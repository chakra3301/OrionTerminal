//! Cancellable staging over pinned PhotoCraft native source/composition APIs.
//! Copyright (c) 2026 ArtCraft Team and PhotoCraft contributors. MIT OR Apache-2.0.
use super::{
    admission, alpha_index, from_rgba_into, Document, Interrupt, LayerId, Mapping, PixelFormat,
    Region, SampleLayers, Surface,
};

const CHUNK: usize = 4096;
#[derive(Default)]
pub(super) struct Sources {
    #[cfg(test)]
    pub(super) peak_read_pixels: usize,
    #[cfg(test)]
    pub(super) peak_encode_pixels: usize,
    #[cfg(test)]
    pub(super) peak_resample_pixels: usize,
}
impl Sources {
    pub(super) fn read(
        &mut self,
        surface: &Surface,
        rect: photocraft_engine::doc::Rect,
        ctl: &Interrupt,
    ) -> Result<Region, String> {
        admission::check(ctl)?;
        admission::area(rect)?;
        let n = surface.channels();
        let mut data = Vec::with_capacity(rect.width() as usize * rect.height() as usize * n);
        for y in rect.y0..rect.y1 {
            for x in (rect.x0..rect.x1).step_by(CHUNK) {
                admission::check(ctl)?;
                let r = photocraft_engine::doc::Rect::new(
                    x,
                    y,
                    x + ((i64::from(rect.x1) - i64::from(x)).min(CHUNK as i64) as i32),
                    y + 1,
                );
                let values = surface.read_region(r);
                data.extend_from_slice(&values);
                #[cfg(test)]
                {
                    self.peak_read_pixels = self.peak_read_pixels.max(r.width() as usize);
                }
            }
        }
        admission::check(ctl)?;
        Ok(Region { rect, ch: n, data })
    }
    pub(super) fn compose(
        &mut self,
        pre: &Document,
        id: Option<LayerId>,
        which: SampleLayers,
        rect: photocraft_engine::doc::Rect,
        fmt: PixelFormat,
        ctl: &Interrupt,
    ) -> Result<Region, String> {
        admission::check(ctl)?;
        admission::area(rect)?;
        let mut doc = pre.clone();
        if which == SampleLayers::CurrentAndBelow {
            if let Some(id) = id {
                let walk: Vec<_> = pre.walk().into_iter().map(|(p, _, l)| (p, l.id)).collect();
                if let Some(pos) = walk.iter().position(|(_, l)| *l == id) {
                    for (path, _) in &walk[pos + 1..] {
                        admission::check(ctl)?;
                        if let Some(layer) = doc.layer_at_mut(path) {
                            layer.visible = false;
                        }
                    }
                }
            }
        }
        admission::check(ctl)?;
        let buf = photocraft_compose::render(&doc, rect);
        admission::check(ctl)?;
        let n = fmt.channels();
        let mut data = Vec::with_capacity(rect.width() as usize * rect.height() as usize * n);
        let mut enc = [0.0f32; 8];
        for chunk in buf.px.chunks(CHUNK) {
            admission::check(ctl)?;
            for px in chunk {
                from_rgba_into(&fmt, *px, &mut enc);
                data.extend_from_slice(&enc[..n]);
            }
            #[cfg(test)]
            {
                self.peak_encode_pixels = self.peak_encode_pixels.max(chunk.len());
            }
        }
        admission::check(ctl)?;
        Ok(Region { rect, ch: n, data })
    }
    fn sample(
        &mut self,
        pre: &Document,
        id: Option<LayerId>,
        surface: &Surface,
        which: SampleLayers,
        rect: photocraft_engine::doc::Rect,
        ctl: &Interrupt,
    ) -> Result<Region, String> {
        if which == SampleLayers::Current {
            self.read(surface, rect, ctl)
        } else {
            self.compose(pre, id, which, rect, surface.format(), ctl)
        }
    }
    fn resample(
        &mut self,
        src: &Region,
        rect: photocraft_engine::doc::Rect,
        map: &Mapping,
        alpha: Option<usize>,
        ctl: &Interrupt,
    ) -> Result<Region, String> {
        admission::check(ctl)?;
        admission::area(rect)?;
        let n = src.ch;
        let mut data = Vec::with_capacity(rect.width() as usize * rect.height() as usize * n);
        for y in rect.y0..rect.y1 {
            for x in (rect.x0..rect.x1).step_by(CHUNK) {
                admission::check(ctl)?;
                let r = photocraft_engine::doc::Rect::new(
                    x,
                    y,
                    x + ((i64::from(rect.x1) - i64::from(x)).min(CHUNK as i64) as i32),
                    y + 1,
                );
                let part = photocraft_engine::presets::clone_source::resample(src, r, map, alpha);
                data.extend_from_slice(&part.data);
                #[cfg(test)]
                {
                    self.peak_resample_pixels =
                        self.peak_resample_pixels.max(part.width() * part.height());
                }
            }
        }
        admission::check(ctl)?;
        Ok(Region { rect, ch: n, data })
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn clone_sample(
        &mut self,
        pre: &Document,
        id: Option<LayerId>,
        surface: &Surface,
        which: SampleLayers,
        rect: photocraft_engine::doc::Rect,
        map: &Mapping,
        ctl: &Interrupt,
    ) -> Result<Region, String> {
        admission::check(ctl)?;
        super::admit_source(rect, map)?;
        if map.is_translation() {
            let off = map.offset();
            let mut result =
                self.sample(pre, id, surface, which, rect.translate(off.0, off.1), ctl)?;
            result.rect = rect;
            return Ok(result);
        }
        let source = self.sample(pre, id, surface, which, map.source_rect(rect), ctl)?;
        self.resample(&source, rect, map, alpha_index(&surface.format()), ctl)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::{
        doc::{ColorMode, Rect, SampleType},
        Session,
    };
    use serde_json::json;
    #[test]
    fn resampling_chunks_near_integer_limits_match_native() {
        let rect = Rect::from_xywh(i32::MAX - 32, i32::MAX - 24, 24, 16);
        let src_rect = Rect::from_xywh(-10, -10, 80, 64);
        let src = Region {
            rect: src_rect,
            ch: 4,
            data: (0..80 * 64 * 4).map(|i| (i % 41) as f32 * 0.019).collect(),
        };
        let map = Mapping {
            source: (10.5, 12.6),
            anchor: (f64::from(i32::MAX - 32), f64::from(i32::MAX - 24)),
            m: [0.98, 0.02, -0.003, 1.08],
        };
        let mut sources = Sources::default();
        let actual = sources
            .resample(&src, rect, &map, Some(3), &Interrupt::NONE)
            .unwrap();
        let expected =
            photocraft_engine::presets::clone_source::resample(&src, rect, &map, Some(3));
        assert!(actual
            .data
            .iter()
            .zip(expected.data)
            .all(|(a, b)| a.to_bits() == b.to_bits()));
        assert_eq!(sources.peak_resample_pixels, 24);
    }
    #[test]
    fn bounded_reads_and_resampling_preserve_native_bits_across_formats_and_transforms() {
        let rect = Rect::from_xywh(-21, 7, 8301, 4);
        for mode in [
            ColorMode::Rgb,
            ColorMode::Grayscale,
            ColorMode::Cmyk,
            ColorMode::Lab,
        ] {
            for sample in [SampleType::U8, SampleType::U16, SampleType::F32] {
                for alpha in [false, true] {
                    let fmt = PixelFormat::new(mode, sample, alpha);
                    let n = fmt.channels();
                    let mut surface = Surface::new(fmt);
                    let filled = Rect::from_xywh(-30, 0, 200, 32);
                    surface.write_region(
                        filled,
                        &(0..200 * 32 * n)
                            .map(|i| (i % 37) as f32 * 0.047 - 0.1)
                            .collect::<Vec<_>>(),
                    );
                    let mut sources = Sources::default();
                    let read = sources.read(&surface, rect, &Interrupt::NONE).unwrap();
                    assert!(read
                        .data
                        .iter()
                        .zip(surface.read_region(rect))
                        .all(|(a, b)| a.to_bits() == b.to_bits()));
                    assert_eq!(sources.peak_read_pixels, 4096);
                    for m in [
                        [1.0, 0.0, 0.0, 1.0],
                        [1.08, 0.02, -0.003, 0.98],
                        [-0.9, 0.03, 0.002, 1.0],
                    ] {
                        let map = Mapping {
                            source: (7.7, -12.2),
                            anchor: (18.1, 2.6),
                            m,
                        };
                        let src_rect = map.source_rect(rect);
                        let src = Region {
                            rect: src_rect,
                            ch: n,
                            data: (0..src_rect.width() as usize * src_rect.height() as usize * n)
                                .map(|i| (i % 41) as f32 * 0.061 - 0.2)
                                .collect(),
                        };
                        let actual = sources
                            .resample(&src, rect, &map, alpha.then_some(n - 1), &Interrupt::NONE)
                            .unwrap();
                        let expected = photocraft_engine::presets::clone_source::resample(
                            &src,
                            rect,
                            &map,
                            alpha.then_some(n - 1),
                        );
                        assert!(
                            actual
                                .data
                                .iter()
                                .zip(&expected.data)
                                .all(|(a, b)| a.to_bits() == b.to_bits()),
                            "{mode:?}/{sample:?}/{alpha}/{m:?}"
                        );
                        assert_eq!(sources.peak_resample_pixels, 4096);
                    }
                }
            }
        }
    }
    #[test]
    fn full_domain_composition_and_current_below_visibility_match_native_adapter() {
        for depth in [8, 16, 32] {
            for mode in ["rgb", "gray", "cmyk", "lab"] {
                let mut engine = Session::new();
                engine.execute("file.new",json!({"width":120,"height":96,"depth":depth,"mode":mode,"background":"#905080"})).unwrap();
                let id = engine.active().unwrap().active_layer;
                engine
                    .execute(
                        "paint.stroke",
                        json!({"points":[[5,20],[110,70]],"size":19,"color":"#20b0c0","seed":31}),
                    )
                    .unwrap();
                engine
                    .execute("layer.new.layer", json!({"name":"Above source"}))
                    .unwrap();
                engine.execute("paint.stroke",json!({"points":[[5,50],[110,20]],"size":17,"opacity":55,"color":"#f08020","seed":33})).unwrap();
                let state = engine.active().unwrap();
                let before = state.doc.clone();
                let fmt = state
                    .doc
                    .layer(id.unwrap())
                    .unwrap()
                    .surface()
                    .unwrap()
                    .format();
                let rect = Rect::from_xywh(-12, -4, 150, 110);
                for which in [SampleLayers::CurrentAndBelow, SampleLayers::All] {
                    let mut sources = Sources::default();
                    let actual = sources
                        .compose(&before, id, which, rect, fmt, &Interrupt::NONE)
                        .unwrap();
                    let expected = super::super::composite_region(&before, id, which, rect, fmt);
                    assert!(actual
                        .data
                        .iter()
                        .zip(&expected.data)
                        .all(|(a, b)| a.to_bits() == b.to_bits()));
                    assert_eq!(sources.peak_encode_pixels, 4096);
                }
                assert!(std::sync::Arc::ptr_eq(
                    &before,
                    &engine.active().unwrap().doc
                ));
            }
        }
    }
    #[test]
    fn read_composition_encoding_and_resampling_observe_in_work_cancellation() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":96,"height":80,"depth":32,"background":"#905080"}),
            )
            .unwrap();
        let state = engine.active().unwrap();
        let id = state.active_layer;
        let doc = state.doc.clone();
        let surface = doc.layer(id.unwrap()).unwrap().surface().unwrap();
        let rect = Rect::from_xywh(0, 0, 8301, 4);
        let src = Region::read(surface, Rect::from_xywh(-10, -10, 200, 100));
        let map = Mapping {
            source: (3.2, 7.5),
            anchor: (2.1, 4.0),
            m: [1.08, 0.02, -0.003, 0.98],
        };
        for phase in ["read", "encode", "resample"] {
            let calls = AtomicUsize::new(0);
            let observe = || {
                calls.fetch_add(1, Ordering::Relaxed);
                false
            };
            let ctl = Interrupt::cancel_only(&observe);
            let mut sources = Sources::default();
            match phase {
                "read" => {
                    sources.read(surface, rect, &ctl).unwrap();
                }
                "encode" => {
                    sources
                        .compose(&doc, id, SampleLayers::All, rect, surface.format(), &ctl)
                        .unwrap();
                }
                _ => {
                    sources.resample(&src, rect, &map, Some(3), &ctl).unwrap();
                }
            }
            let total = calls.load(Ordering::Relaxed);
            assert!(total > 5);
            let peak = match phase {
                "read" => sources.peak_read_pixels,
                "encode" => sources.peak_encode_pixels,
                _ => sources.peak_resample_pixels,
            };
            assert_eq!(peak, 4096);
            eprintln!(
                "healing-source-work phase={phase} domain_pixels={} peak_chunk_pixels={peak}",
                rect.width() as usize * rect.height() as usize
            );
            for threshold in [3, total / 2, total - 1] {
                let calls = AtomicUsize::new(0);
                let stop = || calls.fetch_add(1, Ordering::Relaxed) >= threshold;
                let ctl = Interrupt::cancel_only(&stop);
                let mut sources = Sources::default();
                let failed = match phase {
                    "read" => sources.read(surface, rect, &ctl).is_err(),
                    "encode" => sources
                        .compose(&doc, id, SampleLayers::All, rect, surface.format(), &ctl)
                        .is_err(),
                    _ => sources.resample(&src, rect, &map, Some(3), &ctl).is_err(),
                };
                assert!(failed, "{phase}/{threshold}/{total}");
                assert_eq!(calls.load(Ordering::Relaxed), threshold + 1);
                assert!(std::sync::Arc::ptr_eq(&doc, &engine.active().unwrap().doc));
            }
        }
    }
}
