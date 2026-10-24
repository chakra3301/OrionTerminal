use super::*;
use crate::media_download::{
    playback,
    sponsor::{Choice, Mode},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
};

fn probe_json(path: &Path) -> Value {
    let out = std::process::Command::new(engines().ffprobe.unwrap())
        .args([
            "-v",
            "error",
            "-show_chapters",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .unwrap();
    assert!(out.status.success());
    serde_json::from_slice(&out.stdout).unwrap()
}
struct Server {
    url: String,
    count: Arc<AtomicUsize>,
    status: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Server {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let count = Arc::new(AtomicUsize::new(0));
        let status = Arc::new(AtomicUsize::new(200));
        let stop = Arc::new(AtomicBool::new(false));
        let (requests, response, done) = (count.clone(), status.clone(), stop.clone());
        let thread = std::thread::spawn(move || {
            let prefix = format!("{:x}", Sha256::digest(b"abcdefghijk"));
            while !done.load(Ordering::SeqCst) {
                let (mut stream, _) = match listener.accept() {
                    Ok(s) => s,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    Err(e) => panic!("{e}"),
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut data = Vec::new();
                let mut buffer = [0; 2048];
                while !data.ends_with(b"\r\n\r\n") {
                    let n = stream.read(&mut buffer).unwrap();
                    assert!(n > 0);
                    data.extend_from_slice(&buffer[..n]);
                    assert!(data.len() < 16384);
                }
                let head = String::from_utf8(data).unwrap();
                let target = head
                    .lines()
                    .next()
                    .unwrap()
                    .split_whitespace()
                    .nth(1)
                    .unwrap();
                let request = reqwest::Url::parse(&format!("http://127.0.0.1{target}")).unwrap();
                assert_eq!(
                    request.path(),
                    format!("/api/skipSegments/{}", &prefix[..4])
                );
                let params: std::collections::HashMap<_, _> =
                    request.query_pairs().into_owned().collect();
                assert_eq!(params["service"], "YouTube");
                let categories: Vec<String> = serde_json::from_str(&params["categories"]).unwrap();
                assert_eq!(categories, vec!["sponsor"]);
                let actions: Vec<String> = serde_json::from_str(&params["actionTypes"]).unwrap();
                assert!(actions
                    .iter()
                    .all(|a| ["skip", "poi", "chapter"].contains(&a.as_str())));
                requests.fetch_add(1, Ordering::SeqCst);
                let mode = response.load(Ordering::SeqCst);
                let body = if mode == 200 {
                    json!([{"videoID":"abcdefghijk","segments":[{"segment":[2.0,4.0],"category":"sponsor","actionType":"skip","videoDuration":12.0}]}]).to_string()
                } else if mode == 201 {
                    "null".into()
                } else if mode == 202 {
                    "{}".into()
                } else if mode == 203 {
                    "false".into()
                } else if mode == 205 {
                    "0".into()
                } else if mode == 206 {
                    " ".repeat(256 * 1024 + 1)
                } else if mode == 207 {
                    json!([{"videoID":"abcdefghijk","segments":[]},{"videoID":"abcdefghijk","segments":[{"segment":[2.0,4.0],"category":"sponsor","actionType":"skip","videoDuration":12.0}]}]).to_string()
                } else {
                    "[]".into()
                };
                let code = if mode == 404 {
                    "404 Not Found"
                } else if mode == 500 {
                    "500 Internal Server Error"
                } else {
                    "200 OK"
                };
                let _=write!(stream,"HTTP/1.1 {code}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
            }
        });
        Self {
            url,
            count,
            status,
            stop,
            thread: Some(thread),
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.thread.take().unwrap().join().unwrap();
    }
}
async fn run(
    dir: &Path,
    info: &Path,
    api: &str,
    options: &policy::Options,
    preset: &Preset,
) -> Result<policy::Playback, String> {
    fs::create_dir(dir).unwrap();
    let built = configured_using(
        &engines(),
        "https://example.com/not-used",
        preset,
        options,
        dir,
        None,
        false,
    )?;
    let args: Vec<_> = built
        .as_std()
        .get_args()
        .map(|s| s.to_os_string())
        .collect();
    assert_eq!(args[args.len() - 2], "--");
    let gateway =
        crate::media_download::sponsor_gateway::Gateway::start_test(&options.sponsorblock, api)
            .await?;
    let mut c = engines().command(dir)?;
    c.args(&args[..args.len() - 2])
        .args(["--enable-file-urls", "--load-info-json"])
        .arg(info)
        .args([
            "--sponsorblock-api",
            gateway.as_ref().map_or(api, |g| g.url()),
        ]);
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
    .await?;
    if let Some(gateway) = &gateway {
        gateway.verify()?;
    }
    playback::normalize(
        dir,
        preset.audio(),
        options,
        Some(12.0),
        &mut cancel,
        |_| {},
    )
    .await
}
#[tokio::test]
#[ignore = "installed engines; generated local media and synthetic loopback SponsorBlock API only; no Internet or credentials"]
async fn installed_sponsor_lookup_marks_cuts_and_preserves_playable_timeline() {
    let root = std::env::temp_dir().join(format!("orion-sponsor-proof-{}", ulid::Ulid::new()));
    fs::create_dir(&root).unwrap();
    let source = root.join("generated.mkv");
    let out = std::process::Command::new(engines().ffmpeg.unwrap())
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=160x90:r=10:d=12",
            "-f",
            "lavfi",
            "-i",
            "sine=f=440:d=12",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-g",
            "1",
            "-c:a",
            "libopus",
            "-shortest",
        ])
        .arg(&source)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let before = fs::read(&source).unwrap();
    let info = root.join("info.json");
    let data = json!({"id":"abcdefghijk","extractor_key":"Youtube","title":"Generated SponsorBlock proof","duration":12.0,"ext":"mkv","format_id":"combined","url":reqwest::Url::from_file_path(&source).unwrap().to_string(),"vcodec":"h264","acodec":"opus","height":90,"width":160,"chapters":[{"start_time":0,"end_time":6,"title":"First half"},{"start_time":6,"end_time":12,"title":"Second half"}]});
    assert!(data.get("webpage_url").is_none());
    assert!(data["url"].as_str().unwrap().starts_with("file:"));
    fs::write(&info, serde_json::to_vec(&data).unwrap()).unwrap();
    let server = Server::new();
    let mut options = policy::Options::default();
    let off = run(
        &root.join("off"),
        &info,
        &server.url,
        &options,
        &Preset::Video1080,
    )
    .await
    .unwrap();
    assert!(off.compatible);
    assert!(off.sponsorblock.is_none());
    assert_eq!(server.count.load(Ordering::SeqCst), 0);
    options.sponsorblock = Choice {
        mode: Mode::Mark,
        categories: vec!["sponsor".into()],
    };
    let marked = run(
        &root.join("mark"),
        &info,
        &server.url,
        &options,
        &Preset::Video1080,
    )
    .await
    .unwrap();
    assert!(marked.compatible);
    assert!(marked.sponsor_markers > 0);
    assert!((marked.duration.unwrap() - 12.0).abs() < 0.2);
    assert_eq!(marked.sponsorblock.as_ref().unwrap().segments, 1);
    options.start_seconds = Some(1.0);
    options.end_seconds = Some(6.0);
    let clipped = run(
        &root.join("mark-clip"),
        &info,
        &server.url,
        &options,
        &Preset::Video1080,
    )
    .await
    .unwrap();
    assert!((clipped.duration.unwrap() - 5.0).abs() < 0.2);
    assert!(clipped.sponsor_markers > 0);
    let clipped_probe = probe_json(&root.join("mark-clip/media.mp4"));
    let marker = clipped_probe["chapters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["tags"]["title"]
                .as_str()
                .is_some_and(|s| s.starts_with("[SponsorBlock]:"))
        })
        .unwrap();
    assert!(
        (marker["start_time"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap()
            - 1.0)
            .abs()
            < 0.1
    );
    assert!((marker["end_time"].as_str().unwrap().parse::<f64>().unwrap() - 3.0).abs() < 0.1);
    options.start_seconds = None;
    options.end_seconds = None;
    options.sponsorblock.mode = Mode::Remove;
    let removed = run(
        &root.join("remove"),
        &info,
        &server.url,
        &options,
        &Preset::Video1080,
    )
    .await
    .unwrap();
    assert!(removed.compatible);
    assert!((removed.duration.unwrap() - 10.0).abs() < 0.2);
    assert_eq!(
        removed.sponsorblock.as_ref().unwrap().processed_duration,
        10.0
    );
    let remove_probe = probe_json(&root.join("remove/media.mp4"));
    assert!(remove_probe["chapters"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| (c["start_time"].as_str().unwrap().parse::<f64>().unwrap() - 4.0).abs() < 0.1));
    let audio = run(
        &root.join("remove-audio"),
        &info,
        &server.url,
        &options,
        &Preset::AudioMp3,
    )
    .await
    .unwrap();
    assert!(audio.compatible);
    assert!((audio.duration.unwrap() - 10.0).abs() < 0.2);
    server.status.store(204, Ordering::SeqCst);
    let empty = run(
        &root.join("empty"),
        &info,
        &server.url,
        &options,
        &Preset::Video1080,
    )
    .await
    .unwrap();
    assert_eq!(empty.sponsorblock.as_ref().unwrap().segments, 0);
    assert!((empty.duration.unwrap() - 12.0).abs() < 0.2);
    server.status.store(404, Ordering::SeqCst);
    let missing = run(
        &root.join("missing"),
        &info,
        &server.url,
        &options,
        &Preset::Video1080,
    )
    .await
    .unwrap();
    assert_eq!(missing.sponsorblock.as_ref().unwrap().segments, 0);
    server.status.store(500, Ordering::SeqCst);
    assert!(run(
        &root.join("lookup-failure"),
        &info,
        &server.url,
        &options,
        &Preset::Video1080
    )
    .await
    .is_err());
    for mode in [201, 202, 203, 205, 206, 207] {
        server.status.store(mode, Ordering::SeqCst);
        assert!(run(
            &root.join(format!("invalid-{mode}")),
            &info,
            &server.url,
            &options,
            &Preset::Video1080
        )
        .await
        .is_err());
    }
    let queries = server.count.load(Ordering::SeqCst);
    let mut unsupported = data.clone();
    unsupported["extractor_key"] = json!("Generic");
    let other = root.join("unsupported.json");
    fs::write(&other, serde_json::to_vec(&unsupported).unwrap()).unwrap();
    assert!(run(
        &root.join("unsupported"),
        &other,
        &server.url,
        &options,
        &Preset::Video1080
    )
    .await
    .unwrap_err()
    .contains("lookup"));
    assert_eq!(server.count.load(Ordering::SeqCst), queries);
    assert_eq!(fs::read(&source).unwrap(), before);
    let report = json!({"off":off,"marked":marked,"clipped":clipped,"removed":removed,"audio":audio,"empty":empty,"notFound":missing,"lookupRequests":queries,"malformedResponsesRefused":["null","object","false","zero","over256KiB","duplicateVideoRows"],"lookupFailureRefused":true,"unsupportedExtractorRefusedWithoutLookup":true,"nativeGateway":true,"originalUnchanged":true,"realSite":false,"credentials":false,"loopbackOnlyByConstruction":true,"networkSandbox":false});
    fs::write(
        root.join("report.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    drop(server);
    if std::env::var_os("ORION_KEEP_SPONSOR_FIXTURE").is_some() {
        eprintln!("SponsorBlock generated proof: {}", root.display());
    } else {
        fs::remove_dir_all(root).unwrap();
    }
}
