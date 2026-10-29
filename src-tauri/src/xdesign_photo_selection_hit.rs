//! `selection.contains`: whether a canvas point is inside the selection's marching ants, for tools such as
//! Patch that act differently on a press inside the selection. Read only.
use photocraft_algo::selection::mask_from_surface;
use photocraft_engine::{doc::Rect, Session};
use serde_json::{json, Value};

pub(super) const COMMAND: &str = "selection.contains";

pub(super) fn query(engine: &Session, command: &str, params: &Value) -> Option<Result<Value, String>> {
    if command != COMMAND {
        return None;
    }
    Some((|| {
        let (Some(x), Some(y)) = (params["x"].as_f64(), params["y"].as_f64()) else {
            return Err(format!("{COMMAND}: x and y must be numbers"));
        };
        let selection = engine.active().ok_or("No image document")?.doc.selection.as_ref();
        // A point beyond any surface's reach is simply outside; it is not moved onto the canvas.
        let pixel = |v: f64| Some(v.floor()).filter(|v| (f64::from(i32::MIN)..f64::from(i32::MAX)).contains(v)).map(|v| v as i32);
        let inside = match (selection, pixel(x), pixel(y)) {
            (Some(selection), Some(x), Some(y)) => mask_from_surface(Some(selection), Rect::new(x, y, x + 1, y + 1))[0] >= 0.5,
            _ => false,
        };
        Ok(json!({ "inside": inside }))
    })())
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_algo::selection::{combine, SelectionMode};

    fn image() -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width": 8, "height": 8, "background": "#808080"})).unwrap();
        engine
    }
    fn contains(engine: &mut Session, x: Value, y: Value) -> Result<Value, String> {
        super::super::execute_view_command(engine, COMMAND, json!({"x": x, "y": y}))
    }
    fn inside(engine: &mut Session, x: f64, y: f64) -> bool {
        contains(engine, json!(x), json!(y)).unwrap()["inside"].as_bool().unwrap()
    }

    #[test]
    fn a_point_is_inside_where_the_selection_covers_its_pixel() {
        let mut engine = image();
        assert!(!inside(&mut engine, 3.0, 3.0), "no selection: nothing is inside");
        engine.execute("select.rect", json!({"x": 2, "y": 2, "width": 4, "height": 4})).unwrap();
        assert!(inside(&mut engine, 3.0, 3.0));
        assert!(inside(&mut engine, 2.0, 5.9), "a fractional point tests the pixel it falls in");
        assert!(!inside(&mut engine, 6.0, 3.0), "the right edge is outside");
        assert!(!inside(&mut engine, 1.99, 3.0));
        assert!(!inside(&mut engine, -40.0, 3.0), "off the canvas");
        assert!(!inside(&mut engine, 3.0, 1e12));
        // The bounding box is not the selection: a ring has an unselected hole.
        engine.execute("select.rect", json!({"x": 3, "y": 3, "width": 2, "height": 2, "mode": "subtract"})).unwrap();
        assert!(!inside(&mut engine, 3.5, 3.5) && inside(&mut engine, 2.5, 2.5));
    }

    #[test]
    fn half_coverage_counts_as_inside() {
        let mut engine = image();
        let values = [128.0 / 255.0, 127.0 / 255.0, 1.0, 0.0];
        let selection = combine(None, &values, Rect::new(0, 0, 4, 1), SelectionMode::Replace);
        std::sync::Arc::make_mut(&mut engine.active_mut().unwrap().doc).selection = selection;
        let row: Vec<bool> = (0..4).map(|x| inside(&mut engine, x as f64 + 0.5, 0.5)).collect();
        assert_eq!(row, [true, false, true, false]);
    }

    #[test]
    fn the_query_changes_nothing() {
        let mut engine = image();
        engine.execute("select.rect", json!({"x": 2, "y": 2, "width": 4, "height": 4})).unwrap();
        let before = engine.active().unwrap().clone();
        let journal = engine.journal.clone();
        assert_eq!(contains(&mut engine, json!(3), json!(3)).unwrap(), json!({"inside": true}));
        let after = engine.active().unwrap();
        assert!(std::sync::Arc::ptr_eq(&before.doc, &after.doc));
        assert_eq!((after.history.past_len(), after.revision), (before.history.past_len(), before.revision));
        assert_eq!(engine.journal, journal);
        assert!(super::super::command_supported(COMMAND));
    }

    #[test]
    fn bad_points_are_refused() {
        let mut engine = image();
        for (x, y) in [(json!(null), json!(3)), (json!("3"), json!(3)), (json!(3), json!(true)), (json!([3]), json!(3))] {
            assert_eq!(contains(&mut engine, x.clone(), y.clone()).unwrap_err(), "selection.contains: x and y must be numbers", "{x} {y}");
        }
        let error = super::super::execute_view_command(&mut engine, COMMAND, json!({"x": 3})).unwrap_err();
        assert_eq!(error, "selection.contains: x and y must be numbers");
        let error = super::super::execute_view_command(&mut Session::new(), COMMAND, json!({"x": 3, "y": 3})).unwrap_err();
        assert_eq!(error, "No image document");
    }
}
