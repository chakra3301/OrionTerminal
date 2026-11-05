use super::policy::{Metadata, Options, Preset};
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::Path};
use tokio::process::Command;
const RECEIPT: &str = "media.sponsorblock.json";
const SOURCE_RECEIPT: &str = "media.sponsorblock-source.json";
const MAX_RECEIPT: u64 = 128 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub mode: Mode,
    pub categories: Vec<String>,
    pub segments: u32,
    pub source_duration: f64,
    pub processed_duration: f64,
    #[serde(skip)]
    pub timeline: Vec<Marker>,
}
#[derive(Clone, Debug)]
pub struct Marker {
    pub start: f64,
    pub end: f64,
    pub categories: Vec<String>,
}

pub(super) const CATEGORIES: &[&str] = &[
    "sponsor",
    "selfpromo",
    "interaction",
    "intro",
    "outro",
    "preview",
    "music_offtopic",
    "filler",
    "hook",
    "poi_highlight",
    "chapter",
];
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Off,
    Mark,
    Remove,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Choice {
    pub mode: Mode,
    pub categories: Vec<String>,
}
impl Default for Choice {
    fn default() -> Self {
        Self {
            mode: Mode::Off,
            categories: vec!["sponsor".into()],
        }
    }
}
pub(super) fn configure(command: &mut Command, choice: &Choice, preset: &Preset) {
    // This flag latches off even when a positive flag follows it.
    if choice.mode == Mode::Off {
        command.arg("--no-sponsorblock");
        return;
    }
    command.args([
        if choice.mode == Mode::Mark {
            "--sponsorblock-mark"
        } else {
            "--sponsorblock-remove"
        },
        &choice.categories().join(","),
        "--sponsorblock-api",
        "https://sponsor.ajay.app",
    ]);
    if choice.mode == Mode::Mark || !preset.audio() || matches!(preset, Preset::AudioM4a) {
        command.arg("--embed-chapters");
    }
    if choice.mode == Mode::Mark {
        command.args([
            "--sponsorblock-chapter-title",
            "[SponsorBlock]: %(categories)l",
        ]);
    }
    command.args([
        "--print-to-file",
        "before_dl:%(duration|__ORION_NO_SPONSORBLOCK__)j",
        SOURCE_RECEIPT,
    ]);
    command.args(["--print-to-file", "after_move:{\"segments\":%(sponsorblock_chapters|__ORION_NO_SPONSORBLOCK__)j,\"duration\":%(duration|__ORION_NO_SPONSORBLOCK__)j}", RECEIPT]);
}
pub(super) fn reset(dir: &Path, choice: &Choice) -> Result<(), String> {
    if choice.mode == Mode::Off {
        return Ok(());
    }
    for name in [RECEIPT, SOURCE_RECEIPT] {
        let path = dir.join(name);
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
            Ok(_) => {
                super::publication::regular_limited(&path, MAX_RECEIPT)?;
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}
pub(super) fn report(
    dir: &Path,
    choice: &Choice,
    actual_duration: Option<f64>,
) -> Result<Option<Report>, String> {
    if choice.mode == Mode::Off {
        return Ok(None);
    }
    let fail="SponsorBlock did not produce a valid bounded lookup receipt. Working media was retained; retry or turn SponsorBlock off.";
    let file =
        super::publication::regular_limited(&dir.join(RECEIPT), MAX_RECEIPT).map_err(|_| fail)?;
    let mut bytes = Vec::new();
    file.take(MAX_RECEIPT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| fail)?;
    if bytes.len() as u64 > MAX_RECEIPT {
        return Err(fail.into());
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| fail)?;
    let rows = value["segments"].as_array().ok_or(fail)?;
    let processed = value["duration"]
        .as_f64()
        .filter(|d| d.is_finite() && *d > 0.0)
        .ok_or(fail)?;
    let mut original = Vec::new();
    super::publication::regular_limited(&dir.join(SOURCE_RECEIPT), 64)
        .map_err(|_| fail)?
        .take(65)
        .read_to_end(&mut original)
        .map_err(|_| fail)?;
    let source: f64 = serde_json::from_slice(&original).map_err(|_| fail)?;
    if !source.is_finite() || source <= 0.0 {
        return Err(fail.into());
    }
    if rows.len() > 2000
        || rows.iter().any(|v| {
            let a = v["start_time"].as_f64();
            let b = v["end_time"].as_f64();
            let category = v["category"].as_str();
            !matches!((a,b),(Some(a),Some(b)) if a.is_finite() && b.is_finite() && a>=0.0 && b>a)
                || !category
                    .is_some_and(|c| choice.categories.iter().any(|requested| requested == c))
        })
    {
        return Err(fail.into());
    }
    if choice.mode == Mode::Mark
        && ((processed - source).abs() > 0.1
            || actual_duration
                .is_none_or(|actual| !actual.is_finite() || (actual - source).abs() > 1.0))
    {
        return Err("SponsorBlock marking changed or could not verify the source timeline. Working media was retained.".into());
    }
    if choice.mode == Mode::Remove {
        let mut intervals: Vec<_> = rows
            .iter()
            .map(|v| {
                (
                    v["start_time"].as_f64().unwrap().min(source),
                    v["end_time"].as_f64().unwrap().min(source),
                )
            })
            .collect();
        intervals.sort_by(|a, b| a.0.total_cmp(&b.0));
        let (mut removed, mut end) = (0.0_f64, 0.0_f64);
        for (a, b) in intervals {
            removed += (b - a.max(end)).max(0.0);
            end = end.max(b);
        }
        let expected = source - removed;
        if expected <= 0.05
            || (processed - expected).abs() > 0.1
            || actual_duration
                .is_none_or(|actual| !actual.is_finite() || (actual - expected).abs() > 1.0)
        {
            return Err("SponsorBlock removal could not be verified against the source and processed timeline. Working media was retained; retry or turn removal off.".into());
        }
    }
    Ok(Some(Report {
        mode: choice.mode,
        categories: choice.categories(),
        segments: rows.len() as u32,
        source_duration: source,
        processed_duration: processed,
        timeline: rows
            .iter()
            .map(|v| Marker {
                start: v["start_time"].as_f64().unwrap(),
                end: v["end_time"].as_f64().unwrap(),
                categories: vec![v["category"].as_str().unwrap().into()],
            })
            .collect(),
    }))
}
pub(super) fn verify_final_duration(
    report: &Report,
    actual: Option<f64>,
    start: Option<f64>,
    end: Option<f64>,
) -> Result<(), String> {
    let expected = end.unwrap_or(report.processed_duration) - start.unwrap_or(0.0);
    if !expected.is_finite()
        || expected <= 0.0
        || actual.is_none_or(|actual| {
            !actual.is_finite() || actual <= 0.0 || (actual - expected).abs() > 1.0
        })
    {
        return Err("SponsorBlock final duration could not be verified against the processed or clipped timeline. Working media was retained.".into());
    }
    Ok(())
}
pub(super) fn verify_markers(
    report: &Report,
    markers: &[Marker],
    start: Option<f64>,
    end: Option<f64>,
) -> Result<(), String> {
    if report.mode != Mode::Mark {
        return Ok(());
    }
    let fail = "SponsorBlock marker categories or timing did not survive processing. Working media was retained.";
    let begin = start.unwrap_or(0.0);
    let finish = end
        .unwrap_or(report.source_duration)
        .min(report.source_duration);
    fn coverage(
        rows: &[Marker],
        begin: f64,
        finish: f64,
        shift: f64,
    ) -> Result<std::collections::BTreeMap<String, Vec<(f64, f64)>>, String> {
        let mut map = std::collections::BTreeMap::<String, Vec<(f64, f64)>>::new();
        for marker in rows {
            if !marker.start.is_finite()
                || !marker.end.is_finite()
                || marker.start < 0.0
                || marker.end <= marker.start
                || marker.categories.is_empty()
                || marker
                    .categories
                    .iter()
                    .any(|c| !CATEGORIES.contains(&c.as_str()))
            {
                return Err("Invalid SponsorBlock marker.".into());
            }
            let a = marker.start.max(begin) - shift;
            let b = marker.end.min(finish) - shift;
            if b > a {
                for category in &marker.categories {
                    map.entry(category.clone()).or_default().push((a, b));
                }
            }
        }
        for intervals in map.values_mut() {
            intervals.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut merged: Vec<(f64, f64)> = Vec::new();
            for &(a, b) in intervals.iter() {
                if let Some(last) = merged.last_mut().filter(|last| a <= last.1 + 0.01) {
                    last.1 = last.1.max(b);
                } else {
                    merged.push((a, b));
                }
            }
            *intervals = merged;
        }
        Ok(map)
    }
    let expected = coverage(&report.timeline, begin, finish, begin).map_err(|_| fail)?;
    let actual = coverage(markers, 0.0, f64::MAX, 0.0).map_err(|_| fail)?;
    if expected.len() != actual.len()
        || expected.iter().any(|(category, rows)| {
            actual.get(category).is_none_or(|other| {
                rows.len() != other.len()
                    || rows
                        .iter()
                        .zip(other)
                        .any(|(a, b)| (a.0 - b.0).abs() > 0.1 || (a.1 - b.1).abs() > 0.1)
            })
        })
    {
        return Err(fail.into());
    }
    Ok(())
}
impl Choice {
    pub fn categories(&self) -> Vec<String> {
        if self.mode == Mode::Off {
            return Vec::new();
        }
        let mut categories = self.categories.clone();
        categories.sort();
        categories
    }
    pub fn validate(
        &self,
        options: &Options,
        preset: &Preset,
        metadata: Option<&Metadata>,
    ) -> Result<(), String> {
        if self.categories.len() > CATEGORIES.len()
            || self
                .categories
                .iter()
                .enumerate()
                .any(|(i, c)| !CATEGORIES.contains(&c.as_str()) || self.categories[..i].contains(c))
        {
            return Err("Choose distinct supported SponsorBlock categories.".into());
        }
        if self.mode == Mode::Off {
            return Ok(());
        }
        if self.categories.is_empty() {
            return Err("Select at least one SponsorBlock category.".into());
        }
        if metadata.is_some_and(|m| {
            !m.source_id.split_once(':').is_some_and(|(extractor, id)| {
                extractor.eq_ignore_ascii_case("youtube")
                    && id.len() == 11
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            })
        }) {
            return Err(
                "SponsorBlock requires a YouTube video. Turn it off for this source.".into(),
            );
        }
        if self.mode == Mode::Remove
            && self
                .categories
                .iter()
                .any(|c| matches!(c.as_str(), "poi_highlight" | "chapter"))
        {
            return Err("Highlights and community chapters can be marked, not removed.".into());
        }
        if self.mode == Mode::Mark && preset.audio() && !matches!(preset, Preset::AudioM4a) {
            return Err("SponsorBlock chapter marking needs video or M4A.".into());
        }
        if self.mode == Mode::Remove && (options.clipped() || options.embed_subtitles) {
            return Err("SponsorBlock removal cannot be combined with clip ranges or embedded captions yet. Use full-length media without captions, or mark chapters instead.".into());
        }
        Ok(())
    }
}
#[cfg(test)]
#[path = "sponsor_tests.rs"]
mod tests;
