use super::*;
use std::time::Duration;

#[tokio::test]
#[ignore = "requires explicitly installed FFmpeg/ffprobe; produces only agent-owned synthetic media"]
async fn av1_opus_master_becomes_verified_playable_mp4_without_modifying_original() {
    let e = engine::engines();
    let root = if let Some(path) = std::env::var_os("ORION_MEDIA_PROOF_DIR") {
        PathBuf::from(path)
    } else {
        std::env::temp_dir().join(format!("orion-av1-proof-{}", ulid::Ulid::new()))
    };
    fs::create_dir(&root).unwrap();
    let work = root.join("work");
    fs::create_dir(&work).unwrap();
    let original = root.join("original.mkv");
    let output = Command::new(e.ffmpeg.as_ref().unwrap())
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-n",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=256x144:rate=12",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "3",
            "-c:v",
            "libaom-av1",
            "-cpu-used",
            "8",
            "-threads",
            "2",
            "-crf",
            "38",
            "-c:a",
            "libopus",
        ])
        .arg(&original)
        .output()
        .await
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let original_bytes = fs::read(&original).unwrap();
    publication::publish_file(&original, &work.join("media.mkv")).unwrap();
    let (_send, mut cancel) = watch::channel(false);
    let info = probe(&original, &mut cancel).await.unwrap();
    assert_eq!(info.video_codec, "av1");
    assert_eq!(info.audio_codec, "opus");
    assert!(!info.compatible);
    let options = Options {
        start_seconds: Some(1.0),
        end_seconds: Some(2.5),
        ..Options::default()
    };
    let mut fractions = Vec::new();
    let result = tokio::time::timeout(
        Duration::from_secs(45),
        normalize(&work, false, &options, Some(3.0), &mut cancel, |p| {
            if let Some(f) = p.fraction {
                fractions.push(f);
            }
        }),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(result.compatible && result.converted);
    assert_eq!(result.video_codec, "h264");
    assert_eq!(result.audio_codec, "aac");
    assert!(result.duration.unwrap() >= 1.4 && result.duration.unwrap() <= 1.8);
    assert_eq!(fs::read(&original).unwrap(), original_bytes);
    assert!(work.join("media.mp4").exists());
    assert!(!fractions.is_empty());
    let same = root.join("same-container");
    fs::create_dir(&same).unwrap();
    let converted_bytes = fs::read(work.join("media.mp4")).unwrap();
    publication::publish_file(&work.join("media.mp4"), &same.join("media.mp4")).unwrap();
    let clipped = normalize(
        &same,
        false,
        &Options {
            start_seconds: Some(0.25),
            end_seconds: Some(1.25),
            ..Options::default()
        },
        Some(1.5),
        &mut cancel,
        |_| {},
    )
    .await
    .unwrap();
    assert!(clipped.compatible && clipped.converted);
    assert!((clipped.duration.unwrap() - 1.0).abs() < 0.2);
    assert_eq!(fs::read(work.join("media.mp4")).unwrap(), converted_bytes);
    assert!(same.join("media.mp4").exists());
    assert!(!same.join("media.converted.mp4").exists());
    if std::env::var_os("ORION_MEDIA_PROOF_DIR").is_none() {
        fs::remove_dir_all(root).unwrap();
    }
}
