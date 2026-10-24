use photocraft_engine::doc::{Metadata, SmartSource};
use std::{io::Read, path::Path, sync::Arc};

const DESCRIPTOR_LIMIT: usize = 32 * 1024 * 1024;
const SOURCE_LIMIT_ERROR: &str = "Smart-object contents exceed the 512MB import limit";
const METADATA_LIMIT_ERROR: &str = "Smart-object linked metadata exceeds the 32MB metadata limit";
const UNAVAILABLE: &str = "The smart object's source is unavailable";

pub(super) fn resolve(meta: &Metadata, source: &SmartSource) -> Result<(String, Arc<Vec<u8>>), String> {
    resolve_with_limit(meta, source, super::super::MAX_INPUT_BYTES as usize)
}

pub(super) fn optional(meta: &Metadata, source: &SmartSource) -> Result<Option<(String, Arc<Vec<u8>>)>, String> {
    match resolve(meta, source) { Ok(source) => Ok(Some(source)), Err(error) if error == UNAVAILABLE => Ok(None), Err(error) => Err(error) }
}

pub(super) fn optional_checked(meta: &Metadata, source: &SmartSource, before_read: impl FnOnce() -> Result<(), String>) -> Result<Option<(String, Arc<Vec<u8>>)>, String> {
    let mut admission = Some(before_read);
    let mut rejected = false;
    let mut check = || {
        let result = admission.take().ok_or_else(|| "Smart-object source admission was repeated".to_owned()).and_then(|check| check());
        rejected = result.is_err(); result
    };
    match resolve_with_limits_checked(meta, source, super::super::MAX_INPUT_BYTES as usize, DESCRIPTOR_LIMIT, &mut check) {
        Ok(source) => Ok(Some(source)), Err(error) if error == UNAVAILABLE && !rejected => Ok(None), Err(error) => Err(error),
    }
}

pub(super) fn metadata_checked(meta: &Metadata, path: &str, before_read: impl FnOnce() -> Result<(), String>) -> Result<Option<(String, Arc<Vec<u8>>)>, String> {
    let mut admission = Some(before_read);
    linked_metadata(meta, path, super::super::MAX_INPUT_BYTES as usize, DESCRIPTOR_LIMIT, &mut || {
        admission.take().ok_or_else(|| "Smart-object source admission was repeated".to_owned()).and_then(|check| check())
    })
}

#[cfg(test)]
pub(super) fn optional_with_limit(meta: &Metadata, source: &SmartSource, limit: usize) -> Result<Option<(String, Arc<Vec<u8>>)>, String> {
    match resolve_with_limit(meta, source, limit) { Ok(source) => Ok(Some(source)), Err(error) if error == UNAVAILABLE => Ok(None), Err(error) => Err(error) }
}

#[cfg(test)]
pub(super) fn replay_read_with_limit(reader: &mut impl Read, limit: usize) -> Result<Vec<u8>, String> { read_bounded(reader, limit) }

fn resolve_with_limit(meta: &Metadata, source: &SmartSource, limit: usize) -> Result<(String, Arc<Vec<u8>>), String> {
    resolve_with_limits(meta, source, limit, DESCRIPTOR_LIMIT)
}

fn resolve_with_limits(meta: &Metadata, source: &SmartSource, limit: usize, metadata_limit: usize) -> Result<(String, Arc<Vec<u8>>), String> {
    resolve_with_limits_checked(meta, source, limit, metadata_limit, &mut || Ok(()))
}

fn linked_metadata(meta: &Metadata, path: &str, limit: usize, metadata_limit: usize, before_read: &mut dyn FnMut() -> Result<(), String>) -> Result<Option<(String, Arc<Vec<u8>>)>, String> {
    if path.is_empty() { return Ok(None); }
    for (_, key, data) in &meta.psd_global_blocks {
        if matches!(key, b"lnk2" | b"lnk3" | b"lnkD") {
            if let Some(found) = linked_checked(data, path, limit, metadata_limit, before_read)? { return Ok(Some(found)); }
        }
    }
    Ok(None)
}

fn resolve_with_limits_checked(meta: &Metadata, source: &SmartSource, limit: usize, metadata_limit: usize, before_read: &mut dyn FnMut() -> Result<(), String>) -> Result<(String, Arc<Vec<u8>>), String> {
    match source {
        SmartSource::Embedded { file_name, bytes } => {
            if bytes.len() > limit { return Err(SOURCE_LIMIT_ERROR.into()); }
            if file_name.len() > metadata_limit { return Err(METADATA_LIMIT_ERROR.into()); }
            before_read()?;
            Ok((file_name.clone(), bytes.clone()))
        }
        SmartSource::Linked { path } => {
            if path.is_empty() { return Err(UNAVAILABLE.into()); }
            if let Some(found) = linked_metadata(meta, path, limit, metadata_limit, before_read)? { return Ok(found); }
            let path_ref = Path::new(path);
            let before = std::fs::metadata(path_ref).map_err(|_| UNAVAILABLE)?;
            if !before.is_file() { return Err(UNAVAILABLE.into()); }
            if before.len() > limit as u64 { return Err(SOURCE_LIMIT_ERROR.into()); }
            let mut file = std::fs::File::open(path_ref).map_err(|_| UNAVAILABLE)?;
            let metadata = file.metadata().map_err(|_| UNAVAILABLE)?;
            if !metadata.is_file() { return Err(UNAVAILABLE.into()); }
            if metadata.len() > limit as u64 { return Err(SOURCE_LIMIT_ERROR.into()); }
            before_read()?;
            let bytes = read_bounded(&mut file, limit)?;
            let name = path.rsplit(['/', '\\']).next().unwrap_or(path).to_owned();
            Ok((name, Arc::new(bytes)))
        }
    }
}

fn read_bounded(reader: &mut impl Read, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    loop {
        let remaining = limit - bytes.len();
        let request = chunk.len().min(remaining.saturating_add(1));
        let read = match reader.read(&mut chunk[..request]) {
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            result => result.map_err(|_| UNAVAILABLE)?,
        };
        if read == 0 { return Ok(bytes); }
        if read > remaining { return Err(SOURCE_LIMIT_ERROR.into()); }
        let needed = bytes.len() + read;
        if needed > bytes.capacity() {
            let capacity = bytes.capacity().saturating_mul(2).max(needed).min(limit);
            bytes.try_reserve_exact(capacity - bytes.len()).map_err(|_| "Not enough memory to open the smart object's source")?;
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
}

struct Reader<'a> { data: &'a [u8], offset: usize }
impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let end = self.offset.checked_add(count)?;
        let bytes = self.data.get(self.offset..end)?;
        self.offset = end;
        Some(bytes)
    }
    fn u8(&mut self) -> Option<u8> { Some(*self.take(1)?.first()?) }
    fn u32(&mut self) -> Option<u32> { Some(u32::from_be_bytes(self.take(4)?.try_into().ok()?)) }
    fn u64(&mut self) -> Option<u64> { Some(u64::from_be_bytes(self.take(8)?.try_into().ok()?)) }
}

fn linked_checked(data: &[u8], uuid: &str, limit: usize, metadata_limit: usize, before_read: &mut dyn FnMut() -> Result<(), String>) -> Result<Option<(String, Arc<Vec<u8>>)>, String> {
    let mut block = Reader { data, offset: 0 };
    while let Some(length) = block.u64().and_then(|length| usize::try_from(length).ok()) {
        let Some(item) = block.take(length) else { break; };
        if let Some(found) = linked_item_checked(item, uuid, limit, metadata_limit, before_read)? { return Ok(Some(found)); }
        let Some(aligned) = block.offset.checked_add(3).map(|offset| offset & !3) else { break; };
        block.offset = aligned;
    }
    Ok(None)
}

#[cfg(test)]
fn linked_item(data: &[u8], uuid: &str, limit: usize, metadata_limit: usize) -> Result<Option<(String, Arc<Vec<u8>>)>, String> {
    linked_item_checked(data, uuid, limit, metadata_limit, &mut || Ok(()))
}

fn linked_item_checked(data: &[u8], uuid: &str, limit: usize, metadata_limit: usize, before_read: &mut dyn FnMut() -> Result<(), String>) -> Result<Option<(String, Arc<Vec<u8>>)>, String> {
    let parse = || -> Option<(&[u8], usize, usize, usize)> {
        let mut reader = Reader { data, offset: 0 };
        if reader.take(4)? != b"liFD" { return None; }
        reader.u32()?;
        let id_length = usize::from(reader.u8()?);
        if String::from_utf8_lossy(reader.take(id_length)?) != uuid { return None; }
        let name_length = usize::try_from(reader.u32()?).ok()?.checked_mul(2)?;
        let name = reader.take(name_length)?;
        reader.take(8)?;
        let length = usize::try_from(reader.u64()?).ok()?;
        let descriptor = usize::from(reader.u8()? != 0);
        Some((name, length, reader.offset, descriptor))
    };
    let Some((name, length, mut offset, descriptor)) = parse() else { return Ok(None); };
    if name.len() > metadata_limit { return Err(METADATA_LIMIT_ERROR.into()); }
    if descriptor != 0 {
        let remaining = &data[offset..];
        let prefix = remaining.len().min(metadata_limit - name.len());
        // Parsing only the bounded prefix avoids copying unrelated linked files.
        match photocraft_psd::descriptor::VersionedDescriptor::parse_prefix(&remaining[..prefix]) {
            Ok((_, used)) => offset = offset.checked_add(used).ok_or(UNAVAILABLE)?,
            Err(photocraft_psd::PsdError::UnexpectedEof { needed, .. })
                if needed <= remaining.len() - prefix && prefix < remaining.len() => return Err(METADATA_LIMIT_ERROR.into()),
            Err(_) => return Ok(None),
        }
    }
    let Some(payload) = offset.checked_add(length).and_then(|end| data.get(offset..end)) else { return Ok(None); };
    if length > limit { return Err(SOURCE_LIMIT_ERROR.into()); }
    before_read()?;
    let mut bytes = Vec::new();
    bytes.try_reserve_exact(length).map_err(|_| "Not enough memory to open the smart object's source")?;
    bytes.extend_from_slice(payload);
    let units = name.chunks_exact(2).map(|pair| u16::from_be_bytes([pair[0], pair[1]]));
    let mut file_name: String = char::decode_utf16(units).map(|value| value.unwrap_or(char::REPLACEMENT_CHARACTER)).collect();
    file_name.truncate(file_name.trim_end_matches('\0').len());
    Ok(Some((file_name, Arc::new(bytes))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_io::linked::{encode_linked_file, LinkedFile};

    struct TestDirectory(std::path::PathBuf);
    impl Drop for TestDirectory { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
    fn test_directory() -> TestDirectory {
        let path = std::env::temp_dir().join(format!("xdesign-checked-source-{}", ulid::Ulid::new()));
        std::fs::create_dir(&path).unwrap(); TestDirectory(path)
    }

    #[test]
    fn checked_sources_admit_before_disk_read_and_keep_the_opened_handle() {
        let directory = test_directory(); let path = directory.0.join("source.pcraft");
        std::fs::write(&path, [1, 2, 3]).unwrap();
        let source = SmartSource::Linked { path: path.to_string_lossy().into_owned() };
        let mut calls = 0;
        let resolved = optional_checked(&Metadata::default(), &source, || {
            calls += 1; std::fs::write(&path, [4, 5, 6]).unwrap(); Ok(())
        }).unwrap().unwrap();
        assert_eq!(calls, 1); assert_eq!(resolved.1.as_ref(), &[4, 5, 6]);
        let retained = directory.0.join("opened.pcraft");
        let resolved = optional_checked(&Metadata::default(), &source, || {
            std::fs::rename(&path, &retained).unwrap();
            std::fs::write(&path, [9, 8, 7]).unwrap(); Ok(())
        }).unwrap().unwrap();
        assert_eq!(resolved.1.as_ref(), &[4, 5, 6]);
        assert_eq!(std::fs::read(&path).unwrap(), [9, 8, 7]);
    }

    #[test]
    fn checked_sources_skip_missing_and_refuse_oversize_before_admission() {
        let directory = test_directory(); let path = directory.0.join("source.pcraft");
        let source = SmartSource::Linked { path: path.to_string_lossy().into_owned() };
        assert!(optional_checked(&Metadata::default(), &source, || panic!("missing source admission")).unwrap().is_none());
        std::fs::File::create(&path).unwrap().set_len(super::super::super::MAX_INPUT_BYTES + 1).unwrap();
        assert_eq!(optional_checked(&Metadata::default(), &source, || panic!("oversize source admission")).unwrap_err(), SOURCE_LIMIT_ERROR);
        let oversized = metadata(block(&path.to_string_lossy(), "source.pcraft", vec![1; 5]));
        let mut reject = || panic!("oversize metadata source admission");
        assert_eq!(resolve_with_limits_checked(&oversized, &source, 4, DESCRIPTOR_LIMIT, &mut reject).unwrap_err(), SOURCE_LIMIT_ERROR);
    }

    #[test]
    fn checked_sources_admit_only_the_first_valid_metadata_authority() {
        let mut blocks = frame(&raw_item(b"liFD", 1, "selected", &[65], None, &[1, 2, 3]));
        blocks.truncate(blocks.len() - 2);
        let mut meta = metadata(blocks);
        meta.psd_global_blocks.push((*b"8BIM", *b"lnk3", Arc::new(block("unrelated", "other.pcraft", vec![9]))));
        meta.psd_global_blocks.push((*b"8BIM", *b"lnkD", Arc::new(block("selected", "chosen.pcraft", vec![4, 5, 6]))));
        meta.psd_global_blocks.push((*b"8BIM", *b"lnk2", Arc::new(block("selected", "later.pcraft", vec![7, 8, 9]))));
        let source = SmartSource::Linked { path: "selected".into() }; let mut calls = 0;
        let resolved = optional_checked(&meta, &source, || { calls += 1; Ok(()) }).unwrap().unwrap();
        assert_eq!(calls, 1); assert_eq!(resolved.0, "chosen.pcraft"); assert_eq!(resolved.1.as_ref(), &[4, 5, 6]);
        assert_eq!(optional_checked(&meta, &source, || Err("refused before copy".into())).unwrap_err(), "refused before copy");
    }

    #[test]
    fn checked_sources_never_turn_an_admission_error_into_missing_fallback() {
        let source = SmartSource::Embedded { file_name: "source.pcraft".into(), bytes: Arc::new(vec![1, 2, 3]) };
        assert_eq!(optional_checked(&Metadata::default(), &source, || Err(UNAVAILABLE.into())).unwrap_err(), UNAVAILABLE);
        let admitted = optional_checked(&Metadata::default(), &source, || Ok(())).unwrap().unwrap();
        let SmartSource::Embedded { bytes, .. } = &source else { unreachable!() };
        assert!(Arc::ptr_eq(bytes, &admitted.1));
    }

    fn block(id: &str, name: &str, bytes: Vec<u8>) -> Vec<u8> {
        encode_linked_file(&LinkedFile { uuid: id.into(), file_name: name.into(), bytes })
    }
    fn metadata(bytes: Vec<u8>) -> Metadata {
        let mut meta = Metadata::default();
        meta.psd_global_blocks.push((*b"8BIM", *b"lnk2", Arc::new(bytes)));
        meta
    }

    fn raw_item(kind: &[u8; 4], version: u32, id: &str, name: &[u16], descriptor: Option<&[u8]>, payload: &[u8]) -> Vec<u8> {
        let mut item = kind.to_vec();
        item.extend(version.to_be_bytes());
        item.push(id.len() as u8);
        item.extend(id.as_bytes());
        item.extend((name.len() as u32).to_be_bytes());
        for unit in name { item.extend(unit.to_be_bytes()); }
        item.extend(b"8BPS8BIM");
        item.extend((payload.len() as u64).to_be_bytes());
        item.push(u8::from(descriptor.is_some()));
        if let Some(descriptor) = descriptor { item.extend(descriptor); }
        item.extend(payload);
        item
    }

    fn frame(item: &[u8]) -> Vec<u8> {
        let mut block = (item.len() as u64).to_be_bytes().to_vec();
        block.extend(item);
        block.resize(block.len().next_multiple_of(4), 0);
        block
    }

    #[test]
    fn linked_descriptor_and_unicode_names_match_native_with_bounded_metadata() {
        use photocraft_psd::descriptor::{Descriptor, Value, VersionedDescriptor};
        let descriptor = VersionedDescriptor::new(Descriptor::new("open").with("enabled", Value::Boolean(true))).to_bytes();
        let names = ["Café 🚀 source.psd\0\0".encode_utf16().collect::<Vec<_>>(), vec![65, 0xd800, 66, 0], vec![65, 0, 66, 0, 0]];
        for name in names {
            let payload = vec![7; 256];
            let item = raw_item(b"liFD", 99, "selected", &name, Some(&descriptor), &payload);
            let source = SmartSource::Linked { path: "selected".into() };
            let native = photocraft_engine::smart_cmds::source_bytes(&metadata(frame(&item)), &source).unwrap();
            let budget = name.len() * 2 + descriptor.len();
            let actual = linked_item(&item, "selected", payload.len(), budget).unwrap().unwrap();
            assert_eq!(actual, native);
            assert_eq!(linked_item(&item, "selected", payload.len(), budget - 1).unwrap_err(), METADATA_LIMIT_ERROR);
        }
        let name = vec![65; 12];
        let item = raw_item(b"liFD", 1, "selected", &name, None, &[1]);
        assert_eq!(linked_item(&item, "selected", 1, 23).unwrap_err(), METADATA_LIMIT_ERROR);
        assert_eq!(linked_item(&item, "selected", 1, 24).unwrap().unwrap().0, "A".repeat(12));
        assert!(linked_item(&item, "unrelated", 1, 0).unwrap().is_none());
        let malformed = raw_item(b"liFD", 1, "selected", &[65, 0], Some(&15u32.to_be_bytes()), &[8; 256]);
        assert!(linked_item(&malformed, "selected", 256, 16).unwrap().is_none());
        let truncated = raw_item(b"liFD", 1, "selected", &[65, 0], Some(&16u32.to_be_bytes()), &[]);
        assert!(linked_item(&truncated, "selected", 0, 64).unwrap().is_none());
    }

    #[test]
    fn linked_aliases_malformed_items_and_multiple_blocks_keep_first_valid_authority() {
        let name = [65, 0];
        let mut first = frame(&raw_item(b"liFA", 7, "selected", &name, None, &[90]));
        first.extend(frame(&raw_item(b"liFE", 7, "selected", &name, None, &[91])));
        first.extend(frame(&raw_item(b"liFD", 7, "selected", &name, Some(&15u32.to_be_bytes()), &[92; 128])));
        first.extend(frame(&raw_item(b"liFD", 7, "unrelated", &name, None, &[93; 128])));
        let mut meta = metadata(first);
        meta.psd_global_blocks.insert(0, (*b"8BIM", *b"skip", Arc::new(block("selected", "ignored.psd", vec![99]))));
        meta.psd_global_blocks.push((*b"8BIM", *b"lnk3", Arc::new(frame(&raw_item(b"liFD", 0, "selected", &name, None, &[1, 2, 3])))));
        meta.psd_global_blocks.push((*b"8BIM", *b"lnkD", Arc::new(block("selected", "later.psd", vec![4]))));
        let source = SmartSource::Linked { path: "selected".into() };
        let native = photocraft_engine::smart_cmds::source_bytes(&meta, &source).unwrap();
        assert_eq!(native.1.as_ref(), &[1, 2, 3]);
        assert_eq!(resolve_with_limit(&meta, &source, 3).unwrap(), native);
        assert_eq!(resolve_with_limit(&meta, &source, 2).unwrap_err(), SOURCE_LIMIT_ERROR);
        // An incomplete outer frame ends only its own block, allowing the next block to resolve.
        meta.psd_global_blocks[1].2 = Arc::new(u64::MAX.to_be_bytes().to_vec());
        assert_eq!(resolve_with_limit(&meta, &source, 3).unwrap(), native);
    }

    #[test]
    fn opening_linked_psd_and_refusing_oversize_preserve_parent_state() {
        use photocraft_engine::{Session, doc::LayerContent, channel_cmds::ChannelTarget};
        use photocraft_psd::{LayerSpec, PixelData, PsdBuilder};
        use serde_json::json;
        let directory = std::env::temp_dir().join(format!("xdesign-smart-open-{}", ulid::Ulid::new()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("Café 🚀 source.psd");
        let pixels: Vec<u8> = (0u8..16).flat_map(|index| [index * 13, 70, 180, 255]).collect();
        let mut builder = PsdBuilder::new(4, 4);
        builder.push_layer(LayerSpec::new("Source", 0, 0, 4, 4, PixelData::Rgba8(pixels.clone())));
        builder.composite(PixelData::Rgba8(pixels));
        let bytes = builder.to_bytes().unwrap();
        std::fs::write(&path, &bytes).unwrap();
        let expected = photocraft_io::import("source.psd", &bytes).unwrap().document;
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":8,"height":8,"background":"white"})).unwrap();
        engine.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
        engine.execute("filter.blur.gaussianBlur", json!({"radius":1})).unwrap();
        engine.execute("edit.undo", json!({})).unwrap();
        let layer = engine.active().unwrap().active_layer.unwrap();
        if let LayerContent::Smart(smart) = &mut Arc::make_mut(&mut engine.active_mut().unwrap().doc).layer_mut(layer).unwrap().content {
            smart.source = SmartSource::Linked { path: path.to_string_lossy().into_owned() };
        } else { panic!("smart parent") }
        let state = engine.active_mut().unwrap();
        state.channel_view.target = ChannelTarget::Color(1);
        state.channel_view.color_hidden = vec![true, false, true];
        state.coalesce = Some("retained-gesture".into());
        let parent = super::super::super::PhotoSession { engine, color_settings:None, version:"retained-version".into(),
            original_path:Some("original-parent.psd".into()), writer:Default::default() };
        let before = parent.engine.active().unwrap().clone();
        let journal = parent.engine.journal.clone();
        let active = parent.engine.active_index();
        let assert_parent = || {
            let current = parent.engine.active().unwrap();
            assert!(Arc::ptr_eq(&before.doc, &current.doc));
            assert_eq!(current.history.entries(), before.history.entries());
            assert_eq!(current.history.redo_labels().collect::<Vec<_>>(), before.history.redo_labels().collect::<Vec<_>>());
            assert_eq!(current.active_layer, before.active_layer);
            assert_eq!(current.selected_layers, before.selected_layers);
            assert_eq!(current.layer_anchor, before.layer_anchor);
            assert_eq!(current.channel_view, before.channel_view);
            assert_eq!(current.coalesce, before.coalesce);
            assert_eq!(current.revision, before.revision);
            assert_eq!(current.saved_revision, before.saved_revision);
            assert_eq!(parent.engine.journal, journal);
            assert_eq!(parent.engine.active_index(), active);
            assert_eq!(parent.engine.documents().len(), 1);
            assert_eq!(parent.version, "retained-version");
            assert_eq!(parent.original_path.as_deref(), Some("original-parent.psd"));
        };
        let child = super::super::open(&parent, layer.0).unwrap();
        let another = super::super::open(&parent, layer.0).unwrap();
        assert_ne!(child.engine.active().unwrap().doc.id, parent.engine.active().unwrap().doc.id);
        assert_ne!(child.engine.active().unwrap().doc.id, another.engine.active().unwrap().doc.id);
        assert_eq!(child.engine.active().unwrap().doc.name, "Café 🚀 source.psd");
        assert_eq!(photocraft_compose::flatten(&child.engine.active().unwrap().doc).px, photocraft_compose::flatten(&expected).px);
        assert!(child.version.is_empty());
        assert!(child.original_path.is_none());
        assert_parent();
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_len(super::super::super::MAX_INPUT_BYTES + 1).unwrap();
        assert_eq!(super::super::open(&parent, layer.0).err().unwrap(), SOURCE_LIMIT_ERROR);
        assert_parent();
        std::fs::write(&path, &bytes).unwrap();
        let retry = super::super::open(&parent, layer.0).unwrap();
        assert_eq!(photocraft_compose::flatten(&retry.engine.active().unwrap().doc).px, photocraft_compose::flatten(&expected).px);
        assert_parent();
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn bounded_reader_accepts_exact_limit_and_never_reads_past_one_overflow_byte() {
        struct Stream { left: usize, consumed: usize, interrupted: bool }
        impl Read for Stream {
            fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
                if self.interrupted { self.interrupted = false; return Err(std::io::ErrorKind::Interrupted.into()); }
                let count = output.len().min(self.left);
                output[..count].fill(7); self.left -= count; self.consumed += count; Ok(count)
            }
        }
        for length in [0, 3, 131_072] {
            let mut stream = Stream { left: length, consumed: 0, interrupted: true };
            assert_eq!(read_bounded(&mut stream, length).unwrap(), vec![7; length]);
        }
        let mut growing = Stream { left: 1_000_000, consumed: 0, interrupted: true };
        assert_eq!(read_bounded(&mut growing, 131_072).unwrap_err(), SOURCE_LIMIT_ERROR);
        assert_eq!(growing.consumed, 131_073);
        let mut empty_budget = Stream { left: 1, consumed: 0, interrupted: false };
        assert!(read_bounded(&mut empty_budget, 0).is_err());
        assert_eq!(empty_budget.consumed, 1);
    }

    #[test]
    fn linked_lookup_copies_only_the_first_valid_matching_source() {
        let mut bytes = block("unrelated", "large.psd", vec![9; 256]);
        bytes.extend(block("selected", "Café source.psd", vec![1, 2, 3]));
        bytes.extend(block("selected", "later.psd", vec![4]));
        bytes.extend([0xff, 0x80]);
        let meta = metadata(bytes);
        let source = SmartSource::Linked { path: "selected".into() };
        let native = photocraft_engine::smart_cmds::source_bytes(&meta, &source).unwrap();
        let actual = resolve_with_limit(&meta, &source, 3).unwrap();
        assert_eq!(actual, native);
        assert_eq!(actual.0, "Café source.psd");
        assert_eq!(actual.1.as_ref(), &[1, 2, 3]);
        assert_eq!(resolve_with_limit(&meta, &source, 2).unwrap_err(), SOURCE_LIMIT_ERROR);
        let mut bad = block("selected", "bad.psd", vec![8]);
        // A complete framed item with a truncated payload must not hide a later valid source.
        let id_length = "selected".len();
        let payload_length = 8 + 4 + 4 + 1 + id_length + 4 + "bad.psd\0".encode_utf16().count() * 2 + 8;
        bad[payload_length..payload_length + 8].copy_from_slice(&u64::MAX.to_be_bytes());
        bad.extend(block("selected", "valid.psd", vec![5]));
        let meta = metadata(bad);
        assert_eq!(resolve_with_limit(&meta, &source, 3).unwrap(), photocraft_engine::smart_cmds::source_bytes(&meta, &source).unwrap());
    }

    #[test]
    fn embedded_sources_share_their_arc_and_disk_files_are_bounded_before_import() {
        let bytes = Arc::new(vec![1, 2, 3]);
        let embedded = SmartSource::Embedded { file_name: "embedded.png".into(), bytes: bytes.clone() };
        let actual = resolve_with_limit(&Metadata::default(), &embedded, 3).unwrap();
        assert!(Arc::ptr_eq(&actual.1, &bytes));
        assert_eq!(resolve_with_limits(&Metadata::default(), &embedded, 3, "embedded.png".len()-1).unwrap_err(), METADATA_LIMIT_ERROR);
        assert_eq!(Arc::strong_count(&bytes), 3);
        assert!(resolve_with_limit(&Metadata::default(), &embedded, 2).is_err());
        let directory = std::env::temp_dir().join(format!("xdesign-smart-source-{}", ulid::Ulid::new()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("source.bin");
        std::fs::write(&path, [4, 5, 6]).unwrap();
        let source = SmartSource::Linked { path: path.to_string_lossy().into_owned() };
        assert_eq!(resolve_with_limit(&Metadata::default(), &source, 3).unwrap().1.as_ref(), &[4, 5, 6]);
        assert_eq!(resolve_with_limit(&Metadata::default(), &source, 2).unwrap_err(), SOURCE_LIMIT_ERROR);
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_len(super::super::super::MAX_INPUT_BYTES + 1).unwrap();
        assert_eq!(resolve(&Metadata::default(), &source).unwrap_err(), SOURCE_LIMIT_ERROR);
        for path in [directory.clone(), directory.join("missing")] {
            assert_eq!(resolve(&Metadata::default(), &SmartSource::Linked { path: path.to_string_lossy().into_owned() }).unwrap_err(), UNAVAILABLE);
        }
        assert_eq!(resolve(&Metadata::default(), &SmartSource::Linked { path: String::new() }).unwrap_err(), UNAVAILABLE);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
