//! Mask routing and default-valued channel adjustments missing from the pinned
//! engine, and pixel-layer adjustments in bounded bands. Uses PhotoCraft's
//! checked parameters and native compose evaluator.
use photocraft_compose::{adjust, Buffer};
use photocraft_engine::{
    channel_cmds::ChannelTarget,
    doc::{ColorMode, Layer, LayerContent, Rect, SampleType},
    edit_menu_cmds::FadeSource,
    EngineError, Session,
};
use photocraft_raster::{from_rgba_into, Surface};
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
        Ok(None) => return pixel_layer(engine, command, kind, params),
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
        apply(&mut surface, area, &adjustment, selection.as_ref(), ColorMode::Grayscale);
        surface.prune();
        super::mask_filters::commit_adjustment(engine, command, params, target, adjustment.label(), surface)
    })())
}

/// The engine converts a whole pixel layer to float RGBA three times over
/// (about 1.5 GB at 24 MP). This is its route and bookkeeping, a band at a time.
fn pixel_layer(
    engine: &mut Session,
    command: &str,
    kind: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    let state = engine.active()?;
    // Colour-channel targets, unmet preconditions and running jobs keep the engine's route.
    if engine.disabled_reason(command).is_some()
        || matches!(state.channel_view.target, ChannelTarget::Color(_))
    {
        return None;
    }
    let id = state.active_layer?;
    let layer = state.doc.layer(id)?;
    if !matches!(layer.content, LayerContent::Raster(_)) {
        return None;
    }
    let mut surface = layer.surface()?.clone();
    let mode = state.doc.mode;
    let selection = state.doc.selection.clone();
    Some((|| {
        let adjustment = photocraft_engine::adjust_params::from_params(kind, params, None, mode)
            .map_err(|error| error.to_string())?;
        let area = surface.content_bounds();
        apply(&mut surface, area, &adjustment, selection.as_ref(), mode);
        super::mask_filters::edit_history(engine, adjustment.label(), params, |doc, _| {
            *doc.layer_mut(id)
                .and_then(Layer::surface_mut)
                .ok_or(EngineError::NoLayer(id))? = surface;
            Ok(())
        })?;
        engine.journal.push((command.to_owned(), params.clone()));
        let state = engine.active().ok_or("No image document")?;
        let fade = FadeSource {
            doc: state.doc.id,
            revision: state.revision,
            layer: id,
            mask: false,
            label: state.history.undo_label().unwrap_or(command).to_owned(),
        };
        engine.edit_state.fade = Some(fade);
        Ok(Value::Null)
    })())
}

#[cfg(test)]
#[path = "xdesign_photo_adjust_fade_tests.rs"]
mod fade_tests;
#[cfg(test)]
#[path = "xdesign_photo_adjust_pixel_tests.rs"]
mod pixel_tests;

// Small bands in tests, so fixtures cross band edges in both directions.
const BAND: (i32, i32) = if cfg!(test) { (40, 32) } else { (4096, 256) };

fn apply(
    surface: &mut Surface,
    area: Rect,
    adjustment: &photocraft_engine::doc::Adjustment,
    selection: Option<&Surface>,
    mode: ColorMode,
) {
    let format = surface.format();
    let channels = format.channels();
    let transfer = adjust::Transfer::for_document(mode, format.sample);
    let depth = (format.sample == SampleType::F32).then_some(format.sample);
    // Bound transient buffers for large layers and sparse masks. Keep absolute
    // coordinates in Buffer so ordered dithering is independent of bands.
    for y in (area.y0..area.y1).step_by(BAND.1 as usize) {
        for x in (area.x0..area.x1).step_by(BAND.0 as usize) {
            let rect = Rect::new(
                x,
                y,
                x.saturating_add(BAND.0).min(area.x1),
                y.saturating_add(BAND.1).min(area.y1),
            );
            let pixels = rect.width() as usize * rect.height() as usize;
            let mut original = vec![[0.0; 4]; pixels];
            surface.read_rgba_into(rect, &mut original);
            let mut buffer = Buffer { rect, px: original.clone() };
            adjust::apply_depth(adjustment, &mut buffer, transfer, depth);
            let coverage = selection.map(|selection| (selection.read_region(rect), selection.channels()));
            let mut output = vec![0.0; pixels * channels];
            for (index, (edited, original)) in buffer.px.iter().zip(&original).enumerate() {
                let k = coverage.as_ref().map_or(1.0, |(coverage, stride)| coverage[index * stride]);
                let mixed = [
                    original[0] + (edited[0] - original[0]) * k,
                    original[1] + (edited[1] - original[1]) * k,
                    original[2] + (edited[2] - original[2]) * k,
                    original[3] + (edited[3] - original[3]) * k,
                ];
                from_rgba_into(&format, mixed, &mut output[index * channels..(index + 1) * channels]);
            }
            surface.write_region(rect, &output);
        }
    }
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
