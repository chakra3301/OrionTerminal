//! Cancellable adapters for pinned PhotoCraft 47f9306f algo/src/inpaint.rs.
//! Copyright (c) 2026 ArtCraft Team and PhotoCraft contributors. MIT OR Apache-2.0.
use super::{admission, poisson, Interrupt};

pub(super) fn copy_rows<T: Copy>(
    values: &[T],
    row: usize,
    ctl: &Interrupt,
) -> Result<Vec<T>, String> {
    admission::check(ctl)?;
    let mut out = Vec::with_capacity(values.len());
    for values in values.chunks(row.max(1)) {
        admission::check(ctl)?;
        out.extend_from_slice(values);
    }
    admission::check(ctl)?;
    Ok(out)
}

struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed ^ 0x9E37_79B9_7F4A_7C15)
    }
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}
fn integral(w: usize, h: usize, m: &[bool], ctl: &Interrupt) -> Result<Vec<u32>, String> {
    admission::check(ctl)?;
    let mut s = vec![0u32; (w + 1) * (h + 1)];
    for y in 0..h {
        admission::check(ctl)?;
        let mut row = 0u32;
        for x in 0..w {
            row += u32::from(m[y * w + x]);
            s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row;
        }
    }
    Ok(s)
}
fn window_count(s: &[u32], gw: usize, gh: usize, x0: i32, y0: i32, x1: i32, y1: i32) -> u32 {
    let (x0, y0) = (x0.max(0) as usize, y0.max(0) as usize);
    let (x1, y1) = ((x1.max(0) as usize).min(gw), (y1.max(0) as usize).min(gh));
    if x1 <= x0 || y1 <= y0 {
        return 0;
    }
    let w1 = gw + 1;
    s[y1 * w1 + x1] + s[y0 * w1 + x0] - s[y0 * w1 + x1] - s[y1 * w1 + x0]
}
fn hole_bbox(
    w: usize,
    h: usize,
    hole: &[bool],
    ctl: &Interrupt,
) -> Result<Option<(usize, usize, usize, usize)>, String> {
    let mut b: Option<(usize, usize, usize, usize)> = None;
    for y in 0..h {
        admission::check(ctl)?;
        for x in 0..w {
            if hole[y * w + x] {
                b = Some(match b {
                    None => (x, y, x + 1, y + 1),
                    Some((x0, y0, x1, y1)) => (x0.min(x), y0.min(y), x1.max(x + 1), y1.max(y + 1)),
                });
            }
        }
    }
    Ok(b)
}
#[allow(clippy::too_many_arguments)]
pub(super) fn best_offset(
    w: usize,
    h: usize,
    ch: usize,
    img: &[f32],
    hole: &[bool],
    ring: usize,
    max_radius: i32,
    ctl: &Interrupt,
) -> Result<Option<(i32, i32)>, String> {
    admission::check(ctl)?;
    let Some((bx0, by0, bx1, by1)) = hole_bbox(w, h, hole, ctl)? else {
        return Ok(None);
    };
    let ring = ring.max(1) as i32;
    let hs = integral(w, h, hole, ctl)?;
    let mut pts = Vec::new();
    let (x0, y0) = (bx0 as i32 - ring, by0 as i32 - ring);
    let (x1, y1) = (bx1 as i32 + ring, by1 as i32 + ring);
    for y in y0.max(0)..y1.min(h as i32) {
        admission::check(ctl)?;
        for x in x0.max(0)..x1.min(w as i32) {
            if hole[y as usize * w + x as usize] {
                continue;
            }
            if window_count(&hs, w, h, x - ring, y - ring, x + ring + 1, y + ring + 1) > 0 {
                pts.push((x, y));
            }
        }
    }
    let stride = (pts.len() / 2000).max(1);
    let pts: Vec<(i32, i32)> = pts.into_iter().step_by(stride).collect();
    let eval = |dx: i32, dy: i32| -> Result<Option<f32>, String> {
        admission::check(ctl)?;
        let (hx0, hy0, hx1, hy1) = (x0 + dx, y0 + dy, x1 + dx, y1 + dy);
        let inside = hx0 >= 0 && hy0 >= 0 && hx1 <= w as i32 && hy1 <= h as i32;
        if (dx, dy) == (0, 0) || !inside || window_count(&hs, w, h, hx0, hy0, hx1, hy1) != 0 {
            return Ok(None);
        }
        let mut e = 0.0f32;
        for chunk in pts.chunks(32) {
            admission::check(ctl)?;
            for &(x, y) in chunk {
                let (a, b) = (
                    (y as usize * w + x as usize) * ch,
                    ((y + dy) as usize * w + (x + dx) as usize) * ch,
                );
                for c in 0..ch {
                    let d = img[a + c] - img[b + c];
                    e += d * d;
                }
            }
        }
        Ok(Some(
            e / pts.len().max(1) as f32
                * (1.0 + 1e-3 * ((dx * dx + dy * dy) as f32).sqrt() / max_radius.max(1) as f32),
        ))
    };
    let step = (max_radius / 24).max(1);
    let mut best = None;
    let consider = |dx: i32, dy: i32, best: &mut Option<((i32, i32), f32)>| -> Result<(), String> {
        if let Some(e) = eval(dx, dy)? {
            if best.is_none_or(|(_, be)| e < be) {
                *best = Some(((dx, dy), e));
            }
        }
        Ok(())
    };
    let mut dy = -max_radius;
    while dy <= max_radius {
        admission::check(ctl)?;
        let mut dx = -max_radius;
        while dx <= max_radius {
            consider(dx, dy, &mut best)?;
            dx += step;
        }
        dy += step;
    }
    if step > 1 {
        if let Some(((bx, by), _)) = best {
            for dy in (by - step)..=(by + step) {
                admission::check(ctl)?;
                for dx in (bx - step)..=(bx + step) {
                    consider(dx, dy, &mut best)?;
                }
            }
        }
    }
    admission::check(ctl)?;
    Ok(best.map(|b| b.0))
}
#[allow(clippy::too_many_arguments)]
pub(super) fn synthesize(
    w: usize,
    h: usize,
    ch: usize,
    img: &[f32],
    hole: &[bool],
    block: usize,
    seed: u64,
    ctl: &Interrupt,
) -> Result<Vec<f32>, String> {
    admission::check(ctl)?;
    let mut out = copy_rows(img, w * ch, ctl)?;
    let Some((bx0, by0, bx1, by1)) = hole_bbox(w, h, hole, ctl)? else {
        return Ok(out);
    };
    let b = block.max(4) as i32;
    let ov = (b / 3).max(1);
    let hs = integral(w, h, hole, ctl)?;
    let mut cands = Vec::new();
    for y in ov..(h as i32 - b - ov) {
        admission::check(ctl)?;
        for x in ov..(w as i32 - b - ov) {
            if window_count(&hs, w, h, x - ov, y - ov, x + b + ov, y + b + ov) == 0 {
                cands.push((x, y));
            }
        }
    }
    if cands.is_empty() {
        return poisson::membrane_fill_with(w, h, ch, img, hole, ctl)
            .map_err(|_| "The retouch feedback was canceled".into());
    }
    let mut filled = Vec::with_capacity(hole.len());
    for row in hole.chunks(w.max(1)) {
        admission::check(ctl)?;
        filled.extend(row.iter().map(|x| !x));
    }
    let mut rng = Rng::new(seed);
    let mut by = by0 as i32;
    while by < by1 as i32 {
        admission::check(ctl)?;
        let mut bx = bx0 as i32;
        while bx < bx1 as i32 {
            admission::check(ctl)?;
            if window_count(&hs, w, h, bx, by, bx + b, by + b) > 0 {
                let mut best = (cands[0], f32::INFINITY);
                for _ in 0..48 {
                    admission::check(ctl)?;
                    let c = cands[(rng.next() % cands.len() as u64) as usize];
                    let (mut e, mut n) = (0.0f32, 0u32);
                    for y in (by - ov)..(by + b + ov) {
                        admission::check(ctl)?;
                        for x in (bx - ov)..(bx + b + ov) {
                            if x < 0
                                || y < 0
                                || x >= w as i32
                                || y >= h as i32
                                || !filled[y as usize * w + x as usize]
                            {
                                continue;
                            }
                            let (a, s) = (
                                (y as usize * w + x as usize) * ch,
                                ((y - by + c.1) as usize * w + (x - bx + c.0) as usize) * ch,
                            );
                            for k in 0..ch {
                                let d = out[a + k] - img[s + k];
                                e += d * d;
                            }
                            n += 1;
                        }
                    }
                    let e = if n == 0 { 0.0 } else { e / n as f32 };
                    if e < best.1 {
                        best = (c, e);
                    }
                }
                let c = best.0;
                for y in (by - ov)..(by + b + ov) {
                    admission::check(ctl)?;
                    for x in (bx - ov)..(bx + b + ov) {
                        if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
                            continue;
                        }
                        let i = y as usize * w + x as usize;
                        if !hole[i] {
                            continue;
                        }
                        let (a, s) = (
                            i * ch,
                            ((y - by + c.1) as usize * w + (x - bx + c.0) as usize) * ch,
                        );
                        let k = if filled[i] { 0.5 } else { 1.0 };
                        for q in 0..ch {
                            out[a + q] += (img[s + q] - out[a + q]) * k;
                        }
                        filled[i] = true;
                    }
                }
            }
            bx += b;
        }
        by += b;
    }
    admission::check(ctl)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_algo::inpaint;
    fn fixture(w: usize, h: usize, ch: usize, kind: &str) -> (Vec<f32>, Vec<bool>) {
        let img = (0..w * h * ch)
            .map(|i| (i % 47) as f32 * 0.037 - 0.2)
            .collect();
        let hole = (0..w * h)
            .map(|i| match kind {
                "disc" => {
                    ((i % w) as f32 - w as f32 / 2.0).hypot((i / w) as f32 - h as f32 / 2.0) < 4.5
                }
                "edge" => i % w < 5 && i / w < 8,
                "full" => true,
                _ => false,
            })
            .collect();
        (img, hole)
    }
    #[test]
    fn proximity_search_matches_native_including_refinement_ties_and_no_candidate() {
        for ch in [1, 2, 3, 4, 5, 8] {
            for kind in ["disc", "edge", "full", "empty"] {
                for radius in [0, 18, 60] {
                    let (w, h) = (72, 64);
                    let (img, hole) = fixture(w, h, ch, kind);
                    assert_eq!(
                        best_offset(w, h, ch, &img, &hole, 3, radius, &Interrupt::NONE).unwrap(),
                        inpaint::best_offset(w, h, ch, &img, &hole, 3, radius),
                        "{ch}/{kind}/{radius}"
                    );
                }
            }
        }
        let (w, h) = (72, 64);
        let (_, hole) = fixture(w, h, 1, "disc");
        let img = vec![0.5; w * h];
        assert_eq!(
            best_offset(w, h, 1, &img, &hole, 3, 60, &Interrupt::NONE).unwrap(),
            inpaint::best_offset(w, h, 1, &img, &hole, 3, 60)
        );
    }
    #[test]
    fn seeded_texture_and_membrane_fallback_match_native_float_bits() {
        for ch in [1, 2, 3, 4, 5, 8] {
            for kind in ["disc", "edge", "full", "empty"] {
                for block in [4, 9, 32] {
                    let (w, h) = (40, 32);
                    let (img, hole) = fixture(w, h, ch, kind);
                    let actual =
                        synthesize(w, h, ch, &img, &hole, block, 0x5eed, &Interrupt::NONE).unwrap();
                    let expected = inpaint::synthesize(w, h, ch, &img, &hole, block, 0x5eed);
                    assert!(
                        actual
                            .iter()
                            .zip(&expected)
                            .all(|(a, b)| a.to_bits() == b.to_bits()),
                        "{ch}/{kind}/{block}"
                    );
                }
            }
        }
    }
    #[test]
    fn cancellation_reaches_candidate_search_scoring_and_synthesis() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let (w, h, ch) = (96, 80, 4);
        let (img, hole) = fixture(w, h, ch, "disc");
        for texture in [false, true] {
            let calls = AtomicUsize::new(0);
            let observe = || {
                calls.fetch_add(1, Ordering::Relaxed);
                false
            };
            let ctl = Interrupt::cancel_only(&observe);
            if texture {
                synthesize(w, h, ch, &img, &hole, 9, 0x5eed, &ctl).unwrap();
            } else {
                best_offset(w, h, ch, &img, &hole, 3, 60, &ctl).unwrap();
            }
            let total = calls.load(Ordering::Relaxed);
            assert!(total > h * 3);
            for threshold in [h + 8, h * 2 + 8, total / 2, total - 1] {
                let calls = AtomicUsize::new(0);
                let stop = || calls.fetch_add(1, Ordering::Relaxed) >= threshold;
                let ctl = Interrupt::cancel_only(&stop);
                let failed = if texture {
                    synthesize(w, h, ch, &img, &hole, 9, 0x5eed, &ctl).is_err()
                } else {
                    best_offset(w, h, ch, &img, &hole, 3, 60, &ctl).is_err()
                };
                assert!(failed, "texture{texture}/threshold{threshold}/{total}");
                assert_eq!(calls.load(Ordering::Relaxed), threshold + 1);
            }
        }
    }
}
