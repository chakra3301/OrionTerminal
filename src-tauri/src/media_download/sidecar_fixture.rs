use super::*;
use sha2::{Digest, Sha256};
use std::{fs, process::Command};

#[tokio::test]
#[ignore = "requires the explicitly installed FFmpeg/ffprobe; generated local media only"]
async fn installed_saved_caption_sidecars_are_seekable_local_bounded_and_original_preserving() {
    let root = std::env::temp_dir().join(format!("orion-sidecars-proof-{}", ulid::Ulid::new()));
    fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            if std::env::var_os("ORION_KEEP_SIDECAR_FIXTURE").is_none() {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }
    let _cleanup = Cleanup(root.clone());
    let srt = root.join("generated.srt");
    fs::write(&srt,"1\n00:00:00,500 --> 00:00:01,500\nquasar &amp; <i>orbit</i>\n\n2\n00:00:02,000 --> 00:00:03,500\nnebula generated captions\n").unwrap();
    let chapters = root.join("chapters.txt");
    fs::write(&chapters,";FFMETADATA1\ntitle=Generated sidecar source\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=2000\ntitle=First\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=2000\nEND=4000\ntitle=Second\n").unwrap();
    let path = root.join("generated.mp4");
    let output = Command::new(engine::engines().ffmpeg.expect("installed FFmpeg"))
        .args([
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=teal:s=160x90:r=12:d=4",
            "-i",
        ])
        .arg(&srt)
        .args(["-f", "ffmetadata", "-i"])
        .arg(&chapters)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "1:s:0",
            "-map_metadata",
            "2",
            "-map_chapters",
            "2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:s",
            "mov_text",
            "-metadata:s:s:0",
            "language=por",
            "-metadata:s:s:0",
            "handler_name=Orion caption: pt-BR",
            "-t",
            "4",
            "-y",
        ])
        .arg(&path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let before = fs::read(&path).unwrap();
    let source = Source::open(&path).unwrap();
    let (_sender, mut cancel) = watch::channel(false);
    let (duration, tracks, chapters) = probe(&source, &mut cancel).await.unwrap();
    assert!((duration - 4.0).abs() < 0.1);
    assert_eq!(tracks.len(), 1);
    assert_eq!(tracks[0].index, 1);
    assert_eq!(tracks[0].language, "por-br");
    assert!(tracks[0].supported);
    assert_eq!(chapters.len(), 2);
    assert_eq!(chapters[1].title, "Second");
    let vtt = extract(&source, &tracks[0], "webvtt", duration, &mut cancel)
        .await
        .unwrap();
    let srt = extract(&source, &tracks[0], "srt", duration, &mut cancel)
        .await
        .unwrap();
    let cues = captions::parse(&vtt, Some(duration)).unwrap();
    let srt_cues = captions::parse(&srt, Some(duration)).unwrap();
    assert_eq!(cues.len(), 2);
    assert_eq!(cues[0].text, "quasar & orbit");
    assert_eq!(cues[1].text, "nebula generated captions");
    assert_eq!(
        serde_json::to_value(&cues).unwrap(),
        serde_json::to_value(&srt_cues).unwrap()
    );
    let target = root.join("saved.vtt");
    export::export_bytes(&vtt, &target).unwrap();
    assert_eq!(fs::read(&target).unwrap(), vtt);
    assert!(export::export_bytes(b"must not replace", &target).is_err());
    assert_eq!(fs::read(&target).unwrap(), vtt);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    let bad = root.join("not-media.mkv");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    fs::write(
        &bad,
        format!(
            "#EXTM3U\nhttp://{}/not-authorized\n",
            listener.local_addr().unwrap()
        ),
    )
    .unwrap();
    assert!(probe(&Source::open(&bad).unwrap(), &mut cancel)
        .await
        .is_err());
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    let (stop, mut cancelled) = watch::channel(false);
    stop.send(true).unwrap();
    assert!(
        extract(&source, &tracks[0], "webvtt", duration, &mut cancelled)
            .await
            .is_err()
    );
    source.check().unwrap();
    assert_eq!(fs::read(&path).unwrap(), before);
    let report = json!({"passed":true,"duration":duration,"tracks":tracks,"chapters":chapters,"cues":cues,"originalSha256":format!("{:x}",Sha256::digest(&before)),"originalUnchanged":true,"sequentialPinnedProbeAndVttSrtExtraction":true,"exportNoClobber0600":true,"playlistDemuxerAndNetworkRefused":true,"cancelRefusedExtraction":true,"limits":"Generated local core functions only; not native dialogs, command IPC, UI playback or whole-shell acceptance"});
    fs::write(
        root.join("report.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    if std::env::var_os("ORION_KEEP_SIDECAR_FIXTURE").is_some() {
        eprintln!("SIDECAR_PROOF={}", root.display());
    }
}
