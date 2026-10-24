//! Mask routing and default-valued channel adjustments missing from the pinned
//! engine. Uses PhotoCraft's checked parameters and native compose evaluator.
use photocraft_compose::{adjust, Buffer};
use photocraft_engine::{
    doc::{ColorMode, Rect, SampleType},
    Session,
};
use photocraft_raster::{from_rgba_into, to_rgba, Surface};
use serde_json::Value;

pub(super) fn execute(
    engine: &mut Session,
    command: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    let kind = command.strip_prefix("image.adjustments.")?;
    if !super::preview::ADJUSTMENTS.contains(&kind) {
        return None;
    }
    if !params.is_object() { return Some(Err("Invalid adjustment parameters".into())); }
    engine.active()?;
    let target = match super::mask_filters::target(engine, params) {
        Ok(Some(target)) => target,
        Ok(None) => return None,
        Err(error) => return Some(Err(error)),
    };
    Some((|| {
        let adjustment =
            photocraft_engine::adjust_params::from_params(kind, params, None, ColorMode::Grayscale)
                .map_err(|error| error.to_string())?;
        let state = engine.active().ok_or("No image document")?;
        let selection = state.doc.selection.clone();
        let bounds = state.doc.bounds();
        let mut surface = super::mask_filters::plane(&state.doc, target)?.clone();
        // Reveal/Hide All masks have no stored tiles. Their default
        // coverage must also change within the canvas, as must mask
        // pixels outside it that can be revealed by a later resize.
        let area = bounds.union(&surface.content_bounds());
        let pixels = u64::from(area.width()) * u64::from(area.height());
        if pixels > super::MAX_PIXELS {
            return Err("The channel adjustment exceeds the image size limit".into());
        }
        apply(&mut surface, area, &adjustment, selection.as_ref());
        super::mask_filters::commit_adjustment(engine, command, params, target, adjustment.label(), surface)
    })())
}

#[cfg(test)]
#[path = "xdesign_photo_adjust_fade_tests.rs"]
mod fade_tests;

fn apply(
    surface: &mut Surface,
    area: Rect,
    adjustment: &photocraft_engine::doc::Adjustment,
    selection: Option<&Surface>,
) {
    let format = surface.format();
    let channels = format.channels();
    let transfer = adjust::Transfer::for_document(ColorMode::Grayscale, format.sample);
    let depth = (format.sample == SampleType::F32).then_some(format.sample);
    // Bound transient buffers even for large/sparse masks. Keep absolute
    // coordinates in Buffer so ordered dithering is independent of bands.
    for y in (area.y0..area.y1).step_by(256) {
        for x in (area.x0..area.x1).step_by(4096) {
            let rect = Rect::new(
                x,
                y,
                x.saturating_add(4096).min(area.x1),
                y.saturating_add(256).min(area.y1),
            );
            let raw = surface.read_region(rect);
            let mut buffer = Buffer {
                rect,
                px: raw
                    .chunks_exact(channels)
                    .map(|pixel| to_rgba(&format, pixel))
                    .collect(),
            };
            adjust::apply_depth(adjustment, &mut buffer, transfer, depth);
            let width = rect.width() as usize;
            let mut output = Vec::with_capacity(raw.len());
            for (index, (edited, original)) in
                buffer.px.iter().zip(raw.chunks_exact(channels)).enumerate()
            {
                let coverage = selection.map_or(1.0, |selection| {
                    selection.sample_channel(
                        rect.x0 + (index % width) as i32,
                        rect.y0 + (index / width) as i32,
                        0,
                    )
                });
                let original = to_rgba(&format, original);
                let mixed = std::array::from_fn(|channel| {
                    original[channel] + (edited[channel] - original[channel]) * coverage
                });
                let mut encoded = [0.0; 8];
                let count = from_rgba_into(&format, mixed, &mut encoded);
                output.extend_from_slice(&encoded[..count]);
            }
            surface.write_region(rect, &output);
        }
    }
    surface.prune();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Session {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":32,"height":24,"background":"#4080b0"}),
            )
            .unwrap();
        engine
            .execute("layer.layerMask.revealAll", json!({}))
            .unwrap();
        engine
    }

    #[test]
    fn mask_adjustments_change_default_coverage_through_soft_selection_and_undo() {
        let mut engine = fixture();
        let id = engine.active().unwrap().active_layer.unwrap();
        engine
            .edit("Selection", |doc, _| {
                let mut selection = Surface::new(photocraft_engine::doc::PixelFormat::GRAY8);
                selection.write_pixel(4, 5, &[0.5]);
                selection.write_pixel(6, 5, &[1.0]);
                doc.selection = Some(selection);
                Ok(())
            })
            .unwrap();
        let source = engine.active().unwrap().doc.clone();
        let history = engine.active().unwrap().history.entries().len();
        execute(
            &mut engine,
            "image.adjustments.invert",
            &json!({"target":"mask"}),
        )
        .unwrap()
        .unwrap();
        let layer = engine.active().unwrap().doc.layer(id).unwrap();
        let mask = &layer.mask.as_ref().unwrap().surface;
        assert!((mask.sample_channel(4, 5, 0) - 0.5).abs() < 1.0 / 255.0);
        assert_eq!(mask.sample_channel(6, 5, 0), 0.0);
        assert_eq!(mask.sample_channel(8, 5, 0), 1.0);
        assert_eq!(
            layer.surface().unwrap().read_region(source.bounds()),
            source
                .layer(id)
                .unwrap()
                .surface()
                .unwrap()
                .read_region(source.bounds())
        );
        assert_eq!(
            engine.active().unwrap().history.entries().len(),
            history + 1
        );
        engine.execute("edit.undo", json!({})).unwrap();
        assert_eq!(
            engine.active().unwrap().doc.layer(id).unwrap().mask,
            source.layer(id).unwrap().mask
        );
        engine.execute("edit.redo", json!({})).unwrap();
        assert_eq!(
            engine
                .active()
                .unwrap()
                .doc
                .layer(id)
                .unwrap()
                .mask
                .as_ref()
                .unwrap()
                .surface
                .sample_channel(6, 5, 0),
            0.0
        );
    }

    #[test]
    fn mask_routing_supports_non_pixel_layers_and_rejects_locked_or_invalid_edits() {
        let mut engine = fixture();
        engine
            .execute("layer.newAdjustmentLayer.invert", json!({}))
            .unwrap();
        engine
            .execute("layer.layerMask.revealAll", json!({}))
            .unwrap();
        engine
            .execute("view.layerMask", json!({"mode":"gray"}))
            .unwrap();
        let id = engine.active().unwrap().active_layer.unwrap();
        execute(&mut engine, "image.adjustments.invert", &json!({}))
            .unwrap()
            .unwrap();
        assert_eq!(
            engine
                .active()
                .unwrap()
                .doc
                .layer(id)
                .unwrap()
                .mask
                .as_ref()
                .unwrap()
                .surface
                .sample_channel(2, 2, 0),
            0.0
        );
        assert!(execute(
            &mut engine,
            "image.adjustments.invert",
            &json!({"target":"pixels"})
        )
        .is_none());
        let source = engine.active().unwrap().doc.clone();
        let history = engine.active().unwrap().history.entries().len();
        assert!(execute(
            &mut engine,
            "image.adjustments.levels",
            &json!({"gamma":"invalid"})
        )
        .unwrap()
        .is_err());
        assert!(std::sync::Arc::ptr_eq(
            &source,
            &engine.active().unwrap().doc
        ));
        assert_eq!(history, engine.active().unwrap().history.entries().len());
        engine
            .edit("Lock", |doc, _| {
                doc.layer_mut(id).unwrap().locks.all = true;
                Ok(())
            })
            .unwrap();
        let source = engine.active().unwrap().doc.clone();
        assert!(execute(&mut engine, "image.adjustments.invert", &json!({}))
            .unwrap()
            .is_err());
        assert!(std::sync::Arc::ptr_eq(
            &source,
            &engine.active().unwrap().doc
        ));
    }
}
