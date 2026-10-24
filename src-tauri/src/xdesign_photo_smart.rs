//! Smart-object contents are isolated native drafts. Applying a draft updates
//! its pinned parent in one undoable edit; failed saves leave the parent intact.
use super::{check_size, PhotoSession, MAX_INPUT_BYTES};
use photocraft_engine::{
    doc::{DocId, LayerContent, LayerId},
    smart_cmds::{self, SmartLink},
    Session,
};
use serde::{Deserialize, Serialize};

#[path = "xdesign_photo_smart_sources.rs"]
mod sources;

pub(super) fn source_bytes(meta: &photocraft_engine::doc::Metadata, source: &photocraft_engine::doc::SmartSource) -> Result<Option<(String, std::sync::Arc<Vec<u8>>)>, String> {
    sources::optional(meta, source)
}
pub(super) fn source_bytes_checked(meta: &photocraft_engine::doc::Metadata, source: &photocraft_engine::doc::SmartSource, before_read: impl FnOnce() -> Result<(), String>) -> Result<Option<(String, std::sync::Arc<Vec<u8>>)>, String> {
    sources::optional_checked(meta, source, before_read)
}
pub(super) fn metadata_source_bytes_checked(meta: &photocraft_engine::doc::Metadata, path: &str, before_read: impl FnOnce() -> Result<(), String>) -> Result<Option<(String, std::sync::Arc<Vec<u8>>)>, String> {
    sources::metadata_checked(meta, path, before_read)
}
#[cfg(test)]
pub(super) fn source_bytes_with_limit(meta: &photocraft_engine::doc::Metadata, source: &photocraft_engine::doc::SmartSource, limit: usize) -> Result<Option<(String, std::sync::Arc<Vec<u8>>)>, String> {
    sources::optional_with_limit(meta, source, limit)
}
#[cfg(test)]
pub(super) fn replay_read_with_limit(reader: &mut impl std::io::Read, limit: usize) -> Result<Vec<u8>, String> { sources::replay_read_with_limit(reader, limit) }

const MASK_COMPAT_BLOCK_BYTES: usize = 32 * 1024 * 1024;
const MASK_COMPAT_PIXELS: usize = 16 * 1024 * 1024;
const MASK_COMPAT_LAYERS: usize = 4096;

pub(super) fn import(name: &str, bytes: &[u8]) -> Result<photocraft_io::ImportResult, String> {
    let mut imported = photocraft_io::import(name, bytes).map_err(|error| error.to_string())?;
    // Native bundles can retain PSD provenance after an intentional mask deletion.
    if photocraft_io::is_psd(bytes) {
        restore_explicit_white_masks(&mut imported);
    }
    Ok(imported)
}

fn restore_explicit_white_masks(imported: &mut photocraft_io::ImportResult) {
    restore_explicit_white_masks_with(imported, |item, sample, stack| {
        matches!(photocraft_io::smart_map::mask_from_item(item, sample, stack), Ok(None))
    });
}

fn restore_explicit_white_masks_with(
    imported: &mut photocraft_io::ImportResult,
    mut is_white: impl FnMut(
        &photocraft_psd::filter_effects::FilterEffectsItem,
        photocraft_engine::doc::SampleType,
        &photocraft_io::smart_map::FilterStack,
    ) -> bool,
) {
    use photocraft_engine::doc::{ColorMode, PixelFormat, SampleType};
    use photocraft_engine::doc::LayerMask;
    use photocraft_raster::Surface;
    use photocraft_io::smart_map;
    use photocraft_psd::filter_effects::FilterEffects;

    let mut sources = Vec::new();
    let mut metadata_bytes = 0usize;
    for (_, _, layer) in imported.document.walk() {
        let LayerContent::Smart(smart) = &layer.content else { continue };
        if smart.filter_mask.is_some() || smart.smart_filters.is_empty() { continue; }
        let Some(data) = layer.psd_blocks.iter().find(|(key, _)| key == b"SoLd")
            .or_else(|| layer.psd_blocks.iter().find(|(key, _)| key == b"SoLE")) else { continue };
        let Some(total) = metadata_bytes.checked_add(data.1.len()).filter(|total| *total <= MASK_COMPAT_BLOCK_BYTES) else {
            imported.warnings.push("Explicit smart filter mask compatibility was skipped: placed descriptors exceed the 32MB compatibility limit".into());
            return;
        };
        if sources.len() >= MASK_COMPAT_LAYERS {
            imported.warnings.push("Explicit smart filter mask compatibility was skipped: more than 4096 placed layers".into());
            return;
        }
        metadata_bytes = total;
        sources.push((layer.id, layer.name.clone(), data.1.clone()));
    }
    if sources.is_empty() { return; }
    let blocks: Vec<_> = imported.document.metadata.psd_global_blocks.iter()
        .filter(|(_, key, _)| matches!(key, b"FEid" | b"FXid")).collect();
    if blocks.iter().try_fold(metadata_bytes, |total, (_, _, data)| total.checked_add(data.len()))
        .is_none_or(|total| total > MASK_COMPAT_BLOCK_BYTES) {
        imported.warnings.push("Explicit smart filter mask compatibility was skipped: filter cache and placed descriptors exceed the 32MB compatibility limit".into());
        return;
    }
    let candidates: Vec<_> = sources.into_iter().filter_map(|(id, name, data)| {
        let placed = smart_map::parse_sold(&data)?;
        let Some(photocraft_psd::descriptor::Value::Descriptor(fx)) = placed.descriptor.get("filterFX") else { return None };
        if !matches!(fx.get("filterMaskEnable"), Some(photocraft_psd::descriptor::Value::Boolean(_))) { return None; }
        let stack = placed.stack?;
        if stack.filters.is_empty() || placed.placed.is_empty() { return None; }
        Some((id, name, placed.placed, stack))
    }).collect();
    if candidates.is_empty() { return; }
    let items: Vec<_> = blocks.into_iter().filter_map(|(_, _, data)| FilterEffects::parse(data).ok())
        .flat_map(|effects| effects.items).collect();
    let sample = imported.document.depth;
    let expected_depth = match sample { SampleType::U8 => 8, SampleType::U16 => 16, SampleType::F32 => 32 };
    let mut white_items = std::collections::HashMap::new();
    for (id, name, placed, stack) in candidates {
        // The first matching cache is authoritative, including when its mask is malformed.
        let Some((index, item)) = items.iter().enumerate().find(|(_, item)| item.id == placed) else { continue };
        if item.version != 1 || item.depth != expected_depth { continue; }
        let Some((rect, _)) = &item.mask else { continue };
        let Ok((width, height)) = rect.size() else { continue };
        if width == 0 || height == 0 { continue; }
        if width.checked_mul(height).is_none_or(|pixels| pixels > MASK_COMPAT_PIXELS) {
            imported.warnings.push(format!("layer \"{name}\": explicit smart filter mask compatibility was skipped: mask exceeds the 16MP compatibility limit"));
            continue;
        }
        // White detection does not depend on per-layer enabled/linked flags.
        if !*white_items.entry(index).or_insert_with(|| is_white(item, sample, &stack)) { continue; }
        if let Some(layer) = imported.document.layer_mut(id) {
            if let LayerContent::Smart(smart) = &mut layer.content {
                smart.filter_mask = Some(LayerMask {
                    surface: Surface::with_default(PixelFormat::new(ColorMode::Grayscale, sample, false), &[1.0]),
                    enabled: stack.mask_enabled, linked: stack.mask_linked, density: 1.0, feather: 0.0,
                });
            }
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DraftLink {
    pub parent_id: String,
    pub parent_version: String,
    pub layer: u64,
}

pub(super) fn open(parent: &PhotoSession, layer: u64) -> Result<PhotoSession, String> {
    let state = parent.engine.active().ok_or("No parent image document")?;
    let layer = state
        .doc
        .layer(LayerId(layer))
        .ok_or("The layer no longer exists")?;
    let LayerContent::Smart(smart) = &layer.content else {
        return Err("Select a smart-object layer".into());
    };
    let (name, bytes) = sources::resolve(&state.doc.metadata, &smart.source)?;
    if bytes.len() as u64 > MAX_INPUT_BYTES {
        return Err("Smart-object contents exceed the 512MB import limit".into());
    }
    let mut document = import(&name, &bytes)
        .map_err(|error| format!("can't read smart object contents \"{name}\": {error}"))?.document;
    document.id = DocId::fresh();
    document.name = name;
    let mut engine = Session::new();
    engine.color.settings=parent.engine.color.settings.clone();
    engine.add_document(document, None);
    check_size(&engine)?;
    Ok(PhotoSession {
        engine,color_settings:parent.color_settings.clone(),
        version: String::new(),
        original_path: None,
        writer: Default::default(),
    })
}

pub(super) fn apply(
    parent: &mut PhotoSession,
    child: &PhotoSession,
    layer: u64,
) -> Result<(), String> {
    let before = parent
        .engine
        .active()
        .cloned()
        .ok_or("No parent image document")?;
    if parent.engine.documents().len() != 1 {
        return Err("Reopen the parent image".into());
    }
    let mut contents = (*child.engine.active().ok_or("No smart-object contents")?.doc).clone();
    contents.id = DocId::fresh();
    let index = parent.engine.add_document(contents, None);
    let child_id = parent.engine.documents()[index].doc.id;
    parent.engine.smart_links.push(SmartLink {
        child: child_id,
        parent: before.doc.id,
        layer: LayerId(layer),
    });
    let result = smart_cmds::commit_child(&mut parent.engine, index).map_err(|e| e.to_string());
    // Detach before closing so a failed commit cannot be retried implicitly.
    parent
        .engine
        .smart_links
        .retain(|link| link.child != child_id);
    parent.engine.close(index);
    parent.engine.set_active(0);
    if let Err(error) = result {
        *parent.engine.active_mut().ok_or("No parent image")? = before;
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use photocraft_psd::{PsdBuilder, PsdFile, PixelData, LayerSpec, GroupSpec, TaggedBlock, Version, Compression};
    use photocraft_psd::descriptor::{Descriptor, UnicodeString, Value, VersionedDescriptor};

    fn white_sample(depth: u16) -> Vec<u8> {
        match depth { 8 => vec![255], 16 => 65535u16.to_be_bytes().to_vec(), 32 => 1f32.to_be_bytes().to_vec(), _ => panic!("fixture depth") }
    }

    // Framing and mask samples are authored independently of smart_map's mask/export writers.
    fn effect_item(id: &str, depth: u16, rect: [i32; 4], plane: Option<&[u8]>) -> Vec<u8> {
        let mut item = Vec::new();
        for coordinate in [0i32, 0, 4, 4] { item.extend(coordinate.to_be_bytes()); }
        item.extend(u32::from(depth).to_be_bytes());
        item.extend(0u32.to_be_bytes());
        item.extend([0u8; 8]);
        let mut body = vec![id.len() as u8];
        body.extend(id.as_bytes());
        body.extend(1u32.to_be_bytes());
        body.extend((item.len() as u64).to_be_bytes());
        body.extend(item);
        body.push(u8::from(plane.is_some()));
        if let Some(plane) = plane {
            for coordinate in rect { body.extend(coordinate.to_be_bytes()); }
            body.extend((plane.len() as u64 + 2).to_be_bytes());
            body.extend(0u16.to_be_bytes());
            body.extend(plane);
        }
        let mut section = (body.len() as u64).to_be_bytes().to_vec();
        section.extend(body);
        section.resize(section.len().next_multiple_of(4), 0);
        section
    }

    fn effects(items: Vec<Vec<u8>>) -> Vec<u8> {
        let mut bytes = 3u32.to_be_bytes().to_vec();
        for item in items { bytes.extend(item); }
        bytes
    }

    fn placed_block(id: &str, enabled: Option<bool>, linked: bool) -> TaggedBlock {
        placed_block_value(id, enabled.map(Value::Boolean), linked)
    }

    fn placed_block_value(id: &str, enabled: Option<Value>, linked: bool) -> TaggedBlock {
        let filter = Descriptor::new("filterFX")
            .with("Nm  ", Value::Text(UnicodeString::new("Fixture passthrough")))
            .with("filterID", Value::Integer(1_234_567))
            .with("Fltr", Value::Descriptor(Descriptor::new("fixtureUnknownFilter")));
        let mut fx = Descriptor::new("filterFXStyle")
            .with("enab", Value::Boolean(true))
            .with("filterMaskLinked", Value::Boolean(linked))
            .with("filterMaskExtendWithWhite", Value::Boolean(true))
            .with("filterFXList", Value::List(vec![Value::Descriptor(filter)]));
        if let Some(enabled) = enabled { fx = fx.with("filterMaskEnable", enabled); }
        let descriptor = Descriptor::new("soLD")
            .with("Idnt", Value::Text(UnicodeString::new("fixture-source")))
            .with("placed", Value::Text(UnicodeString::new(id)))
            .with("Sz  ", Value::Descriptor(Descriptor::new("Pnt ")
                .with("Wdth", Value::Double(4.0)).with("Hght", Value::Double(4.0))))
            .with("filterFX", Value::Descriptor(fx));
        let mut bytes = b"soLD".to_vec();
        bytes.extend(4u32.to_be_bytes());
        bytes.extend(VersionedDescriptor::new(descriptor).to_bytes());
        TaggedBlock::new(*b"SoLd", bytes)
    }

    fn fixture(version: Version, depth: u16, layers: &[(&str, Option<bool>, bool)], cache: Vec<u8>) -> Vec<u8> {
        let pixels: Vec<u8> = (0..16).flat_map(|index| [index * 11, 80, 170, 255]).collect();
        let mut builder = PsdBuilder::new(4, 4).version(version).compression(Compression::Raw);
        builder.begin_group(GroupSpec::new("Nested"));
        for (id, _, _) in layers { builder.push_layer(LayerSpec::new(*id, 0, 0, 4, 4, PixelData::Rgba8(pixels.clone()))); }
        builder.end_group().unwrap();
        builder.composite(PixelData::Rgba8(pixels));
        let mut file = PsdFile::from_bytes(&builder.to_bytes().unwrap()).unwrap();
        if depth != 8 {
            let convert = |bytes: Vec<u8>| -> Vec<u8> {
                bytes.into_iter().flat_map(|value| match depth {
                    16 => ((u32::from(value) * 65535 / 255) as u16).to_be_bytes().to_vec(),
                    32 => (f32::from(value) / 255.0).to_be_bytes().to_vec(),
                    _ => panic!("fixture depth"),
                }).collect()
            };
            for layer in file.layers_mut() {
                let (width, height) = layer.rect.size().unwrap();
                for channel in &mut layer.channels {
                    let decoded = channel.decode(width, height, 8, version).unwrap();
                    *channel = photocraft_psd::ChannelData::encode(channel.id, Compression::Raw, &convert(decoded), width, height, depth, version).unwrap();
                }
            }
            let merged = file.image_data.decode(&file.header).unwrap();
            file.header.depth = depth;
            file.image_data = photocraft_psd::ImageData::encode(Compression::Raw, &convert(merged), &file.header).unwrap();
        }
        let source = file.to_bytes().unwrap();
        for layer in file.layers_mut() {
            if let Some((id, enabled, linked)) = layers.iter().find(|(id, _, _)| *id == layer.name()) {
                layer.blocks.push(placed_block(id, *enabled, *linked));
            }
        }
        file.global_blocks.push(TaggedBlock::new(*b"FEid", cache));
        file.global_blocks.push(TaggedBlock::new(*b"lnk2", photocraft_io::linked::encode_linked_file(&photocraft_io::linked::LinkedFile {
            uuid: "fixture-source".into(), file_name: "source.psd".into(), bytes: source,
        })));
        file.to_bytes().unwrap()
    }

    fn smart_layer<'a>(document: &'a photocraft_engine::doc::Document, name: &str) -> (LayerId, &'a photocraft_engine::doc::SmartObject) {
        let layer = document.walk().into_iter().find(|(_, _, layer)| layer.name == name).unwrap().2;
        let LayerContent::Smart(smart) = &layer.content else { panic!("fixture smart layer") };
        (layer.id, smart)
    }

    fn assert_white_mask(document: &photocraft_engine::doc::Document, name: &str, enabled: bool, linked: bool) {
        let mask = smart_layer(document, name).1.filter_mask.as_ref().unwrap();
        assert_eq!((mask.enabled, mask.linked, mask.density, mask.feather), (enabled, linked, 1.0, 0.0));
        assert_eq!(mask.surface.format().sample, document.depth);
        assert!(mask.surface.content_bounds().is_empty());
        assert_eq!(mask.surface.pixel(-500, 500), vec![1.0]);
    }

    #[test]
    fn explicit_white_psd_psb_masks_preserve_raw_flags_pixels_native_and_export_state() {
        for version in [Version::Psd, Version::Psb] { for depth in [8, 16, 32] { for linked in [false, true] { for enabled in [false, true] {
            let plane = white_sample(depth).repeat(16);
            let bytes = fixture(version, depth, &[("placed-a", Some(enabled), linked)], effects(vec![effect_item("placed-a", depth, [-2, -3, 2, 1], Some(&plane))]));
            let ordinary = photocraft_io::import("fixture.psd", &bytes).unwrap();
            assert!(smart_layer(&ordinary.document, "placed-a").1.filter_mask.is_none(), "fixture must reproduce the native omission");
            let omitted = photocraft_format::save_to_bytes(&ordinary.document, &Default::default()).unwrap();
            assert!(smart_layer(&import("omitted.pcraft", &omitted).unwrap().document, "placed-a").1.filter_mask.is_none());
            let fixed = import("fixture.psd", &bytes).unwrap();
            assert_white_mask(&fixed.document, "placed-a", enabled, linked);
            assert_eq!(fixed.document.mode, ordinary.document.mode);
            assert_eq!(fixed.document.depth, ordinary.document.depth);
            assert_eq!(fixed.document.icc_profile, ordinary.document.icc_profile);
            assert_eq!(fixed.document.metadata.psd_global_blocks, ordinary.document.metadata.psd_global_blocks);
            assert_eq!(photocraft_compose::flatten(&fixed.document).px, photocraft_compose::flatten(&ordinary.document).px);
            assert_eq!(fixed.warnings, ordinary.warnings);
            let (id, smart) = smart_layer(&fixed.document, "placed-a");
            assert_eq!(smart.smart_filters, smart_layer(&ordinary.document, "placed-a").1.smart_filters);
            assert_eq!(smart.cache, smart_layer(&ordinary.document, "placed-a").1.cache);
            let mut engine = Session::new(); engine.add_document(fixed.document, None);
            engine.execute("layer.smartFilter.disableFilterMask", json!({"layer":id.0,"enabled":!enabled})).unwrap();
            assert_white_mask(&engine.active().unwrap().doc, "placed-a", !enabled, linked);
            engine.execute("edit.undo", json!({})).unwrap();
            assert_white_mask(&engine.active().unwrap().doc, "placed-a", enabled, linked);
            engine.execute("edit.redo", json!({})).unwrap();
            assert_white_mask(&engine.active().unwrap().doc, "placed-a", !enabled, linked);
            assert_eq!(photocraft_compose::flatten(&engine.active().unwrap().doc).px, photocraft_compose::flatten(&ordinary.document).px);
            let native = photocraft_format::save_to_bytes(&engine.active().unwrap().doc, &Default::default()).unwrap();
            assert_white_mask(&import("state.pcraft", &native).unwrap().document, "placed-a", !enabled, linked);
            engine.execute("layer.smartFilter.disableFilterMask", json!({"layer":id.0,"enabled":enabled})).unwrap();
            for format in ["psd", "psb"] {
                let exported = photocraft_io::export(&engine.active().unwrap().doc, format, &Default::default()).unwrap();
                let reopened = import(&format!("state.{format}"), &exported.bytes).unwrap();
                assert_white_mask(&reopened.document, "placed-a", enabled, linked);
                assert_eq!(photocraft_compose::flatten(&reopened.document).px, photocraft_compose::flatten(&engine.active().unwrap().doc).px);
            }
        } } } }
    }

    #[test]
    fn explicit_white_masks_bind_first_placed_id_and_leave_other_mask_semantics_unchanged() {
        let white = [255u8; 16]; let gray = [128u8; 16];
        let layers = [("a", Some(false), true), ("b", Some(false), false), ("c", Some(true), true), ("d", None, true), ("e", Some(false), true), ("f", Some(false), true)];
        let cache = effects(vec![effect_item("b", 8, [0, 0, 4, 4], Some(&gray)), effect_item("a", 8, [0, 0, 4, 4], Some(&white)),
            effect_item("c", 8, [0, 0, 4, 4], Some(&white)), effect_item("d", 8, [0, 0, 4, 4], Some(&white)),
            effect_item("e", 8, [0, 0, 4, 4], None), effect_item("e", 8, [0, 0, 4, 4], Some(&white)),
            effect_item("unbound", 8, [0, 0, 4, 4], Some(&white))]);
        for version in [Version::Psd, Version::Psb] {
            let bytes = fixture(version, 8, &layers, cache.clone());
            let mut file = PsdFile::from_bytes(&bytes).unwrap();
            file.global_blocks.push(TaggedBlock::new(*b"FXid", effects(vec![
                effect_item("f", 8, [0, 0, 4, 4], Some(&white)), effect_item("e", 8, [0, 0, 4, 4], Some(&white)),
            ])));
            let bytes = file.to_bytes().unwrap();
            let ordinary = photocraft_io::import("fixture.psd", &bytes).unwrap();
            let fixed = import("fixture.psd", &bytes).unwrap();
            assert_white_mask(&fixed.document, "a", false, true);
            assert_white_mask(&fixed.document, "c", true, true);
            assert_white_mask(&fixed.document, "f", false, true);
            for name in ["b", "d", "e"] { assert_eq!(smart_layer(&fixed.document, name).1.filter_mask, smart_layer(&ordinary.document, name).1.filter_mask, "{name}"); }
            assert_eq!(photocraft_compose::flatten(&fixed.document).px, photocraft_compose::flatten(&ordinary.document).px);
        }
    }

    #[test]
    fn explicit_white_duplicate_placed_ids_decode_once_and_keep_each_layers_flags() {
        for version in [Version::Psd, Version::Psb] { for depth in [8, 16, 32] {
            let white = white_sample(depth).repeat(16);
            let layers = [("linked", Some(false), true), ("unlinked", Some(false), false),
                ("enabled-linked", Some(true), true), ("enabled-unlinked", Some(true), false),
                ("bad-linked", Some(false), true), ("bad-unlinked", Some(false), false)];
            let cache = effects(vec![
                effect_item("shared", depth, [0, 0, 4, 4], Some(&white)),
                effect_item("shared", depth, [0, 0, 4, 4], Some(&vec![0; white.len()])),
                effect_item("bad", depth, [0, 0, 4, 4], Some(&white[..white.len() - 1])),
                effect_item("bad", depth, [0, 0, 4, 4], Some(&white)),
            ]);
            let mut file = PsdFile::from_bytes(&fixture(version, depth, &layers, cache)).unwrap();
            for layer in file.layers_mut() {
                if let Some((name, enabled, linked)) = layers.iter().find(|(name, _, _)| *name == layer.name()) {
                    let placed = if name.starts_with("bad-") { "bad" } else { "shared" };
                    *layer.blocks.iter_mut().find(|block| block.key == *b"SoLd").unwrap() = placed_block(placed, *enabled, *linked);
                }
            }
            let bytes = file.to_bytes().unwrap();
            let ordinary = photocraft_io::import("duplicates.psd", &bytes).unwrap();
            let pixels = photocraft_compose::flatten(&ordinary.document).px;
            for _ in 0..2 {
                let mut repaired = ordinary.clone();
                let mut decodes = std::collections::BTreeMap::new();
                restore_explicit_white_masks_with(&mut repaired, |item, sample, stack| {
                    *decodes.entry(item.id.clone()).or_insert(0usize) += 1;
                    matches!(photocraft_io::smart_map::mask_from_item(item, sample, stack), Ok(None))
                });
                assert_eq!(decodes, std::collections::BTreeMap::from([("bad".to_owned(), 1usize), ("shared".to_owned(), 1usize)]));
                assert_white_mask(&repaired.document, "linked", false, true);
                assert_white_mask(&repaired.document, "unlinked", false, false);
                assert_white_mask(&repaired.document, "enabled-linked", true, true);
                assert_white_mask(&repaired.document, "enabled-unlinked", true, false);
                for name in ["bad-linked", "bad-unlinked"] { assert!(smart_layer(&repaired.document, name).1.filter_mask.is_none()); }
                assert_eq!(repaired.warnings, ordinary.warnings);
                assert_eq!(repaired.document.metadata.psd_global_blocks, ordinary.document.metadata.psd_global_blocks);
                assert_eq!(photocraft_compose::flatten(&repaired.document).px, pixels);
                for (name, _, _) in layers {
                    assert_eq!(smart_layer(&repaired.document, name).1.cache, smart_layer(&ordinary.document, name).1.cache);
                    assert_eq!(smart_layer(&repaired.document, name).1.smart_filters, smart_layer(&ordinary.document, name).1.smart_filters);
                }
            }
            let imported = import("duplicates.psd", &bytes).unwrap();
            assert_white_mask(&imported.document, "linked", false, true);
            assert_white_mask(&imported.document, "unlinked", false, false);
            assert_white_mask(&imported.document, "enabled-linked", true, true);
            assert_white_mask(&imported.document, "enabled-unlinked", true, false);
            for name in ["bad-linked", "bad-unlinked"] { assert!(smart_layer(&imported.document, name).1.filter_mask.is_none()); }
        } }
    }

    #[test]
    fn explicit_white_predicate_reuse_never_decodes_ineligible_or_guarded_items() {
        let white = [255; 16];
        let bytes = fixture(Version::Psd, 8, &[("implicit", None, true)], effects(vec![effect_item("implicit", 8, [0, 0, 4, 4], Some(&white))]));
        let mut no_candidates = photocraft_io::import("implicit.psd", &bytes).unwrap();
        restore_explicit_white_masks_with(&mut no_candidates, |_, _, _| panic!("implicit mask state is not a candidate"));
        for (depth, rect, plane) in [(16, [0, 0, 4, 4], white_sample(16).repeat(16)),
            (8, [4, 0, 0, 4], white.to_vec()), (8, [0, 0, 0, 4], vec![]), (8, [0, 0, 4097, 4097], white.to_vec())] {
            let bytes = fixture(Version::Psd, 8, &[("guarded", Some(false), true)], effects(vec![effect_item("guarded", depth, rect, Some(&plane))]));
            let mut guarded = photocraft_io::import("guarded.psd", &bytes).unwrap();
            restore_explicit_white_masks_with(&mut guarded, |_, _, _| panic!("guarded mask must not decode"));
            assert!(smart_layer(&guarded.document, "guarded").1.filter_mask.is_none());
        }
        let bytes = fixture(Version::Psd, 8, &[("restored", Some(false), true)], effects(vec![effect_item("restored", 8, [0, 0, 4, 4], Some(&white))]));
        let mut restored = import("restored.psd", &bytes).unwrap();
        restore_explicit_white_masks_with(&mut restored, |_, _, _| panic!("existing mask must not decode"));
        assert_white_mask(&restored.document, "restored", false, true);
        let mut unknown = effect_item("unknown", 8, [0, 0, 4, 4], Some(&white));
        let version_offset = 8 + 1 + "unknown".len();
        unknown[version_offset..version_offset + 4].copy_from_slice(&2u32.to_be_bytes());
        let bytes = fixture(Version::Psb, 8, &[("unknown", Some(false), true)], effects(vec![unknown]));
        let mut unknown = photocraft_io::import("unknown.psb", &bytes).unwrap();
        restore_explicit_white_masks_with(&mut unknown, |_, _, _| panic!("unknown item version must not decode"));
        assert!(smart_layer(&unknown.document, "unknown").1.filter_mask.is_none());
    }

    #[test]
    fn explicit_white_psd_psb_import_requires_actual_boolean_mask_enable_field() {
        let white = [255; 16];
        let fields = [None, Some(Value::Integer(0)), Some(Value::Integer(1)), Some(Value::Double(1.0)),
            Some(Value::Text(UnicodeString::new("true"))), Some(Value::Text(UnicodeString::new("false"))),
            Some(Value::List(vec![Value::Boolean(true)])), Some(Value::Descriptor(Descriptor::new("futureState")))];
        for version in [Version::Psd, Version::Psb] { for field in &fields {
            let bytes = fixture(version, 8, &[("invalid", None, true)], effects(vec![effect_item("invalid", 8, [0, 0, 4, 4], Some(&white))]));
            let mut file = PsdFile::from_bytes(&bytes).unwrap();
            let layer = file.layers_mut().iter_mut().find(|layer| layer.name() == "invalid").unwrap();
            *layer.blocks.iter_mut().find(|block| block.key == *b"SoLd").unwrap() = placed_block_value("invalid", field.clone(), true);
            let bytes = file.to_bytes().unwrap();
            let ordinary = photocraft_io::import("invalid.psd", &bytes).unwrap();
            let mut guarded = ordinary.clone();
            restore_explicit_white_masks_with(&mut guarded, |_, _, _| panic!("non-Boolean mask state must not decode"));
            let imported = import("invalid.psd", &bytes).unwrap();
            for candidate in [&guarded, &imported] {
                assert!(smart_layer(&candidate.document, "invalid").1.filter_mask.is_none());
                assert_eq!(candidate.warnings, ordinary.warnings);
                assert_eq!(candidate.document.metadata.psd_global_blocks, ordinary.document.metadata.psd_global_blocks);
                assert_eq!(smart_layer(&candidate.document, "invalid").1.psd_raw, smart_layer(&ordinary.document, "invalid").1.psd_raw);
                assert_eq!(photocraft_compose::flatten(&candidate.document).px, photocraft_compose::flatten(&ordinary.document).px);
            }
        } }
    }

    #[test]
    fn disabled_white_mask_repair_refuses_corrupt_depth_bounds_and_retained_native_provenance() {
        for (depth, rect, plane) in [(16, [0, 0, 4, 4], white_sample(16).repeat(16)), (8, [0, 0, 4, 4], vec![255; 15]),
            (8, [4, 0, 0, 4], vec![255; 16]), (8, [0, 0, 0, 4], vec![]), (8, [0, 0, 4097, 4097], vec![255; 16])] {
            let bytes = fixture(Version::Psd, 8, &[("a", Some(false), true)], effects(vec![effect_item("a", depth, rect, Some(&plane))]));
            let fixed = import("fixture.psd", &bytes).unwrap();
            assert!(smart_layer(&fixed.document, "a").1.filter_mask.is_none());
            if rect[2] == 4097 { assert!(fixed.warnings.iter().any(|warning| warning.contains("16MP compatibility limit"))); }
        }
        let white = [255; 16];
        let bytes = fixture(Version::Psd, 8, &[("a", Some(false), true)], effects(vec![effect_item("a", 8, [0, 0, 4, 4], Some(&white))]));
        let ordinary = photocraft_io::import("fixture.psd", &bytes).unwrap();
        let native = photocraft_format::save_to_bytes(&ordinary.document, &Default::default()).unwrap();
        assert!(smart_layer(&import("deleted.pcraft", &native).unwrap().document, "a").1.filter_mask.is_none());
        let mut fixed = import("fixture.psd", &bytes).unwrap();
        let (id, _) = smart_layer(&fixed.document, "a");
        let mut engine = Session::new(); engine.add_document(fixed.document.clone(), None);
        engine.execute("layer.smartFilter.deleteFilterMask", json!({"layer":id.0})).unwrap();
        let native = photocraft_format::save_to_bytes(&engine.active().unwrap().doc, &Default::default()).unwrap();
        assert!(smart_layer(&import("deleted.pcraft", &native).unwrap().document, "a").1.filter_mask.is_none());
        if let LayerContent::Smart(smart) = &mut fixed.document.layer_mut(id).unwrap().content { smart.filter_mask = None; }
        fixed.document.metadata.psd_global_blocks.push((*b"8BIM", *b"FXid", std::sync::Arc::new(vec![0; MASK_COMPAT_BLOCK_BYTES + 1])));
        restore_explicit_white_masks(&mut fixed);
        assert!(smart_layer(&fixed.document, "a").1.filter_mask.is_none());
        assert!(fixed.warnings.iter().any(|warning| warning.contains("32MB compatibility limit")));
        let mut oversized = ordinary.clone();
        let (_, _, layer) = oversized.document.walk().into_iter().find(|(_, _, layer)| layer.name == "a").unwrap();
        let id = layer.id;
        oversized.document.layer_mut(id).unwrap().psd_blocks.iter_mut().find(|(key, _)| key == b"SoLd").unwrap().1 = std::sync::Arc::new(vec![0; MASK_COMPAT_BLOCK_BYTES + 1]);
        restore_explicit_white_masks(&mut oversized);
        assert!(smart_layer(&oversized.document, "a").1.filter_mask.is_none());
        assert!(oversized.warnings.iter().any(|warning| warning.contains("placed descriptors exceed the 32MB")));
        drop(oversized);
        let mut too_many = ordinary.clone();
        let layer = too_many.document.layer(smart_layer(&too_many.document, "a").0).unwrap().clone();
        too_many.document.layers = vec![layer; MASK_COMPAT_LAYERS + 1];
        restore_explicit_white_masks(&mut too_many);
        assert!(too_many.document.walk().into_iter().all(|(_, _, layer)| matches!(&layer.content, LayerContent::Smart(smart) if smart.filter_mask.is_none())));
        assert!(too_many.warnings.iter().any(|warning| warning.contains("more than 4096")));
        let mut unknown_item_version = effect_item("a", 8, [0, 0, 4, 4], Some(&white));
        unknown_item_version[10..14].copy_from_slice(&2u32.to_be_bytes());
        let unknown = fixture(Version::Psd, 8, &[("a", Some(false), true)], effects(vec![unknown_item_version]));
        assert!(smart_layer(&import("unknown.psd", &unknown).unwrap().document, "a").1.filter_mask.is_none());
        let malformed = fixture(Version::Psb, 8, &[("a", Some(false), true)], vec![0, 0, 0, 3, 0]);
        let ordinary = photocraft_io::import("fixture.psb", &malformed).unwrap();
        let fixed = import("fixture.psb", &malformed).unwrap();
        assert!(smart_layer(&fixed.document, "a").1.filter_mask.is_none());
        assert_eq!(fixed.warnings, ordinary.warnings);
    }

    #[test]
    fn contents_are_isolated_layered_and_commit_preserves_filters_and_parent_undo() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":24,"height":24,"background":"white"}),
            )
            .unwrap();
        engine
            .execute("layer.smartObjects.convertToSmartObject", json!({}))
            .unwrap();
        engine
            .execute("filter.blur.gaussianBlur", json!({"radius":1}))
            .unwrap();
        let layer = engine.active().unwrap().active_layer.unwrap().0;
        let mut parent = PhotoSession {
            engine,color_settings:None,
            version: "parent".into(),
            original_path: None,
            writer: Default::default(),
        };
        let original = parent.engine.active().unwrap().doc.clone();
        let mut child = open(&parent, layer).unwrap();
        child
            .engine
            .execute("layer.new.layer", json!({"name":"Inside"}))
            .unwrap();
        child
            .engine
            .execute(
                "paint.stroke",
                json!({"points":[[8,8,1],[16,16,1]],"size":8,"color":"#ff0000"}),
            )
            .unwrap();
        assert!(std::sync::Arc::ptr_eq(
            &original,
            &parent.engine.active().unwrap().doc
        ));
        apply(&mut parent, &child, layer).unwrap();
        assert_eq!(parent.engine.documents().len(), 1);
        let LayerContent::Smart(smart) = &parent
            .engine
            .active()
            .unwrap()
            .doc
            .layer(LayerId(layer))
            .unwrap()
            .content
        else {
            panic!("smart object lost")
        };
        assert_eq!(smart.smart_filters.len(), 1);
        let reopened = open(&parent, layer).unwrap();
        assert!(reopened
            .engine
            .active()
            .unwrap()
            .doc
            .walk()
            .iter()
            .any(|(_, _, layer)| layer.name == "Inside"));
        parent.engine.execute("edit.undo", json!({})).unwrap();
        assert!(open(&parent, layer)
            .unwrap()
            .engine
            .active()
            .unwrap()
            .doc
            .walk()
            .iter()
            .all(|(_, _, layer)| layer.name != "Inside"));
        let before = parent.engine.active().unwrap().doc.clone();
        assert!(apply(&mut parent, &child, u64::MAX).is_err());
        assert_eq!(parent.engine.documents().len(), 1);
        assert!(std::sync::Arc::ptr_eq(
            &before,
            &parent.engine.active().unwrap().doc
        ));
    }
}
