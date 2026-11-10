use super::*;
use tokio::io::AsyncWriteExt;

// This deliberately bypasses only the public-source gate for agent-owned loopback bytes.
// Production commands still reject loopback. No accounts, providers or public videos are used.
#[tokio::test]
#[ignore = "requires explicitly installed external media engines"]
async fn installed_engines_download_synthetic_video_and_extract_audio() {
    let e = engines();
    let root = std::env::temp_dir().join(format!("orion-media-engine-proof-{}", ulid::Ulid::new()));
    std::fs::create_dir(&root).unwrap();
    let source = root.join("fixture.mp4");
    let generated = Command::new(e.ffmpeg.as_ref().expect("FFmpeg installed"))
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-n",
            "-f",
            "lavfi",
            "-i",
            "color=c=green:s=128x72:r=12",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=22050",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
        ])
        .arg(&source)
        .output()
        .await
        .unwrap();
    assert!(
        generated.status.success(),
        "{}",
        String::from_utf8_lossy(&generated.stderr)
    );
    let bytes = std::sync::Arc::new(std::fs::read(&source).unwrap());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/fixture.mp4", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let bytes = bytes.clone();
            tokio::spawn(async move {
                let mut request = [0u8; 8192];
                let count = socket.read(&mut request).await.unwrap_or(0);
                let header = format!("HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",bytes.len());
                let _ = socket.write_all(header.as_bytes()).await;
                if !request[..count].starts_with(b"HEAD ") {
                    let _ = socket.write_all(&bytes).await;
                }
                let _ = socket.shutdown().await;
            });
        }
    });
    let inspect_dir = root.join("inspect");
    std::fs::create_dir(&inspect_dir).unwrap();
    let mut command = e.command(&inspect_dir).unwrap();
    command.args(["--dump-single-json", "--skip-download", "--", &url]);
    let (_send, mut cancel) = watch::channel(false);
    let result = collect(&mut command, 4 * 1024 * 1024, &mut cancel)
        .await
        .unwrap();
    let metadata = policy::metadata(
        &serde_json::from_slice(&result).unwrap(),
        "https://example.com/fixture.mp4",
    )
    .unwrap();
    assert!(!metadata.title.is_empty());
    for (name, preset, expected) in [
        ("video", Preset::Video720, "media.mp4"),
        ("audio", Preset::AudioMp3, "media.mp3"),
    ] {
        let dir = root.join(name);
        std::fs::create_dir(&dir).unwrap();
        let mut command = download_command(&url, &preset, &dir).unwrap();
        let stdout = collect(&mut command, 2 * 1024 * 1024, &mut cancel)
            .await
            .unwrap();
        assert!(
            dir.join(expected).is_file(),
            "{}",
            String::from_utf8_lossy(&stdout)
        );
        assert!(std::fs::metadata(dir.join(expected)).unwrap().len() > 100);
        super::super::publication::validate_output(&dir, preset.audio()).unwrap();
        let probe = Command::new(e.ffprobe.as_ref().unwrap())
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "json",
            ])
            .arg(dir.join(expected))
            .output()
            .await
            .unwrap();
        assert!(probe.status.success());
        let value: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
        let streams = value["streams"].as_array().unwrap();
        assert!(streams.iter().any(|s| s["codec_type"] == "audio"));
        assert_eq!(
            streams.iter().any(|s| s["codec_type"] == "video"),
            !preset.audio()
        );
    }
    server.abort();
    let _ = server.await;
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "requires explicitly installed external media engines; agent-owned loopback range fixture"]
async fn installed_transfer_pause_reaps_and_resume_requests_retained_byte_range() {
    let e = engines();
    let root = std::env::temp_dir().join(format!("orion-media-resume-proof-{}", ulid::Ulid::new()));
    std::fs::create_dir(&root).unwrap();
    let source = root.join("fixture.mp4");
    let generated = Command::new(e.ffmpeg.as_ref().unwrap())
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-n",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=640x360:r=30",
            "-t",
            "3",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "10",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
        ])
        .arg(&source)
        .output()
        .await
        .unwrap();
    assert!(generated.status.success());
    let bytes = std::sync::Arc::new(std::fs::read(&source).unwrap());
    assert!(bytes.len() > 128 * 1024);
    let ranges = std::sync::Arc::new(parking_lot::Mutex::new(Vec::<usize>::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/fixture.mp4", listener.local_addr().unwrap());
    let served = bytes.clone();
    let observed = ranges.clone();
    let server = tokio::spawn(async move {
        let mut handlers = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                result=listener.accept()=>{
                    let (mut socket,_)=result.unwrap();let bytes=served.clone();let ranges=observed.clone();
                    handlers.spawn(async move {
                        let mut request=Vec::new();let mut chunk=[0u8;1024];
                        while request.len()<8192 && !request.windows(4).any(|w|w==b"\r\n\r\n") { let n=socket.read(&mut chunk).await.unwrap_or(0);if n==0{return;}request.extend_from_slice(&chunk[..n]); }
                        let text=String::from_utf8_lossy(&request); let range=text.lines().find_map(|line|line.to_ascii_lowercase().strip_prefix("range: bytes=").map(str::to_owned)).and_then(|r|r.split('-').next()?.parse::<usize>().ok());
                        let start=range.unwrap_or(0).min(bytes.len()); if let Some(start)=range {ranges.lock().push(start);}
                        let header=if range.is_some() {format!("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {}-{}/{}\r\n",start,bytes.len()-1,bytes.len())}else{"HTTP/1.1 200 OK\r\n".into()};
                        let header=format!("{header}Content-Type: video/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",bytes.len()-start);
                        if socket.write_all(header.as_bytes()).await.is_err(){return;}
                        if !request.starts_with(b"HEAD ") {for chunk in bytes[start..].chunks(8192) {if socket.write_all(chunk).await.is_err(){return;}tokio::time::sleep(Duration::from_millis(5)).await;}}
                        let _=socket.shutdown().await;
                    });
                },
                _=handlers.join_next(),if !handlers.is_empty()=>{}
            }
        }
    });
    let dir = root.join("transfer");
    std::fs::create_dir(&dir).unwrap();
    let options = policy::Options {
        rate_limit_kib: Some(256),
        ..policy::Options::default()
    };
    let mut command = configured_using(
        &e,
        &url,
        &Preset::VideoCombined,
        &options,
        &dir,
        None,
        false,
    )
    .unwrap();
    let (send, mut cancel) = watch::channel(false);
    let report = |p: Progress| {
        if !p.processing && p.downloaded.is_some_and(|n| n >= 32.0 * 1024.0) {
            let _ = send.send(true);
        }
    };
    let stopped = run_media(
        &mut command,
        &dir,
        &mut cancel,
        report,
        None,
        None,
        &options.limits,
    )
    .await;
    assert_eq!(stopped.unwrap_err(), STOPPED);
    let partial = std::fs::metadata(dir.join("media.mp4.part")).unwrap().len() as usize;
    assert!(partial > 0 && partial < bytes.len());
    assert!(!dir.join("media.mp4").exists());
    let (_send, mut cancel) = watch::channel(false);
    let mut command =
        configured_using(&e, &url, &Preset::VideoCombined, &options, &dir, None, true).unwrap();
    run_media(
        &mut command,
        &dir,
        &mut cancel,
        |_| {},
        None,
        None,
        &options.limits,
    )
    .await
    .unwrap();
    assert!(
        ranges
            .lock()
            .iter()
            .any(|start| *start >= partial && *start > 0),
        "resume must request retained bytes rather than silently restarting"
    );
    assert_eq!(std::fs::read(dir.join("media.mp4")).unwrap(), *bytes);
    assert_eq!(std::fs::read(&source).unwrap(), *bytes);
    super::super::publication::validate_output(&dir, false).unwrap();
    server.abort();
    let _ = server.await;
    std::fs::remove_dir_all(root).unwrap();
}
