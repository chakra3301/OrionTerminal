use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::IpAddr;

pub const MAX_FILE: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_WORK: u64 = 4 * 1024 * 1024 * 1024;
pub const ABSOLUTE_FILE: u64 = 64 * 1024 * 1024 * 1024;
const MIB: u64 = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub file_mib: u32,
    pub work_mib: u32,
    pub free_mib: u32,
    pub minutes: u16,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            file_mib: (MAX_FILE / MIB) as u32,
            work_mib: (MAX_WORK / MIB) as u32,
            free_mib: 512,
            minutes: 45,
        }
    }
}
impl Limits {
    pub fn validate(&self) -> Result<(), String> {
        if !(16..=65536).contains(&self.file_mib)
            || !(32..=262144).contains(&self.work_mib)
            || self.work_mib < self.file_mib * 2
            || !(512..=65536).contains(&self.free_mib)
            || !(1..=1440).contains(&self.minutes)
        {
            return Err("Use 16–65536 MiB per file, 32–262144 MiB combined work (at least twice the file limit), 512–65536 MiB free reserve and 1–1440 minutes per engine operation.".into());
        }
        Ok(())
    }
    pub fn file_bytes(&self) -> u64 {
        u64::from(self.file_mib) * MIB
    }
    pub fn work_bytes(&self) -> u64 {
        u64::from(self.work_mib) * MIB
    }
    pub fn free_bytes(&self) -> u64 {
        u64::from(self.free_mib) * MIB
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Preset {
    VideoCombined,
    VideoBest,
    VideoMp4,
    VideoOnly,
    VideoOnlyWorst,
    VideoWorst,
    #[serde(rename = "video-4k")]
    Video4k,
    #[serde(rename = "video-2k")]
    Video2k,
    #[serde(rename = "video-1080")]
    Video1080,
    #[serde(rename = "video-720")]
    Video720,
    #[serde(rename = "video-480")]
    Video480,
    #[serde(rename = "video-360")]
    Video360,
    #[serde(rename = "video-240")]
    Video240,
    #[serde(rename = "video-144")]
    Video144,
    AudioOriginal,
    AudioM4a,
    AudioMp3,
    AudioAac,
    AudioWav,
    AudioFlac,
    AudioOpus,
    AudioVorbis,
}
impl Preset {
    pub fn audio(&self) -> bool {
        matches!(
            self,
            Self::AudioOriginal
                | Self::AudioM4a
                | Self::AudioMp3
                | Self::AudioAac
                | Self::AudioWav
                | Self::AudioFlac
                | Self::AudioOpus
                | Self::AudioVorbis
        )
    }
    pub fn args(&self) -> Vec<String> {
        if self.audio() {
            let format = match self {
                Self::AudioM4a => "m4a",
                Self::AudioMp3 => "mp3",
                Self::AudioAac => "aac",
                Self::AudioWav => "wav",
                Self::AudioFlac => "flac",
                Self::AudioOpus => "opus",
                Self::AudioVorbis => "vorbis",
                _ => "best",
            };
            return ["-f", "bestaudio/best", "-x", "--audio-format", format]
                .iter()
                .map(|s| (*s).into())
                .collect();
        }
        let height = match self {
            Self::Video4k => Some(2160),
            Self::Video2k => Some(1440),
            Self::Video1080 => Some(1080),
            Self::Video720 => Some(720),
            Self::Video480 => Some(480),
            Self::Video360 => Some(360),
            Self::Video240 => Some(240),
            Self::Video144 => Some(144),
            _ => None,
        };
        let selector = if let Some(h) = height {
            format!("bv*[height<=?{h}]+ba/b[height<=?{h}]")
        } else {
            match self {
                Self::VideoCombined => "b",
                Self::VideoMp4 => "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
                Self::VideoOnly => "bv",
                Self::VideoOnlyWorst => "wv",
                Self::VideoWorst => "w",
                _ => "bv*+ba/b",
            }
            .into()
        };
        vec![
            "-f".into(),
            selector,
            "--merge-output-format".into(),
            "mp4/mkv".into(),
        ]
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub playable: bool,
    pub limits: Limits,
    pub sponsorblock: super::sponsor::Choice,
    pub skip_duplicates: bool,
    pub audio_quality: u8,
    pub start_seconds: Option<f64>,
    pub end_seconds: Option<f64>,
    pub format_id: Option<String>,
    pub rate_limit_kib: Option<u32>,
    pub retries: u8,
    pub fragments: u8,
    pub embed_metadata: bool,
    pub embed_chapters: bool,
    pub embed_thumbnail: bool,
    pub embed_subtitles: bool,
    pub automatic_subtitles: bool,
    pub subtitle_langs: Vec<String>,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            playable: true,
            limits: Limits::default(),
            sponsorblock: super::sponsor::Choice::default(),
            skip_duplicates: true,
            audio_quality: 0,
            start_seconds: None,
            end_seconds: None,
            format_id: None,
            rate_limit_kib: None,
            retries: 2,
            fragments: 1,
            embed_metadata: false,
            embed_chapters: false,
            embed_thumbnail: false,
            embed_subtitles: false,
            automatic_subtitles: false,
            subtitle_langs: Vec::new(),
        }
    }
}
pub fn valid_lang(lang: &str) -> bool {
    let (primary, region) = lang
        .split_once('-')
        .map_or((lang, None), |(a, b)| (a, Some(b)));
    (2..=3).contains(&primary.len())
        && primary.bytes().all(|b| b.is_ascii_alphabetic())
        && region.is_none_or(|r| {
            (1..=8).contains(&r.len()) && r.bytes().all(|b| b.is_ascii_alphanumeric())
        })
}
impl Options {
    pub fn validate(&self, metadata: Option<&Metadata>, audio: bool) -> Result<(), String> {
        self.limits.validate()?;
        if self
            .rate_limit_kib
            .is_some_and(|n| !(16..=1_048_576).contains(&n))
            || self.retries > 10
            || !(1..=8).contains(&self.fragments)
        {
            return Err(
                "Use 16–1048576 KiB/s (or unlimited), 0–10 retries and 1–8 concurrent fragments."
                    .into(),
            );
        }
        if self.audio_quality > 10 {
            return Err("Audio quality must be between 0 and 10.".into());
        }
        if self.subtitle_langs.len() > 5
            || self.subtitle_langs.iter().any(|l| !valid_lang(l))
            || self
                .subtitle_langs
                .iter()
                .enumerate()
                .any(|(i, l)| self.subtitle_langs[..i].contains(l))
        {
            return Err("Choose up to 5 subtitle languages using codes like en or pt-BR.".into());
        }
        if self.embed_subtitles {
            if audio {
                return Err("Subtitles embed into video downloads only.".into());
            }
            if self.subtitle_langs.is_empty() {
                return Err("Choose at least one subtitle language to embed.".into());
            }
            if let Some(m) = metadata {
                if self.subtitle_langs.iter().any(|lang| {
                    !m.subtitles.contains(lang)
                        && !(self.automatic_subtitles && m.automatic_subtitles.contains(lang))
                }) {
                    return Err("A requested subtitle language is unavailable. Inspect again or change the selected languages/automatic-caption option.".into());
                }
            }
        }
        for value in [self.start_seconds, self.end_seconds].into_iter().flatten() {
            if !value.is_finite() || !(0.0..=86400.0).contains(&value) {
                return Err("Clip times must be finite seconds within 24 hours.".into());
            }
        }
        let start = self.start_seconds.unwrap_or(0.0);
        if let Some(end) = self.end_seconds {
            if end <= start
                || metadata
                    .and_then(|m| m.duration)
                    .is_some_and(|d| end > d + 0.1)
            {
                return Err(
                    "Clip end must follow the start and be within the media duration.".into(),
                );
            }
        }
        if metadata
            .and_then(|m| m.duration)
            .is_some_and(|d| start >= d)
        {
            return Err("Clip start must be before the end of the media.".into());
        }
        if let Some(id) = &self.format_id {
            if id.is_empty()
                || id.len() > 64
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            {
                return Err("Invalid source format identity.".into());
            }
            let format = metadata
                .and_then(|m| m.formats.iter().find(|f| &f.id == id))
                .ok_or("The selected format is not in this inspection. Inspect again.")?;
            if audio && format.audio_codec == "none" {
                return Err("This format has no audio.".into());
            }
            if !audio && format.video_codec == "none" {
                return Err("This format has no video.".into());
            }
        }
        Ok(())
    }
    pub fn validate_preset(
        &self,
        preset: &Preset,
        metadata: Option<&Metadata>,
    ) -> Result<(), String> {
        self.validate(metadata, preset.audio())?;
        self.sponsorblock.validate(self, preset, metadata)?;
        if self.embed_thumbnail
            && !matches!(
                preset,
                Preset::AudioMp3 | Preset::AudioM4a | Preset::AudioFlac
            )
        {
            return Err("Cover art embedding supports MP3, M4A and FLAC presets. Video previews are generated locally.".into());
        }
        if self.embed_chapters && preset.audio() && !matches!(preset, Preset::AudioM4a) {
            return Err("Embedded chapters need a video or M4A preset.".into());
        }
        if self.embed_subtitles && self.clipped() {
            return Err("Embedded subtitles and clip ranges cannot be combined yet. Download the full video with subtitles, or turn subtitles off to clip.".into());
        }
        Ok(())
    }
    pub fn clipped(&self) -> bool {
        self.start_seconds.is_some() || self.end_seconds.is_some()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Format {
    pub id: String,
    pub extension: String,
    pub height: Option<u64>,
    pub fps: Option<f64>,
    pub video_codec: String,
    pub audio_codec: String,
    pub size: Option<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playback {
    pub compatible: bool,
    pub container: String,
    pub video_codec: String,
    pub audio_codec: String,
    pub converted: bool,
    #[serde(default)]
    pub sponsorblock: Option<super::sponsor::Report>,
    #[serde(skip)]
    pub sponsor_markers: u32,
    #[serde(skip)]
    pub sponsor_timeline: Vec<super::sponsor::Marker>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub embedded: Option<Embedded>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Embedded {
    pub title: bool,
    pub chapters: u32,
    pub subtitles: u32,
    #[serde(default)]
    pub subtitle_languages: Vec<String>,
    pub artwork: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub title: String,
    pub creator: String,
    pub description: String,
    pub duration: Option<f64>,
    pub site: String,
    pub tags: Vec<String>,
    pub heights: Vec<u64>,
    #[serde(default)]
    pub formats: Vec<Format>,
    #[serde(default)]
    pub source_id: String,
    #[serde(default)]
    pub playback: Option<Playback>,
    #[serde(default)]
    pub subtitles: Vec<String>,
    #[serde(default)]
    pub automatic_subtitles: Vec<String>,
    #[serde(default)]
    pub chapters: Option<u32>,
    #[serde(default)]
    pub thumbnail: bool,
}
fn text(v: &Value, name: &str, max: usize) -> String {
    v[name]
        .as_str()
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(max)
        .collect()
}
pub fn metadata(v: &Value, source: &str) -> Result<Metadata, String> {
    if v.get("entries").is_some() || matches!(v["_type"].as_str(), Some("playlist" | "multi_video"))
    {
        return Err("Use a single video or audio link, not a playlist.".into());
    }
    if v["is_live"].as_bool() == Some(true)
        || matches!(v["live_status"].as_str(), Some("is_live" | "is_upcoming"))
    {
        return Err("Live and upcoming streams are not supported yet.".into());
    }
    let title = text(v, "title", 300);
    if title.is_empty() {
        return Err("This link did not return a media title.".into());
    }
    let mut heights: Vec<u64> = v["formats"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| f["height"].as_u64())
        .filter(|h| *h > 0 && *h <= 16384)
        .collect();
    heights.sort_unstable();
    heights.dedup();
    heights.truncate(32);
    let tags = v["tags"]
        .as_array()
        .into_iter()
        .flatten()
        .take(20)
        .filter_map(Value::as_str)
        .filter_map(normalize_tag)
        .take(5)
        .collect();
    Ok(Metadata {
        title,
        creator: text(v, "uploader", 200),
        description: text(v, "description", 2000),
        duration: v["duration"]
            .as_f64()
            .filter(|n| n.is_finite() && *n >= 0.0),
        site: url(source)?
            .host_str()
            .unwrap_or_default()
            .trim_start_matches("www.")
            .to_string(),
        tags,
        heights,
        formats: v["formats"]
            .as_array()
            .into_iter()
            .flatten()
            .take(300)
            .filter_map(|f| {
                let id = f["format_id"].as_str()?;
                if id.is_empty()
                    || id.len() > 64
                    || !id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
                {
                    return None;
                }
                Some(Format {
                    id: id.into(),
                    extension: text(f, "ext", 16),
                    height: f["height"].as_u64(),
                    fps: f["fps"].as_f64().filter(|n| n.is_finite()),
                    video_codec: text(f, "vcodec", 64),
                    audio_codec: text(f, "acodec", 64),
                    size: f["filesize"]
                        .as_u64()
                        .or_else(|| f["filesize_approx"].as_u64()),
                })
            })
            .collect(),
        source_id: format!("{}:{}", text(v, "extractor_key", 80), text(v, "id", 200)),
        playback: None,
        subtitles: subtitle_langs(v, "subtitles")?,
        automatic_subtitles: subtitle_langs(v, "automatic_captions")?,
        chapters: v["chapters"]
            .as_array()
            .map(|c| c.len().min(10000) as u32)
            .filter(|n| *n > 0),
        thumbnail: v["thumbnail"].as_str().is_some_and(|t| !t.is_empty())
            || v["thumbnails"].as_array().is_some_and(|t| !t.is_empty()),
    })
}
fn subtitle_langs(v: &Value, key: &str) -> Result<Vec<String>, String> {
    let languages: Vec<_> = v[key]
        .as_object()
        .into_iter()
        .flat_map(|map| map.keys())
        .filter(|lang| valid_lang(lang))
        .take(1025)
        .cloned()
        .collect();
    if languages.len() > 1024 {
        return Err("Source subtitle inventory exceeds 1024 language codes; refusing an incomplete inspection.".into());
    }
    Ok(languages)
}
pub fn normalize_tag(input: &str) -> Option<String> {
    let result = input
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    if result.is_empty()
        || result.len() > 32
        || !result.chars().all(|c| c.is_alphanumeric() || c == '-')
    {
        None
    } else {
        Some(result)
    }
}
pub fn url(input: &str) -> Result<Url, String> {
    if input.len() > 4096 || input.chars().any(char::is_control) || input != input.trim() {
        return Err("Use one HTTP(S) link, up to 4096 characters.".into());
    }
    let parsed = Url::parse(input).map_err(|_| "Enter a valid HTTP(S) link.")?;
    let host = parsed
        .host_str()
        .ok_or("The link needs a public hostname.")?
        .trim_end_matches('.');
    if !matches!(parsed.scheme(), "https" | "http")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some_and(|p| p != 80 && p != 443)
        || !host.contains('.')
        || [
            "localhost",
            "local",
            "internal",
            "test",
            "invalid",
            "home",
            "lan",
        ]
        .iter()
        .any(|s| host == *s || host.ends_with(&format!(".{s}")))
        || host.trim_matches(['[', ']']).parse::<IpAddr>().is_ok()
    {
        return Err("Use a public HTTP(S) hostname without credentials or a custom port.".into());
    }
    Ok(parsed)
}
pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && a != 0
                && a < 224
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 198 && (b == 18 || b == 19))
                && !(a == 192 && b == 0)
        }
        IpAddr::V6(ip) => {
            // Only ordinary global unicast; translated, local and special-use ranges fail closed.
            let s = ip.segments();
            (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && s[1] < 0x200)
                && !(s[0] == 0x2001 && s[1] == 0xdb8)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits_are_bounded_defaulted_and_reject_unsafe_json() {
        let old: Options = serde_json::from_str("{}").unwrap();
        assert_eq!(old.limits, Limits::default());
        for (file, work, free, minutes) in [(16, 32, 512, 1), (65536, 262144, 65536, 1440)] {
            Limits {
                file_mib: file,
                work_mib: work,
                free_mib: free,
                minutes,
            }
            .validate()
            .unwrap();
        }
        for (file, work, free, minutes) in [
            (0, 4096, 512, 45),
            (65537, 262144, 512, 45),
            (2048, 4095, 512, 45),
            (16, 262145, 512, 45),
            (16, 32, 511, 45),
            (16, 32, 65537, 45),
            (16, 32, 512, 0),
            (16, 32, 512, 1441),
            (u32::MAX, u32::MAX, 512, 1),
        ] {
            assert!(Limits {
                file_mib: file,
                work_mib: work,
                free_mib: free,
                minutes
            }
            .validate()
            .is_err());
        }
        for json in [
            r#"{"limits":{"fileMib":-1}}"#,
            r#"{"limits":{"fileMib":16.5}}"#,
            r#"{"limits":{"bytes":0}}"#,
            r#"{"limits":null}"#,
        ] {
            assert!(serde_json::from_str::<Options>(json).is_err(), "{json}");
        }
    }
    use serde_json::json;
    #[test]
    fn embedding_options_are_bounded_literal_and_preset_scoped() {
        let mut options = Options {
            embed_subtitles: true,
            subtitle_langs: vec!["en".into(), "pt-BR".into()],
            ..Default::default()
        };
        assert!(options.validate_preset(&Preset::Video1080, None).is_ok());
        assert!(options.validate_preset(&Preset::AudioMp3, None).is_err());
        for languages in [
            vec![],
            vec!["en.*".into()],
            vec!["all".into(); 6],
            vec!["en".into(), "en".into()],
            vec!["--exec".into()],
        ] {
            options.subtitle_langs = languages;
            assert!(options.validate_preset(&Preset::Video1080, None).is_err());
        }
        options.subtitle_langs = vec!["en".into()];
        options.start_seconds = Some(1.0);
        assert!(options
            .validate_preset(&Preset::Video1080, None)
            .unwrap_err()
            .contains("clip ranges"));
        options = Options {
            embed_thumbnail: true,
            ..Default::default()
        };
        assert!(options.validate_preset(&Preset::AudioMp3, None).is_ok());
        assert!(options.validate_preset(&Preset::AudioAac, None).is_err());
        assert!(options.validate_preset(&Preset::VideoMp4, None).is_err());
        options = Options {
            embed_chapters: true,
            ..Default::default()
        };
        assert!(options.validate_preset(&Preset::AudioM4a, None).is_ok());
        assert!(options.validate_preset(&Preset::AudioMp3, None).is_err());
    }
    #[test]
    fn inspection_separates_manual_and_automatic_captions_without_urls() {
        let m=metadata(&json!({"title":"Fixture", "subtitles":{"en":[{"url":"secret"}],"en.*":[],"live_chat":[]},"automatic_captions":{"fr":[]},"chapters":[{},{}],"thumbnail":"https://example.com/art.jpg"}),"https://example.com/video").unwrap();
        assert_eq!(m.subtitles, vec!["en"]);
        assert_eq!(m.automatic_subtitles, vec!["fr"]);
        assert_eq!(m.chapters, Some(2));
        assert!(m.thumbnail);
        let mut options = Options {
            embed_subtitles: true,
            subtitle_langs: vec!["fr".into()],
            ..Default::default()
        };
        assert!(options
            .validate_preset(&Preset::Video1080, Some(&m))
            .is_err());
        options.automatic_subtitles = true;
        assert!(options
            .validate_preset(&Preset::Video1080, Some(&m))
            .is_ok());
        assert!(!serde_json::to_string(&m).unwrap().contains("secret"));
    }
    #[test]
    fn subtitle_inventory_is_complete_or_inspection_refuses() {
        let mut value = json!({"title":"Languages","automatic_captions":{}});
        for i in 0..100 {
            value["automatic_captions"][format!("en-{i:03}")] = json!([]);
        }
        let meta = metadata(&value, "https://example.com/video").unwrap();
        assert_eq!(meta.automatic_subtitles.len(), 100);
        assert!(Options {
            embed_subtitles: true,
            automatic_subtitles: true,
            subtitle_langs: vec!["en-099".into()],
            ..Default::default()
        }
        .validate_preset(&Preset::Video1080, Some(&meta))
        .is_ok());
        for i in 0..1025 {
            value["automatic_captions"][format!("fr-{i:04}")] = json!([]);
        }
        assert!(metadata(&value, "https://example.com/video")
            .unwrap_err()
            .contains("1024 language codes"));
    }
    #[test]
    fn old_options_keep_extras_off_and_old_playback_is_not_a_new_verification() {
        let options: Options = serde_json::from_str("{}").unwrap();
        assert!(
            !options.embed_metadata
                && !options.embed_chapters
                && !options.embed_subtitles
                && !options.embed_thumbnail
        );
        let p:Playback=serde_json::from_value(json!({"compatible":true,"container":"mp4","videoCodec":"h264","audioCodec":"aac","converted":false})).unwrap();
        assert!(p.embedded.is_none());
    }
    #[test]
    fn refuses_local_credentials_protocols_and_argument_inputs() {
        for s in [
            "file:///etc/passwd",
            "--exec=touch",
            "https://u:p@youtube.com/x",
            "http://127.0.0.1/x",
            "http://2130706433",
            "http://[::1]/",
            "https://box.local/a",
            "https://a.com:9000",
            "https://a.com/\n--exec=x",
        ] {
            assert!(url(s).is_err(), "{s}");
        }
        assert!(url("https://www.youtube.com/watch?v=example&list=ignored").is_ok());
    }
    #[test]
    fn refuses_non_public_dns_answers() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "169.254.169.254",
            "100.64.1.1",
            "198.18.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "2001:db8::1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(public_ip("8.8.8.8".parse().unwrap()));
        assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
    }
    #[test]
    fn rejects_playlist_and_live_metadata() {
        for v in [
            json!({"entries":[]}),
            json!({"is_live":true}),
            json!({"live_status":"is_upcoming"}),
        ] {
            assert!(metadata(&v, "https://youtube.com/x").is_err());
        }
    }
    #[test]
    fn bounds_and_normalizes_untrusted_metadata() {
        let m = metadata(&json!({"title":"A".repeat(1000),"uploader":"Creator", "description":"x".repeat(4000),"tags":["Music Theory","<script>","piano"],"formats":[{"height":1080},{"height":720},{"height":1080}]}), "https://www.youtube.com/x").unwrap();
        assert_eq!(m.title.len(), 300);
        assert_eq!(m.description.len(), 2000);
        assert_eq!(m.tags, vec!["music-theory", "piano"]);
        assert_eq!(m.heights, vec![720, 1080]);
        assert_eq!(m.site, "youtube.com");
    }
    #[test]
    fn clip_and_quality_controls_are_bounded() {
        let meta = metadata(
            &json!({"title":"Range","duration":30}),
            "https://example.com/video",
        )
        .unwrap();
        for options in [
            Options {
                audio_quality: 11,
                ..Options::default()
            },
            Options {
                start_seconds: Some(-1.0),
                ..Options::default()
            },
            Options {
                start_seconds: Some(f64::NAN),
                ..Options::default()
            },
            Options {
                start_seconds: Some(30.0),
                ..Options::default()
            },
            Options {
                start_seconds: Some(10.0),
                end_seconds: Some(9.0),
                ..Options::default()
            },
            Options {
                end_seconds: Some(31.0),
                ..Options::default()
            },
        ] {
            assert!(options.validate(Some(&meta), false).is_err());
        }
        assert!(Options {
            start_seconds: Some(5.0),
            end_seconds: Some(15.0),
            ..Options::default()
        }
        .validate(Some(&meta), false)
        .is_ok());
        assert!(serde_json::from_str::<Options>(r#"{"cookieFile":"/private/cookies"}"#).is_err());
    }
    #[test]
    fn transfer_controls_reject_unbounded_requests() {
        for options in [
            Options {
                rate_limit_kib: Some(0),
                ..Options::default()
            },
            Options {
                rate_limit_kib: Some(1_048_577),
                ..Options::default()
            },
            Options {
                retries: 11,
                ..Options::default()
            },
            Options {
                fragments: 0,
                ..Options::default()
            },
            Options {
                fragments: 9,
                ..Options::default()
            },
        ] {
            assert!(options.validate(None, false).is_err());
        }
        for options in [
            Options {
                rate_limit_kib: Some(16),
                retries: 0,
                fragments: 1,
                ..Options::default()
            },
            Options {
                rate_limit_kib: Some(1_048_576),
                retries: 10,
                fragments: 8,
                ..Options::default()
            },
        ] {
            assert!(options.validate(None, false).is_ok());
        }
    }
    #[test]
    fn source_formats_must_be_inspected_and_match_the_mode() {
        let meta = metadata(&json!({"title":"Formats","formats":[{"format_id":"137","vcodec":"h264","acodec":"none","ext":"mp4"},{"format_id":"140","vcodec":"none","acodec":"aac","ext":"m4a"},{"format_id":"best+--exec=bad","vcodec":"h264"}]}),"https://example.com/video").unwrap();
        assert_eq!(meta.formats.len(), 2);
        for (id, audio, valid) in [
            ("137", false, true),
            ("137", true, false),
            ("140", true, true),
            ("140", false, false),
            ("missing", false, false),
            ("--exec=bad", false, false),
        ] {
            assert_eq!(
                Options {
                    format_id: Some(id.into()),
                    ..Options::default()
                }
                .validate(Some(&meta), audio)
                .is_ok(),
                valid,
                "{id}"
            );
        }
    }
    #[test]
    fn resolution_ladder_is_a_real_upper_bound_not_an_upscale() {
        for (name, height) in [
            ("video-4k", 2160),
            ("video-2k", 1440),
            ("video-1080", 1080),
            ("video-720", 720),
            ("video-480", 480),
            ("video-360", 360),
            ("video-240", 240),
            ("video-144", 144),
        ] {
            let preset: Preset = serde_json::from_value(json!(name)).unwrap();
            assert!(preset.args()[1].contains(&format!("height<=?{height}")));
            assert!(!preset.audio());
        }
        assert_eq!(Preset::VideoOnly.args()[1], "bv");
        assert_eq!(Preset::VideoOnlyWorst.args()[1], "wv");
        assert_eq!(Preset::VideoCombined.args()[1], "b");
    }
    #[test]
    fn presets_are_fixed_and_audio_conversion_is_explicit() {
        assert!(Preset::AudioMp3.args().contains(&"mp3".into()));
        assert!(!Preset::Video1080.audio());
        assert!(Preset::AudioOriginal.audio());
        assert!(serde_json::from_str::<Preset>("\"--exec\"").is_err());
    }
}
