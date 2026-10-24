use photocraft_engine::doc::{Document, Layer, LayerContent, SmartSource, Surface};
use std::{
    collections::HashSet,
    fmt::{self, Debug, Write as FmtWrite},
    io::{self, Write},
    mem::size_of,
    sync::Arc,
};

const STRUCTURED_FACTOR: usize = 16;

struct Budget {
    limit: usize,
    used: usize,
    owned: usize,
    pixels: usize,
    pixel_floor: usize,
    tiles: HashSet<usize>,
    raw: HashSet<usize>,
}

impl Budget {
    fn new(limit: usize, pixel_floor: usize) -> Option<Self> {
        (pixel_floor <= limit).then(|| Self {
            limit, used: pixel_floor, owned: 0, pixels: 0, pixel_floor,
            tiles: HashSet::new(), raw: HashSet::new(),
        })
    }

    fn add(&mut self, bytes: usize) -> Option<()> {
        self.owned = self.owned.checked_add(bytes)?;
        self.used = self.owned.checked_add(self.pixels.max(self.pixel_floor))?;
        (self.used <= self.limit).then_some(())
    }

    fn pixels(&mut self, bytes: usize) -> Option<()> {
        self.pixels = self.pixels.checked_add(bytes)?;
        self.used = self.owned.checked_add(self.pixels.max(self.pixel_floor))?;
        (self.used <= self.limit).then_some(())
    }

    fn string(&mut self, value: &String) -> Option<()> {
        self.add(value.capacity())
    }

    fn raw_bytes(&mut self, value: &Arc<Vec<u8>>) -> Option<()> {
        if self.raw.insert(Arc::as_ptr(value) as usize) {
            self.add(value.capacity())?;
            self.add(size_of::<Vec<u8>>() + 2 * size_of::<usize>())?;
        }
        Some(())
    }

    fn surface(&mut self, surface: &Surface) -> Option<()> {
        self.add(size_of::<Surface>())?;
        self.add(surface.default_bytes().len())?;
        for (_, tile) in surface.tiles() {
            self.add(128)?;
            if self.tiles.insert(Arc::as_ptr(tile) as usize) {
                self.pixels(tile.bytes().len())?;
            }
        }
        Some(())
    }

    fn debug<T: Debug>(&mut self, value: &T) -> Option<()> {
        let remaining = self.limit.checked_sub(self.used)?;
        let cap = remaining / STRUCTURED_FACTOR;
        let mut sink = CappedFmt { len: 0, cap };
        if write!(&mut sink, "{value:?}").is_err() {
            return None;
        }
        self.add(sink.len.checked_mul(STRUCTURED_FACTOR)?)
    }
}

struct CappedFmt {
    len: usize,
    cap: usize,
}

impl FmtWrite for CappedFmt {
    fn write_str(&mut self, value: &str) -> fmt::Result {
        self.len = self.len.checked_add(value.len()).ok_or(fmt::Error)?;
        if self.len > self.cap {
            return Err(fmt::Error);
        }
        Ok(())
    }
}

struct CappedIo {
    len: usize,
    cap: usize,
}

impl Write for CappedIo {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let Some(next) = self.len.checked_add(bytes.len()) else {
            return Err(io::Error::other("preview metadata budget exceeded"));
        };
        if next > self.cap {
            return Err(io::Error::other("preview metadata budget exceeded"));
        }
        self.len = next;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn charge_serialized<T: serde::Serialize>(budget: &mut Budget, value: &T) -> Option<()> {
    let cap = budget.limit.checked_sub(budget.used)? / STRUCTURED_FACTOR;
    let mut sink = CappedIo { len: 0, cap };
    serde_json::to_writer(&mut sink, value).ok()?;
    budget.add(sink.len.checked_mul(STRUCTURED_FACTOR)?)
}

fn charge_layer(budget: &mut Budget, layer: &Layer) -> Option<()> {
    budget.add(size_of::<Layer>())?;
    budget.string(&layer.name)?;
    if let Some(surface) = layer.surface() {
        budget.surface(surface)?;
    }
    if let Some(mask) = &layer.mask {
        budget.surface(&mask.surface)?;
        budget.debug(&(mask.enabled, mask.linked, mask.density, mask.feather))?;
    }
    if let Some(mask) = &layer.vector_mask {
        charge_path(budget, &mask.path)?;
        budget.debug(mask)?;
    }
    if let Some(cache) = &layer.fill_cache {
        budget.debug(&cache.fill)?;
        budget.surface(&cache.surface)?;
    }
    budget.add(
        layer
            .psd_blocks
            .capacity()
            .saturating_mul(size_of::<([u8; 4], Arc<Vec<u8>>)>()),
    )?;
    for (_, data) in &layer.psd_blocks {
        budget.raw_bytes(data)?;
    }
    budget.debug(&(
        &layer.visible,
        &layer.locks,
        &layer.blend,
        layer.opacity,
        layer.fill_opacity,
        layer.clipped,
        layer.effects.enabled,
        &layer.effects.items,
        &layer.effects.reference,
        &layer.label,
    ))?;
    budget.debug(&(
        layer.psd_id,
        layer.link_group,
        layer.excluded_channels,
        &layer.blend_if,
    ))?;
    if let Some(raw) = &layer.effects.psd_raw {
        budget.raw_bytes(raw)?;
    }
    budget.add(vec_capacity_bytes(&layer.effects.items))?;
    if let Some(video) = &layer.video {
        budget.add(vec_capacity_bytes(&video.frames))?;
        for frame in &video.frames {
            budget.surface(frame)?;
        }
        budget.debug(&(&video.source, video.fps, video.show_altered))?;
    }

    match &layer.content {
        LayerContent::Raster(_) => {}
        LayerContent::Group(group) => {
            budget.add(group.children.capacity().saturating_mul(size_of::<Layer>()))?;
            budget.debug(&group.artboard)?;
        }
        LayerContent::Adjustment(value) => budget.debug(value)?,
        LayerContent::Fill(value) => budget.debug(value)?,
        LayerContent::Text(text) => {
            budget.string(&text.text)?;
            budget.string(&text.font_family)?;
            budget.add(vec_capacity_bytes(&text.runs))?;
            budget.add(vec_capacity_bytes(&text.paragraphs))?;
            budget.debug(&(
                text.size_pt,
                text.color,
                text.transform,
                &text.runs,
                &text.paragraphs,
                &text.shape,
                text.orientation,
                text.antialias,
                &text.warp,
            ))?;
            if let Some(raw) = &text.psd_raw {
                budget.raw_bytes(raw)?;
            }
        }
        LayerContent::Shape(shape) => {
            charge_path(budget, &shape.path)?;
            budget.debug(&(&shape.path, &shape.fill, &shape.stroke, &shape.live))?;
            if let Some(raw) = &shape.psd_raw {
                budget.raw_bytes(raw)?;
            }
        }
        LayerContent::Smart(smart) => {
            match &smart.source {
                SmartSource::Embedded { file_name, bytes } => {
                    budget.string(file_name)?;
                    budget.raw_bytes(bytes)?;
                }
                SmartSource::Linked { path } => budget.string(path)?,
            }
            budget.add(vec_capacity_bytes(&smart.smart_filters))?;
            budget.debug(&(
                smart.transform,
                &smart.smart_filters,
                smart.filters_enabled,
                &smart.warp,
                smart.stack_mode,
                smart.perspective,
            ))?;
            if let Some(mask) = &smart.filter_mask {
                budget.surface(&mask.surface)?;
                budget.debug(&(mask.enabled, mask.linked, mask.density, mask.feather))?;
            }
            if let Some(raw) = &smart.psd_raw {
                budget.raw_bytes(raw)?;
            }
        }
    }
    Some(())
}

fn vec_capacity_bytes<T>(values: &Vec<T>) -> usize {
    values.capacity().saturating_mul(size_of::<T>())
}

fn charge_named_path(budget: &mut Budget, path: &photocraft_engine::doc::NamedPath) -> Option<()> {
    budget.string(&path.name)?;
    charge_path(budget, &path.path)?;
    if let Some(raw) = &path.psd_raw {
        budget.raw_bytes(raw)?;
    }
    Some(())
}

fn charge_path(budget: &mut Budget, path: &photocraft_engine::doc::Path) -> Option<()> {
    budget.add(vec_capacity_bytes(&path.subpaths))?;
    for subpath in &path.subpaths {
        budget.add(size_of::<photocraft_engine::doc::Subpath>())?;
        budget.add(vec_capacity_bytes(&subpath.knots))?;
    }
    budget.debug(&path.fill_rule)?;
    budget.debug(&path.inverted)
}

fn charge_comp(budget: &mut Budget, comp: &photocraft_engine::doc::LayerComp) -> Option<()> {
    budget.add(size_of::<photocraft_engine::doc::LayerComp>())?;
    budget.string(&comp.name)?;
    budget.string(&comp.comment)?;
    budget.add(vec_capacity_bytes(&comp.states))?;
    for state in &comp.states {
        budget.add(size_of::<photocraft_engine::doc::CompLayerState>())?;
        budget.debug(&state.layer)?;
        budget.debug(&state.visible)?;
        budget.debug(&state.position)?;
        if let Some(appearance) = &state.appearance {
            budget.add(size_of::<photocraft_engine::doc::CompAppearance>())?;
            budget.debug(&(
                appearance.blend,
                appearance.opacity,
                appearance.fill_opacity,
            ))?;
            budget.debug(&appearance.effects.items)?;
            budget.add(vec_capacity_bytes(&appearance.effects.items))?;
            if let Some(raw) = &appearance.effects.psd_raw {
                budget.raw_bytes(raw)?;
            }
        }
    }
    Some(())
}

pub(super) fn retained_document_bytes(doc: &Document, limit: usize) -> Option<usize> {
    let mut budget = Budget::new(limit, 0)?;
    charge_document(&mut budget, doc)?;
    Some(budget.used)
}

pub(super) struct DocumentBudget {
    budget: Budget,
    documents: HashSet<usize>,
}

impl DocumentBudget {
    pub(super) fn new(limit: usize, pixel_floor: usize, overhead: usize) -> Option<Self> {
        let mut budget = Budget::new(limit, pixel_floor)?;
        budget.add(overhead)?;
        Some(Self { budget, documents: HashSet::new() })
    }

    pub(super) fn include(&mut self, document: &Arc<Document>) -> Option<()> {
        if self.documents.insert(Arc::as_ptr(document) as usize) {
            charge_document(&mut self.budget, document)?;
        }
        Some(())
    }

    pub(super) fn bytes(&self) -> usize { self.budget.used }
}

fn charge_document(budget: &mut Budget, doc: &Document) -> Option<()> {
    budget.add(size_of::<Document>())?;
    budget.string(&doc.name)?;
    budget.add(doc.layers.capacity().saturating_mul(size_of::<Layer>()))?;
    let mut levels = vec![doc.layers.iter()];
    while let Some(level) = levels.last_mut() {
        if let Some(layer) = level.next() {
            charge_layer(budget, layer)?;
            if let Some(children) = layer.children() { levels.push(children.iter()); }
        } else {
            levels.pop();
        }
    }
    budget.add(vec_capacity_bytes(&doc.paths))?;
    for path in &doc.paths {
        charge_named_path(budget, path)?;
    }
    if let Some(path) = &doc.work_path {
        charge_path(budget, path)?;
    }

    for channel in doc.channels.iter().chain(doc.quick_mask.iter()) {
        budget.add(size_of::<photocraft_engine::doc::AlphaChannel>())?;
        budget.string(&channel.name)?;
        budget.surface(&channel.surface)?;
        budget.debug(&(
            &channel.spot,
            &channel.color,
            channel.opacity,
            channel.indicates,
        ))?;
    }
    if let Some(selection) = &doc.selection {
        budget.surface(selection)?;
    }
    for pattern in &doc.patterns {
        budget.add(size_of::<photocraft_engine::doc::Pattern>())?;
        budget.string(&pattern.id)?;
        budget.string(&pattern.name)?;
        budget.surface(&pattern.surface)?;
        budget.debug(&(pattern.width, pattern.height))?;
    }
    if let Some(profile) = &doc.icc_profile {
        budget.raw_bytes(profile)?;
    }
    if let Some(exif) = &doc.metadata.exif {
        budget.raw_bytes(exif)?;
    }
    if let Some(xmp) = &doc.metadata.xmp {
        budget.string(xmp)?;
    }
    for (_, name, data) in &doc.metadata.psd_resources {
        budget.string(name)?;
        budget.raw_bytes(data)?;
    }
    for (_, _, data) in &doc.metadata.psd_global_blocks {
        budget.raw_bytes(data)?;
    }

    budget.add(vec_capacity_bytes(&doc.channels))?;
    budget.add(
        doc.patterns
            .capacity()
            .saturating_mul(size_of::<photocraft_engine::doc::Pattern>()),
    )?;
    budget.add(vec_capacity_bytes(&doc.metadata.psd_resources))?;
    budget.add(vec_capacity_bytes(&doc.metadata.psd_global_blocks))?;

    budget.add(vec_capacity_bytes(&doc.layer_comps))?;
    for comp in &doc.layer_comps {
        charge_comp(budget, comp)?;
    }
    if let Some(comp) = &doc.last_document_state {
        charge_comp(budget, comp)?;
    }

    budget.debug(&(
        doc.size,
        doc.resolution_dpi,
        doc.mode,
        doc.depth,
        &doc.guides,
        &doc.work_path,
        &doc.clipping_path,
        &doc.global_light,
        &doc.color_table,
        &doc.duotone,
    ))?;
    budget.debug(&(
        doc.last_applied_comp,
        &doc.measurement,
        &doc.notes,
        &doc.text_styles,
        &doc.slices,
        &doc.variables,
        &doc.timeline,
    ))?;
    charge_serialized(budget, &doc.guides)?;
    charge_serialized(budget, &doc.variables)?;
    charge_serialized(budget, &doc.slices)?;
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::doc::{
        Color, ColorMode, Fill, FillCache, LayerMask, Pattern, SampleType, Size, SmartObject,
        Surface, VideoData,
    };

    fn doc() -> Document {
        Document::new("preview", Size::new(32, 24), ColorMode::Rgb, SampleType::U8)
    }

    fn tiled() -> Surface {
        let mut surface = Surface::new(photocraft_engine::doc::PixelFormat::RGBA8);
        surface.write_region(
            photocraft_engine::doc::Rect::new(0, 0, 1, 1),
            &[0.2, 0.4, 0.6, 1.0],
        );
        surface
    }

    #[test]
    fn retained_estimate_includes_surfaces_history_counter_omits() {
        let baseline = retained_document_bytes(&doc(), 8 * 1024 * 1024).unwrap();

        let mut selection = doc();
        selection.selection = Some(tiled());
        assert!(retained_document_bytes(&selection, 8 * 1024 * 1024).unwrap() > baseline);

        let mut patterns = doc();
        patterns
            .patterns
            .push(Pattern::new("tile", tiled(), 256, 256));
        assert!(retained_document_bytes(&patterns, 8 * 1024 * 1024).unwrap() > baseline);

        let mut cached_fill = doc();
        let mut layer = Layer::raster("fill", photocraft_engine::doc::PixelFormat::RGBA8);
        layer.fill_cache = Some(FillCache {
            fill: Fill::Solid(Color::BLACK),
            surface: tiled(),
        });
        cached_fill.layers.push(layer);
        assert!(retained_document_bytes(&cached_fill, 8 * 1024 * 1024).unwrap() > baseline);

        let mut smart_mask = doc();
        let mut smart = SmartObject::new(
            SmartSource::Linked {
                path: "linked.psd".into(),
            },
            Default::default(),
            None,
        );
        smart.filter_mask = Some(LayerMask {
            surface: tiled(),
            ..LayerMask::reveal_all()
        });
        smart_mask
            .layers
            .push(Layer::new("smart", LayerContent::Smart(smart)));
        assert!(retained_document_bytes(&smart_mask, 8 * 1024 * 1024).unwrap() > baseline);

        let mut video = doc();
        let mut layer = Layer::raster("video", photocraft_engine::doc::PixelFormat::RGBA8);
        layer.video = Some(VideoData::new(vec![tiled()], 24.0));
        video.layers.push(layer);
        assert!(retained_document_bytes(&video, 8 * 1024 * 1024).unwrap() > baseline);
    }

    #[test]
    fn retained_estimate_counts_raw_payloads_and_fails_closed_at_limit() {
        let mut value = doc();
        value.icc_profile = Some(Arc::new(vec![1; 32 * 1024]));
        value.metadata.xmp = Some("metadata".repeat(4096));
        let estimate = retained_document_bytes(&value, 8 * 1024 * 1024).unwrap();
        assert!(estimate >= 32 * 1024 + value.metadata.xmp.as_ref().unwrap().capacity());
        assert_eq!(retained_document_bytes(&value, estimate - 1), None);
    }

    #[test]
    fn raw_path_and_effect_capacities_are_charged_even_when_empty() {
        let empty = retained_document_bytes(&doc(), 8 * 1024 * 1024).unwrap();

        let mut path_doc = doc();
        path_doc.paths.push(photocraft_engine::doc::NamedPath {
            name: "saved".into(),
            psd_raw: Some(Arc::new(Vec::with_capacity(64 * 1024))),
            ..Default::default()
        });
        let path_estimate = retained_document_bytes(&path_doc, 8 * 1024 * 1024).unwrap();
        assert!(path_estimate >= empty + 64 * 1024);

        let mut effect_doc = doc();
        let mut layer = Layer::raster("layer", photocraft_engine::doc::PixelFormat::RGBA8);
        layer.effects.psd_raw = Some(Arc::new(Vec::with_capacity(64 * 1024)));
        effect_doc.layers.push(layer);
        let effect_estimate = retained_document_bytes(&effect_doc, 8 * 1024 * 1024).unwrap();
        assert!(effect_estimate >= empty + 64 * 1024);
    }

    #[test]
    fn pixel_floor_combines_owned_cost_with_the_larger_pixel_union() {
        let mut zero = Budget::new(1000, 0).unwrap();
        zero.add(10).unwrap(); zero.pixels(20).unwrap(); zero.add(30).unwrap();
        assert_eq!(zero.used, 60);
        let mut floor = Budget::new(1000, 100).unwrap();
        floor.add(10).unwrap(); floor.pixels(20).unwrap(); floor.add(30).unwrap();
        assert_eq!(floor.used, 140);
        floor.pixels(120).unwrap();
        assert_eq!(floor.used, 180);
        let mut exact = Budget::new(180, 100).unwrap();
        exact.add(40).unwrap(); exact.pixels(140).unwrap();
        assert_eq!(exact.used, 180);
        assert!(exact.add(1).is_none());
    }

    #[test]
    fn document_budget_deduplicates_allocations_and_preserves_preview_thresholds() {
        let mut value = doc();
        value.layers.push(Layer::new("pixels", LayerContent::Raster(tiled())));
        value.metadata.exif = Some(Arc::new(vec![7; 128 * 1024]));
        let first = Arc::new(value);
        let preview = retained_document_bytes(&first, 8 * 1024 * 1024).unwrap();
        let mut shared = DocumentBudget::new(preview, 0, 0).unwrap();
        shared.include(&first).unwrap();
        assert_eq!(shared.bytes(), preview);
        shared.include(&first).unwrap();
        assert_eq!(shared.bytes(), preview);
        assert!(retained_document_bytes(&first, preview - 1).is_none());
        let copy = Arc::new((*first).clone());
        assert_eq!(first.id, copy.id);
        let mut shared = DocumentBudget::new(8 * 1024 * 1024, 0, 0).unwrap();
        shared.include(&first).unwrap(); shared.include(&copy).unwrap();
        assert!(shared.bytes() > preview);
        let shared_cost = shared.bytes();
        let mut distinct = (*copy).clone();
        distinct.metadata.exif = Some(Arc::new(vec![7; 128 * 1024]));
        let mut separate = DocumentBudget::new(8 * 1024 * 1024, 0, 0).unwrap();
        separate.include(&first).unwrap(); separate.include(&Arc::new(distinct)).unwrap();
        assert!(separate.bytes() >= shared_cost + 128 * 1024);
    }

    #[test]
    fn pixel_floor_does_not_add_tiles_already_charged_by_native_history() {
        let mut value = doc();
        let pixels = tiled();
        let tile_bytes = pixels.tiles().map(|(_, tile)| tile.bytes().len()).sum::<usize>();
        value.layers.push(Layer::new("pixels", LayerContent::Raster(pixels.clone())));
        value.patterns.push(Pattern::new("shared", pixels, 1, 1));
        let value = Arc::new(value);
        let preview = retained_document_bytes(&value, 8 * 1024 * 1024).unwrap();
        let mut covered = DocumentBudget::new(8 * 1024 * 1024, tile_bytes, 0).unwrap();
        covered.include(&value).unwrap();
        assert_eq!(covered.bytes(), preview);
        let mut redo_floor = DocumentBudget::new(8 * 1024 * 1024, tile_bytes * 3, 0).unwrap();
        redo_floor.include(&value).unwrap();
        assert_eq!(redo_floor.bytes(), preview + tile_bytes * 2);
        let mut smaller = DocumentBudget::new(8 * 1024 * 1024, tile_bytes / 2, 0).unwrap();
        smaller.include(&value).unwrap();
        assert_eq!(smaller.bytes(), preview);
    }
}
