use super::*;
use photocraft_engine::doc::{ColorMode, PixelFormat, SampleType};

const FILTERS: [Resample; 5] = [Resample::Nearest, Resample::Bilinear, Resample::Bicubic, Resample::Lanczos, Resample::PreserveDetails];

fn fixture(format: PixelFormat, origin: (i32, i32), nonzero: bool) -> Surface {
    let channels = format.channels();
    let mut defaults = vec![0.0; channels];
    if nonzero {
        for (index, value) in defaults.iter_mut().enumerate() { *value = (index + 1) as f32 / 9.0; }
        if format.alpha { defaults[channels - 1] = 0.35; }
    }
    let mut source = Surface::with_default(format, &defaults);
    let mut data = Vec::new();
    for pixel in 0..12 {
        for channel in 0..channels {
            data.push(if format.alpha && channel == channels - 1 { [0.0, 0.125, 0.7, 1.0][pixel % 4] }
                else { ((pixel * 13 + channel * 7) % 31) as f32 / 30.0 });
        }
    }
    source.write_region(Rect::from_xywh(origin.0, origin.1, 4, 3), &data);
    source.prune();
    source
}

#[test]
fn streamed_resample_all_filters_anisotropy_raw_models_depths_alpha_defaults_match_native_exactly() {
    for sample in SampleType::ALL {
        for mode in [ColorMode::Rgb, ColorMode::Grayscale, ColorMode::Cmyk] {
            for alpha in [false, true] {
                let format = PixelFormat { mode, sample, alpha };
                for nonzero in [false, true] {
                    for origin in [(0, 0), (-2, -1)] {
                        let source = fixture(format, origin, nonzero);
                        let before = source.clone();
                        for filter in FILTERS {
                            for (sx, sy) in [(0.5, 0.73), (1.5, 2.0), (0.01, 0.02)] {
                                let native = resize_surface(&source, sx, sy, filter);
                                let streamed = streamed_xy(&source, sx, sy, filter).unwrap();
                                let automatic = resize_xy(&source, sx, sy, filter).unwrap();
                                assert_eq!(streamed, native, "stream {format:?}/{nonzero}/{origin:?}/{filter:?}/{sx},{sy}");
                                assert_eq!(automatic, native, "automatic {format:?}/{nonzero}/{origin:?}/{filter:?}/{sx},{sy}");
                                assert_eq!(source, before);
                            }
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn streamed_resample_nearest_enlargement_has_independent_exact_pixel_and_default_oracle() {
    let mut source = Surface::with_default(PixelFormat::GRAY8, &[1.0]);
    source.write_region(Rect::new(-1, 0, 1, 1), &[0.0, 0.5]);
    let before = source.clone();
    let result = streamed_xy(&source, 2.0, 3.0, Resample::Nearest).unwrap();
    assert_eq!(result.default_pixel(), vec![1.0]);
    for y in -1..4 {
        for x in -3..3 {
            let expected = if (0..3).contains(&y) {
                match x { -2 | -1 => 0.0, 0 | 1 => 128.0 / 255.0, _ => 1.0 }
            } else { 1.0 };
            assert_eq!(result.pixel(x, y), vec![expected], "{x},{y}");
        }
    }
    assert_eq!(source, before);
}

#[test]
fn streamed_resample_extreme_nonzero_default_retains_native_sequential_f32_padding_without_halo() {
    let format = PixelFormat::new(ColorMode::Grayscale, SampleType::F32, false);
    let mut source = Surface::with_default(format, &[1.0]);
    source.write_pixel(0, 0, &[0.0]);
    let before = source.clone();
    // A 100000-wide nearest kernel has equal weights. The hole is its first sample on each axis.
    let weight = 1.0f32 / 100000.0;
    let mut default_row = 0.0f32;
    let mut hole_row = 0.0f32;
    for index in 0..100000 {
        default_row += weight;
        hole_row += if index == 0 { 0.0 } else { weight };
    }
    let mut expected = 0.0f32;
    for index in 0..100000 { expected += if index == 0 { hole_row } else { default_row } * weight; }
    let result = resize_xy(&source, 0.00001, 0.00001, Resample::Nearest).unwrap();
    assert_eq!(result.default_pixel(), vec![1.0]);
    assert_eq!(result.pixel(0, 0), vec![expected]);
    for (x, y) in [(-1, 0), (1, 0), (0, -1), (0, 1)] { assert_eq!(result.pixel(x, y), vec![1.0]); }
    assert_eq!(source, before);
}

#[test]
fn streamed_resample_extreme_transparent_bicubic_has_independent_tiny_alpha_and_cutoff_oracle() {
    let mut source = Surface::new(PixelFormat::RGBA32F);
    source.fill_rect(Rect::new(0, 0, 2, 2), &[1.0, 0.0, 0.0, 1.0]);
    let before = source.clone();
    let output = resize_xy(&source, 0.0001, 0.0001, Resample::Bicubic).unwrap();
    let pixel = output.pixel(0, 0);
    assert_eq!(&pixel[..3], &[0.0; 3]);
    assert!((pixel[3] - 1.266243811547247e-8).abs() <= 5e-15);
    for (x, y) in [(-1, 0), (1, 0), (0, -1), (0, 1)] { assert_eq!(output.pixel(x, y), vec![0.0; 4]); }
    assert_eq!(source, before);
}

#[test]
fn streamed_resample_preserve_details_uses_exact_public_native_sharpen_after_anisotropic_lanczos() {
    let source = fixture(PixelFormat::RGBA32F, (-1, 2), true);
    let (sx, sy) = (2.0, 1.25);
    let lanczos = resize_surface(&source, sx, sy, Resample::Lanczos);
    let params = photocraft_algo::FilterParams::UnsharpMask { amount: 30.0, radius: 0.6 * sx.max(sy) as f32, threshold: 0.0 };
    let destination = scaled_rect(source.content_bounds(), sx, sy);
    let area = photocraft_algo::output_area(&params, lanczos.content_bounds(), destination, None);
    let expected = photocraft_algo::apply(&lanczos, &params, area, destination, None);
    assert_eq!(streamed_xy(&source, sx, sy, Resample::PreserveDetails).unwrap(), expected);
    assert_eq!(resize_xy(&source, sx, sy, Resample::PreserveDetails).unwrap(), expected);
}

#[test]
fn streamed_resample_empty_defaults_and_placement_wrapper_keep_their_existing_contracts() {
    for filter in FILTERS {
        let empty = Surface::with_default(PixelFormat::GRAY8, &[1.0]);
        assert_eq!(resize_xy(&empty, 0.000001, 2.0, filter).unwrap(), empty);
        assert_eq!(streamed_xy(&empty, 0.000001, 2.0, filter).unwrap(), empty);
    }
    let zero = fixture(PixelFormat::RGBA16, (0, 0), false);
    assert_eq!(resize(&zero, 0.5).unwrap(), resize_xy(&zero, 0.5, 0.5, Resample::Bicubic).unwrap());
    assert_eq!(streamed(&zero, 0.5).unwrap(), streamed_xy(&zero, 0.5, 0.5, Resample::Bicubic).unwrap());
    let nonzero = fixture(PixelFormat::GRAY8, (0, 0), true);
    assert!(streamed(&nonzero, 0.5).is_err());
    assert!(streamed_xy(&nonzero, 0.5, 0.5, Resample::Bicubic).is_ok());
}

#[test]
fn streamed_resample_rejects_invalid_or_oversized_geometry_before_any_large_workspace() {
    let mut source = Surface::new(PixelFormat::RGBA8);
    source.fill_rect(Rect::new(0, 0, 2, 2), &[1.0; 4]);
    let before = source.clone();
    for (sx, sy) in [(0.0, 1.0), (-1.0, 1.0), (f64::NAN, 1.0), (f64::INFINITY, 1.0), (1.0, f64::NAN), (1e300, 1.0), (1.0, 1e300), (1e8, 1e8)] {
        assert!(resize_xy(&source, sx, sy, Resample::Bicubic).is_err());
        assert!(streamed_xy(&source, sx, sy, Resample::Bicubic).is_err());
        assert_eq!(source, before);
    }
    let mut sparse = Surface::new(PixelFormat::GRAY8);
    sparse.write_pixel(0, 0, &[1.0]);
    sparse.write_pixel(20000, 20000, &[1.0]);
    assert!(resize_xy(&sparse, 0.01, 0.01, Resample::Bilinear).is_err());
}

#[test]
fn streamed_resample_preserve_details_rejects_huge_sharpen_workspace_after_small_base_resize() {
    let mut source = Surface::new(PixelFormat::RGBA8);
    source.fill_rect(Rect::new(0, 0, 2, 1), &[1.0; 4]);
    let before = source.clone();
    assert!(resize_xy(&source, 1.0, 8192.0, Resample::PreserveDetails).unwrap_err().contains("editing limit"));
    assert!(streamed_xy(&source, 1.0, 8192.0, Resample::PreserveDetails).unwrap_err().contains("editing limit"));
    assert_eq!(source, before);
}

#[test]
fn streamed_resample_coordinate_guards_cover_native_tap_endpoints_and_full_raster_tiles() {
    let upper = i64::from(i32::MAX) - 255;
    assert!(raster_bounds_safe(i64::from(i32::MIN), -256, i64::from(i32::MIN) + 256, 0));
    assert!(raster_bounds_safe(upper - 256, 0, upper, 256));
    assert!(!raster_bounds_safe(upper, 0, upper + 1, 1));
    assert!(!raster_bounds_safe(i64::from(i32::MIN) - 1, 0, i64::from(i32::MIN) + 1, 1));
    assert!(!raster_bounds_safe(0, 0, i64::from(i32::MAX) + 1, 1));
    let mut source = Surface::new(PixelFormat::GRAY8);
    source.write_pixel(1, 0, &[1.0]);
    let before = source.clone();
    assert!(checked_geometry(&source, f64::from(i32::MAX) / 2.0, 1.0).is_err());
    assert_eq!(source, before);
    for filter in FILTERS {
        assert!(native_safe(Rect::new(0, 0, 2, 2), 1.0, 1.0, 4, filter));
        assert!(!native_safe(Rect::new(i32::MAX - 1, 0, i32::MAX, 1), 1.0, 1.0, 4, filter));
        assert!(!native_safe(Rect::new(0, i32::MAX - 1, 1, i32::MAX), 1.0, 1.0, 4, filter));
        assert!(!native_safe(Rect::new(i32::MAX / 2 - 1, 0, i32::MAX / 2, 1), 0.5, 1.0, 4, filter));
    }
}
