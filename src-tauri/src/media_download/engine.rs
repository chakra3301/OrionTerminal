use super::policy::{self, Metadata, Preset};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::watch,
};

const STOPPED: &str = "Stopped. Partial files are retained until Retry or Remove.";
pub(super) async fn cancelled(cancel: &mut watch::Receiver<bool>) {
    if *cancel.borrow() {
        return;
    }
    let _ = cancel.changed().await;
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Engines {
    pub yt_dlp: Option<PathBuf>,
    pub ffmpeg: Option<PathBuf>,
    pub ffprobe: Option<PathBuf>,
    pub node: Option<PathBuf>,
}
fn executable(path: &Path) -> bool {
    let Ok(m) = std::fs::metadata(path) else {
        return false;
    };
    if !m.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        m.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}
fn locate(name: &str) -> Option<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ];
    if name == "yt-dlp" {
        if let Some(home) = std::env::var_os("HOME") {
            dirs.insert(
                0,
                PathBuf::from(home).join(".local/share/orion-tools/media-downloader/bin"),
            );
        }
    }
    dirs.into_iter()
        .map(|d| d.join(name))
        .find(|p| executable(p))
}
pub fn engines() -> Engines {
    Engines {
        yt_dlp: locate("yt-dlp"),
        ffmpeg: locate("ffmpeg"),
        ffprobe: locate("ffprobe"),
        node: locate("node"),
    }
}
impl Engines {
    fn command(&self, dir: &Path) -> Result<Command, String> {
        let mut c = Command::new(
            self.yt_dlp
                .as_ref()
                .ok_or("yt-dlp is missing. See engine setup.")?,
        );
        let ff = self
            .ffmpeg
            .as_ref()
            .ok_or("FFmpeg is missing. See engine setup.")?;
        let probe = self
            .ffprobe
            .as_ref()
            .ok_or("ffprobe is missing. See engine setup.")?;
        if ff.parent() != probe.parent() {
            return Err("FFmpeg and ffprobe must be installed together.".into());
        }
        let node = self
            .node
            .as_ref()
            .ok_or("Node.js is missing. See engine setup.")?;
        c.env_clear()
            .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
            .env("HOME", dir)
            .env("TMPDIR", dir)
            .env("LANG", "en_US.UTF-8")
            .env("PYTHONNOUSERSITE", "1")
            .current_dir(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        c.args([
            "--ignore-config",
            "--no-plugin-dirs",
            "--no-remote-components",
            "--no-update",
            "--no-cache-dir",
            "--no-playlist",
            "--no-js-runtimes",
            "--js-runtimes",
            &format!("node:{}", node.display()),
            "--ffmpeg-location",
            &ff.parent().unwrap().to_string_lossy(),
            "--socket-timeout",
            "20",
            "--retries",
            "2",
            "--fragment-retries",
            "2",
            "--extractor-retries",
            "2",
            "--no-colors",
        ]);
        Ok(c)
    }
}
async fn public_source(source: &str) -> Result<(), String> {
    let url = policy::url(source)?;
    let host = url.host_str().unwrap();
    let addrs = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::net::lookup_host((host, url.port_or_known_default().unwrap())),
    )
    .await
    .map_err(|_| "Hostname lookup timed out.")?
    .map_err(|_| "Could not resolve the source hostname.")?;
    let addresses: Vec<_> = addrs.collect();
    if addresses.is_empty() || addresses.iter().any(|a| !policy::public_ip(a.ip())) {
        return Err("Private-network sources are not supported.".into());
    }
    Ok(())
}
async fn bounded(mut reader: impl AsyncRead + Unpin, cap: usize) -> Result<Vec<u8>, String> {
    let mut result = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let n = reader
            .read(&mut chunk)
            .await
            .map_err(|_| "Could not read downloader output.")?;
        if n == 0 {
            break;
        }
        if result.len() + n > cap {
            return Err("Downloader output exceeded its safety limit.".into());
        }
        result.extend_from_slice(&chunk[..n]);
    }
    Ok(result)
}
fn failure(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let line = text.lines().rev().find(|s| s.contains("ERROR:")).unwrap_or(
        "Download failed. The source may be unavailable or the engine may need updating.",
    );
    line.chars().filter(|c| !c.is_control()).take(600).collect()
}
pub(super) async fn collect(
    command: &mut Command,
    cap: usize,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Vec<u8>, String> {
    collect_authorized(command, cap, cancel, None).await
}
async fn collect_authorized(
    command: &mut Command,
    cap: usize,
    cancel: &mut watch::Receiver<bool>,
    access: Option<&super::auth::Access>,
) -> Result<Vec<u8>, String> {
    if *cancel.borrow() {
        return Err(STOPPED.into());
    }
    let (mut child, mut group) =
        crate::process_group::spawn(command).map_err(|_| "Could not start yt-dlp.")?;
    let out = child
        .stdout
        .take()
        .ok_or("Downloader output unavailable.")?;
    let err = child
        .stderr
        .take()
        .ok_or("Downloader diagnostics unavailable.")?;
    let result = tokio::select! {
        biased;
        _ = cancelled(cancel) => Err(STOPPED.into()),
        _ = tokio::time::sleep(Duration::from_secs(90)) => Err("Inspection timed out. Retry explicitly.".into()),
        result = async { tokio::try_join!(bounded(out, cap), bounded(err, 64 * 1024)) } => result,
        result = super::auth::budget(access) => Err(result.unwrap_err()),
    };
    let status = if result.is_ok() {
        match tokio::time::timeout(Duration::from_secs(5), child.wait()).await {
            Ok(status) => {
                group.disarm();
                status
            }
            Err(_) => {
                group.terminate();
                child.wait().await
            }
        }
    } else {
        group.terminate();
        child.wait().await
    };
    let status = status.map_err(|_| "Could not await downloader exit.")?;
    let (stdout, stderr) = result?;
    if !status.success() {
        return Err(failure(&stderr));
    }
    Ok(stdout)
}
pub async fn inspect(
    source: &str,
    dir: &Path,
    cancel: &mut watch::Receiver<bool>,
    access: Option<&super::auth::Access>,
) -> Result<Metadata, String> {
    tokio::select! { biased; _ = cancelled(cancel) => return Err(STOPPED.into()), result = public_source(source) => result? };
    let mut command = engines().command(dir)?;
    command.args(["--dump-single-json", "--skip-download"]);
    if let Some(access) = access {
        access.apply(&mut command);
    }
    command.args(["--", source]);
    let result = collect_authorized(&mut command, 4 * 1024 * 1024, cancel, access).await;
    let bytes = super::auth::redact(result, access.is_some(), *cancel.borrow())?;
    let value = serde_json::from_slice(&bytes)
        .map_err(|_| "The engine returned invalid media metadata.")?;
    let metadata = policy::metadata(&value, source)?;
    super::thumbnails::inspect(dir, &value, cancel).await;
    Ok(metadata)
}

pub(super) async fn playlist(
    source: &str,
    dir: &Path,
    cancel: &mut watch::Receiver<bool>,
) -> Result<serde_json::Value, String> {
    tokio::select! { biased; _ = cancelled(cancel) => return Err(STOPPED.into()), result = public_source(source) => result? };
    let mut command = engines().command(dir)?;
    command.args([
        "--yes-playlist",
        "--flat-playlist",
        "--playlist-end",
        "101",
        "--dump-single-json",
        "--skip-download",
        "--",
        source,
    ]);
    let bytes = collect(&mut command, 4 * 1024 * 1024, cancel).await?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "The engine returned invalid playlist metadata.".into())
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub downloaded: Option<f64>,
    pub total: Option<f64>,
    pub speed: Option<f64>,
    pub eta: Option<f64>,
    pub processing: bool,
    pub phase: Option<String>,
    pub fraction: Option<f64>,
}
fn number(s: &str) -> Option<f64> {
    s.parse::<f64>().ok().filter(|n| n.is_finite() && *n >= 0.0)
}
pub fn progress(line: &str) -> Option<Progress> {
    let parts: Vec<_> = line
        .strip_prefix("ORION_PROGRESS:")?
        .trim()
        .split('|')
        .collect();
    if parts.len() != 6 {
        return None;
    }
    Some(Progress {
        downloaded: number(parts[0]),
        total: number(parts[1]).or_else(|| number(parts[2])),
        speed: number(parts[3]),
        eta: number(parts[4]),
        processing: parts[5] == "finished",
        phase: None,
        fraction: None,
    })
}
async fn progress_output(
    mut out: impl AsyncRead + Unpin,
    mut report: impl FnMut(Progress),
    duration: Option<f64>,
) -> Result<(), String> {
    let mut chunk = [0u8; 4096];
    let mut pending = Vec::new();
    let mut total = 0;
    loop {
        let n = out
            .read(&mut chunk)
            .await
            .map_err(|_| "Could not read download progress.")?;
        if n == 0 {
            return Ok(());
        }
        total += n;
        if total > 16 * 1024 * 1024 {
            return Err("Download log exceeded its safety limit.".into());
        }
        for byte in &chunk[..n] {
            if *byte == b'\n' {
                let line = String::from_utf8_lossy(&pending);
                if let Some(p) = progress(&line) {
                    report(p);
                }
                if let Some(micros) = line.strip_prefix("out_time_us=").and_then(number) {
                    report(Progress {
                        processing: true,
                        phase: Some("converting".into()),
                        fraction: duration
                            .filter(|d| *d > 0.0)
                            .map(|d| (micros / 1_000_000.0 / d).clamp(0.0, 1.0)),
                        ..Progress::default()
                    });
                }
                pending.clear();
            } else {
                pending.push(*byte);
            }
            if pending.len() > 64 * 1024 {
                return Err("Download log line exceeded its safety limit.".into());
            }
        }
    }
}
pub(super) fn present<T>(result: std::io::Result<T>) -> Result<Option<T>, String> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
pub(super) fn work_size(dir: &Path) -> Result<u64, String> {
    let mut bytes = 0u64;
    let Some(entries) = present(std::fs::read_dir(dir))? else {
        return Ok(0);
    };
    for (index, entry) in entries.enumerate() {
        if index >= 256 {
            return Err("Too many download working files.".into());
        }
        let Some(entry) = present(entry)? else {
            continue;
        };
        let Some(meta) = present(std::fs::symlink_metadata(entry.path()))? else {
            continue;
        };
        if meta.is_symlink() {
            return Err("Downloader created an unexpected symbolic link.".into());
        }
        if meta.is_file() {
            bytes = bytes.saturating_add(meta.len());
        } else {
            return Err("Downloader created an unexpected directory or special file.".into());
        }
    }
    Ok(bytes)
}
#[cfg(test)]
fn download_command(source: &str, preset: &Preset, dir: &Path) -> Result<Command, String> {
    configured_command(source, preset, &policy::Options::default(), dir, None)
}
#[cfg(test)]
fn configured_command(
    source: &str,
    preset: &Preset,
    options: &policy::Options,
    dir: &Path,
    access: Option<&super::auth::Access>,
) -> Result<Command, String> {
    configured_using(&engines(), source, preset, options, dir, access, false)
}
#[cfg(test)]
fn configured_using(
    engines: &Engines,
    source: &str,
    preset: &Preset,
    options: &policy::Options,
    dir: &Path,
    access: Option<&super::auth::Access>,
    resume: bool,
) -> Result<Command, String> {
    configured_for_gateway(engines, source, preset, options, dir, access, resume, None)
}
fn configured_for_gateway(
    engines: &Engines,
    source: &str,
    preset: &Preset,
    options: &policy::Options,
    dir: &Path,
    access: Option<&super::auth::Access>,
    resume: bool,
    api: Option<&str>,
) -> Result<Command, String> {
    // Exact formats are validated against the frozen inspection by the native caller.
    let mut checked = options.clone();
    checked.format_id = None;
    checked.validate_preset(preset, None)?;
    let mut command = engines.command(dir)?;
    command.args(preset.args());
    if options.playable && !preset.audio() && options.format_id.is_none() {
        command.args(["--format-sort", "res,vcodec:h264,acodec:m4a"]);
    }
    if let Some(format) = &options.format_id {
        command.args(["-f", format]);
    }
    if preset.audio() {
        command.args(["--audio-quality", &options.audio_quality.to_string()]);
    }
    embed_options(&mut command, preset, options);
    super::sponsor::configure(&mut command, &options.sponsorblock, preset);
    if let Some(api) = api {
        command.args(["--sponsorblock-api", api]);
    }
    transfer_options(&mut command, options);
    command.arg(if resume {
        "--continue"
    } else {
        "--no-continue"
    });
    command.args(["--no-simulate", "--no-overwrites", "--no-keep-video", "--newline", "--progress", "--progress-delta", "0.5",
        "--progress-template", "download:ORION_PROGRESS:%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.status)s",
        "--match-filter", "!is_live & !is_upcoming", "--max-filesize", &options.limits.file_bytes().to_string(), "--output", "media.%(ext)s"]);
    if let Some(access) = access {
        access.apply(&mut command);
    }
    command.args(["--", source]);
    Ok(command)
}
fn embed_options(command: &mut Command, preset: &Preset, options: &policy::Options) {
    // Auxiliary files live only in private work; only the verified media file enters Media.
    command.args([
        "--no-embed-info-json",
        "--no-embed-metadata",
        "--no-embed-chapters",
    ]);
    if options.embed_metadata {
        command.arg("--embed-metadata");
    }
    if options.embed_chapters {
        command.arg("--embed-chapters");
    }
    if options.embed_thumbnail {
        command.arg("--embed-thumbnail");
    }
    if options.embed_subtitles && !preset.audio() && !options.subtitle_langs.is_empty() {
        // The keys-only receipt retains source variants that container language tags collapse.
        command.args([
            "--print-to-file",
            "after_move:%(requested_subtitles|__ORION_NO_CAPTIONS__)l",
        ]);
        command.arg("media.caption-languages.txt");
        command.args([
            "--remux-video",
            "mkv",
            "--embed-subs",
            "--write-subs",
            "--compat-options",
            "no-keep-subs",
            "--sub-format",
            "vtt/srt/best",
            "--sub-langs",
            &options.subtitle_langs.join(","),
        ]);
        command.arg(if options.automatic_subtitles {
            "--write-auto-subs"
        } else {
            "--no-write-auto-subs"
        });
    }
}
fn transfer_options(command: &mut Command, options: &policy::Options) {
    command.args([
        "--retries",
        &options.retries.to_string(),
        "--fragment-retries",
        &options.retries.to_string(),
        "--extractor-retries",
        &options.retries.to_string(),
        "--concurrent-fragments",
        &options.fragments.to_string(),
    ]);
    if let Some(rate) = options.rate_limit_kib {
        command.args(["--limit-rate", &format!("{rate}K")]);
    }
}
pub async fn download(
    source: &str,
    preset: &Preset,
    options: &policy::Options,
    dir: &Path,
    cancel: &mut watch::Receiver<bool>,
    report: impl FnMut(Progress),
    access: Option<&super::auth::Access>,
    resume: bool,
) -> Result<(), String> {
    tokio::select! { biased; _ = cancelled(cancel) => return Err(STOPPED.into()), result = public_source(source) => result? };
    if *cancel.borrow() {
        return Err(STOPPED.into());
    }
    super::sponsor::reset(dir, &options.sponsorblock)?;
    let gateway = super::sponsor_gateway::Gateway::start(&options.sponsorblock).await?;
    let mut command = configured_for_gateway(
        &engines(),
        source,
        preset,
        options,
        dir,
        access,
        resume,
        gateway.as_ref().map(|g| g.url()),
    )?;
    let result = run_media(
        &mut command,
        dir,
        cancel,
        report,
        None,
        access,
        &options.limits,
    )
    .await;
    let result = result.and_then(|_| gateway.as_ref().map_or(Ok(()), |g| g.verify()));
    super::auth::redact(result, access.is_some(), *cancel.borrow())
}
pub(super) fn require_space(available: u64, reserve: u64, copy: u64) -> Result<(), String> {
    if reserve
        .checked_add(copy)
        .is_none_or(|required| available < required)
    {
        return Err("Insufficient free disk space for the selected reserve and pending copy. Working files were retained; free space or reduce limits before retrying.".into());
    }
    Ok(())
}
pub(super) fn disk_space(dir: &Path, reserve: u64, copy: u64) -> Result<(), String> {
    let dir = std::fs::canonicalize(dir).map_err(|e| e.to_string())?;
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let disk = disks
        .iter()
        .filter(|d| dir.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().components().count())
        .ok_or("Cannot check free disk space for this download.")?;
    require_space(disk.available_space(), reserve, copy)
}
pub(super) async fn run_media(
    command: &mut Command,
    dir: &Path,
    cancel: &mut watch::Receiver<bool>,
    report: impl FnMut(Progress),
    duration: Option<f64>,
    access: Option<&super::auth::Access>,
    limits: &policy::Limits,
) -> Result<(), String> {
    limits.validate()?;
    if *cancel.borrow() {
        return Err(STOPPED.into());
    }
    super::check_work_budget(dir, limits)?;
    disk_space(dir, limits.free_bytes(), 0)?;
    let (mut child, mut group) =
        crate::process_group::spawn(command).map_err(|_| "Could not start media engine.")?;
    let out = child
        .stdout
        .take()
        .ok_or("Downloader output unavailable.")?;
    let err = child
        .stderr
        .take()
        .ok_or("Downloader diagnostics unavailable.")?;
    let watch = async {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if let Some(access) = access {
                access.check_size()?;
            }
            if let Err(error) = super::check_work_budget(dir, limits)
                .and_then(|_| disk_space(dir, limits.free_bytes(), 0))
            {
                return Err::<(), String>(error);
            }
        }
    };
    let result = tokio::select! {
        biased;
        _ = cancelled(cancel) => Err(STOPPED.into()),
        _ = tokio::time::sleep(Duration::from_secs(u64::from(limits.minutes) * 60)) => Err("The engine operation reached its selected time limit. Retry explicitly.".into()),
        result = async { let (_, stderr) = tokio::try_join!(progress_output(out, report, duration), bounded(err, 64 * 1024))?; Ok::<_, String>(stderr) } => result,
        result = watch => Err(result.unwrap_err()),
    };
    // Kill any descendants holding resources before reaping the process-group leader.
    // When stdout/stderr close naturally, wait for normal exit before group termination.
    let status = if result.is_ok() {
        match tokio::time::timeout(Duration::from_secs(5), child.wait()).await {
            Ok(status) => {
                group.disarm();
                status
            }
            Err(_) => {
                group.terminate();
                child.wait().await
            }
        }
    } else {
        group.terminate();
        child.wait().await
    };
    let stderr = result?;
    if !status
        .map_err(|_| "Could not await downloader exit.")?
        .success()
    {
        return Err(failure(&stderr));
    }
    super::check_work_budget(dir, limits)?;
    disk_space(dir, limits.free_bytes(), 0)
}

#[cfg(test)]
#[path = "embedding_fixture.rs"]
mod embedding_fixture;
#[cfg(test)]
#[path = "installed_fixture.rs"]
mod installed_fixture;
#[cfg(test)]
#[path = "sponsor_fixture.rs"]
mod sponsor_fixture;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn disk_reserve_includes_pending_copy_and_overflow_fails_closed() {
        require_space(1024, 512, 512).unwrap();
        assert!(require_space(1023, 512, 512).is_err());
        assert!(require_space(511, 512, 0).is_err());
        assert!(require_space(u64::MAX, u64::MAX, 1).is_err());
        assert!(disk_space(&std::env::temp_dir(), u64::MAX, 1).is_err());
    }
    #[test]
    fn selected_file_limit_is_passed_as_exact_engine_bytes() {
        let dir = std::env::temp_dir().join(format!("orion-engine-limit-{}", ulid::Ulid::new()));
        fs::create_dir(&dir).unwrap();
        let options = policy::Options {
            sponsorblock: super::super::sponsor::Choice {
                mode: super::super::sponsor::Mode::Mark,
                categories: vec!["sponsor".into()],
            },
            limits: policy::Limits {
                file_mib: 8192,
                work_mib: 16384,
                ..Default::default()
            },
            ..Default::default()
        };
        let command = configured_for_gateway(
            &Engines {
                yt_dlp: Some("/fake/yt-dlp".into()),
                ffmpeg: Some("/fake/ffmpeg".into()),
                ffprobe: Some("/fake/ffprobe".into()),
                node: Some("/fake/node".into()),
            },
            "https://example.com/video",
            &policy::Preset::VideoBest,
            &options,
            &dir,
            None,
            false,
            Some("http://127.0.0.1:1/private"),
        )
        .unwrap();
        let args: Vec<_> = command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(args
            .windows(2)
            .any(|a| a == ["--max-filesize", "8589934592"]));
        assert_eq!(
            &args[args.len() - 2..],
            &["--", "https://example.com/video"]
        );
        assert_eq!(
            args.windows(2)
                .filter(|a| a[0] == "--sponsorblock-api")
                .last()
                .unwrap()[1],
            "http://127.0.0.1:1/private"
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn selected_work_limit_terminates_and_reaps_but_retains_partial_bytes() {
        let dir =
            std::env::temp_dir().join(format!("orion-engine-work-limit-{}", ulid::Ulid::new()));
        fs::create_dir(&dir).unwrap();
        let mut command = Command::new("sh");
        command
            .args([
                "-c",
                "dd if=/dev/zero of=media.mp4.part bs=1048576 count=33 2>/dev/null; sleep 60",
            ])
            .current_dir(&dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let (_send, mut cancel) = watch::channel(false);
        let limits = policy::Limits {
            file_mib: 16,
            work_mib: 32,
            ..Default::default()
        };
        let start = std::time::Instant::now();
        let error = run_media(&mut command, &dir, &mut cancel, |_| {}, None, None, &limits)
            .await
            .unwrap_err();
        assert!(error.contains("selected work limit"), "{error}");
        assert!(start.elapsed() < Duration::from_secs(10));
        assert_eq!(
            fs::metadata(dir.join("media.mp4.part")).unwrap().len(),
            33 * 1024 * 1024
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn progress_is_structured_and_tolerates_unknown_totals() {
        let p = progress("ORION_PROGRESS:1024|NA|2048|512|2|downloading").unwrap();
        assert_eq!(p.total, Some(2048.));
        assert!(!p.processing);
        assert!(progress("untrusted output").is_none());
        assert!(progress("ORION_PROGRESS:NaN|-1|inf|NA|NA|finished")
            .unwrap()
            .total
            .is_none());
    }
    #[tokio::test]
    async fn output_is_bounded() {
        assert!(bounded(&b"12345"[..], 4).await.is_err());
    }
    #[tokio::test]
    async fn rejects_unbounded_lines() {
        assert!(progress_output(&vec![b'x'; 65537][..], |_| {}, None)
            .await
            .is_err());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn natural_exit_is_not_killed_before_collection() {
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "printf fixture"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let (_send, mut recv) = watch::channel(false);
        assert_eq!(
            collect(&mut command, 1024, &mut recv).await.unwrap(),
            b"fixture"
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_reaps_the_leader_and_terminates_descendant_pipes() {
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "sleep 30 & wait"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let (send, mut recv) = watch::channel(false);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            send.send(true).unwrap();
        });
        let error = tokio::time::timeout(
            Duration::from_secs(3),
            collect(&mut command, 1024, &mut recv),
        )
        .await
        .unwrap()
        .unwrap_err();
        assert_eq!(error, STOPPED);
    }
    #[test]
    fn authenticated_flags_precede_the_url_terminator_without_ambient_credentials() {
        let root = std::env::temp_dir().join(format!("orion-auth-argv-{}", ulid::Ulid::new()));
        let access = super::super::auth::synthetic_access(&root);
        let e = Engines {
            yt_dlp: Some("/synthetic/yt-dlp".into()),
            ffmpeg: Some("/synthetic/ffmpeg".into()),
            ffprobe: Some("/synthetic/ffprobe".into()),
            node: Some("/synthetic/node".into()),
        };
        let c = configured_using(
            &e,
            "https://example.com/video",
            &Preset::Video1080,
            &policy::Options::default(),
            Path::new("/synthetic/private-job"),
            Some(&access),
            false,
        )
        .unwrap();
        let args: Vec<_> = c
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let cookie = args
            .iter()
            .position(|a| a == "--cookies-from-browser")
            .unwrap();
        let boundary = args.iter().position(|a| a == "--").unwrap();
        assert!(cookie < boundary);
        assert_eq!(args.last().unwrap(), "https://example.com/video");
        assert!(!args.iter().any(|a| a == "--cookies"));
        assert!(
            c.as_std()
                .get_envs()
                .any(|(k, v)| k == "HOME"
                    && v == Some(std::ffi::OsStr::new("/synthetic/private-job")))
        );
        drop(access);
        super::super::auth::remove_fixture(&root);
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn credential_scratch_budget_terminates_and_reaps_the_engine() {
        let root =
            std::env::temp_dir().join(format!("orion-auth-supervisor-{}", ulid::Ulid::new()));
        let access = super::super::auth::synthetic_access(&root);
        let temp = root
            .read_dir()
            .unwrap()
            .map(|e| e.unwrap())
            .find(|e| e.file_type().unwrap().is_dir())
            .unwrap()
            .path();
        let file = std::fs::File::create(temp.join("synthetic-sparse-db")).unwrap();
        file.set_len(64 * 1024 * 1024 + 1).unwrap();
        drop(file);
        let mut c = Command::new("/bin/sh");
        c.args(["-c", "sleep 30 & wait"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let (_send, mut cancel) = watch::channel(false);
        let result = tokio::time::timeout(
            Duration::from_secs(3),
            collect_authorized(&mut c, 1024, &mut cancel, Some(&access)),
        )
        .await
        .unwrap();
        assert!(result.unwrap_err().contains("64 MiB"));
        drop(access);
        assert!(!temp.exists());
        super::super::auth::remove_fixture(&root);
    }
    #[test]
    fn embedding_flags_preserve_manual_caption_priority_and_independent_chapters() {
        let mut command = Command::new("/synthetic/yt-dlp");
        let options = policy::Options {
            embed_metadata: true,
            embed_subtitles: true,
            automatic_subtitles: true,
            subtitle_langs: vec!["en".into(), "pt-BR".into()],
            ..Default::default()
        };
        embed_options(&mut command, &Preset::Video1080, &options);
        let args: Vec<_> = command
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        for flag in [
            "--no-embed-info-json",
            "--no-embed-chapters",
            "--embed-metadata",
            "--embed-subs",
            "--write-subs",
            "--write-auto-subs",
        ] {
            assert!(args.iter().any(|s| s == flag), "{flag}");
        }
        assert!(!args.iter().any(|s| s == "--embed-chapters"));
        assert!(args
            .windows(2)
            .any(|a| a == ["--compat-options", "no-keep-subs"]));
        assert!(args.windows(2).any(|a| a == ["--sub-langs", "en,pt-BR"]));
        let mut command = Command::new("/synthetic/yt-dlp");
        embed_options(
            &mut command,
            &Preset::Video1080,
            &policy::Options::default(),
        );
        assert!(!command
            .as_std()
            .get_args()
            .any(|s| s == "--embed-subs" || s == "--embed-thumbnail" || s == "--embed-metadata"));
    }
    #[test]
    fn transfer_controls_drive_bounded_real_engine_flags() {
        let mut command = Command::new("/synthetic/yt-dlp");
        transfer_options(
            &mut command,
            &policy::Options {
                rate_limit_kib: Some(512),
                retries: 4,
                fragments: 3,
                ..policy::Options::default()
            },
        );
        let args: Vec<_> = command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            vec![
                "--retries",
                "4",
                "--fragment-retries",
                "4",
                "--extractor-retries",
                "4",
                "--concurrent-fragments",
                "3",
                "--limit-rate",
                "512K"
            ]
        );
        let mut unlimited = Command::new("/synthetic/yt-dlp");
        transfer_options(&mut unlimited, &policy::Options::default());
        assert!(!unlimited.as_std().get_args().any(|a| a == "--limit-rate"));
    }
    #[test]
    fn resume_is_a_native_execution_flag_not_a_saved_or_arbitrary_option() {
        let e = Engines {
            yt_dlp: Some("/fake/yt-dlp".into()),
            ffmpeg: Some("/fake/ffmpeg".into()),
            ffprobe: Some("/fake/ffprobe".into()),
            node: Some("/fake/node".into()),
        };
        for resume in [false, true] {
            let command = configured_using(
                &e,
                "https://example.com/video",
                &Preset::Video1080,
                &policy::Options::default(),
                Path::new("/fake/job"),
                None,
                resume,
            )
            .unwrap();
            let args: Vec<_> = command
                .as_std()
                .get_args()
                .map(|a| a.to_string_lossy().into_owned())
                .collect();
            assert_eq!(args.iter().any(|a| a == "--continue"), resume);
            assert_eq!(args.iter().any(|a| a == "--no-continue"), !resume);
            assert!(
                args.iter()
                    .position(|a| a
                        == if resume {
                            "--continue"
                        } else {
                            "--no-continue"
                        })
                    .unwrap()
                    < args.iter().position(|a| a == "--").unwrap()
            );
            assert!(args.iter().any(|a| a == "--no-overwrites"));
            assert!(!args.iter().any(|a| a == "--cookies-from-browser"));
        }
        assert!(
            serde_json::from_value::<policy::Options>(serde_json::json!({"resume":true})).is_err()
        );
    }
    #[test]
    fn fixed_command_disables_ambient_execution_and_credentials() {
        let e = Engines {
            yt_dlp: Some("/synthetic/yt-dlp".into()),
            ffmpeg: Some("/synthetic/ffmpeg".into()),
            ffprobe: Some("/synthetic/ffprobe".into()),
            node: Some("/synthetic/node".into()),
        };
        let command = e.command(Path::new("/private/job")).unwrap();
        let args: Vec<_> = command
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        for required in [
            "--ignore-config",
            "--no-plugin-dirs",
            "--no-remote-components",
            "--no-update",
            "--no-playlist",
        ] {
            assert!(args.iter().any(|a| a == required));
        }
        for denied in ["--exec", "--cookies-from-browser", "--no-check-certificate"] {
            assert!(!args.iter().any(|a| a == denied));
        }
        assert!(command.as_std().get_envs().all(|(k, _)| [
            "PATH",
            "HOME",
            "TMPDIR",
            "LANG",
            "PYTHONNOUSERSITE"
        ]
        .iter()
        .any(|allowed| k == *allowed)));
    }
}
