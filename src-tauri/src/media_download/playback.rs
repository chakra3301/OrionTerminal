use super::{
    engine,
    policy::{Embedded, Options, Playback},
    publication,
};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::{process::Command, sync::watch};

#[path = "caption_languages.rs"]
mod caption_languages;
fn tag<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .as_object()?
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))?
        .1
        .as_str()
        .filter(|s| !s.is_empty())
}
pub(super) fn subtitle_language(stream: &Value) -> String {
    let tags = &stream["tags"];
    let base = tag(tags, "language")
        .filter(|s| super::policy::valid_lang(s))
        .map(caption_languages::canonical)
        .unwrap_or_else(|| "und".into());
    let marker = ["handler_name", "title"]
        .into_iter()
        .find_map(|key| tag(tags, key).and_then(|s| s.strip_prefix(caption_languages::MARKER)))
        .filter(|s| super::policy::valid_lang(s))
        .map(caption_languages::canonical);
    marker
        .filter(|m| {
            base != "und"
                && (m == &base
                    || (!base.contains('-') && m.split('-').next() == base.split('-').next()))
        })
        .unwrap_or(base)
}
pub(super) fn facts(value: &Value, ext: &str) -> Playback {
    let streams = value["streams"].as_array();
    let video = streams
        .into_iter()
        .flatten()
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1);
    let audio = streams
        .into_iter()
        .flatten()
        .find(|s| s["codec_type"] == "audio");
    let video_codec = video
        .and_then(|s| s["codec_name"].as_str())
        .unwrap_or("none")
        .to_string();
    let audio_codec = audio
        .and_then(|s| s["codec_name"].as_str())
        .unwrap_or("none")
        .to_string();
    let format = value["format"]["format_name"].as_str().unwrap_or("");
    let formats: Vec<_> = format.split(',').collect();
    let compatible = if let Some(v) = video {
        formats.iter().any(|f| matches!(*f, "mov" | "mp4"))
            && matches!(ext, "mp4" | "m4v" | "mov")
            && video_codec == "h264"
            && v["pix_fmt"] == "yuv420p"
            && matches!(audio_codec.as_str(), "aac" | "none")
    } else {
        audio.is_some()
            && formats
                .iter()
                .any(|f| matches!(*f, "mp3" | "mov" | "mp4" | "wav" | "flac"))
            && matches!(
                (ext, audio_codec.as_str()),
                ("mp3", "mp3") | ("m4a" | "mp4", "aac") | ("wav", "pcm_s16le") | ("flac", "flac")
            )
    };
    Playback {
        compatible,
        container: ext.into(),
        video_codec,
        audio_codec,
        converted: false,
        sponsorblock: None,
        sponsor_markers: value["chapters"].as_array().map_or(0, |rows| {
            rows.iter()
                .filter(|row| {
                    tag(&row["tags"], "title")
                        .is_some_and(|title| title.starts_with("[SponsorBlock]:"))
                })
                .count() as u32
        }),
        sponsor_timeline: value["chapters"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|row| {
                let categories = tag(&row["tags"], "title")?
                    .strip_prefix("[SponsorBlock]:")?
                    .split(',')
                    .map(|c| c.trim().to_string())
                    .collect();
                let time = |key: &str| {
                    row[key]
                        .as_f64()
                        .or_else(|| row[key].as_str()?.parse::<f64>().ok())
                        .unwrap_or(f64::NAN)
                };
                Some(super::sponsor::Marker {
                    start: time("start_time"),
                    end: time("end_time"),
                    categories,
                })
            })
            .collect(),
        duration: value["format"]["duration"]
            .as_str()
            .and_then(|s| s.parse::<f64>().ok())
            .filter(|n| n.is_finite() && *n >= 0.0),
        embedded: Some(Embedded {
            title: tag(&value["format"]["tags"], "title").is_some()
                || audio.is_some_and(|s| tag(&s["tags"], "title").is_some()),
            chapters: value["chapters"].as_array().map_or(0, |c| c.len() as u32),
            subtitles: streams
                .into_iter()
                .flatten()
                .filter(|s| s["codec_type"] == "subtitle")
                .count() as u32,
            subtitle_languages: streams
                .into_iter()
                .flatten()
                .filter(|s| s["codec_type"] == "subtitle")
                .map(subtitle_language)
                .collect(),
            artwork: streams
                .into_iter()
                .flatten()
                .any(|s| s["disposition"]["attached_pic"] == 1),
        }),
    }
}
pub(super) async fn probe(
    path: &Path,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Playback, String> {
    publication::regular(path)?;
    let exe = engine::engines().ffprobe.ok_or("ffprobe is missing.")?;
    let mut c = Command::new(exe);
    c.args([
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_entries",
        "stream=codec_type,codec_name,pix_fmt:stream_disposition=attached_pic:stream_tags=title,language,handler_name:format=format_name,duration:format_tags=title:chapter=id,start_time,end_time:chapter_tags=title",
        "-of",
        "json",
    ])
    .arg(path)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);
    let bytes = engine::collect(&mut c, 256 * 1024, cancel).await?;
    let data: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Could not read the media codecs.")?;
    Ok(facts(
        &data,
        path.extension().and_then(|s| s.to_str()).unwrap_or(""),
    ))
}
fn command(
    exe: &Path,
    source: &Path,
    output: &Path,
    audio: bool,
    clip: &Options,
    info: &Playback,
) -> Result<Command, String> {
    let mut c = Command::new(exe);
    c.env_clear()
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .env("LANG", "en_US.UTF-8")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-n",
            "-protocol_whitelist",
            "file,pipe",
        ]);
    // Accurate input-side audio decoding preserves the attached cover packet; output-side seeking drops it.
    if audio {
        if let Some(start) = clip.start_seconds {
            c.args(["-ss", &start.to_string()]);
        }
    }
    c.arg("-i").arg(source);
    // Video is re-encoded with output-side seeking, not keyframe-only trimming.
    if !audio {
        if let Some(start) = clip.start_seconds {
            c.args(["-ss", &start.to_string()]);
        }
    }
    if let Some(end) = clip.end_seconds {
        c.args(["-t", &(end - clip.start_seconds.unwrap_or(0.0)).to_string()]);
    }
    if audio {
        c.args(["-map", "0:a:0"]);
        if info.embedded.as_ref().is_some_and(|e| e.artwork) {
            c.args([
                "-map",
                "0:v?",
                "-c:v",
                "copy",
                "-disposition:v:0",
                "attached_pic",
            ]);
        }
    } else {
        c.args([
            "-map", "0:V:0", "-map", "0:a:0?", "-map", "0:s?", "-c:s", "mov_text", "-c:v",
            "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-threads", "2",
        ]);
    }
    let ext = output.extension().and_then(|s| s.to_str()).unwrap_or("");
    if info.audio_codec != "none" {
        match ext {
            "mp3" => {
                c.args([
                    "-c:a",
                    "libmp3lame",
                    "-q:a",
                    &clip.audio_quality.min(9).to_string(),
                ]);
            }
            "wav" => {
                c.args(["-c:a", "pcm_s16le"]);
            }
            "flac" => {
                c.args(["-c:a", "flac"]);
            }
            "opus" => {
                let bitrate = format!(
                    "{}k",
                    256 - u32::from(clip.audio_quality.min(10)) * 224 / 10
                );
                c.args(["-c:a", "libopus", "-b:a", &bitrate]);
            }
            "ogg" => {
                c.args([
                    "-c:a",
                    "libvorbis",
                    "-q:a",
                    &(10 - clip.audio_quality).to_string(),
                ]);
            }
            _ => {
                let bitrate = if audio {
                    format!(
                        "{}k",
                        320 - u32::from(clip.audio_quality.min(10)) * 288 / 10
                    )
                } else {
                    "192k".into()
                };
                c.args(["-c:a", "aac", "-b:a", &bitrate]);
            }
        }
    }
    c.args(["-map_metadata", "0", "-map_chapters", "0"]);
    if audio {
        c.args(["-map_metadata", "0:s:a:0"]);
    }
    if !audio {
        if let Some(extras) = info.embedded.as_ref() {
            caption_metadata(&mut c, &extras.subtitle_languages);
        }
    }
    if matches!(ext, "mp4" | "m4a") {
        c.args(["-movflags", "+faststart"]);
    }
    c.args([
        "-progress",
        "pipe:1",
        "-fs",
        &clip.limits.file_bytes().to_string(),
    ])
    .arg(output);
    Ok(c)
}
fn caption_metadata(command: &mut Command, languages: &[String]) {
    for (i, lang) in languages.iter().enumerate() {
        command.args([
            format!("-metadata:s:s:{i}"),
            format!("language={}", lang.split('-').next().unwrap_or("und")),
            format!("-metadata:s:s:{i}"),
            format!("handler_name={}{}", caption_languages::MARKER, lang),
            format!("-metadata:s:s:{i}"),
            format!("title={}{}", caption_languages::MARKER, lang),
        ]);
    }
}
async fn label_captions(
    dir: &Path,
    source: &Path,
    before: &Playback,
    identities: &[String],
    limits: &super::policy::Limits,
    cancel: &mut watch::Receiver<bool>,
    report: impl FnMut(engine::Progress),
) -> Result<Playback, String> {
    if source.extension().and_then(|s| s.to_str()) != Some("mkv") {
        return Err(
            "Caption identity correction requires Matroska staging. Retry the download.".into(),
        );
    }
    let exe = engine::engines().ffmpeg.ok_or("FFmpeg is missing.")?;
    let output = dir.join("media.captioned.mkv");
    let mut command = Command::new(exe);
    command
        .env_clear()
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .env("LANG", "en_US.UTF-8")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-n",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
        ])
        .arg(source)
        .args([
            "-map",
            "0:v?",
            "-map",
            "0:a?",
            "-map",
            "0:s?",
            "-c",
            "copy",
            "-map_metadata",
            "0",
            "-map_chapters",
            "0",
        ]);
    caption_metadata(&mut command, identities);
    command
        .args([
            "-progress",
            "pipe:1",
            "-fs",
            &limits.file_bytes().to_string(),
        ])
        .arg(&output);
    engine::run_media(
        &mut command,
        dir,
        cancel,
        report,
        before.duration,
        None,
        limits,
    )
    .await?;
    let result = probe(&output, cancel).await?;
    let a = before
        .embedded
        .as_ref()
        .ok_or("Missing caption verification facts.")?;
    let b = result
        .embedded
        .as_ref()
        .ok_or("Missing caption verification facts.")?;
    if b.subtitle_languages != identities
        || b.subtitles != a.subtitles
        || b.chapters != a.chapters
        || b.title != a.title
        || before.video_codec != result.video_codec
        || before.audio_codec != result.audio_codec
        || matches!((before.duration,result.duration),(Some(a),Some(b)) if (a-b).abs()>0.5)
    {
        return Err("Caption metadata remux did not preserve verified tracks, chapters, title, codecs or duration. The working source was kept.".into());
    }
    let file = publication::regular_limited(&output, limits.file_bytes())?;
    if file.metadata().map_err(|e| e.to_string())?.len() >= limits.file_bytes() {
        return Err(
            "Caption metadata remux reached the output limit. The working source was kept.".into(),
        );
    }
    if *cancel.borrow() {
        return Err("Stopped before caption metadata publication.".into());
    }
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&output, source).map_err(|e| e.to_string())?;
    fs::File::open(dir)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(result)
}
pub(super) async fn normalize(
    dir: &Path,
    audio: bool,
    options: &Options,
    duration: Option<f64>,
    cancel: &mut watch::Receiver<bool>,
    mut report: impl FnMut(engine::Progress),
) -> Result<Playback, String> {
    options.limits.validate()?;
    let (source, _, _) = publication::output(dir, audio)?;
    publication::regular_limited(&source, options.limits.file_bytes())?;
    super::check_work_budget(dir, &options.limits)?;
    engine::disk_space(dir, options.limits.free_bytes(), 0)?;
    let mut info = probe(&source, cancel).await?;
    if options.embed_subtitles {
        use std::io::Read;
        let path = dir.join("media.caption-languages.txt");
        let file = publication::regular(&path)
            .map_err(|_| "The subtitle-language receipt is missing; retry the download.")?;
        let mut receipt = String::new();
        file.take(513)
            .read_to_string(&mut receipt)
            .map_err(|_| "Could not read the bounded subtitle-language receipt.")?;
        if receipt.len() > 512 {
            return Err("The subtitle-language receipt exceeds its bound.".into());
        }
        let extras = info
            .embedded
            .as_mut()
            .ok_or("Subtitle streams could not be verified.")?;
        let identities = caption_languages::reconcile(
            &extras.subtitle_languages,
            &receipt,
            &options.subtitle_langs,
        )?;
        if extras.subtitle_languages != identities {
            info = label_captions(
                dir,
                &source,
                &info,
                &identities,
                &options.limits,
                cancel,
                &mut report,
            )
            .await?;
        }
    }
    info.sponsorblock = super::sponsor::report(dir, &options.sponsorblock, info.duration)?;
    if let Some(receipt) = &info.sponsorblock {
        super::sponsor::verify_markers(receipt, &info.sponsor_timeline, None, None)?;
    }
    let before = info.embedded.clone().unwrap_or_default();
    if options.embed_thumbnail && !before.artwork {
        return Err("The source did not produce embedded cover art. Turn off cover art or choose another source.".into());
    }
    if (!options.playable || info.compatible) && !options.clipped() {
        return Ok(info);
    }
    let source_ext = source.extension().and_then(|s| s.to_str()).unwrap_or("");
    let ext = if !audio {
        "mp4"
    } else if !options.playable
        && matches!(
            source_ext,
            "mp3" | "m4a" | "aac" | "wav" | "flac" | "opus" | "ogg"
        )
    {
        source_ext
    } else {
        "m4a"
    };
    let output = dir.join(format!("media.converted.{ext}"));
    if output.exists() {
        return Err(
            "A conversion output already exists. Retry explicitly to clear partial work.".into(),
        );
    }
    let exe = engine::engines().ffmpeg.ok_or("FFmpeg is missing.")?;
    let mut c = command(&exe, &source, &output, audio, options, &info)?;
    let seconds = options
        .end_seconds
        .or(info.duration)
        .or(duration)
        .map(|end| end - options.start_seconds.unwrap_or(0.0));
    engine::run_media(&mut c, dir, cancel, report, seconds, None, &options.limits).await?;
    let mut result = probe(&output, cancel).await?;
    result.sponsorblock = info.sponsorblock.clone();
    if let Some(receipt) = &result.sponsorblock {
        super::sponsor::verify_final_duration(
            receipt,
            result.duration,
            options.start_seconds,
            options.end_seconds,
        )?;
        super::sponsor::verify_markers(
            receipt,
            &result.sponsor_timeline,
            options.start_seconds,
            options.end_seconds,
        )?;
    }
    let after = result.embedded.clone().unwrap_or_default();
    if !options.clipped()
        && (before.chapters != after.chapters || info.sponsor_markers != result.sponsor_markers)
    {
        return Err(
            "Conversion did not preserve embedded chapters. The original working file was kept."
                .into(),
        );
    }
    if after.subtitles != before.subtitles
        || after.subtitle_languages != before.subtitle_languages
        || (before.artwork && audio && !after.artwork)
        || (before.title && !after.title)
    {
        return Err("Conversion did not preserve embedded subtitles, audio artwork or title. The original working file was kept.".into());
    }
    if options.playable && !result.compatible {
        return Err(
            "Conversion did not produce a compatible H.264/AAC MP4 or AAC M4A file.".into(),
        );
    }
    if let (Some(expected), Some(actual)) = (seconds, result.duration) {
        if (actual - expected).abs() > 2.0_f64.max(expected * 0.01) {
            return Err("Conversion duration is incomplete or differs from the requested range. The original working file was kept.".into());
        }
    }
    if fs::metadata(&output).map_err(|e| e.to_string())?.len() >= options.limits.file_bytes() {
        return Err(
            "Conversion reached the selected output limit. The original working file was kept."
                .into(),
        );
    }
    if *cancel.borrow() {
        return Err("Stopped before conversion publication.".into());
    }
    fs::File::open(&output)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    let final_path = dir.join(format!("media.{ext}"));
    // Atomic replacement is allowed only for this private working input, never the owner/library original.
    if final_path == source {
        fs::rename(&output, &final_path).map_err(|e| e.to_string())?;
    } else {
        fs::hard_link(&output, &final_path).map_err(|e| {
            format!("Could not publish conversion without overwriting; working original kept: {e}")
        })?;
        fs::File::open(dir)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        fs::remove_file(&source).map_err(|e| e.to_string())?;
        fs::remove_file(&output).map_err(|e| e.to_string())?;
    }
    fs::File::open(dir)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    result.container = ext.into();
    result.converted = true;
    Ok(result)
}
pub(super) fn owned_source(assets: &Path, input: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(input);
    let parent = path.parent().ok_or("Missing asset directory.")?;
    if parent != assets
        || fs::symlink_metadata(assets)
            .map_err(|e| e.to_string())?
            .is_symlink()
    {
        return Err("Playable copies require a file inside Archives Media.".into());
    }
    publication::regular(&path)?;
    Ok(path)
}

#[cfg(test)]
#[path = "playback_fixture.rs"]
mod installed_fixture;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn codec_compatibility_not_just_extension() {
        let av1 = json!({"streams":[{"codec_type":"video","codec_name":"av1","pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"opus"}]});
        assert!(!facts(&av1, "mkv").compatible);
        assert!(!facts(&av1, "mp4").compatible);
        let h264 = json!({"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2"},"streams":[{"codec_type":"video","codec_name":"h264","pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"aac"}]});
        assert!(facts(&h264, "mp4").compatible);
        assert!(!facts(&h264, "mkv").compatible);
        assert!(!facts(&json!({"streams":[]}), "mp4").compatible);
        let mut disguised = h264.clone();
        disguised["format"]["format_name"] = "matroska,webm".into();
        assert!(!facts(&disguised, "mp4").compatible);
    }
    #[test]
    fn stream_titles_and_language_identities_are_probed() {
        let p = facts(
            &json!({"streams":[{"codec_type":"audio","codec_name":"opus","tags":{"TITLE":"Stream title"}},{"codec_type":"subtitle","tags":{"language":"fre"}},{"codec_type":"subtitle","tags":{"language":"por","handler_name":"Orion caption: por-br"}}]}),
            "ogg",
        );
        let extras = p.embedded.unwrap();
        assert!(extras.title);
        assert_eq!(extras.subtitle_languages, vec!["fra", "por-br"]);
        let p = facts(
            &json!({"streams":[{"codec_type":"subtitle","tags":{"title":"Orion caption: --exec"}}]}),
            "mp4",
        );
        assert_eq!(p.embedded.unwrap().subtitle_languages, vec!["und"]);
        let p = facts(
            &json!({"streams":[{"codec_type":"subtitle","tags":{"language":"spa","handler_name":"Orion caption: eng"}}]}),
            "mp4",
        );
        assert_eq!(p.embedded.unwrap().subtitle_languages, vec!["spa"]);
        let p = facts(
            &json!({"streams":[{"codec_type":"subtitle","tags":{"language":"pt-PT","handler_name":"Orion caption: por-br"}}]}),
            "mkv",
        );
        let observed = p.embedded.unwrap().subtitle_languages;
        assert_eq!(observed, vec!["por-pt"]);
        assert!(caption_languages::reconcile(&observed, "pt-BR\n", &["pt-BR".into()]).is_err());
    }
    #[test]
    fn audio_cover_art_is_not_the_video_stream() {
        let mp3 = json!({"format":{"format_name":"mp3"},"streams":[{"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}},{"codec_type":"audio","codec_name":"mp3"}]});
        assert!(facts(&mp3, "mp3").compatible);
    }
    #[test]
    fn generated_conversion_uses_fixed_codecs_and_no_shell() {
        let info = Playback {
            compatible: false,
            container: "mkv".into(),
            video_codec: "av1".into(),
            audio_codec: "opus".into(),
            converted: false,
            sponsorblock: None,
            sponsor_markers: 0,
            sponsor_timeline: Vec::new(),
            duration: None,
            embedded: None,
        };
        let video = command(
            Path::new("/synthetic/ffmpeg"),
            Path::new("/private/media.mkv"),
            Path::new("/private/media.converted.mp4"),
            false,
            &Options::default(),
            &info,
        )
        .unwrap();
        let args: Vec<_> = video
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert!(args.contains(&"libx264".into()));
        assert!(args.contains(&"yuv420p".into()));
        assert!(args.contains(&"file,pipe".into()));
        assert!(args.contains(&"-n".into()));
        let audio = command(
            Path::new("/synthetic/ffmpeg"),
            Path::new("/private/media.m4a"),
            Path::new("/private/media.converted.m4a"),
            true,
            &Options {
                audio_quality: 10,
                ..Options::default()
            },
            &info,
        )
        .unwrap();
        let args: Vec<_> = audio
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert!(args.windows(2).any(|a| a == ["-b:a", "32k"]));
        assert!(!args.contains(&"libx264".into()));
    }
}
