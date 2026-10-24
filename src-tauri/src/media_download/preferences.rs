use super::policy::{Options, Preset};
use super::{db, id_check, Job};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub version: u8,
    pub preset: Preset,
    pub options: Options,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            version: 1,
            preset: Preset::Video1080,
            options: Options::default(),
        }
    }
}
impl Preferences {
    fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("Unknown download defaults version. Nothing was changed.".into());
        }
        if self.options.clipped() || self.options.format_id.is_some() {
            return Err("Clip ranges and exact source formats cannot be saved as defaults.".into());
        }
        self.options.validate_preset(&self.preset, None)
    }
}
pub(super) fn load(c: &Connection) -> Result<Preferences, String> {
    let saved: Option<String> = c
        .query_row(
            "SELECT settings_json FROM media_download_preferences WHERE singleton=1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let settings = match saved {
        None => Preferences::default(),
        Some(s) if s.len() <= 8192 => serde_json::from_str(&s)
            .map_err(|_| "Saved download defaults are invalid. Nothing was reset.")?,
        Some(_) => return Err("Saved download defaults exceed their size limit.".into()),
    };
    settings.validate()?;
    Ok(settings)
}
fn save(c: &Connection, settings: &Preferences) -> Result<(), String> {
    // Validate the existing row too: a newer or damaged configuration is not silently replaced.
    load(c)?;
    settings.validate()?;
    let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    c.execute("INSERT INTO media_download_preferences(singleton,settings_json) VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET settings_json=excluded.settings_json",[json]).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn media_download_preferences(
    app: AppHandle,
    settings: Option<Preferences>,
) -> Result<Preferences, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let c = db(&app)?;
        if let Some(settings) = settings {
            save(&c, &settings)?;
        }
        load(&c)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn source_key(item: &Job) -> &str {
    item.metadata
        .as_ref()
        .map(|m| m.source_id.as_str())
        .filter(|s| {
            s.split_once(':').is_some_and(|(extractor, id)| {
                !extractor.is_empty()
                    && !id.is_empty()
                    && !extractor.eq_ignore_ascii_case("generic")
            })
        })
        .unwrap_or(&item.url)
}
fn languages(options: &Options) -> Vec<String> {
    let mut langs = if options.embed_subtitles {
        options.subtitle_langs.clone()
    } else {
        Vec::new()
    };
    langs.sort();
    langs.dedup();
    langs
}
fn variant(preset: &Preset, options: &Options) -> Result<String, String> {
    serde_json::to_string(&(
        preset,
        if options.playable { 1 } else { 0 },
        options.audio_quality,
        options.start_seconds,
        options.end_seconds,
        &options.format_id,
        options.embed_metadata as u8,
        options.embed_chapters as u8,
        options.embed_thumbnail as u8,
        options.embed_subtitles as u8,
        (options.embed_subtitles && options.automatic_subtitles) as u8,
        languages(options),
        options.sponsorblock.mode,
        options.sponsorblock.categories(),
    ))
    .map_err(|e| e.to_string())
}
pub(super) fn same_output(a: &Job, b: &Job) -> Result<bool, String> {
    Ok((a.url == b.url || source_key(a) == source_key(b))
        && variant(&a.preset, &a.options)? == variant(&b.preset, &b.options)?)
}
pub(super) fn duplicate(
    c: &Connection,
    item: &Job,
    preset: &Preset,
    options: &Options,
) -> Result<bool, String> {
    let preset = serde_json::to_value(preset).map_err(|e| e.to_string())?;
    // JSON numeric comparison keeps migrated integer and real clip values equivalent.
    c.query_row("SELECT EXISTS(SELECT 1 FROM media_download_archive WHERE (source_key=?1 OR source_url=?2) AND json_extract(variant_json,'$[0]') IS ?3 AND json_extract(variant_json,'$[1]') IS ?4 AND json_extract(variant_json,'$[2]') IS ?5 AND json_extract(variant_json,'$[3]') IS ?6 AND json_extract(variant_json,'$[4]') IS ?7 AND json_extract(variant_json,'$[5]') IS ?8 AND COALESCE(json_extract(variant_json,'$[6]'),0) IS ?9 AND COALESCE(json_extract(variant_json,'$[7]'),0) IS ?10 AND COALESCE(json_extract(variant_json,'$[8]'),0) IS ?11 AND COALESCE(json_extract(variant_json,'$[9]'),0) IS ?12 AND COALESCE(json_extract(variant_json,'$[10]'),0) IS ?13 AND COALESCE(json_extract(variant_json,'$[11]'),'[]') IS ?14 AND COALESCE(json_extract(variant_json,'$[12]'),'off') IS ?15 AND COALESCE(json_extract(variant_json,'$[13]'),'[]') IS ?16)",params![source_key(item),item.url,preset.as_str(),options.playable as i32,options.audio_quality,options.start_seconds,options.end_seconds,options.format_id,options.embed_metadata as i32,options.embed_chapters as i32,options.embed_thumbnail as i32,options.embed_subtitles as i32,(options.embed_subtitles && options.automatic_subtitles) as i32,serde_json::to_string(&languages(options)).map_err(|e|e.to_string())?,serde_json::to_value(options.sponsorblock.mode).map_err(|e|e.to_string())?.as_str(),serde_json::to_string(&options.sponsorblock.categories()).map_err(|e|e.to_string())?],|r|r.get(0)).map_err(|e|e.to_string())
}
pub(super) fn record(tx: &Transaction<'_>, item: &Job) -> Result<(), String> {
    if item.source_asset_id.is_some() {
        return Ok(());
    }
    tx.execute("INSERT INTO media_download_archive(source_key,source_url,variant_json,saved_at,asset_id) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(source_key,variant_json) DO UPDATE SET source_url=excluded.source_url,saved_at=excluded.saved_at,asset_id=excluded.asset_id",params![source_key(item),item.url,variant(&item.preset,&item.options)?,item.created_at,item.id]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn media_download_archive_count(app: AppHandle) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        db(&app)?
            .query_row("SELECT count(*) FROM media_download_archive", [], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn media_download_archive_forget(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        id_check(&id)?;
        let active = super::ACTIVE.lock();
        if !active.is_empty() {
            return Err(
                "Finish or stop the current operation before editing the download archive.".into(),
            );
        }
        let c = db(&app)?;
        let item = super::job(&c, &id)?;
        if item.source_asset_id.is_some() {
            return Err("Local playable copies do not use the source download archive.".into());
        }
        c.execute(
            "DELETE FROM media_download_archive WHERE source_key=?1 OR source_url=?2",
            params![source_key(&item), item.url],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Connection, Job) {
        let c = Connection::open_in_memory().unwrap();
        for sql in [
            include_str!("../../migrations/0034_media_downloads.sql"),
            include_str!("../../migrations/0035_media_download_options.sql"),
            include_str!("../../migrations/0036_media_download_preferences.sql"),
        ] {
            c.execute_batch(sql).unwrap();
        }
        let id = ulid::Ulid::new().to_string();
        c.execute("INSERT INTO media_downloads(id,url,state,created_at) VALUES(?1,'https://example.com/video','inspected',1)",[&id]).unwrap();
        let mut job = super::super::job(&c, &id).unwrap();
        job.metadata = Some(
            super::super::policy::metadata(
                &serde_json::json!({"title":"Clip","extractor_key":"Fixture","id":"one"}),
                &job.url,
            )
            .unwrap(),
        );
        (c, job)
    }
    #[test]
    fn defaults_roundtrip_without_credential_or_source_specific_fields() {
        let (c, _) = fixture();
        assert!(load(&c).unwrap().options.playable);
        let p = Preferences {
            preset: Preset::AudioMp3,
            options: Options {
                rate_limit_kib: Some(512),
                retries: 4,
                fragments: 3,
                ..Options::default()
            },
            ..Preferences::default()
        };
        save(&c, &p).unwrap();
        assert!(load(&c).unwrap().preset.audio());
        assert_eq!(load(&c).unwrap().options.rate_limit_kib, Some(512));
        let mut invalid = p.clone();
        invalid.options.format_id = Some("137".into());
        assert!(save(&c, &invalid).is_err());
        invalid = p;
        invalid.options.end_seconds = Some(30.0);
        assert!(save(&c, &invalid).is_err());
        assert!(serde_json::from_str::<Preferences>(r#"{"cookies":"secret"}"#).is_err());
    }
    #[test]
    fn damaged_or_unknown_defaults_are_not_overwritten() {
        let (c, _) = fixture();
        for saved in ["bad JSON", r#"{"version":9}"#] {
            c.execute(
                "INSERT OR REPLACE INTO media_download_preferences VALUES(1,?1)",
                [saved],
            )
            .unwrap();
            assert!(load(&c).is_err());
            assert!(save(&c, &Preferences::default()).is_err());
            let retained: String = c
                .query_row(
                    "SELECT settings_json FROM media_download_preferences",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(retained, saved);
        }
    }
    #[test]
    fn saved_limits_roundtrip_and_invalid_updates_preserve_previous_json() {
        let (c, _) = fixture();
        let mut settings = Preferences::default();
        settings.options.limits = super::super::policy::Limits {
            file_mib: 8192,
            work_mib: 16384,
            free_mib: 1024,
            minutes: 90,
        };
        save(&c, &settings).unwrap();
        assert_eq!(load(&c).unwrap().options.limits, settings.options.limits);
        let before: String = c
            .query_row(
                "SELECT settings_json FROM media_download_preferences",
                [],
                |r| r.get(0),
            )
            .unwrap();
        settings.options.limits.work_mib = 8192;
        assert!(save(&c, &settings).is_err());
        let after: String = c
            .query_row(
                "SELECT settings_json FROM media_download_preferences",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(before, after);
    }
    #[test]
    fn archive_survives_history_removal_and_matches_identity_variants() {
        let (mut c, mut item) = fixture();
        item.options.start_seconds = Some(5.0);
        item.options.end_seconds = Some(12.0);
        let tx = c.transaction().unwrap();
        record(&tx, &item).unwrap();
        tx.commit().unwrap();
        c.execute("DELETE FROM media_downloads", []).unwrap();
        assert!(duplicate(&c, &item, &item.preset, &item.options).unwrap());
        item.url = "https://example.com/another-alias".into();
        assert!(duplicate(&c, &item, &item.preset, &item.options).unwrap());
        let mut options = item.options.clone();
        options.retries = 8;
        options.rate_limit_kib = Some(1024);
        options.limits = super::super::policy::Limits {
            file_mib: 8192,
            work_mib: 16384,
            free_mib: 1024,
            minutes: 90,
        };
        let mut same = item.clone();
        same.options = options.clone();
        assert!(same_output(&item, &same).unwrap());
        assert!(duplicate(&c, &item, &item.preset, &options).unwrap());
        options.end_seconds = Some(13.0);
        assert!(!duplicate(&c, &item, &item.preset, &options).unwrap());
        assert!(!duplicate(&c, &item, &Preset::AudioMp3, &item.options).unwrap());
        options = item.options.clone();
        options.playable = false;
        assert!(!duplicate(&c, &item, &item.preset, &options).unwrap());
    }
    #[test]
    fn embedded_variants_are_distinct_and_language_order_is_not_identity() {
        let (mut c, mut item) = fixture();
        item.options.embed_subtitles = true;
        item.options.subtitle_langs = vec!["fr".into(), "en".into()];
        let tx = c.transaction().unwrap();
        record(&tx, &item).unwrap();
        tx.commit().unwrap();
        let mut other = item.clone();
        other.options.subtitle_langs.reverse();
        assert!(same_output(&item, &other).unwrap());
        assert!(duplicate(&c, &other, &other.preset, &other.options).unwrap());
        for field in [
            "metadata",
            "chapters",
            "artwork",
            "automatic",
            "languages",
            "subtitles",
        ] {
            let mut other = item.clone();
            match field {
                "metadata" => other.options.embed_metadata = true,
                "chapters" => other.options.embed_chapters = true,
                "artwork" => other.options.embed_thumbnail = true,
                "automatic" => other.options.automatic_subtitles = true,
                "languages" => other.options.subtitle_langs = vec!["en".into()],
                _ => other.options.embed_subtitles = false,
            }
            assert!(!same_output(&item, &other).unwrap(), "{field}");
            assert!(
                !duplicate(&c, &other, &other.preset, &other.options).unwrap(),
                "{field}"
            );
        }
    }
    #[test]
    fn sponsor_variants_are_canonical_and_old_plain_receipts_still_match() {
        use super::super::sponsor::{Choice, Mode};
        let (mut c, mut item) = fixture();
        let old = serde_json::json!([item.preset, 1, 0, null, null, null, 0, 0, 0, 0, 0, []]);
        c.execute("INSERT INTO media_download_archive(source_key,source_url,variant_json,saved_at,asset_id) VALUES(?1,?2,?3,1,?4)",params![source_key(&item),item.url,old.to_string(),item.id]).unwrap();
        assert!(duplicate(&c, &item, &item.preset, &item.options).unwrap());
        item.options.sponsorblock = Choice {
            mode: Mode::Mark,
            categories: vec!["sponsor".into(), "intro".into()],
        };
        assert!(!duplicate(&c, &item, &item.preset, &item.options).unwrap());
        let tx = c.transaction().unwrap();
        record(&tx, &item).unwrap();
        tx.commit().unwrap();
        let mut other = item.clone();
        other.options.sponsorblock.categories.reverse();
        assert!(same_output(&item, &other).unwrap());
        assert!(duplicate(&c, &other, &other.preset, &other.options).unwrap());
        other.options.sponsorblock.mode = Mode::Remove;
        assert!(!same_output(&item, &other).unwrap());
        assert!(!duplicate(&c, &other, &other.preset, &other.options).unwrap());
        other.options.sponsorblock.mode = Mode::Off;
        assert!(duplicate(&c, &other, &other.preset, &other.options).unwrap());
        let mut plain = other.clone();
        plain.options.sponsorblock.categories = vec!["filler".into()];
        assert!(same_output(&plain, &other).unwrap());
    }
    #[test]
    fn generic_basename_identities_do_not_skip_different_hosts() {
        let (mut c, mut item) = fixture();
        item.metadata.as_mut().unwrap().source_id = "Generic:video".into();
        let tx = c.transaction().unwrap();
        record(&tx, &item).unwrap();
        tx.commit().unwrap();
        assert!(duplicate(&c, &item, &item.preset, &item.options).unwrap());
        item.url = "https://another.example.com/video".into();
        assert!(!duplicate(&c, &item, &item.preset, &item.options).unwrap());
    }
    #[test]
    fn archive_rolls_back_with_publication_and_ignores_local_copies() {
        let (mut c, mut item) = fixture();
        let tx = c.transaction().unwrap();
        record(&tx, &item).unwrap();
        drop(tx);
        assert!(!duplicate(&c, &item, &item.preset, &item.options).unwrap());
        item.source_asset_id = Some(ulid::Ulid::new().to_string());
        let tx = c.transaction().unwrap();
        record(&tx, &item).unwrap();
        tx.commit().unwrap();
        assert!(!duplicate(&c, &item, &item.preset, &item.options).unwrap());
    }
    #[test]
    fn generic_archive_migration_recovers_collisions_without_history_dependency() {
        let c = Connection::open_in_memory().unwrap();
        for sql in [
            include_str!("../../migrations/0034_media_downloads.sql"),
            include_str!("../../migrations/0035_media_download_options.sql"),
        ] {
            c.execute_batch(sql).unwrap();
        }
        for (id, url) in [
            ("first", "https://example.com/video"),
            ("second", "https://another.example.com/video"),
        ] {
            c.execute("INSERT INTO media_downloads(id,url,state,created_at,asset_id,metadata_json) VALUES(?1,?2,'completed',1,?1,'{\"sourceId\":\"Generic:video\"}')",params![id,url]).unwrap();
        }
        c.execute_batch(include_str!(
            "../../migrations/0036_media_download_preferences.sql"
        ))
        .unwrap();
        let count: i64 = c
            .query_row("SELECT count(*) FROM media_download_archive", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
        let preserved_url: String = c
            .query_row("SELECT source_url FROM media_download_archive", [], |r| {
                r.get(0)
            })
            .unwrap();
        c.execute("DELETE FROM media_downloads WHERE url=?1", [preserved_url])
            .unwrap();
        c.execute_batch(include_str!(
            "../../migrations/0037_media_download_generic_archive.sql"
        ))
        .unwrap();
        c.execute("DELETE FROM media_downloads", []).unwrap();
        let (_, mut item) = fixture();
        item.metadata.as_mut().unwrap().source_id = "Generic:video".into();
        for url in [
            "https://example.com/video",
            "https://another.example.com/video",
        ] {
            item.url = url.into();
            assert!(duplicate(&c, &item, &item.preset, &item.options).unwrap());
        }
        let count: i64 = c
            .query_row("SELECT count(*) FROM media_download_archive", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 2);
    }
    #[test]
    fn migration_backfills_only_completed_remote_receipts() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../../migrations/0034_media_downloads.sql"))
            .unwrap();
        c.execute_batch(include_str!(
            "../../migrations/0035_media_download_options.sql"
        ))
        .unwrap();
        c.execute_batch("INSERT INTO media_downloads(id,url,state,created_at,asset_id,metadata_json,options_json) VALUES('legacy','https://example.com/legacy','completed',1,'legacy','{\"sourceId\":\"Fixture:legacy\"}','{\"startSeconds\":5,\"endSeconds\":12}'); INSERT INTO media_downloads(id,url,state,created_at) VALUES('unsaved','https://example.com/unsaved','ready',2);").unwrap();
        c.execute_batch(include_str!(
            "../../migrations/0036_media_download_preferences.sql"
        ))
        .unwrap();
        let (_, mut item) = fixture();
        item.url = "https://example.com/legacy".into();
        item.options.start_seconds = Some(5.0);
        item.options.end_seconds = Some(12.0);
        assert!(duplicate(&c, &item, &item.preset, &item.options).unwrap());
        let count: i64 = c
            .query_row("SELECT count(*) FROM media_download_archive", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }
}
