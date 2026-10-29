//! Strided healing staging adapted from pinned PhotoCraft 47f9306f retouch_cmds.rs.
//! Copyright (c) 2026 ArtCraft Team and PhotoCraft contributors. MIT OR Apache-2.0.
use super::{admission, healing_publish::PaintSource, poisson, Interrupt};
use photocraft_engine::{
    doc::{PixelFormat, Rect, SampleType},
    paint::retouch::{alpha_index, Region},
};
use std::borrow::Cow;

pub(super) struct Paint<'a> {
    base: &'a Region,
    solved: Option<Region>,
}
impl PaintSource for Paint<'_> {
    fn bounds(&self) -> Rect {
        self.base.rect
    }
    fn patch(&self, rect: Rect, ctl: &Interrupt) -> Result<Cow<'_, Region>, String> {
        admission::check(ctl)?;
        let Some(solved) = &self.solved else {
            return Ok(Cow::Borrowed(self.base));
        };
        let overlap = rect.intersect(&solved.rect);
        if overlap.is_empty() {
            return Ok(Cow::Borrowed(self.base));
        }
        let n = self.base.ch;
        let width = rect.width() as usize;
        let mut data = Vec::with_capacity(width * rect.height() as usize * n);
        for y in rect.y0..rect.y1 {
            admission::check(ctl)?;
            let start = self.base.index(rect.x0, y) * n;
            data.extend_from_slice(&self.base.data[start..start + width * n]);
        }
        for y in overlap.y0..overlap.y1 {
            admission::check(ctl)?;
            let out = ((y - rect.y0) as usize * width + (overlap.x0 - rect.x0) as usize) * n;
            let input = solved.index(overlap.x0, y) * n;
            let len = overlap.width() as usize * n;
            data[out..out + len].copy_from_slice(&solved.data[input..input + len]);
        }
        admission::check(ctl)?;
        Ok(Cow::Owned(Region { rect, ch: n, data }))
    }
}
pub(super) fn heal_region<'a>(
    fmt: &PixelFormat,
    src: &Region,
    dst: &'a Region,
    mask: &[bool],
    ctl: &Interrupt,
) -> Result<Paint<'a>, String> {
    heal_region_diffused(fmt, src, dst, mask, 5, 0.0, ctl)
}
/// `heal_region` with Photoshop's Diffusion (1..=7); 5 is the native solve.
pub(super) fn heal_region_diffused<'a>(
    fmt: &PixelFormat,
    src: &Region,
    dst: &'a Region,
    mask: &[bool],
    diffusion: u8,
    scale: f32,
    ctl: &Interrupt,
) -> Result<Paint<'a>, String> {
    admission::check(ctl)?;
    admission::area(dst.rect)?;
    let w = dst.width();
    let n = dst.ch;
    if src.ch != n
        || fmt.channels() != n
        || src.rect.intersect(&dst.rect) != dst.rect
        || mask.len() != w * dst.height()
    {
        return Err("Invalid healing solve region".into());
    }
    let mut bbox = Rect::EMPTY;
    for (y, row) in mask.chunks(w.max(1)).enumerate() {
        admission::check(ctl)?;
        for (x, &set) in row.iter().enumerate() {
            if set {
                let (x, y) = (dst.rect.x0 + x as i32, dst.rect.y0 + y as i32);
                bbox = bbox.union(&Rect::new(x, y, x + 1, y + 1));
            }
        }
    }
    if bbox.is_empty() {
        return Ok(Paint {
            base: dst,
            solved: None,
        });
    }
    let rect = bbox.inflate(1).intersect(&dst.rect);
    let width = rect.width() as usize;
    let height = rect.height() as usize;
    admission::area(rect)?;
    let mut delta = Vec::with_capacity(width * height * n);
    let mut cropped_mask = Vec::with_capacity(width * height);
    for y in rect.y0..rect.y1 {
        admission::check(ctl)?;
        let si = src.index(rect.x0, y) * n;
        let di = dst.index(rect.x0, y) * n;
        delta.extend(
            dst.data[di..di + width * n]
                .iter()
                .zip(&src.data[si..si + width * n])
                .map(|(d, s)| d - s),
        );
        let start = dst.index(rect.x0, y);
        cropped_mask.extend_from_slice(&mask[start..start + width]);
    }
    super::healing_options::smooth_mismatch(&mut delta, &cropped_mask, width, height, n, diffusion, scale);
    let mut data = poisson::membrane_fill_with(width, height, n, &delta, &cropped_mask, ctl)
        .map_err(|_| "The retouch feedback was canceled".to_string())?;
    drop(delta);
    super::healing_options::confine_correction(&mut data, &cropped_mask, width, height, n, diffusion, scale);
    let alpha = alpha_index(fmt);
    let float = fmt.sample == SampleType::F32;
    for y in 0..height {
        admission::check(ctl)?;
        for x in 0..width {
            let i = y * width + x;
            let (si, di) = (
                src.index(rect.x0 + x as i32, rect.y0 + y as i32) * n,
                dst.index(rect.x0 + x as i32, rect.y0 + y as i32) * n,
            );
            for c in 0..n {
                let value = if cropped_mask[i] {
                    src.data[si + c] + data[i * n + c]
                } else {
                    dst.data[di + c]
                };
                data[i * n + c] = if Some(c) == alpha || !float {
                    value.clamp(0.0, 1.0)
                } else {
                    value.max(0.0)
                };
            }
        }
    }
    admission::check(ctl)?;
    Ok(Paint {
        base: dst,
        solved: Some(Region { rect, ch: n, data }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::{
        doc::{ColorMode, Surface},
        paint::retouch::apply_coverage,
    };
    fn native(fmt: &PixelFormat, src: &Region, dst: &Region, mask: &[bool]) -> Region {
        let w = dst.width();
        let bbox = mask
            .iter()
            .enumerate()
            .filter(|(_, m)| **m)
            .fold(Rect::EMPTY, |r, (i, _)| {
                let (x, y) = (dst.rect.x0 + (i % w) as i32, dst.rect.y0 + (i / w) as i32);
                r.union(&Rect::new(x, y, x + 1, y + 1))
            });
        let mut out = dst.clone();
        if bbox.is_empty() {
            return out;
        }
        let r = bbox.inflate(1).intersect(&dst.rect);
        let (s, d) = (src.crop(r), dst.crop(r));
        let m: Vec<bool> = (r.y0..r.y1)
            .flat_map(|y| (r.x0..r.x1).map(move |x| (x, y)))
            .map(|(x, y)| mask[dst.index(x, y)])
            .collect();
        let mut data = poisson::seamless_clone(d.width(), d.height(), d.ch, &s.data, &d.data, &m);
        super::super::clamp_samples(fmt, &mut data);
        for y in r.y0..r.y1 {
            let o = out.index(r.x0, y) * out.ch;
            let i = (y - r.y0) as usize * r.width() as usize * out.ch;
            let len = r.width() as usize * out.ch;
            out.data[o..o + len].copy_from_slice(&data[i..i + len]);
        }
        out
    }
    #[test]
    fn borrowed_base_and_solved_patches_match_native_full_paint_float_bits() {
        let rect = Rect::from_xywh(-20, 9, 96, 72);
        let pixels = rect.width() as usize * rect.height() as usize;
        for mode in [
            ColorMode::Rgb,
            ColorMode::Grayscale,
            ColorMode::Cmyk,
            ColorMode::Lab,
        ] {
            for sample in [SampleType::U8, SampleType::U16, SampleType::F32] {
                for alpha in [false, true] {
                    for kind in ["disc", "edge", "full", "empty"] {
                        let fmt = PixelFormat::new(mode, sample, alpha);
                        let n = fmt.channels();
                        let src = Region {
                            rect,
                            ch: n,
                            data: (0..pixels * n)
                                .map(|i| (i % 23) as f32 * 0.073 - 0.2)
                                .collect(),
                        };
                        let dst = Region {
                            rect,
                            ch: n,
                            data: (0..pixels * n)
                                .map(|i| (i % 31) as f32 * 0.091 - 0.1)
                                .collect(),
                        };
                        let mask: Vec<bool> = (0..pixels)
                            .map(|i| match kind {
                                "disc" => {
                                    ((i % 96) as f32 - 48.0).hypot((i / 96) as f32 - 36.0) < 16.0
                                }
                                "edge" => i % 96 < 25 && i / 96 < 20,
                                "full" => true,
                                _ => false,
                            })
                            .collect();
                        let expected = native(&fmt, &src, &dst, &mask);
                        let actual =
                            heal_region(&fmt, &src, &dst, &mask, &Interrupt::NONE).unwrap();
                        assert!(std::ptr::eq(actual.base, &dst));
                        assert_eq!(actual.solved.is_none(), kind == "empty");
                        for y in (rect.y0..rect.y1).step_by(32) {
                            for x in (rect.x0..rect.x1).step_by(32) {
                                let patch = Rect::from_xywh(x, y, 32, 32).intersect(&rect);
                                let data = actual.patch(patch, &Interrupt::NONE).unwrap();
                                for y in patch.y0..patch.y1 {
                                    for x in patch.x0..patch.x1 {
                                        assert!(
                                            data.px(x, y)
                                                .iter()
                                                .zip(expected.px(x, y))
                                                .all(|(a, b)| a.to_bits() == b.to_bits()),
                                            "{mode:?}/{sample:?}/{alpha}/{kind}/{x}/{y}"
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn lazy_solver_paint_is_bounded_during_actual_native_publication() {
        use photocraft_engine::doc::BlendMode;
        let rect = Rect::from_xywh(-12, 4, 320, 240);
        let fmt = PixelFormat::RGBA32F;
        let pixels = 320 * 240;
        let src = Region {
            rect,
            ch: 4,
            data: (0..pixels * 4).map(|i| (i % 23) as f32 * 0.073).collect(),
        };
        let dst = Region {
            rect,
            ch: 4,
            data: (0..pixels * 4).map(|i| (i % 31) as f32 * 0.091).collect(),
        };
        let mask: Vec<bool> = (0..pixels)
            .map(|i| (i % 320 > 80 && i % 320 < 220) && (i / 320 > 50 && i / 320 < 170))
            .collect();
        let cov: Vec<f32> = mask
            .iter()
            .map(|set| if *set { 0.63 } else { 0.0 })
            .collect();
        let actual = heal_region(&fmt, &src, &dst, &mask, &Interrupt::NONE).unwrap();
        let expected = native(&fmt, &src, &dst, &mask);
        let solved = actual.solved.as_ref().unwrap();
        let mut a = Surface::new(fmt);
        a.write_region(rect, &dst.data);
        let mut b = a.clone();
        let published = super::super::healing_publish::apply(
            &mut a,
            rect,
            &cov,
            rect,
            0.71,
            None,
            false,
            &actual,
            BlendMode::Normal,
            &Interrupt::NONE,
        )
        .unwrap();
        apply_coverage(
            &mut b,
            rect,
            &cov,
            0.71,
            None,
            false,
            &expected,
            BlendMode::Normal,
        );
        assert!(a
            .read_region(rect)
            .iter()
            .zip(b.read_region(rect))
            .all(|(a, b)| a.to_bits() == b.to_bits()));
        assert_eq!(published.peak_paint_pixels, 4096);
        assert_eq!(published.peak_pixels, 4096);
        assert!(published.patches > 1);
        eprintln!("healing-solve-work full_paint_copy_pixels_avoided={pixels} cropped_input_copy_pixels_avoided={} solve_pixels={} peak_owned_paint_pixels={} peak_publication_pixels={}",2*solved.width()*solved.height(),solved.width()*solved.height(),published.peak_paint_pixels,published.peak_pixels);
    }
    #[test]
    fn solve_and_patch_staging_observe_cancellation_without_mutating_inputs() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let rect = Rect::from_xywh(0, 0, 96, 80);
        let fmt = PixelFormat::RGBA32F;
        let src = Region {
            rect,
            ch: 4,
            data: vec![0.71; 96 * 80 * 4],
        };
        let dst = Region {
            rect,
            ch: 4,
            data: vec![0.21; 96 * 80 * 4],
        };
        let mask: Vec<bool> = (0..96 * 80)
            .map(|i| i % 96 > 20 && i % 96 < 70 && i / 96 > 20 && i / 96 < 60)
            .collect();
        let before = dst.data.clone();
        let calls = AtomicUsize::new(0);
        let observe = || {
            calls.fetch_add(1, Ordering::Relaxed);
            false
        };
        heal_region(&fmt, &src, &dst, &mask, &Interrupt::cancel_only(&observe)).unwrap();
        let total = calls.load(Ordering::Relaxed);
        assert!(total > 160);
        for threshold in [10, 90, total / 2, total - 1] {
            let calls = AtomicUsize::new(0);
            let stop = || calls.fetch_add(1, Ordering::Relaxed) >= threshold;
            assert!(heal_region(&fmt, &src, &dst, &mask, &Interrupt::cancel_only(&stop)).is_err());
            assert_eq!(calls.load(Ordering::Relaxed), threshold + 1);
            assert_eq!(before, dst.data);
        }
        let paint = heal_region(&fmt, &src, &dst, &mask, &Interrupt::NONE).unwrap();
        let calls = AtomicUsize::new(0);
        let stop = || calls.fetch_add(1, Ordering::Relaxed) >= 10;
        assert!(paint
            .patch(
                Rect::from_xywh(0, 0, 64, 64),
                &Interrupt::cancel_only(&stop)
            )
            .is_err());
        assert_eq!(before, dst.data);
    }
}
