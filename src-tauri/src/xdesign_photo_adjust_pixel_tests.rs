use super::*;
use photocraft_engine::doc::PixelFormat;
use serde_json::json;

const CASES: [(&str, &str); 16] = [
    ("brightnessContrast", r#"{"brightness":40,"contrast":25}"#),
    ("levels", r#"{"inBlack":12,"gamma":1.4,"inWhite":230,"outBlack":5,"outWhite":250}"#),
    ("curves", r#"{"points":[[0,10],[128,150],[255,240]]}"#),
    ("exposure", r#"{"exposure":0.7,"offset":0.02,"gamma":1.1}"#),
    ("vibrance", r#"{"vibrance":40,"saturation":-15}"#),
    ("hueSaturation", r#"{"hue":25,"saturation":30,"lightness":-10}"#),
    ("blackWhite", r##"{"reds":50,"tint":true,"tintColor":"#c08040"}"##),
    ("colorBalance", r#"{"shadows":[10,-5,20],"midtones":[-15,10,5],"highlights":[5,5,-10]}"#),
    ("photoFilter", r#"{"filter":"warming85","density":40}"#),
    ("channelMixer", r#"{"red":[80,20,0,0],"green":[10,90,0,0],"blue":[0,30,70,5]}"#),
    ("gradientMap", r##"{"stops":[[0,"#102030"],[0.6,"#c04080"],[1,"#f0f0a0"]],"dither":true}"##),
    ("selectiveColor", r#"{"colors":"reds","cyan":-20,"magenta":10,"yellow":15,"black":5}"#),
    ("colorLookup", r#"{"lut":"warm","dither":true}"#),
    ("invert", "{}"),
    ("posterize", r#"{"levels":5}"#),
    ("threshold", r#"{"level":110}"#),
];

/// A pixel layer that reaches past the canvas, with HDR, transparent and
/// partly transparent pixels, over more than one band in each direction.
fn fixture(mode: &str, depth: u32, selected: bool) -> Option<Session> {
    let mut engine = Session::new();
    engine.execute("file.new", json!({"width":96,"height":80,"mode":mode,"depth":depth,"background":"#4080b0"})).ok()?;
    engine.execute("layer.new.layer", json!({"name":"Pixels"})).unwrap();
    engine.edit("Fixture", |doc, active| {
        let surface = doc.layer_mut(active.unwrap()).unwrap().surface_mut().unwrap();
        let format = surface.format();
        let rect = Rect::new(-8, -4, 70, 75);
        let mut values = Vec::new();
        for y in rect.y0..rect.y1 {
            for x in rect.x0..rect.x1 {
                let hdr = if (x + y).rem_euclid(17) == 0 { 1.25 } else { 1.0 };
                let rgba = [
                    (x * 7 + y * 3).rem_euclid(97) as f32 / 96.0 * hdr,
                    (x * 5 + y * 11).rem_euclid(89) as f32 / 88.0,
                    (x * 13 + y).rem_euclid(83) as f32 / 82.0,
                    (x + y * 2).rem_euclid(5) as f32 / 4.0,
                ];
                let mut encoded = [0.0; 8];
                let count = from_rgba_into(&format, rgba, &mut encoded);
                values.extend_from_slice(&encoded[..count]);
            }
        }
        surface.write_region(rect, &values);
        if selected {
            let mut selection = Surface::new(PixelFormat::GRAY8);
            for y in 10..60 { for x in 20..90 { selection.write_pixel(x, y, &[((x + y) % 11) as f32 / 10.0]); } }
            doc.selection = Some(selection);
        }
        Ok(())
    }).unwrap();
    Some(engine)
}

fn pixels(engine: &Session) -> Surface {
    let state = engine.active().unwrap();
    state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().clone()
}

#[test]
fn pixel_layer_adjustments_match_the_engine_in_every_mode_and_depth() {
    let mut checked = 0;
    for mode in ["rgb", "gray", "cmyk", "lab"] {
        for depth in [8, 16, 32] {
            for selected in [false, true] {
                for (kind, params) in CASES {
                    let Some(mut native) = fixture(mode, depth, selected) else { continue };
                    let mut banded = fixture(mode, depth, selected).unwrap();
                    let before = pixels(&banded);
                    let command = format!("image.adjustments.{kind}");
                    let params: Value = serde_json::from_str(params).unwrap();
                    let case = format!("{kind} in {mode} {depth}-bit, selection {selected}");
                    let expected = native.execute(&command, params.clone()).map_err(|error| error.to_string());
                    let actual = execute(&mut banded, &command, &params).unwrap_or_else(|| panic!("{case}: not handled by the banded route"));
                    assert_eq!(actual, expected, "{case}");
                    assert!(pixels(&banded) == pixels(&native), "{case}: pixels differ");
                    let (a, b) = (banded.active().unwrap(), native.active().unwrap());
                    assert_eq!(a.history.entries().len(), b.history.entries().len(), "{case}");
                    assert_eq!(a.history.undo_label(), b.history.undo_label(), "{case}");
                    assert_eq!((a.revision, &a.coalesce), (b.revision, &b.coalesce), "{case}");
                    assert_eq!(banded.journal, native.journal, "{case}");
                    // Document and layer ids are process-wide counters, so compare them per session.
                    let fade = |engine: &Session| engine.edit_state.fade.clone().map(|fade| {
                        let state = engine.active().unwrap();
                        (fade.doc == state.doc.id, Some(fade.layer) == state.active_layer, fade.revision, fade.mask, fade.label)
                    });
                    assert_eq!(fade(&banded), fade(&native), "{case}");
                    if expected.is_ok() {
                        banded.execute("edit.undo", json!({})).unwrap();
                        assert!(pixels(&banded) == before, "{case}: undo");
                    }
                    checked += 1;
                }
            }
        }
    }
    assert_eq!(checked, 4 * 3 * 2 * 16);
}

#[test]
fn invalid_parameters_and_empty_layers_behave_like_the_engine() {
    for (params, empty) in [(json!({"gamma":"invalid"}), false), (json!({"gamma":1.5}), true)] {
        let mut native = fixture("rgb", 8, false).unwrap();
        let mut banded = fixture("rgb", 8, false).unwrap();
        if empty {
            for engine in [&mut native, &mut banded] { engine.execute("layer.new.layer", json!({})).unwrap(); }
        }
        let expected = native.execute("image.adjustments.levels", params.clone()).map_err(|error| error.to_string());
        assert_eq!(execute(&mut banded, "image.adjustments.levels", &params).unwrap(), expected);
        assert_eq!(expected.is_err(), !empty);
        assert!(pixels(&banded) == pixels(&native));
        let (a, b) = (banded.active().unwrap(), native.active().unwrap());
        assert_eq!((a.history.entries().len(), a.revision), (b.history.entries().len(), b.revision));
        assert_eq!(banded.journal, native.journal);
        assert_eq!(banded.edit_state.fade.is_some(), native.edit_state.fade.is_some());
    }
}

#[test]
fn fade_after_a_banded_adjustment_matches_the_engine() {
    let mut native = fixture("rgb", 8, true).unwrap();
    let mut banded = fixture("rgb", 8, true).unwrap();
    let params = json!({"inBlack":30,"gamma":0.8});
    native.execute("image.adjustments.levels", params.clone()).unwrap();
    execute(&mut banded, "image.adjustments.levels", &params).unwrap().unwrap();
    for engine in [&mut native, &mut banded] {
        engine.execute("edit.fade", json!({"opacity":40,"mode":"multiply"})).unwrap();
    }
    assert!(pixels(&banded) == pixels(&native));
    assert_eq!(banded.active().unwrap().history.undo_label(), native.active().unwrap().history.undo_label());
}

#[test]
fn colour_channel_targets_and_non_pixel_layers_stay_on_the_engine_route() {
    let mut engine = fixture("rgb", 8, false).unwrap();
    engine.execute("channel.target", json!({"channel":"red"})).unwrap();
    assert!(execute(&mut engine, "image.adjustments.invert", &json!({})).is_none());
    engine.execute("channel.target", json!({"channel":"composite"})).unwrap();
    engine.execute("layer.newAdjustmentLayer.invert", json!({})).unwrap();
    assert!(execute(&mut engine, "image.adjustments.invert", &json!({})).is_none());
}
