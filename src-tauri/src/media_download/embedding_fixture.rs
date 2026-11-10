use super::super::{playback, publication};
use super::*;
use serde_json::json;
use std::{collections::BTreeMap, fs};

async fn ffmpeg(args: &[&str], output: &Path) {
    let result = Command::new(engines().ffmpeg.unwrap())
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-n"])
        .args(args)
        .arg(output)
        .output()
        .await
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}
async fn probe_json(path: &Path) -> serde_json::Value {
    let out = Command::new(engines().ffprobe.unwrap())
        .args([
            "-v",
            "error",
            "-show_streams",
            "-show_chapters",
            "-show_format",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .await
        .unwrap();
    assert!(out.status.success());
    serde_json::from_slice(&out.stdout).unwrap()
}
fn file_url(path: &Path) -> String {
    reqwest::Url::from_file_path(path).unwrap().to_string()
}

// Only this generated fixture enables file URLs and replaces URL extraction with immutable local JSON.
// The options, postprocessors and final normalization are the production implementation.
async fn download_fixture(dir: &Path, info: &Path, preset: &Preset, options: &policy::Options) {
    fs::create_dir(dir).unwrap();
    let production = configured_using(
        &engines(),
        "https://example.com/fixture",
        preset,
        options,
        dir,
        None,
        false,
    )
    .unwrap();
    let args: Vec<_> = production
        .as_std()
        .get_args()
        .map(|s| s.to_os_string())
        .collect();
    let mut c = engines().command(dir).unwrap();
    c.args(&args[..args.len() - 2])
        .args(["--enable-file-urls", "--load-info-json"])
        .arg(info);
    let (_send, mut cancel) = watch::channel(false);
    run_media(
        &mut c,
        dir,
        &mut cancel,
        |_| {},
        None,
        None,
        &options.limits,
    )
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "requires installed engines; generated local media/metadata/captions/artwork only, no network or credentials"]
async fn installed_embedding_survives_conversion_and_audio_clipping() {
    let root = std::env::temp_dir().join(format!("orion-embedding-proof-{}", ulid::Ulid::new()));
    fs::create_dir(&root).unwrap();
    let source = root.join("source.mkv");
    ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=256x144:r=12",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "4",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "libopus",
        ],
        &source,
    )
    .await;
    let art = root.join("cover.jpg");
    ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=160x160",
            "-frames:v",
            "1",
        ],
        &art,
    )
    .await;
    let manual = root.join("manual.vtt");
    let automatic = root.join("automatic.vtt");
    fs::write(
        &manual,
        "WEBVTT\n\n00:00.250 --> 00:01.500\nManual caption takes priority\n",
    )
    .unwrap();
    fs::write(
        &automatic,
        "WEBVTT\n\n00:01.750 --> 00:03.500\nAutomatic fallback caption\n",
    )
    .unwrap();
    let mut info = json!({"id":"embedding-fixture", "title":"Embedding proof title", "uploader":"Synthetic creator", "extractor":"fixture", "extractor_key":"Fixture", "webpage_url":"https://example.com/fixture", "duration":4,
        "formats":[{"format_id":"fixture", "url":file_url(&source), "ext":"mkv", "vcodec":"h264", "acodec":"opus", "height":144}],
        "subtitles":{"en":[{"url":file_url(&manual),"ext":"vtt"}]},
        "automatic_captions":{"en":[{"url":file_url(&automatic),"ext":"vtt"}]},
        "thumbnail":file_url(&art), "thumbnails":[{"url":file_url(&art),"ext":"jpg"}],
        "chapters":[{"title":"Opening", "start_time":0,"end_time":2},{"title":"Ending", "start_time":2,"end_time":4}]});
    let info_path = root.join("fixture.json");
    fs::write(&info_path, serde_json::to_vec(&info).unwrap()).unwrap();
    let originals: BTreeMap<_, _> = [&source, &art, &manual, &automatic]
        .into_iter()
        .map(|p| (p.clone(), fs::read(p).unwrap()))
        .collect();
    let (_send, mut cancel) = watch::channel(false);
    let mut report = Vec::new();
    for (name, auto_only, lang, identity, playable) in [
        ("manual-priority", false, "en", "eng", true),
        ("automatic-fallback", true, "en", "eng", true),
        ("regional-language", false, "pt-BR", "por-br", true),
        ("three-letter-filipino", false, "fil", "fil", true),
        ("three-letter-slovak", false, "slo", "slk", true),
        ("regional-original-codecs", false, "pt-BR", "por-br", false),
    ] {
        info["subtitles"] = if auto_only {
            json!({})
        } else {
            json!({(lang):[{"url":file_url(&manual),"ext":"vtt"}]})
        };
        fs::write(&info_path, serde_json::to_vec(&info).unwrap()).unwrap();
        let dir = root.join(name);
        let options = policy::Options {
            playable,
            embed_metadata: true,
            embed_chapters: true,
            embed_subtitles: true,
            automatic_subtitles: true,
            subtitle_langs: vec![lang.into()],
            ..Default::default()
        };
        download_fixture(&dir, &info_path, &Preset::VideoCombined, &options).await;
        let result = playback::normalize(&dir, false, &options, Some(4.0), &mut cancel, |_| {})
            .await
            .unwrap();
        let extras = result.embedded.as_ref().unwrap();
        assert!(extras.title);
        assert_eq!(result.converted, playable);
        assert_eq!(result.compatible, playable);
        assert_eq!(extras.subtitle_languages, vec![identity]);
        assert_eq!(extras.subtitles, 1);
        assert_eq!(extras.chapters, 2);
        let final_path = dir.join(if playable { "media.mp4" } else { "media.mkv" });
        let facts = probe_json(&final_path).await;
        let reprobe = playback::facts(&facts, if playable { "mp4" } else { "mkv" });
        assert_eq!(
            reprobe.embedded.as_ref().unwrap().subtitle_languages,
            extras.subtitle_languages
        );
        assert_eq!(facts["format"]["tags"]["title"], "Embedding proof title");
        assert_eq!(facts["chapters"][1]["tags"]["title"], "Ending");
        let captions = Command::new(engines().ffmpeg.unwrap())
            .args(["-v", "error", "-i"])
            .arg(&final_path)
            .args(["-map", "0:s:0", "-f", "srt", "-"])
            .output()
            .await
            .unwrap();
        assert!(captions.status.success());
        let text = String::from_utf8_lossy(&captions.stdout);
        assert!(
            text.contains(if auto_only {
                "Automatic fallback"
            } else {
                "Manual caption"
            }),
            "{text}"
        );
        assert!(!fs::read_dir(&dir).unwrap().any(|e| e
            .unwrap()
            .path()
            .extension()
            .is_some_and(|e| e == "vtt")));
        publication::validate_output(&dir, false).unwrap();
        report.push(json!({"case":name,"options":options,"playback":result,"probe":facts,"captions":text,"noCaptionSidecar":true}));
    }
    for preset in [Preset::AudioMp3, Preset::AudioM4a, Preset::AudioFlac] {
        let name = serde_json::to_value(&preset)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned();
        let dir = root.join(&name);
        let options = policy::Options {
            playable: false,
            embed_metadata: true,
            embed_thumbnail: true,
            start_seconds: Some(0.5),
            end_seconds: Some(3.0),
            ..Default::default()
        };
        download_fixture(&dir, &info_path, &preset, &options).await;
        let result = playback::normalize(&dir, true, &options, Some(4.0), &mut cancel, |_| {})
            .await
            .unwrap();
        let extras = result.embedded.as_ref().unwrap();
        assert!(extras.artwork && extras.title && result.converted);
        assert!((result.duration.unwrap() - 2.5).abs() < 0.15);
        publication::validate_output(&dir, true).unwrap();
        let (path, _, _) = publication::output(&dir, true).unwrap();
        let original = fs::read(&path).unwrap();
        super::super::poster::create_audio(&dir, &mut cancel)
            .await
            .unwrap();
        let poster = dir.join("media.poster.jpg");
        assert!(poster.exists());
        let art = probe_json(&poster).await;
        assert_eq!(art["streams"][0]["codec_name"], "mjpeg");
        assert!(art["streams"][0]["width"].as_u64().unwrap() <= 320);
        assert_eq!(fs::read(&path).unwrap(), original);
        report.push(json!({"case":name,"options":options,"playback":result,"probe":probe_json(&path).await,"localCoverPoster":art,"sourceUnchanged":true}));
    }
    for (name, codec) in [
        ("opus-stream-title", "libopus"),
        ("vorbis-stream-title", "libvorbis"),
    ] {
        let dir = root.join(name);
        fs::create_dir(&dir).unwrap();
        let input = dir.join("media.ogg");
        ffmpeg(
            &[
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-t",
                "2",
                "-c:a",
                codec,
                "-metadata",
                "title=Stream title proof",
                "-metadata",
                "artist=Stream artist proof",
            ],
            &input,
        )
        .await;
        let before = probe_json(&input).await;
        assert!(playback::facts(&before, "ogg").embedded.unwrap().title);
        let options = policy::Options {
            embed_metadata: true,
            ..Default::default()
        };
        let result = playback::normalize(&dir, true, &options, Some(2.0), &mut cancel, |_| {})
            .await
            .unwrap();
        assert!(result.compatible && result.converted && result.embedded.as_ref().unwrap().title);
        let after = probe_json(&dir.join("media.m4a")).await;
        assert_eq!(after["format"]["tags"]["title"], "Stream title proof");
        assert_eq!(after["format"]["tags"]["artist"], "Stream artist proof");
        report.push(json!({"case":name,"before":before,"playback":result,"probe":after}));
    }
    for (name, language, request) in [
        ("existing-spanish", "spa", "en"),
        ("existing-nauru", "nau", "na"),
    ] {
        let spanish = root.join(format!("{name}.mkv"));
        let source_string = source.to_str().unwrap();
        let manual_string = manual.to_str().unwrap();
        ffmpeg(
            &[
                "-i",
                source_string,
                "-i",
                manual_string,
                "-map",
                "0:v",
                "-map",
                "0:a",
                "-map",
                "1:s",
                "-c",
                "copy",
                "-c:s",
                "webvtt",
                "-metadata:s:s:0",
                &format!("language={language}"),
            ],
            &spanish,
        )
        .await;
        let spanish_bytes = fs::read(&spanish).unwrap();
        info["formats"][0]["url"] = file_url(&spanish).into();
        info["subtitles"] = json!({});
        info["automatic_captions"] = json!({});
        fs::write(&info_path, serde_json::to_vec(&info).unwrap()).unwrap();
        let case = format!("missing-{request}-with-{name}");
        let dir = root.join(&case);
        let options = policy::Options {
            embed_subtitles: true,
            subtitle_langs: vec![request.into()],
            ..Default::default()
        };
        download_fixture(&dir, &info_path, &Preset::VideoCombined, &options).await;
        let error = playback::normalize(&dir, false, &options, Some(4.0), &mut cancel, |_| {})
            .await
            .unwrap_err();
        assert!(error.contains("Requested subtitle languages"), "{error}");
        assert!(!dir.join("media.mp4").exists());
        assert_eq!(fs::read(&spanish).unwrap(), spanish_bytes);
        report.push(json!({"case":case,"refused":error,"sourceByteIdentical":true}));
    }
    info["formats"][0]["url"] = file_url(&source).into();
    fs::write(&info_path, serde_json::to_vec(&info).unwrap()).unwrap();
    let dir = root.join("clipped-chapters");
    let options = policy::Options {
        embed_metadata: true,
        embed_chapters: true,
        start_seconds: Some(1.0),
        end_seconds: Some(3.0),
        ..Default::default()
    };
    download_fixture(&dir, &info_path, &Preset::VideoCombined, &options).await;
    let result = playback::normalize(&dir, false, &options, Some(4.0), &mut cancel, |_| {})
        .await
        .unwrap();
    assert_eq!(result.embedded.as_ref().unwrap().chapters, 2);
    let data = probe_json(&dir.join("media.mp4")).await;
    let chapters = data["chapters"].as_array().unwrap();
    for (chapter, (start, end)) in chapters.iter().zip([(0.0, 1.0), (1.0, 2.0)]) {
        let actual_start = chapter["start_time"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap();
        let actual_end = chapter["end_time"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap();
        assert!(
            (actual_start - start).abs() < 0.01 && (actual_end - end).abs() < 0.01,
            "{chapter}"
        );
    }
    report
        .push(json!({"case":"clipped-chapters","options":options,"playback":result,"probe":data}));
    for (path, bytes) in originals {
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    if std::env::var_os("ORION_KEEP_EMBEDDING_FIXTURE").is_some() {
        fs::write(root.join("report.json"),serde_json::to_vec_pretty(&json!({"cases":report,"sourcesByteIdentical":true,"realNetwork":false,"credentials":false,"source":"generated local lavfi, captions, cover and extractor JSON; file URLs enabled in test only"})).unwrap()).unwrap();
        println!("Retained generated embedding fixture: {}", root.display());
    } else {
        fs::remove_dir_all(root).unwrap();
    }
}
