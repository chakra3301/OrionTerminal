//! Bounded publication adapted from PhotoCraft 47f9306f paint/src/retouch.rs.
//! Copyright (c) 2026 ArtCraft Team and PhotoCraft contributors. MIT OR Apache-2.0.
use super::{admission, Interrupt};
use photocraft_engine::{
    doc::{BlendMode, Rect, Surface},
    paint::{
        render::COV_TILE,
        retouch::{apply_coverage, Region},
    },
};
use std::borrow::Cow;

pub(super) trait PaintSource {
    fn bounds(&self) -> Rect;
    fn patch(&self, rect: Rect, ctl: &Interrupt) -> Result<Cow<'_, Region>, String>;
}
impl PaintSource for Region {
    fn bounds(&self) -> Rect {
        self.rect
    }
    fn patch(&self, _rect: Rect, _ctl: &Interrupt) -> Result<Cow<'_, Region>, String> {
        Ok(Cow::Borrowed(self))
    }
}

pub(super) struct Published {
    pub(super) damage: Rect,
    #[cfg(test)]
    pub(super) peak_pixels: usize,
    #[cfg(test)]
    pub(super) patches: usize,
    #[cfg(test)]
    pub(super) peak_paint_pixels: usize,
}
impl Published {
    pub(super) fn empty() -> Self {
        Self {
            damage: Rect::EMPTY,
            #[cfg(test)]
            peak_pixels: 0,
            #[cfg(test)]
            patches: 0,
            #[cfg(test)]
            peak_paint_pixels: 0,
        }
    }
}
#[allow(clippy::too_many_arguments)]
pub(super) fn apply<P: PaintSource>(
    target: &mut Surface,
    rect: Rect,
    cov: &[f32],
    coverage_rect: Rect,
    opacity: f32,
    selection: Option<&Surface>,
    locked: bool,
    paint: &P,
    blend: BlendMode,
    ctl: &Interrupt,
) -> Result<Published, String> {
    admission::check(ctl)?;
    if rect.is_empty() {
        return Ok(Published::empty());
    }
    admission::area(rect)?;
    admission::area(coverage_rect)?;
    let width = coverage_rect.width() as usize;
    if coverage_rect.intersect(&rect) != rect
        || paint.bounds().intersect(&rect) != rect
        || cov.len() != width * coverage_rect.height() as usize
    {
        return Err("Invalid healing coverage region".into());
    }
    let mut result = Published::empty();
    result.damage = rect;
    for ty in rect.y0.div_euclid(COV_TILE)..=(rect.y1 - 1).div_euclid(COV_TILE) {
        for tx in rect.x0.div_euclid(COV_TILE)..=(rect.x1 - 1).div_euclid(COV_TILE) {
            admission::check(ctl)?;
            let patch = Rect::from_xywh(
                tx * COV_TILE,
                ty * COV_TILE,
                COV_TILE as u32,
                COV_TILE as u32,
            )
            .intersect(&rect);
            let pw = patch.width() as usize;
            let mut patch_cov = Vec::with_capacity(pw * patch.height() as usize);
            for y in patch.y0..patch.y1 {
                admission::check(ctl)?;
                let start = (y - coverage_rect.y0) as usize * width
                    + (patch.x0 - coverage_rect.x0) as usize;
                patch_cov.extend_from_slice(&cov[start..start + pw]);
            }
            admission::check(ctl)?;
            let paint_patch = paint.patch(patch, ctl)?;
            apply_coverage(
                target,
                patch,
                &patch_cov,
                opacity,
                selection,
                locked,
                &paint_patch,
                blend,
            );
            #[cfg(test)]
            {
                result.peak_pixels = result.peak_pixels.max(patch_cov.len());
                result.patches += 1;
                if let Cow::Owned(paint) = &paint_patch {
                    result.peak_paint_pixels =
                        result.peak_paint_pixels.max(paint.width() * paint.height());
                }
            }
        }
    }
    admission::check(ctl)?;
    Ok(result)
}
pub(super) fn restore_channels(
    target: &mut Surface,
    original: &Surface,
    rect: Rect,
    channel: usize,
    ctl: &Interrupt,
) -> Result<Published, String> {
    admission::check(ctl)?;
    if rect.is_empty() {
        return Ok(Published::empty());
    }
    admission::area(rect)?;
    let n = target.channels();
    let mut result = Published::empty();
    result.damage = rect;
    for ty in rect.y0.div_euclid(COV_TILE)..=(rect.y1 - 1).div_euclid(COV_TILE) {
        for tx in rect.x0.div_euclid(COV_TILE)..=(rect.x1 - 1).div_euclid(COV_TILE) {
            admission::check(ctl)?;
            let patch = Rect::from_xywh(
                tx * COV_TILE,
                ty * COV_TILE,
                COV_TILE as u32,
                COV_TILE as u32,
            )
            .intersect(&rect);
            let mut pixels = target.read_region(patch);
            let old = original.read_region(patch);
            let row = patch.width() as usize * n;
            for (new, old) in pixels.chunks_mut(row).zip(old.chunks(row)) {
                admission::check(ctl)?;
                for (new, old) in new.chunks_exact_mut(n).zip(old.chunks_exact(n)) {
                    for c in 0..n {
                        if c != channel {
                            new[c] = old[c];
                        }
                    }
                }
            }
            admission::check(ctl)?;
            target.write_region(patch, &pixels);
            #[cfg(test)]
            {
                result.peak_pixels = result.peak_pixels.max(pixels.len() / n);
                result.patches += 1;
            }
        }
    }
    admission::check(ctl)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::{
        doc::{ColorMode, PixelFormat, SampleType},
        paint::retouch::apply_coverage,
    };
    #[test]
    fn strided_publication_matches_native_float_bits_across_formats_blends_and_locks() {
        let rect = Rect::from_xywh(-31, 7, 137, 85);
        let coverage_rect = rect.inflate(5);
        let cov: Vec<_> = (0..coverage_rect.width() as usize * coverage_rect.height() as usize)
            .map(|i| {
                if i % 7 == 0 {
                    0.0
                } else {
                    (i % 23) as f32 / 19.0
                }
            })
            .collect();
        let dense: Vec<_> = (rect.y0..rect.y1)
            .flat_map(|y| (rect.x0..rect.x1).map(move |x| (x, y)))
            .map(|(x, y)| {
                cov[(y - coverage_rect.y0) as usize * coverage_rect.width() as usize
                    + (x - coverage_rect.x0) as usize]
            })
            .collect();
        let mut selection = Surface::new(PixelFormat::GRAY8);
        selection.write_region(
            rect,
            &(0..dense.len())
                .map(|i| (i % 11) as f32 / 10.0)
                .collect::<Vec<_>>(),
        );
        for mode in [
            ColorMode::Rgb,
            ColorMode::Grayscale,
            ColorMode::Cmyk,
            ColorMode::Lab,
        ] {
            for sample in [SampleType::U8, SampleType::U16, SampleType::F32] {
                for alpha in [false, true] {
                    for blend in [BlendMode::Normal, BlendMode::Multiply, BlendMode::Screen] {
                        for locked in [false, true] {
                            let fmt = PixelFormat::new(mode, sample, alpha);
                            let n = fmt.channels();
                            let mut source = Surface::new(fmt);
                            source.write_region(
                                rect,
                                &(0..dense.len() * n)
                                    .map(|i| {
                                        if alpha && i % n == n - 1 {
                                            (i / n % 4) as f32 / 3.0
                                        } else {
                                            (i % 31) as f32 / 17.0 - 0.2
                                        }
                                    })
                                    .collect::<Vec<_>>(),
                            );
                            let paint = Region {
                                rect: coverage_rect,
                                ch: n,
                                data: (0..cov.len() * n)
                                    .map(|i| {
                                        if alpha && i % n == n - 1 {
                                            (i / n % 3) as f32 / 2.0
                                        } else {
                                            (i % 37) as f32 / 23.0 - 0.1
                                        }
                                    })
                                    .collect(),
                            };
                            let mut actual = source.clone();
                            let mut expected = source.clone();
                            let result = apply(
                                &mut actual,
                                rect,
                                &cov,
                                coverage_rect,
                                0.63,
                                Some(&selection),
                                locked,
                                &paint,
                                blend,
                                &Interrupt::NONE,
                            )
                            .unwrap();
                            let damage = apply_coverage(
                                &mut expected,
                                rect,
                                &dense,
                                0.63,
                                Some(&selection),
                                locked,
                                &paint,
                                blend,
                            );
                            assert_eq!(result.damage, damage);
                            assert!(result.peak_pixels <= 4096);
                            assert!(result.patches > 1);
                            assert!(
                                actual
                                    .read_region(rect.inflate(2))
                                    .iter()
                                    .zip(expected.read_region(rect.inflate(2)))
                                    .all(|(a, b)| a.to_bits() == b.to_bits()),
                                "{mode:?}/{sample:?}/{alpha}/{blend:?}/{locked}"
                            );
                            for channel in [0, n - 1] {
                                let mut restored = actual.clone();
                                let mut old = expected.clone();
                                let mut pixels = old.read_region(rect);
                                let before = source.read_region(rect);
                                for (new, before) in
                                    pixels.chunks_exact_mut(n).zip(before.chunks_exact(n))
                                {
                                    for c in 0..n {
                                        if c != channel {
                                            new[c] = before[c];
                                        }
                                    }
                                }
                                old.write_region(rect, &pixels);
                                let result = restore_channels(
                                    &mut restored,
                                    &source,
                                    rect,
                                    channel,
                                    &Interrupt::NONE,
                                )
                                .unwrap();
                                assert!(result.peak_pixels <= 4096);
                                assert!(result.patches > 1);
                                assert!(restored
                                    .read_region(rect.inflate(2))
                                    .iter()
                                    .zip(old.read_region(rect.inflate(2)))
                                    .all(|(a, b)| a.to_bits() == b.to_bits()));
                            }
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn publication_can_cancel_after_a_patch_without_mutating_original_surface() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let rect = Rect::from_xywh(0, 0, 300, 200);
        let source = Surface::new(photocraft_engine::doc::PixelFormat::RGBA8);
        let mut target = source.clone();
        let paint = Region {
            rect,
            ch: 4,
            data: vec![1.0; 300 * 200 * 4],
        };
        let calls = AtomicUsize::new(0);
        let stop = || calls.fetch_add(1, Ordering::Relaxed) >= 100;
        assert!(apply(
            &mut target,
            rect,
            &vec![1.0; 300 * 200],
            rect,
            1.0,
            None,
            false,
            &paint,
            BlendMode::Normal,
            &Interrupt::cancel_only(&stop)
        )
        .is_err());
        assert_ne!(source.read_region(rect), target.read_region(rect));
        assert!(source.read_region(rect).iter().all(|x| *x == 0.0));
    }
    #[test]
    fn channel_restoration_can_cancel_after_a_patch_without_mutating_original() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let rect = Rect::from_xywh(0, 0, 300, 200);
        let original = Surface::new(photocraft_engine::doc::PixelFormat::RGBA8);
        let mut target = original.clone();
        target.write_region(rect, &vec![1.0; 300 * 200 * 4]);
        let calls = AtomicUsize::new(0);
        let stop = || calls.fetch_add(1, Ordering::Relaxed) >= 100;
        assert!(restore_channels(
            &mut target,
            &original,
            rect,
            0,
            &Interrupt::cancel_only(&stop)
        )
        .is_err());
        let actual = target.read_region(rect);
        assert!(actual.iter().any(|x| *x == 0.0));
        assert!(actual.iter().any(|x| *x == 1.0));
        assert!(original.read_region(rect).iter().all(|x| *x == 0.0));
    }
}
