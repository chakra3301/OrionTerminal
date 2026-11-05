use super::warp_gray;
use photocraft_algo::{transform::Interp, warp::warp_mesh_gray};
use photocraft_engine::doc::{ColorMode, PixelFormat, Rect, SampleType};
use photocraft_raster::Surface;
use std::sync::atomic::{AtomicUsize, Ordering};

fn gray(sample: SampleType, default: f32, rect: Rect) -> Surface {
    let format = PixelFormat::new(ColorMode::Grayscale, sample, false);
    let mut source = Surface::with_default(format, &[default]);
    for y in rect.y0..rect.y1 {
        for x in rect.x0..rect.x1 {
            let value = ((x - rect.x0) * 7 + (y - rect.y0) * 11) % 19;
            source.write_pixel(x, y, &[value as f32 / 18.0]);
        }
    }
    source.prune();
    source
}

fn mapping(kind: usize, x: f64, y: f64) -> (f64, f64) {
    match kind {
        0 => (x, y),
        1 => (x + 2.35, y - 1.6),
        2 => (0.9 * x + 0.2 * y - 1.25, -0.15 * x + 1.1 * y + 0.4),
        3 => (x + 0.03 * y * y, y + 0.025 * x * x),
        _ => unreachable!(),
    }
}

#[test]
fn warp_gray_safe_native_exact_all_depths_defaults_interpolation_and_maps() {
    for sample in SampleType::ALL {
        for default in [0.0, 0.4, 1.0] {
            for origin in [(0, 0), (-5, -3)] {
                let source = gray(sample, default, Rect::from_xywh(origin.0, origin.1, 9, 7));
                let before = source.clone();
                for interpolation in [Interp::Nearest, Interp::Bilinear, Interp::Bicubic] {
                    for kind in 0..4 {
                        let map = |x, y| mapping(kind, x, y);
                        let native = warp_mesh_gray(&source, &map, interpolation);
                        let actual = warp_gray(&source, &map, interpolation);
                        assert_eq!(actual, native, "{sample:?}/{default}/{origin:?}/{interpolation:?}/{kind}");
                        assert_eq!(actual.format(), source.format());
                        assert_eq!(actual.default_pixel(), source.default_pixel());
                        assert_eq!(source, before);
                    }
                }
            }
        }
    }
}

#[test]
fn warp_gray_row_chunk_boundary_matches_native_without_source_changes() {
    for sample in SampleType::ALL {
        for default in [0.0, 0.4, 1.0] {
            let source = gray(sample, default, Rect::from_xywh(-3, -1, 1029, 3));
            let before = source.clone();
            for interpolation in [Interp::Nearest, Interp::Bilinear, Interp::Bicubic] {
                let map = |x: f64, y: f64| (x + 1.25, y + 0.35);
                let native = warp_mesh_gray(&source, &map, interpolation);
                let actual = warp_gray(&source, &map, interpolation);
                assert_eq!(actual, native, "{sample:?}/{default}/{interpolation:?}");
                assert_eq!(source, before);
            }
        }
    }
}

#[test]
fn warp_gray_far_translation_literal_pixels_default_and_retired_old_region() {
    // A native gray call here would fill the entire source/destination union.
    // The color mesh still has a tiny destination and is safe for this fixture.
    const DX: i32 = 750_000;
    const DY: i32 = -750_000;
    for sample in SampleType::ALL {
        for default in [0.0, 0.4, 1.0] {
            let format = PixelFormat::new(ColorMode::Grayscale, sample, false);
            let mut source = Surface::with_default(format, &[default]);
            source.write_region(Rect::new(0, 0, 2, 2), &[0.1, 0.9, 0.7, 0.2]);
            let before = source.clone();
            let encoded_default = source.default_pixel();
            for interpolation in [Interp::Nearest, Interp::Bilinear, Interp::Bicubic] {
                let actual = warp_gray(&source, &|x, y| (x + f64::from(DX), y + f64::from(DY)), interpolation);
                assert_eq!(actual.format(), format);
                assert_eq!(actual.default_pixel(), encoded_default);
                assert_eq!(actual.content_bounds(), Rect::new(DX, DY, DX + 2, DY + 2));
                assert!(actual.tile_count() <= 4, "the empty translation gap must not retain tiles");
                for y in -2..4 {
                    for x in -2..4 {
                        let expected = if (0..2).contains(&x) && (0..2).contains(&y) {
                            source.pixel(x, y)
                        } else {
                            encoded_default.clone()
                        };
                        assert_eq!(actual.pixel(DX + x, DY + y), expected, "{sample:?}/{default}/{interpolation:?}/{x},{y}");
                        assert_eq!(actual.pixel(x, y), encoded_default, "old mask location must return to its default");
                    }
                }
                for point in [(DX / 2, DY / 2), (-900_000, 900_000), (DX + 200, DY - 200)] {
                    assert_eq!(actual.pixel(point.0, point.1), encoded_default);
                }
                assert_eq!(source, before);
            }
        }
    }
}

#[test]
fn warp_gray_fold_keeps_later_source_cells_with_literal_gray_result() {
    for sample in SampleType::ALL {
        for default in [0.0, 0.4, 1.0] {
            let format = PixelFormat::new(ColorMode::Grayscale, sample, false);
            let mut source = Surface::with_default(format, &[default]);
            source.fill_rect(Rect::new(0, 0, 8, 2), &[0.25]);
            source.fill_rect(Rect::new(8, 0, 16, 2), &[0.75]);
            let before = source.clone();
            let map = |x: f64, y: f64| ((x - 8.0).abs(), y);
            let actual = warp_gray(&source, &map, Interp::Nearest);
            assert_eq!(actual, warp_mesh_gray(&source, &map, Interp::Nearest));
            assert_eq!(actual.content_bounds(), Rect::new(0, 0, 8, 2));
            let later = source.pixel(10, 0);
            for y in -1..3 {
                for x in -1..17 {
                    let expected = if (0..8).contains(&x) && (0..2).contains(&y) { later.clone() } else { source.default_pixel() };
                    assert_eq!(actual.pixel(x, y), expected, "{sample:?}/{default}/{x},{y}");
                }
            }
            assert_eq!(source, before);
        }
    }
}

#[test]
fn warp_gray_empty_default_never_evaluates_map_or_allocates_tiles() {
    for sample in SampleType::ALL {
        for default in [0.0, 0.4, 1.0] {
            let source = Surface::with_default(PixelFormat::new(ColorMode::Grayscale, sample, false), &[default]);
            let calls = AtomicUsize::new(0);
            for interpolation in [Interp::Nearest, Interp::Bilinear, Interp::Bicubic] {
                let output = warp_gray(&source, &|_, _| { calls.fetch_add(1, Ordering::SeqCst); (750_000.0, -750_000.0) }, interpolation);
                assert_eq!(output, source);
                assert_eq!(output.tile_count(), 0);
                assert_eq!(output.pixel(-999_999, 999_999), source.default_pixel());
            }
            assert_eq!(calls.load(Ordering::SeqCst), 0);
        }
    }
}
