use std::{fs::{File, Metadata}, io::{ErrorKind, Read}, path::Path};

const LIMIT_ERROR: &str = "Image import exceeds 512MB";
const MEMORY_ERROR: &str = "Not enough memory to import the image";
const CHUNK_BYTES: usize = 64 * 1024;

pub(super) fn read_source_file(path: &Path) -> Result<Vec<u8>, String> {
    let before = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if !before.is_file() { return Err("Smart-object source is not a regular file".into()); }
    if before.len() > super::MAX_INPUT_BYTES { return Err(LIMIT_ERROR.into()); }
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let opened = file.metadata().map_err(|error| error.to_string())?;
    if !opened.is_file() { return Err("Smart-object source is not a regular file".into()); }
    read_regular(&mut file, &opened, super::MAX_INPUT_BYTES as usize)
}

pub(super) fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    // The opened handle may differ from the path checked by the caller.
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    read_regular(&mut file, &metadata, super::MAX_INPUT_BYTES as usize)
}

fn read_regular(reader: &mut impl Read, metadata: &Metadata, limit: usize) -> Result<Vec<u8>, String> {
    if !metadata.is_file() || metadata.len() > limit as u64 { return Err(LIMIT_ERROR.into()); }
    read_bounded(reader, limit)
}

fn read_bounded(reader: &mut impl Read, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; CHUNK_BYTES];
    loop {
        let remaining = limit.checked_sub(bytes.len()).ok_or(LIMIT_ERROR)?;
        let request = chunk.len().min(remaining.saturating_add(1));
        let read = match reader.read(&mut chunk[..request]) {
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            result => result.map_err(|error| error.to_string())?,
        };
        if read == 0 { return Ok(bytes); }
        if read > remaining { return Err(LIMIT_ERROR.into()); }
        let needed = bytes.len().checked_add(read).filter(|size| *size <= limit).ok_or(LIMIT_ERROR)?;
        if needed > bytes.capacity() {
            let capacity = bytes.capacity().saturating_mul(2).max(needed).min(limit);
            let reserve = capacity.checked_sub(bytes.len()).ok_or(LIMIT_ERROR)?;
            bytes.try_reserve_exact(reserve).map_err(|_| MEMORY_ERROR)?;
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{import_image_path, raw_fixture, RawDevelopSettings};
    use photocraft_codecs::{ChannelLayout, Format, Image};
    use photocraft_psd::{Compression, LayerSpec, PixelData, PsdBuilder, Version};
    use serde_json::json;
    use std::{fs::OpenOptions, io::{Seek, Write}, path::PathBuf};

    struct Temp(PathBuf);
    impl Drop for Temp {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }
    fn temp() -> Temp {
        let path = std::env::temp_dir().join(format!("xdesign-input-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&path).unwrap();
        Temp(path)
    }
    fn rgba() -> Vec<u8> { vec![255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,0,255] }
    fn png() -> Vec<u8> {
        let image = Image::from_u8(2, 2, ChannelLayout::Rgba, rgba()).unwrap();
        photocraft_codecs::encode(&image, Format::Png, &Default::default()).unwrap()
    }
    fn psd(version: Version) -> Vec<u8> {
        let mut builder = PsdBuilder::new(2, 2).version(version).compression(Compression::Raw);
        builder.push_layer(LayerSpec::new("Known source", 0, 0, 2, 2, PixelData::Rgba8(rgba())));
        builder.composite(PixelData::Rgba8(rgba()));
        builder.to_bytes().unwrap()
    }
    fn jpeg() -> Vec<u8> {
        let image = Image::from_u8(2, 2, ChannelLayout::Rgb, vec![240,20,30, 20,220,40, 15,30,230, 220,210,25]).unwrap();
        photocraft_codecs::encode(&image, Format::Jpeg, &Default::default()).unwrap()
    }
    fn pixels(imported: &photocraft_io::ImportResult) -> Vec<[f32; 4]> {
        photocraft_compose::render(&imported.document, imported.document.bounds()).px
    }
    fn same_import(actual: &photocraft_io::ImportResult, expected: &photocraft_io::ImportResult) {
        assert_eq!(actual.document.size, expected.document.size);
        assert_eq!(actual.document.mode, expected.document.mode);
        assert_eq!(actual.document.depth, expected.document.depth);
        assert_eq!(actual.document.icc_profile, expected.document.icc_profile);
        assert_eq!(actual.document.metadata.exif, expected.document.metadata.exif);
        assert_eq!(pixels(actual), pixels(expected));
        assert_eq!(actual.warnings, expected.warnings);
    }

    struct Stream {
        remaining: Option<usize>, grow: bool, interrupted: bool, short: usize,
        consumed: usize, largest_request: usize,
    }
    impl Stream {
        fn new(remaining: Option<usize>) -> Self {
            Self { remaining, grow:false, interrupted:true, short:usize::MAX, consumed:0, largest_request:0 }
        }
    }
    impl Read for Stream {
        fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
            self.largest_request = self.largest_request.max(output.len());
            if self.interrupted { self.interrupted = false; return Err(ErrorKind::Interrupted.into()); }
            let read = output.len().min(self.short).min(self.remaining.unwrap_or(usize::MAX));
            output[..read].fill(0x75);
            self.consumed += read;
            if let Some(left) = &mut self.remaining { *left -= read; }
            if self.grow { self.grow = false; self.remaining = None; }
            Ok(read)
        }
    }

    #[test]
    fn bounded_reader_keeps_exact_zero_n_and_n_plus_one_limits_with_short_reads() {
        for limit in [0, 1, 17, CHUNK_BYTES - 1, CHUNK_BYTES, CHUNK_BYTES + 1, CHUNK_BYTES * 2] {
            let mut exact = Stream::new(Some(limit));
            exact.short = 701;
            assert_eq!(read_bounded(&mut exact, limit).unwrap(), vec![0x75; limit]);
            assert_eq!(exact.consumed, limit);
            assert!(exact.largest_request <= 64 * 1024);
            let mut over = Stream::new(Some(limit + 1));
            assert_eq!(read_bounded(&mut over, limit).unwrap_err(), LIMIT_ERROR);
            assert_eq!(over.consumed, limit + 1);
            assert!(over.largest_request <= 64 * 1024);
        }
        let mut small = Stream::new(Some(3));
        assert_eq!(read_bounded(&mut small, usize::MAX).unwrap(), vec![0x75; 3]);
    }

    #[test]
    fn infinite_and_growing_readers_stop_after_the_single_overflow_byte_and_keep_io_errors() {
        for growing in [false, true] {
            let mut stream = Stream::new(if growing { Some(3) } else { None });
            stream.grow = growing;
            let limit = 2 * 64 * 1024 + 19;
            assert_eq!(read_bounded(&mut stream, limit).unwrap_err(), LIMIT_ERROR);
            assert_eq!(stream.consumed, limit + 1);
            assert!(stream.largest_request <= 64 * 1024);
        }
        struct Refused;
        impl Read for Refused {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::new(ErrorKind::PermissionDenied, "fixture read refusal"))
            }
        }
        assert_eq!(read_bounded(&mut Refused, 3).unwrap_err(), "fixture read refusal");
    }

    #[test]
    fn opened_handle_metadata_admission_precedes_reads_and_growth_stays_capped() {
        struct NeverRead;
        impl Read for NeverRead {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> { panic!("metadata refusal must precede reads") }
        }
        let dir = temp();
        let path = dir.0.join("append.bin");
        let limit = 64 * 1024 + 7;
        std::fs::write(&path, vec![0x75; limit]).unwrap();
        let mut file = File::open(&path).unwrap();
        let metadata = file.metadata().unwrap();
        assert_eq!(read_regular(&mut NeverRead, &metadata, limit - 1).unwrap_err(), LIMIT_ERROR);
        assert_eq!(read_regular(&mut NeverRead, &std::fs::metadata(&dir.0).unwrap(), limit).unwrap_err(), LIMIT_ERROR);
        OpenOptions::new().append(true).open(&path).unwrap().write_all(&[1, 2, 3, 4]).unwrap();
        assert_eq!(metadata.len(), limit as u64);
        assert_eq!(read_regular(&mut file, &metadata, limit).unwrap_err(), LIMIT_ERROR);
        assert_eq!(file.stream_position().unwrap(), limit as u64 + 1);
        let empty = dir.0.join("empty.bin");
        std::fs::write(&empty, []).unwrap();
        let mut file = File::open(empty).unwrap();
        let metadata = file.metadata().unwrap();
        assert!(read_regular(&mut file, &metadata, 0).unwrap().is_empty());
    }

    #[test]
    fn generated_psd_psb_png_and_regular_symlink_imports_keep_bytes_pixels_and_warnings() {
        let dir = temp();
        for (name, bytes) in [("source.psd", psd(Version::Psd)), ("source.psb", psd(Version::Psb)), ("source.png", png())] {
            let path = dir.0.join(name);
            std::fs::write(&path, &bytes).unwrap();
            assert_eq!(read_file(&path).unwrap(), bytes);
            let expected = photocraft_io::import(name, &bytes).unwrap();
            let actual = import_image_path(&path, None).unwrap();
            same_import(&actual, &expected);
            assert_eq!(pixels(&actual), vec![[1.,0.,0.,1.], [0.,1.,0.,1.], [0.,0.,1.,1.], [1.,1.,0.,1.]]);
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
        #[cfg(unix)] {
            let path = dir.0.join("accepted.png");
            std::os::unix::fs::symlink(dir.0.join("source.png"), &path).unwrap();
            let bytes = png();
            assert_eq!(read_file(&path).unwrap(), bytes);
            let expected = photocraft_io::import("accepted.png", &bytes).unwrap();
            same_import(&import_image_path(&path, None).unwrap(), &expected);
        }
    }

    fn raw_expected(name: &str, bytes: &[u8], exposure: f64, orient: bool) -> photocraft_io::ImportResult {
        fn defaults<T: Default, R>(_: fn(&str, &[u8], &T) -> R) -> T { T::default() }
        let mut options = defaults(photocraft_io::raw::import_raw_with);
        options.exposure = exposure;
        options.orient = orient;
        let limits = photocraft_codecs::Limits::default();
        options.limits.max_width = limits.max_width;
        options.limits.max_height = limits.max_height;
        options.limits.max_pixels = limits.max_pixels;
        options.limits.max_alloc = limits.max_alloc;
        let mut expected = photocraft_io::raw::import_raw_with(name, bytes, &options).unwrap();
        if exposure != 0.0 || !orient {
            for warning in &mut expected.warnings {
                *warning = warning.replace("developed with default settings", &format!("developed with {exposure:+} EV exposure and {} camera orientation", if orient { "applied" } else { "skipped" }));
            }
        }
        expected
    }

    #[test]
    fn generated_sensor_and_preview_dng_imports_keep_raw_options_pixels_warnings_and_refusals() {
        let dir = temp();
        for fallback in [false, true] {
            let name = if fallback { "preview.dng" } else { "sensor.dng" };
            let bytes = raw_fixture::dng(fallback, 6, &jpeg());
            let path = dir.0.join(name);
            std::fs::write(&path, &bytes).unwrap();
            assert_eq!(read_file(&path).unwrap(), bytes);
            let expected = photocraft_io::raw::import_raw(name, &bytes).unwrap();
            same_import(&import_image_path(&path, None).unwrap(), &expected);
            same_import(&import_image_path(&path, Some(RawDevelopSettings { exposure:0.0, orient:true })).unwrap(), &expected);
            assert_eq!(expected.warnings.iter().any(|warning| warning.contains("not the raw sensor data")), fallback);
            for (exposure, orient) in [(1.25, true), (-1.25, false)] {
                let actual = import_image_path(&path, Some(RawDevelopSettings { exposure, orient }));
                if fallback { assert!(actual.unwrap_err().contains("only provides an embedded JPEG preview")); }
                else { same_import(&actual.unwrap(), &raw_expected(name, &bytes, exposure, orient)); }
            }
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
    }

    #[test]
    fn sparse_oversized_sources_refuse_before_decode_and_directory_bundles_keep_the_native_route() {
        let dir = temp();
        let path = dir.0.join("oversized.dng");
        File::create(&path).unwrap().set_len(super::super::MAX_INPUT_BYTES + 1).unwrap();
        assert_eq!(read_file(&path).unwrap_err(), LIMIT_ERROR);
        assert_eq!(import_image_path(&path, None).unwrap_err(), LIMIT_ERROR);
        assert_eq!(import_image_path(&path, Some(RawDevelopSettings { exposure:0.0, orient:true })).unwrap_err(), LIMIT_ERROR);
        let mut engine = photocraft_engine::Session::new();
        engine.execute("file.new", json!({"width":2,"height":2,"background":"#905080"})).unwrap();
        let version = ulid::Ulid::new().to_string();
        super::super::bundle::write_document(&dir.0, &version, &engine.active().unwrap().doc, &mut Default::default()).unwrap();
        let path = dir.0.join(format!("{version}.pcraft"));
        let imported = import_image_path(&path, None).unwrap();
        assert_eq!(imported.document, *engine.active().unwrap().doc);
        assert!(imported.warnings.is_empty());
        assert_eq!(import_image_path(&path, Some(RawDevelopSettings { exposure:0.0, orient:true })).unwrap_err(), "RAW development options require a camera RAW file");
    }
}
