//! Match Color's Ignore Selection when Applying Adjustment, which the pinned engine lacks: the selection can
//! still shape the statistics, but the match is applied to the whole layer.
use std::ops::RangeInclusive;

use photocraft_algo::{
    selection::mask_from_surface,
    tone::{lab_stats, match_color, LabStats, MatchColor},
};
use photocraft_engine::{
    channel_cmds::ChannelTarget,
    doc::{Document, Layer, LayerId, Rect},
    edit_menu_cmds::FadeSource,
    EngineError, Session,
};
use photocraft_raster::from_rgba_into;
use serde_json::{json, Value};

const CMD: &str = "image.adjustments.matchColor";
const NAME: &str = "Match Color";

struct Options {
    adjust: MatchColor,
    source: Option<usize>,
    source_layer: Option<u64>,
    in_source: bool,
    in_target: bool,
    ignore_selection: bool,
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != CMD {
        return None;
    }
    let options = match parse(params) {
        Ok(options) => options,
        Err(error) => return Some(Err(error)),
    };
    if !options.ignore_selection || engine.active()?.doc.selection.is_none() {
        return None;
    }
    Some(apply(engine, params, &options))
}

/// Resolves the dialog's `sourcePhoto` into the engine's `source` index. The image being edited is its own
/// live state, engine document 0, so its layer ids match the ones its inspect lists; any other image or
/// version is returned for loading beside it as document 1.
pub(super) fn source_photo(command: &str, params: &mut Value, photo_id: &str, version: &str) -> Result<Option<(String, String)>, String> {
    let Some(source) = (command == CMD).then(|| params.as_object_mut().and_then(|object| object.remove("sourcePhoto"))).flatten() else {
        return Ok(None);
    };
    let (Some(id), Some(source_version)) = (source["id"].as_str(), source["version"].as_str()) else {
        return Err("Choose a source image for Match Color".into());
    };
    if id == photo_id && source_version == version {
        params["source"] = json!(0);
        return Ok(None);
    }
    params["source"] = json!(1);
    Ok(Some((id.to_owned(), source_version.to_owned())))
}

fn given<'a>(params: &'a Value, key: &str) -> Option<&'a Value> {
    params.get(key).filter(|value| !value.is_null())
}

fn number(params: &Value, key: &str, range: RangeInclusive<f64>, default: f64) -> Result<f32, String> {
    match given(params, key) {
        None => Ok(default as f32),
        Some(value) => value
            .as_f64()
            .filter(|value| range.contains(value))
            .map(|value| value as f32)
            .ok_or_else(|| format!("{NAME}: {key} must be a number from {} to {}", range.start(), range.end())),
    }
}

fn flag(params: &Value, key: &str) -> Result<bool, String> {
    match given(params, key) {
        None => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(format!("{NAME}: {key} must be true or false")),
    }
}

fn parse(params: &Value) -> Result<Options, String> {
    let source = match given(params, "source") {
        None => None,
        Some(value) => Some(value.as_u64().and_then(|index| usize::try_from(index).ok()).ok_or_else(|| format!("{NAME}: source must be an open document's index"))?),
    };
    let source_layer = match given(params, "sourceLayer") {
        None => None,
        Some(value) => Some(value.as_u64().ok_or_else(|| format!("{NAME}: sourceLayer must be a layer id"))?),
    };
    Ok(Options {
        adjust: MatchColor {
            luminance: number(params, "luminance", 1.0..=200.0, 100.0)?,
            intensity: number(params, "intensity", 1.0..=200.0, 100.0)?,
            fade: number(params, "fade", 0.0..=100.0, 0.0)?,
            neutralize: flag(params, "neutralize")?,
        },
        source,
        source_layer,
        in_source: flag(params, "useSelectionInSource")?,
        in_target: flag(params, "useSelectionInTarget")?,
        ignore_selection: flag(params, "ignoreSelection")?,
    })
}

/// The engine's source statistics: one layer or the merged image, optionally within its selection.
fn source_stats(doc: &Document, layer: Option<u64>, in_selection: bool) -> Result<LabStats, String> {
    let area = doc.bounds();
    let pixels = match layer {
        Some(id) => photocraft_compose::render_layer(doc.layer(LayerId(id)).ok_or_else(|| format!("{NAME}: the source has no layer {id}"))?, area).px,
        None => photocraft_compose::flatten(doc).px,
    };
    let mask = doc.selection.as_ref().filter(|_| in_selection).map(|selection| mask_from_surface(Some(selection), area));
    lab_stats(&pixels, mask.as_deref()).ok_or_else(|| format!("{NAME}: the source has no opaque pixels"))
}

fn apply(engine: &mut Session, params: &Value, options: &Options) -> Result<Value, String> {
    if let Some(reason) = engine.disabled_reason(CMD) {
        return Err(format!("{NAME}: {reason}"));
    }
    let source = match options.source {
        Some(index) => {
            let doc = &engine.documents().get(index).ok_or_else(|| format!("{NAME}: no document {index}"))?.doc;
            Some(source_stats(doc, options.source_layer, options.in_source)?)
        }
        None => None,
    };
    let state = engine.active().ok_or("No image document")?;
    let routed = super::mask_filters::target(engine, params)?.is_some()
        || given(params, "target").is_some_and(|target| target != "pixels");
    if routed || matches!(state.channel_view.target, ChannelTarget::Color(_)) {
        return Err(format!("{NAME}: Ignore Selection needs a pixel layer target; masks and channels follow the selection"));
    }
    let id = state.active_layer.ok_or_else(|| format!("{NAME}: select a layer"))?;
    let layer = state.doc.layer(id).ok_or_else(|| format!("{NAME}: the layer no longer exists"))?;
    if layer.locks.pixels || layer.locks.all {
        return Err(format!("Could not complete your request because the layer \"{}\" is locked", layer.name));
    }
    let mut surface = layer.surface().ok_or_else(|| format!("{NAME}: the active layer has no pixels; rasterize it first"))?.clone();
    let area = surface.content_bounds();
    if !area.is_empty() {
        let mut pixels = vec![[0.0; 4]; area.width() as usize * area.height() as usize];
        surface.read_rgba_into(area, &mut pixels);
        let mask = state.doc.selection.as_ref().filter(|_| options.in_target).map(|selection| mask_from_surface(Some(selection), area));
        if let Some(target) = lab_stats(&pixels, mask.as_deref()) {
            match_color(&mut pixels, &target, source.as_ref(), &options.adjust);
            write(&mut surface, area, &pixels);
        }
    }
    super::mask_filters::edit_history(engine, NAME, params, |doc, _| {
        *doc.layer_mut(id).and_then(Layer::surface_mut).ok_or(EngineError::NoLayer(id))? = surface;
        Ok(())
    })?;
    engine.journal.push((CMD.to_owned(), params.clone()));
    let state = engine.active().ok_or("No image document")?;
    let label = state.history.undo_label().unwrap_or(NAME).to_owned();
    engine.edit_state.fade = Some(FadeSource { doc: state.doc.id, revision: state.revision, layer: id, mask: false, label });
    Ok(Value::Null)
}

/// Encodes the matched pixels a band of rows at a time, so only one band of the layer's format is held.
fn write(surface: &mut photocraft_engine::doc::Surface, area: Rect, pixels: &[[f32; 4]]) {
    let format = surface.format();
    let channels = format.channels();
    let width = area.width() as usize;
    let rows = super::adjust::BAND.1;
    for y in (area.y0..area.y1).step_by(rows as usize) {
        let band = Rect::new(area.x0, y, area.x1, y.saturating_add(rows).min(area.y1));
        let start = (y - area.y0) as usize * width;
        let band_pixels = &pixels[start..start + width * band.height() as usize];
        let mut output = vec![0.0; band_pixels.len() * channels];
        for (pixel, encoded) in band_pixels.iter().zip(output.chunks_exact_mut(channels)) {
            from_rgba_into(&format, *pixel, encoded);
        }
        surface.write_region(band, &output);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{ColorMode, Document, Layer, LayerId, SampleType, Size};
    use serde_json::json;

    fn document(row: &[[f32; 4]]) -> Document {
        let mut doc = Document::new("Match", Size::new(row.len() as u32, 1), ColorMode::Rgb, SampleType::U8);
        let mut layer = Layer::raster("Layer 0", doc.pixel_format());
        let data: Vec<f32> = row.iter().flatten().copied().collect();
        layer.surface_mut().unwrap().write_region(doc.bounds(), &data);
        doc.layers.push(layer);
        doc
    }
    /// The target, then any source documents; the target's only layer is active.
    fn session(row: &[[f32; 4]], sources: &[&[[f32; 4]]]) -> Session {
        let mut engine = Session::new();
        engine.add_document(document(row), None);
        for source in sources {
            engine.add_document(document(source), None);
        }
        engine.set_active(0);
        let top = engine.active().unwrap().doc.layers.last().unwrap().id;
        engine.active_mut().unwrap().active_layer = Some(top);
        engine
    }
    fn select_first(engine: &mut Session, width: u32) {
        engine.execute("select.rect", json!({"x": 0, "y": 0, "width": width, "height": 1, "antiAlias": false})).unwrap();
    }
    fn active(engine: &Session) -> LayerId {
        engine.active().unwrap().active_layer.unwrap()
    }
    fn row(engine: &Session) -> Vec<[f32; 4]> {
        let state = engine.active().unwrap();
        let surface = state.doc.layer(active(engine)).unwrap().surface().unwrap();
        (0..state.doc.size.width as i32).map(|x| surface.rgba(x, 0)).collect()
    }
    fn close(a: [f32; 4], b: [f32; 4]) -> bool {
        a.iter().zip(b).all(|(a, b)| (a - b).abs() <= 1.5 / 255.0)
    }
    fn assert_rows(actual: &[[f32; 4]], expected: &[[f32; 4]]) {
        assert!(actual.len() == expected.len() && actual.iter().zip(expected).all(|(a, b)| close(*a, *b)), "{actual:?} vs {expected:?}");
    }
    fn matched(engine: &mut Session, params: Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, CMD, params)
    }

    const WARM: [[f32; 4]; 4] = [[0.8, 0.4, 0.3, 1.0], [0.7, 0.5, 0.4, 1.0], [0.9, 0.3, 0.2, 1.0], [0.6, 0.4, 0.35, 1.0]];

    #[test]
    fn ignore_selection_applies_the_match_to_the_whole_layer_in_one_step() {
        let mut whole = session(&WARM, &[]);
        matched(&mut whole, json!({"neutralize": true})).unwrap();
        let expected = row(&whole);
        assert!(!close(expected[3], WARM[3]));
        let mut engine = session(&WARM, &[]);
        select_first(&mut engine, 2);
        let past = engine.active().unwrap().history.past_len();
        let params = json!({"neutralize": true, "ignoreSelection": true});
        matched(&mut engine, params.clone()).unwrap();
        assert_rows(&row(&engine), &expected);
        let state = engine.active().unwrap();
        assert_eq!((state.history.past_len(), state.history.undo_label()), (past + 1, Some("Match Color")));
        assert!(state.doc.selection.is_some());
        assert_eq!(engine.journal.last(), Some(&(CMD.to_owned(), params)));
        assert_eq!(engine.edit_state.fade.as_ref().map(|fade| (fade.layer, fade.mask)), Some((active(&engine), false)));
        engine.execute("edit.undo", json!({})).unwrap();
        assert_rows(&row(&engine), &WARM);
        // Without it the selection still limits the match.
        matched(&mut engine, json!({"neutralize": true, "ignoreSelection": false})).unwrap();
        let limited = row(&engine);
        assert!(close(limited[3], WARM[3]) && !close(limited[0], WARM[0]));
    }

    #[test]
    fn target_and_source_statistics_still_use_the_selection_when_it_is_ignored() {
        let cool = [[0.2, 0.3, 0.8, 1.0], [0.3, 0.4, 0.9, 1.0], [0.25, 0.35, 0.7, 1.0], [0.1, 0.3, 0.6, 1.0]];
        let mut limited = session(&WARM, &[&cool]);
        select_first(&mut limited, 2);
        let stats = json!({"source": 1, "useSelectionInTarget": true, "luminance": 120, "intensity": 80});
        matched(&mut limited, stats.clone()).unwrap();
        let mut engine = session(&WARM, &[&cool]);
        select_first(&mut engine, 2);
        let mut params = stats.clone();
        params["ignoreSelection"] = json!(true);
        matched(&mut engine, params).unwrap();
        let (inside, all) = (row(&limited), row(&engine));
        assert_rows(&all[..2], &inside[..2]);
        assert!(close(inside[3], WARM[3]) && !close(all[3], WARM[3]), "{inside:?} {all:?}");
        // Use Selection in Source reads the source document's own selection.
        let mut native = session(&WARM, &[&cool]);
        native.set_active(1);
        select_first(&mut native, 1);
        native.set_active(0);
        let source = json!({"source": 1, "useSelectionInSource": true});
        matched(&mut native, source.clone()).unwrap();
        let mut engine = session(&WARM, &[&cool]);
        engine.set_active(1);
        select_first(&mut engine, 1);
        engine.set_active(0);
        select_first(&mut engine, 2);
        let mut params = source.clone();
        params["ignoreSelection"] = json!(true);
        matched(&mut engine, params).unwrap();
        assert_rows(&row(&engine), &row(&native));
    }

    #[test]
    fn bad_match_color_options_and_targets_are_refused_without_a_history_step() {
        let mut engine = session(&WARM, &[]);
        select_first(&mut engine, 2);
        let past = engine.active().unwrap().history.past_len();
        for (params, message) in [
            (json!({"luminance": 0}), "luminance must be a number from 1 to 200"),
            (json!({"intensity": 201}), "intensity must be a number from 1 to 200"),
            (json!({"fade": -1}), "fade must be a number from 0 to 100"),
            (json!({"neutralize": "yes"}), "neutralize must be true or false"),
            (json!({"ignoreSelection": 1}), "ignoreSelection must be true or false"),
            (json!({"useSelectionInTarget": "no"}), "useSelectionInTarget must be true or false"),
            (json!({"useSelectionInSource": null, "source": -1}), "source must be an open document's index"),
            (json!({"source": 4, "ignoreSelection": true}), "no document 4"),
            (json!({"sourceLayer": "top"}), "sourceLayer must be a layer id"),
        ] {
            let error = matched(&mut engine, params.clone()).unwrap_err();
            assert!(error.contains(message), "{params}: {error}");
        }
        engine.execute("layer.layerMask.revealAll", json!({})).unwrap();
        let error = matched(&mut engine, json!({"ignoreSelection": true, "target": "mask"})).unwrap_err();
        assert!(error.contains("needs a pixel layer target"), "{error}");
        assert_eq!(engine.active().unwrap().history.past_len(), past + 1);
        assert_rows(&row(&engine), &WARM);
    }

    #[test]
    fn the_target_image_can_be_its_own_source_photo() {
        let picked = |source: Value| {
            let mut params = json!({"luminance": 120, "sourcePhoto": source});
            source_photo(CMD, &mut params, "photo", "v2").map(|loaded| (loaded, params))
        };
        let (loaded, params) = picked(json!({"id": "photo", "version": "v2"})).unwrap();
        assert_eq!((loaded, params), (None, json!({"luminance": 120, "source": 0})), "this image's live state, engine document 0");
        let (loaded, params) = picked(json!({"id": "other", "version": "v9"})).unwrap();
        assert_eq!((loaded, params), (Some(("other".to_owned(), "v9".to_owned())), json!({"luminance": 120, "source": 1})));
        let (loaded, params) = picked(json!({"id": "photo", "version": "v1"})).unwrap();
        assert_eq!((loaded, params["source"].clone()), (Some(("photo".to_owned(), "v1".to_owned())), json!(1)), "another version is loaded beside it");
        for source in [json!(null), json!({"id": "photo"}), json!({"id": 3, "version": "v2"}), json!("photo")] {
            assert_eq!(picked(source.clone()).unwrap_err(), "Choose a source image for Match Color", "{source}");
        }
        let mut params = json!({"sourcePhoto": {"id": "photo", "version": "v2"}});
        assert_eq!(source_photo("image.adjustments.levels", &mut params, "photo", "v2").unwrap(), None);
        assert!(params.get("sourcePhoto").is_some(), "other commands keep their params");
        let mut params = json!({"luminance": 120});
        assert_eq!(source_photo(CMD, &mut params, "photo", "v2").unwrap(), None);
        assert_eq!(params, json!({"luminance": 120}), "no source image: no source");
    }

    #[test]
    fn another_layer_of_the_same_image_is_a_source() {
        const COOL: [[f32; 4]; 4] = [[0.2, 0.3, 0.8, 1.0], [0.3, 0.4, 0.9, 1.0], [0.25, 0.35, 0.7, 1.0], [0.1, 0.3, 0.6, 1.0]];
        // The WARM layer on top (active) over a COOL layer.
        let mut doc = document(&WARM);
        let mut cool = Layer::raster("Cool", doc.pixel_format());
        cool.surface_mut().unwrap().write_region(doc.bounds(), &COOL.concat());
        let (cool_id, top) = (cool.id.0, doc.layers[0].id);
        doc.layers.insert(0, cool);
        // `documents` engine documents, each a copy of the same image.
        let layered = |documents: usize| {
            let mut engine = Session::new();
            for _ in 0..documents { engine.add_document(doc.clone(), None); }
            engine.set_active(0);
            engine.active_mut().unwrap().active_layer = Some(top);
            select_first(&mut engine, 2);
            engine
        };
        for ignore_selection in [false, true] {
            let (mut own, mut beside) = (layered(1), layered(2));
            let params = |source: usize| json!({"source": source, "sourceLayer": cool_id, "ignoreSelection": ignore_selection});
            let past = own.active().unwrap().history.past_len();
            matched(&mut own, params(0)).unwrap();
            matched(&mut beside, params(1)).unwrap();
            assert_rows(&row(&own), &row(&beside));
            assert!(!close(row(&own)[0], WARM[0]), "the cool layer's statistics moved the warm one");
            let state = own.active().unwrap();
            assert_eq!((state.history.past_len(), state.history.undo_label(), own.documents().len()), (past + 1, Some("Match Color"), 1));
        }
    }
}
