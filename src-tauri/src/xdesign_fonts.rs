use base64::Engine;
use fontique::{
    Attributes, Collection, CollectionOptions, FontStyle, FontWeight, QueryStatus, SourceCache,
};
use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

struct Fonts {
    collection: Collection,
    cache: SourceCache,
}
fn fonts() -> &'static Mutex<Fonts> {
    static FONTS: OnceLock<Mutex<Fonts>> = OnceLock::new();
    FONTS.get_or_init(|| {
        let mut collection = Collection::new(CollectionOptions {
            shared: false,
            system_fonts: false,
        });
        let mut dirs = Vec::<PathBuf>::new();
        if cfg!(target_os = "macos") {
            dirs.extend(["/System/Library/Fonts", "/Library/Fonts"].map(PathBuf::from));
        } else if cfg!(target_os = "windows") {
            if let Some(root) = std::env::var_os("WINDIR") {
                dirs.push(PathBuf::from(root).join("Fonts"));
            }
        } else {
            dirs.extend(["/usr/share/fonts", "/usr/local/share/fonts"].map(PathBuf::from));
        }
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            dirs.push(home.join(if cfg!(target_os = "macos") {
                "Library/Fonts"
            } else {
                ".local/share/fonts"
            }));
            if !cfg!(target_os = "macos") {
                dirs.push(home.join(".fonts"));
            }
        }
        let files = dirs
            .iter()
            .flat_map(|dir| {
                walkdir::WalkDir::new(dir)
                    .max_depth(6)
                    .follow_links(false)
                    .into_iter()
                    .filter_map(Result::ok)
            })
            .filter(|entry| {
                entry.file_type().is_file()
                    && entry.metadata().is_ok_and(|m| m.len() <= 64 * 1024 * 1024)
                    && entry
                        .path()
                        .extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|e| {
                            ["ttf", "otf", "ttc", "otc"].contains(&e.to_ascii_lowercase().as_str())
                        })
            })
            .take(20_000)
            .map(|entry| entry.into_path())
            .collect::<Vec<_>>();
        collection.load_fonts_from_paths(files);
        Mutex::new(Fonts {
            collection,
            cache: SourceCache::default(),
        })
    })
}

// CanvasKit's family registration accepts a standalone face. TTC table offsets
// are absolute, so rebuild the requested face instead of returning face zero.
fn face_bytes(data: &[u8], index: u32) -> Result<Vec<u8>, String> {
    if data.len() > 64 * 1024 * 1024 {
        return Err("Font exceeds the 64MB loading limit".into());
    }
    if !data.starts_with(b"ttcf") {
        return Ok(data.to_vec());
    }
    let u32_at = |offset: usize| -> Result<u32, String> {
        Ok(u32::from_be_bytes(
            data.get(offset..offset + 4)
                .ok_or("Invalid font collection")?
                .try_into()
                .map_err(|_| "Invalid font collection")?,
        ))
    };
    if index >= u32_at(8)? {
        return Err("Invalid font face index".into());
    }
    let start = u32_at(12 + index as usize * 4)? as usize;
    let header = data.get(start..start + 12).ok_or("Invalid font face")?;
    let count = u16::from_be_bytes([header[4], header[5]]) as usize;
    if count > 256 {
        return Err("Font has too many tables".into());
    }
    let directory = data
        .get(start + 12..start + 12 + count * 16)
        .ok_or("Invalid font tables")?;
    let mut out = header.to_vec();
    out.extend_from_slice(directory);
    let mut head = None;
    for table in 0..count {
        let record = start + 12 + table * 16;
        let offset = u32_at(record + 8)? as usize;
        let length = u32_at(record + 12)? as usize;
        let bytes = data
            .get(
                offset
                    ..offset
                        .checked_add(length)
                        .ok_or("Invalid font table length")?,
            )
            .ok_or("Invalid font table")?;
        let dest = out.len();
        out[12 + table * 16 + 8..12 + table * 16 + 12]
            .copy_from_slice(&(dest as u32).to_be_bytes());
        out.extend_from_slice(bytes);
        while out.len() % 4 != 0 {
            out.push(0);
        }
        if &directory[table * 16..table * 16 + 4] == b"head" {
            if length < 12 {
                return Err("Invalid font head".into());
            }
            head = Some(dest);
            out[dest + 8..dest + 12].fill(0);
        }
        if out.len() > 64 * 1024 * 1024 {
            return Err("Font face exceeds its loading limit".into());
        }
    }
    if let Some(head) = head {
        let sum = out.chunks_exact(4).fold(0u32, |sum, chunk| {
            sum.wrapping_add(u32::from_be_bytes(chunk.try_into().unwrap()))
        });
        out[head + 8..head + 12].copy_from_slice(&0xb1b0afbAu32.wrapping_sub(sum).to_be_bytes());
    }
    Ok(out)
}

#[tauri::command]
pub async fn xdesign_font_families() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut fonts = fonts().lock().map_err(|_| "Font catalog unavailable")?;
        let mut names = fonts
            .collection
            .family_names()
            .filter(|name| !name.starts_with('.'))
            .map(str::to_string)
            .collect::<Vec<_>>();
        names.sort_by_key(|name| name.to_lowercase());
        names.dedup();
        Ok(names)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn xdesign_font_load(family: String, style: String) -> Result<Option<String>, String> {
    if family.len() > 256 || style.len() > 128 {
        return Err("Invalid font name".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut fonts = fonts().lock().map_err(|_| "Font catalog unavailable")?;
        let Fonts { collection, cache } = &mut *fonts;
        let lower = style.to_ascii_lowercase();
        let weight = if lower.contains("extrabold") || lower.contains("extra bold") {
            800.
        } else if lower.contains("semibold") || lower.contains("semi bold") {
            600.
        } else if lower.contains("bold") {
            700.
        } else if lower.contains("medium") {
            500.
        } else if lower.contains("extralight") {
            200.
        } else if lower.contains("light") {
            300.
        } else if lower.contains("black") {
            900.
        } else if lower.contains("thin") {
            100.
        } else {
            400.
        };
        let mut query = collection.query(cache);
        query.set_families([family.as_str()]);
        query.set_attributes(Attributes {
            weight: FontWeight::new(weight),
            style: if lower.contains("italic") || lower.contains("oblique") {
                FontStyle::Italic
            } else {
                FontStyle::Normal
            },
            ..Default::default()
        });
        let mut bytes = None;
        query.matches_with(|font| {
            bytes = Some(face_bytes(font.blob.data(), font.index));
            QueryStatus::Stop
        });
        bytes
            .transpose()
            .map(|data| data.map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_requested_collection_face_and_rejects_invalid_offsets() {
        let mut data = vec![0u8; 100];
        data[..4].copy_from_slice(b"ttcf");
        data[8..12].copy_from_slice(&2u32.to_be_bytes());
        data[12..16].copy_from_slice(&24u32.to_be_bytes());
        data[16..20].copy_from_slice(&52u32.to_be_bytes());
        for (start, offset) in [(24, 80), (52, 84)] {
            data[start..start + 4].copy_from_slice(&0x00010000u32.to_be_bytes());
            data[start + 4..start + 6].copy_from_slice(&1u16.to_be_bytes());
            data[start + 12..start + 16].copy_from_slice(b"name");
            data[start + 20..start + 24].copy_from_slice(&(offset as u32).to_be_bytes());
            data[start + 24..start + 28].copy_from_slice(&4u32.to_be_bytes());
        }
        data[80..84].copy_from_slice(b"ONE!");
        data[84..88].copy_from_slice(b"TWO!");
        let face = face_bytes(&data, 1).unwrap();
        assert_eq!(&face[28..32], b"TWO!");
        assert_eq!(&face[20..24], &28u32.to_be_bytes());
        assert!(face_bytes(&data, 2).is_err());
        data[72..76].copy_from_slice(&999u32.to_be_bytes());
        assert!(face_bytes(&data, 1).is_err());
    }
}
