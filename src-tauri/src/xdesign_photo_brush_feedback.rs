//! Guarded native Brush/Pencil/Eraser drafts; the public LiveStroke owns paint math.
//! Channel routing/restoration follows PhotoCraft 47f9306f channel_cmds.rs.
use photocraft_engine::{brush_cmds::LiveStroke, channel_cmds::{ChannelTarget, ChannelView},
    doc::{Document, LayerId, Rect}, paint::StrokePoint, Session, ToolState};
use serde_json::Value;
use std::sync::Arc;

pub(super) struct BrushDraft {
    live: LiveStroke,
    copies: Option<super::super::symmetry::Copies>,
    source: Arc<Document>,
    before: ToolState,
    preset_revision: u64,
    active_layer: Option<LayerId>,
    channel_view: ChannelView,
    symmetry: Option<(String, Vec<[[f64; 2]; 2]>)>,
    restriction: Option<usize>,
    label: &'static str,
    behind: Option<super::super::paint_modes::Behind>,
    #[cfg(test)] samples_pushed: usize,
}

impl BrushDraft {
    pub fn begin(engine: &Session, command: &str, params: &Value) -> Result<Self, String> {
        let state = engine.active().ok_or("No brush image")?;
        let mut effective = params.clone();
        if effective.get("target").is_none() {
            match state.channel_view.target {
                ChannelTarget::Alpha(index) if index < state.doc.channels.len() => effective["target"] = serde_json::json!({"channel":index}),
                ChannelTarget::Composite if state.doc.quick_mask.is_some() => effective["target"] = serde_json::json!("quickMask"),
                ChannelTarget::Composite if photocraft_engine::mask_view_cmds::current(state).is_some() => effective["target"] = serde_json::json!("mask"),
                _ => {}
            }
        }
        let mode = super::super::paint_modes::begin(engine, command, &mut effective)?;
        let brush = photocraft_engine::brush_cmds::resolve_brush(engine, &effective, command).map_err(|error| error.to_string())?;
        let label = if let Some(mode) = &mode { mode.label } else if brush.erase { "Eraser" } else if command == "paint.pencil" { "Pencil" } else { "Brush Tool" };
        let restriction = if matches!(effective["target"].as_str(), Some("mask" | "quickMask")) || effective["target"]["channel"].as_u64().is_some() {
            None
        } else {
            match state.channel_view.target { ChannelTarget::Color(index) => Some(index), _ => None }
        };
        let base = mode.as_ref().and_then(|mode| mode.scratch.as_ref()).unwrap_or(engine);
        let plan = super::super::symmetry::plan(base, command, &mut effective)?;
        let live = LiveStroke::begin_with(plan.as_ref().map_or(base, |plan| plan.session()), command, &effective).map_err(|error| error.to_string())?;
        let copies = plan.map(|plan| plan.begin(command, &effective, &live)).transpose()?;
        let painted = copies.as_ref().map_or(&live.doc, |copies| copies.document());
        let behind = mode.and_then(|mode| mode.behind(&state.doc, painted, copies.as_ref().map_or_else(|| live.bounds(), |copies| copies.bounds(&live))));
        let mut draft = Self { live, copies, source: state.doc.clone(), before: super::feedback_tools(&engine.tools),
            preset_revision: engine.presets.rev, active_layer: state.active_layer, channel_view: state.channel_view.clone(),
            symmetry: state.symmetry_path.as_ref().map(|axis| (axis.source.clone(), axis.segments.clone())), restriction, label, behind,
            #[cfg(test)] samples_pushed: params["points"].as_array().map_or(0, Vec::len),
        };
        draft.restore_channels();
        Ok(draft)
    }

    pub fn matches(&self, engine: &Session) -> bool {
        engine.active().is_some_and(|state| Arc::ptr_eq(&self.source, &state.doc)
            && self.active_layer == state.active_layer && self.channel_view == state.channel_view
            && match (&self.symmetry, &state.symmetry_path) {
                (None, None) => true,
                (Some((source, segments)), Some(axis)) => *source == axis.source && *segments == axis.segments,
                _ => false,
            })
            && self.before.brush == engine.tools.brush && self.before.foreground == engine.tools.foreground
            && self.before.background == engine.tools.background && self.before.presets_rev == engine.tools.presets_rev
            && self.preset_revision == engine.presets.rev
    }

    pub fn seed(&self) -> u64 { self.live.seed }
    pub fn document(&self) -> Arc<Document> { self.behind.as_ref().map_or_else(|| self.painted().clone(), |behind| behind.document()) }
    pub fn bounds(&self) -> Rect { self.copies.as_ref().map_or_else(|| self.live.bounds(), |copies| copies.bounds(&self.live)) }
    /// The stroke with every symmetry copy, before Behind shows the layer over it.
    fn painted(&self) -> &Arc<Document> { self.copies.as_ref().map_or(&self.live.doc, |copies| copies.document()) }
    /// Returns the rectangle these samples changed (including the redrawn smoothing tail).
    pub fn push(&mut self, points: &[StrokePoint]) -> Result<Rect, String> {
        let damage = self.live.push(points).map_err(|error| error.to_string())?;
        let regions = match &mut self.copies { Some(copies) => copies.push(&self.live, damage, points)?, None => vec![damage] };
        let painted = self.copies.as_ref().map_or(&self.live.doc, |copies| copies.document());
        if let Some(behind) = &mut self.behind { for region in &regions { behind.update(&self.source, painted, *region); } }
        self.restore_channels();
        #[cfg(test)] { self.samples_pushed += points.len(); }
        Ok(regions.iter().fold(Rect::EMPTY, |all, region| all.union(region)))
    }

    fn restore_channels(&mut self) {
        let (Some(channel), Some(layer)) = (self.restriction, self.active_layer) else { return };
        let Some(original) = self.source.layer(layer).and_then(|layer| layer.surface()) else { return };
        let painted = match &mut self.copies { Some(copies) => copies.document_mut(), None => &mut self.live.doc };
        let Some(target) = Arc::make_mut(painted).layer_mut(layer).and_then(|layer| layer.surface_mut()) else { return };
        if original.format() != target.format() { return; }
        let mut coords: Vec<_> = target.tiles().filter(|(coord, tile)| original.tile(**coord).is_none_or(|old| !Arc::ptr_eq(old, tile))).map(|(coord, _)| *coord).collect();
        coords.extend(original.tiles().filter(|(coord, _)| target.tile(**coord).is_none()).map(|(coord, _)| *coord));
        let channels = target.channels();
        for coord in coords {
            let rect = coord.rect();
            for y in (rect.y0..rect.y1).step_by(64) { for x in (rect.x0..rect.x1).step_by(64) {
                let part = Rect::new(x, y, (i64::from(x) + 64).min(i64::from(rect.x1)) as i32, (i64::from(y) + 64).min(i64::from(rect.y1)) as i32);
                let before = original.read_region(part);
                let mut pixels = target.read_region(part);
                for (pixel, source) in pixels.chunks_exact_mut(channels).zip(before.chunks_exact(channels)) {
                    for index in 0..channels { if index != channel { pixel[index] = source[index]; } }
                }
                target.write_region(part, &pixels);
            }}
        }
        target.prune();
    }

    pub fn prepared(&self) -> super::super::prepared::Prepared {
        let damage = self.bounds();
        super::super::prepared::Prepared { document: self.document(), damage, label: self.label,
            result: serde_json::json!({"damage":[damage.x0,damage.y0,damage.width(),damage.height()]}), clone_sources: None, mixer: None }
    }
    #[cfg(test)] pub fn samples_pushed(&self) -> usize { self.samples_pushed }
}
