//! Clone Stamp and Healing Brush sampling another open image, like Photoshop's Clone Source set in a
//! second document. The pinned engine samples only the image it paints (retouch_cmds.rs:178-205) and a
//! Clone Source slot has no document field (presets/clone_source.rs:23-36), so the stroke names the image
//! with `sourceDocument: {id, version}`. The host loads that image for the command or feedback step and
//! the host retouch stroke samples it in place of the image being painted; nothing in it changes.
use photocraft_engine::doc::{ColorMode, Document, LayerId, PixelFormat, Surface};
use serde_json::Value;
use std::{cell::RefCell, path::PathBuf, sync::Arc};

const UNAVAILABLE: &str = "the source image is closed or unavailable; set the clone source again";

fn tool(command: &str) -> Option<&'static str> {
    match command {
        "paint.cloneStamp" => Some("Clone Stamp"),
        "paint.healingBrush" => Some("Healing Brush"),
        _ => None,
    }
}

struct Provided {
    id: String,
    doc: Arc<Document>,
    layer: Option<LayerId>,
}
thread_local! {
    static PROVIDED: RefCell<Option<Provided>> = const { RefCell::new(None) };
}

/// The other image a stroke samples, validated before the engine runs.
pub(super) struct Reference {
    dir: PathBuf,
    key: String,
    id: String,
    version: String,
    label: &'static str,
}

/// Keeps the loaded source image available to strokes on this thread until dropped, then restores
/// whatever was provided before.
pub(super) struct Provision(Option<Option<Provided>>);
impl Drop for Provision {
    fn drop(&mut self) {
        if let Some(previous) = self.0.take() {
            PROVIDED.with(|provided| *provided.borrow_mut() = previous);
        }
    }
}

fn install(id: String, doc: Arc<Document>, layer: Option<LayerId>) -> Provision {
    Provision(Some(PROVIDED.with(|provided| provided.borrow_mut().replace(Provided { id, doc, layer }))))
}

fn parse(label: &str, params: &Value) -> Result<Option<(String, String)>, String> {
    let Some(value) = params.get("sourceDocument").filter(|value| !value.is_null()) else { return Ok(None) };
    let text = |key: &str| value[key].as_str().filter(|text| ulid::Ulid::from_string(text).is_ok()).map(str::to_owned);
    match (value.as_object().map(|object| object.len()), text("id"), text("version")) {
        (Some(2), Some(id), Some(version)) => Ok(Some((id, version))),
        _ => Err(format!("{label}: sourceDocument must be {{id, version}} of an open image")),
    }
}

/// Whether a Clone Stamp / Healing Brush stroke names another image (the host then runs it).
pub(super) fn requested(command: &str, params: &Value) -> bool {
    tool(command).is_some() && params.get("sourceDocument").is_some_and(|value| !value.is_null())
}

/// Validates `sourceDocument` and drops it when it names the image being painted, which the engine
/// samples itself.
pub(super) fn reference(command: &str, params: &mut Value, project: &str, photo: &str, dir: impl FnOnce(&str) -> Result<PathBuf, String>) -> Result<Option<Reference>, String> {
    let Some(label) = tool(command) else { return Ok(None) };
    let Some((id, version)) = parse(label, params)? else { return Ok(None) };
    if id == photo {
        if let Some(object) = params.as_object_mut() {
            object.remove("sourceDocument");
        }
        return Ok(None);
    }
    Ok(Some(Reference { dir: dir(&id)?, key: super::key(project, &id), id, version, label }))
}

/// Loads the referenced image from the open session cache (the version the stroke names) or its bundle.
pub(super) fn provide(cache: &super::cache::PhotoCache, reference: Option<&Reference>) -> Result<Provision, String> {
    let Some(reference) = reference else { return Ok(Provision(None)) };
    let open = open(cache, reference);
    load(reference, open)
}

/// `provide` for feedback routes, which do not hold the session cache; a bundle is read after the
/// cache is released.
pub(super) fn provide_unlocked(reference: Option<&Reference>) -> Result<Provision, String> {
    let Some(reference) = reference else { return Ok(Provision(None)) };
    let open = open(&*super::sessions().lock().map_err(|_| "Image engine needs to be restarted")?, reference);
    load(reference, open)
}

fn open(cache: &super::cache::PhotoCache, reference: &Reference) -> Option<(Arc<Document>, Option<LayerId>)> {
    cache.get(&reference.key).filter(|session| session.version == reference.version).and_then(|session| session.engine.active().map(|state| (state.doc.clone(), state.active_layer)))
}

fn load(reference: &Reference, open: Option<(Arc<Document>, Option<LayerId>)>) -> Result<Provision, String> {
    let state = match open {
        Some(state) => Some(state),
        None => super::restore(&reference.dir, &reference.version, None).ok().and_then(|session| session.engine.active().map(|state| (state.doc.clone(), state.active_layer))),
    };
    let (doc, layer) = state.ok_or_else(|| format!("{}: {UNAVAILABLE}", reference.label))?;
    Ok(install(reference.id.clone(), doc, layer))
}

/// What a cross-image clone samples: the source image, its current layer, and that layer's pixels in
/// the painted surface's format (for Sample: Current Layer; otherwise only the format is read).
pub(in super::super) struct Foreign {
    doc: Arc<Document>,
    layer: Option<LayerId>,
    surface: Surface,
}
impl Foreign {
    pub(in super::super) fn parts(&self) -> (&Document, Option<LayerId>, &Surface) {
        (&self.doc, self.layer, &self.surface)
    }
}

/// The provided source image for a stroke that names one. `current` is Sample: Current Layer, `strip`
/// the Ignore Adjustment Layers copy, `pattern` a Healing Brush pattern source.
pub(in super::super) fn foreign(command: &str, params: &Value, target: &Document, format: PixelFormat, pattern: bool, current: bool, strip: Option<fn(&Document) -> Document>) -> Result<Option<Foreign>, String> {
    let Some(label) = tool(command) else { return Ok(None) };
    let Some((id, _)) = parse(label, params)? else { return Ok(None) };
    if pattern {
        return Err(format!("{label}: sourceDocument can't be combined with a pattern source"));
    }
    let (doc, layer) = PROVIDED.with(|provided| provided.borrow().as_ref().filter(|provided| provided.id == id).map(|provided| (provided.doc.clone(), provided.layer))).ok_or_else(|| format!("{label}: {UNAVAILABLE}"))?;
    // convert_pixel goes through RGBA for these models only (photocraft raster/src/lib.rs:547-575).
    for (whose, mode) in [("the source image", doc.mode), ("this image", target.mode)] {
        if !matches!(mode, ColorMode::Rgb | ColorMode::Grayscale | ColorMode::Cmyk | ColorMode::Lab) {
            return Err(format!("{label}: clone between RGB, Grayscale, CMYK and Lab images ({whose} is {mode:?})"));
        }
    }
    let doc = match strip {
        Some(strip) => Arc::new(strip(&doc)),
        None => doc,
    };
    let surface = if current {
        let pixels = layer.and_then(|id| doc.layer(id)).and_then(|layer| layer.surface()).ok_or_else(|| format!("{label}: the source image's current layer has no pixels; select a pixel layer there or sample All Layers"))?;
        if pixels.format() == format { pixels.clone() } else { pixels.convert(format) }
    } else {
        Surface::new(format)
    };
    Ok(Some(Foreign { doc, layer, surface }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::Session;
    use serde_json::json;

    const SOURCE: &str = "01JBCK0NE5RC0000000000000A";
    const VERSION: &str = "01JBCK0NEVER0000000000000B";

    fn fixture(depth: u64, mode: &str, background: &str) -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 48, "height": 48, "depth": depth, "mode": mode, "background": background})).unwrap();
        engine
    }
    /// Two pixel layers so Current Layer, Current & Below and All Layers sample differently.
    fn layered() -> Session {
        let mut engine = fixture(8, "rgb", "#905080");
        engine.execute("paint.stroke", json!({"points": [[4, 8], [42, 8], [42, 36], [5, 36]], "size": 9, "color": "#20b0c0", "seed": 31})).unwrap();
        engine.execute("layer.new.layer", json!({"name": "Above"})).unwrap();
        engine.execute("paint.stroke", json!({"points": [[6, 12], [40, 30]], "size": 11, "color": "#f08020", "seed": 32})).unwrap();
        engine
    }
    fn twin(engine: &Session) -> Session {
        let state = engine.active().unwrap().clone();
        let mut twin = Session::new();
        twin.add_document((*state.doc).clone(), None);
        *twin.active_mut().unwrap() = state;
        twin.tools = engine.tools.clone();
        twin.presets = engine.presets.clone();
        twin
    }
    fn provide_from(engine: &Session) -> Provision {
        let state = engine.active().unwrap();
        install(SOURCE.into(), state.doc.clone(), state.active_layer)
    }
    fn reference_to_source() -> Value {
        json!({"id": SOURCE, "version": VERSION})
    }
    fn layer_pixels(engine: &Session) -> Vec<f32> {
        let state = engine.active().unwrap();
        state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().read_region(state.doc.bounds())
    }
    fn rgba(engine: &Session, x: i32, y: i32) -> [f32; 4] {
        let state = engine.active().unwrap();
        state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().rgba(x, y)
    }
    fn run(engine: &mut Session, command: &str, params: &Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, command, params.clone())
    }
    fn label(engine: &Session) -> (usize, Option<String>) {
        let history = &engine.active().unwrap().history;
        (history.past_len(), history.undo_label().map(str::to_owned))
    }
    fn stroke(sample: &str, transformed: bool) -> Value {
        let mut params = json!({"points": [[30, 30], [34, 32], [26, 40]], "size": 7, "hardness": 100, "source": [12, 10], "seed": 5, "sampleLayer": sample});
        if transformed {
            params["scale"] = json!([80, 115]);
            params["rotation"] = json!(23);
            params["flipH"] = json!(true);
        }
        params
    }

    #[test]
    fn a_provided_copy_of_the_image_clones_and_heals_exactly_like_the_image_itself() {
        for command in ["paint.cloneStamp", "paint.healingBrush"] {
            for sample in ["current", "currentAndBelow", "all"] {
                for transformed in [false, true] {
                    let context = format!("{command}/{sample}/{transformed}");
                    let engine = layered();
                    let mut native = twin(&engine);
                    let mut cross = twin(&engine);
                    let params = stroke(sample, transformed);
                    let expected = run(&mut native, command, &params).unwrap();
                    let _source = provide_from(&engine);
                    let mut foreign = params.clone();
                    foreign["sourceDocument"] = reference_to_source();
                    let actual = run(&mut cross, command, &foreign).expect(&context);
                    assert_eq!(actual["damage"], expected["damage"], "{context}");
                    assert_eq!(layer_pixels(&cross), layer_pixels(&native), "{context}");
                    assert_eq!(label(&cross), label(&native), "{context}");
                }
            }
        }
    }

    #[test]
    fn clone_stamp_samples_the_other_image_layer_converting_its_mode_and_depth() {
        let source = fixture(16, "grayscale", "#808080");
        let original = source.active().unwrap().doc.clone();
        let _provided = provide_from(&source);
        let engine = layered();
        let before = label(&engine);
        for command in ["paint.cloneStamp", "paint.healingBrush"] {
            let mut painted = twin(&engine);
            let params = json!({"points": [[24, 24]], "size": 9, "hardness": 100, "source": [10, 10], "seed": 3, "sampleLayer": "current", "sourceDocument": reference_to_source()});
            run(&mut painted, command, &params).unwrap();
            let pixel = rgba(&painted, 24, 24);
            if command == "paint.cloneStamp" {
                let grey = 128.0 / 255.0;
                assert!(pixel.iter().zip([grey, grey, grey, 1.0]).all(|(a, b)| (a - b).abs() <= 1.0 / 255.0), "{command}: {pixel:?}");
            } else {
                // Healing keeps only the source's texture, so any flat other image heals alike, and unlike
                // the textured area of this image at the same source point.
                let flat = fixture(8, "rgb", "#c04010");
                let mut other = twin(&engine);
                {
                    let _flat = provide_from(&flat);
                    run(&mut other, command, &params).unwrap();
                }
                assert!(layer_pixels(&painted).iter().zip(layer_pixels(&other)).all(|(a, b)| (a - b).abs() <= 2.0 / 255.0), "{command}: flat sources");
                let mut own = twin(&engine);
                let mut same = params.clone();
                same.as_object_mut().unwrap().remove("sourceDocument");
                run(&mut own, command, &same).unwrap();
                assert_ne!(layer_pixels(&painted), layer_pixels(&own), "{command}: the other image is sampled");
            }
            let (steps, undo) = label(&painted);
            assert_eq!(steps, before.0 + 1, "{command}");
            assert_eq!(undo.as_deref(), Some(if command == "paint.cloneStamp" { "Clone Stamp" } else { "Healing Brush" }));
            painted.execute("edit.undo", json!({})).unwrap();
            assert_eq!(layer_pixels(&painted), layer_pixels(&engine), "{command} undo");
        }
        assert!(Arc::ptr_eq(&original, &source.active().unwrap().doc));
        // All Layers samples the other image's composite rather than this image's layers.
        let mut all = twin(&engine);
        run(&mut all, "paint.cloneStamp", &json!({"points": [[24, 24]], "size": 9, "hardness": 100, "source": [10, 10], "seed": 3, "sampleLayer": "all", "sourceDocument": reference_to_source()})).unwrap();
        assert!((rgba(&all, 24, 24)[0] - 128.0 / 255.0).abs() <= 1.0 / 255.0);
        assert_eq!(label(&all).0, before.0 + 1);
        assert_eq!(label(&engine), before, "the painted image's own state is untouched");
    }

    #[test]
    fn live_cross_image_feedback_commits_the_previewed_pixels() {
        let _serial = super::super::feedback_serial();
        let source = fixture(8, "rgb", "#c04010");
        for command in ["paint.cloneStamp", "paint.healingBrush"] {
            let _provided = provide_from(&source);
            let mut engine = layered();
            let mut reference = twin(&engine);
            let full = json!({"points": [[20, 20], [26, 24], [30, 30]], "size": 7, "hardness": 100, "source": [8, 8], "seed": 9, "sourceDocument": reference_to_source()});
            let mut first = full.clone();
            first["points"] = json!(full["points"].as_array().unwrap()[..1]);
            let identity = format!("clone-document-{}", ulid::Ulid::new());
            let before = engine.active().unwrap().doc.clone();
            super::super::stroke::render_with_identity(&engine, Some(&identity), command, &first, 0, 0, 0, 0, 1).unwrap();
            super::super::stroke::render_with_identity(&engine, Some(&identity), command, &full, 0, 0, 0, 0, 1).unwrap();
            assert!(Arc::ptr_eq(&before, &engine.active().unwrap().doc));
            let live = super::super::stroke::commit_feedback(&mut engine, &identity, command, &full).expect("the live draft commits").unwrap();
            let direct = run(&mut reference, command, &full).unwrap();
            assert_eq!(live["damage"], direct["damage"], "{command}");
            assert_eq!(layer_pixels(&engine), layer_pixels(&reference), "{command}");
            assert_eq!(label(&engine), label(&reference), "{command}");
            if command == "paint.cloneStamp" {
                assert!((rgba(&engine, 26, 24)[0] - 192.0 / 255.0).abs() <= 1.0 / 255.0);
            }
            super::super::stroke::release(&identity, 9).unwrap();
        }
    }

    #[test]
    fn bad_or_missing_source_images_are_refused_without_a_history_step() {
        let engine = layered();
        let source = fixture(8, "rgb", "#c04010");
        let steps = label(&engine);
        let base = json!({"points": [[24, 24]], "size": 9, "source": [10, 10], "seed": 3});
        // Malformed references never reach the engine.
        for bad in [json!("doc"), json!({"id": SOURCE}), json!({"id": "nope", "version": VERSION}), json!({"id": SOURCE, "version": VERSION, "extra": 1})] {
            let mut params = base.clone();
            params["sourceDocument"] = bad.clone();
            let error = reference("paint.cloneStamp", &mut params, "01JBCK0NEPRJ0000000000000C", "01JBCK0NETGT0000000000000D", |_| Ok(PathBuf::from("/nonexistent"))).err().unwrap();
            assert_eq!(error, "Clone Stamp: sourceDocument must be {id, version} of an open image", "{bad}");
            let mut painted = twin(&engine);
            let error = run(&mut painted, "paint.healingBrush", &params).unwrap_err();
            assert_eq!(error, "Healing Brush: sourceDocument must be {id, version} of an open image", "{bad}");
            assert_eq!(label(&painted), steps);
        }
        // The image being painted is its own source: the engine's sampling, without the reference.
        let mut params = base.clone();
        params["sourceDocument"] = json!({"id": "01JBCK0NETGT0000000000000D", "version": VERSION});
        assert!(reference("paint.cloneStamp", &mut params, "01JBCK0NEPRJ0000000000000C", "01JBCK0NETGT0000000000000D", |_| unreachable!()).unwrap().is_none());
        assert!(params.get("sourceDocument").is_none());
        // Other tools ignore it.
        let mut stroke = json!({"sourceDocument": "x"});
        assert!(reference("paint.stroke", &mut stroke, "p", "t", |_| unreachable!()).unwrap().is_none());
        // A closed image: neither open in the cache nor on disk.
        let mut params = base.clone();
        params["sourceDocument"] = reference_to_source();
        let found = reference("paint.cloneStamp", &mut params, "01JBCK0NEPRJ0000000000000C", "01JBCK0NETGT0000000000000D", |_| Ok(PathBuf::from("/nonexistent/clone-source"))).unwrap();
        let cache = super::super::cache::PhotoCache::default();
        assert_eq!(provide(&cache, found.as_ref()).err().unwrap(), format!("Clone Stamp: {UNAVAILABLE}"));
        // A stroke naming an image nobody loaded.
        let mut painted = twin(&engine);
        assert_eq!(run(&mut painted, "paint.cloneStamp", &params).unwrap_err(), format!("Clone Stamp: {UNAVAILABLE}"));
        assert_eq!(label(&painted), steps);
        // Healing from a pattern and from another image at once.
        {
            let _provided = provide_from(&source);
            let mut pattern = params.clone();
            pattern["sourceType"] = json!("pattern");
            let mut painted = twin(&engine);
            assert_eq!(run(&mut painted, "paint.healingBrush", &pattern).unwrap_err(), "Healing Brush: sourceDocument can't be combined with a pattern source");
            assert_eq!(label(&painted), steps);
        }
        // Modes the engine can't convert between.
        let mut multichannel = (*source.active().unwrap().doc).clone();
        multichannel.mode = ColorMode::Multichannel;
        let _provided = install(SOURCE.into(), Arc::new(multichannel), source.active().unwrap().active_layer);
        let mut painted = twin(&engine);
        assert_eq!(run(&mut painted, "paint.cloneStamp", &params).unwrap_err(), "Clone Stamp: clone between RGB, Grayscale, CMYK and Lab images (the source image is Multichannel)");
        assert_eq!(label(&painted), steps);
    }

    #[test]
    fn the_open_session_supplies_the_named_version() {
        let source = fixture(8, "rgb", "#c04010");
        let mut cache = super::super::cache::PhotoCache::default();
        let key = super::super::key("01JBCK0NEPRJ0000000000000C", SOURCE);
        let session = super::super::PhotoSession { engine: twin(&source), color_settings: None, version: VERSION.into(), original_path: None, writer: Default::default() };
        cache.insert(key, session);
        let mut params = json!({"sourceDocument": reference_to_source()});
        let found = reference("paint.healingBrush", &mut params, "01JBCK0NEPRJ0000000000000C", "01JBCK0NETGT0000000000000D", |_| Ok(PathBuf::from("/nonexistent/clone-source"))).unwrap();
        {
            let _provided = provide(&cache, found.as_ref()).unwrap();
            let doc = PROVIDED.with(|provided| provided.borrow().as_ref().map(|p| p.doc.clone())).unwrap();
            assert!(Arc::ptr_eq(&doc, &cache.get(&super::super::key("01JBCK0NEPRJ0000000000000C", SOURCE)).unwrap().engine.active().unwrap().doc));
        }
        assert!(PROVIDED.with(|provided| provided.borrow().is_none()), "the provision ends with its guard");
        // Another version than the open one comes from the bundle, which is missing here.
        let mut stale = json!({"sourceDocument": {"id": SOURCE, "version": "01JBCK0NE0DD0000000000000E"}});
        let old = reference("paint.healingBrush", &mut stale, "01JBCK0NEPRJ0000000000000C", "01JBCK0NETGT0000000000000D", |_| Ok(PathBuf::from("/nonexistent/clone-source"))).unwrap();
        assert_eq!(provide(&cache, old.as_ref()).err().unwrap(), format!("Healing Brush: {UNAVAILABLE}"));
    }
}
