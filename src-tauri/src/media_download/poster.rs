use super::{engine, publication};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::{process::Command, sync::watch};

pub(super) fn validate(path: &Path) -> Result<(), String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = publication::regular_limited(path, 512 * 1024)?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    if !(4..=512 * 1024).contains(&size) {
        return Err("Poster exceeded its size limit.".into());
    }
    let mut start = [0u8; 2];
    let mut end = [0u8; 2];
    file.read_exact(&mut start).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::End(-2)).map_err(|e| e.to_string())?;
    file.read_exact(&mut end).map_err(|e| e.to_string())?;
    if start != [0xff, 0xd8] || end != [0xff, 0xd9] {
        return Err("Poster is not a complete JPEG.".into());
    }
    Ok(())
}
pub(super) async fn create(
    dir: &Path,
    duration: Option<f64>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    create_using(dir, duration, false, cancel).await
}
pub(super) async fn create_audio(
    dir: &Path,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    create_using(dir, None, true, cancel).await
}
async fn create_using(
    dir: &Path,
    duration: Option<f64>,
    audio: bool,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let (source, _, _) = publication::output(dir, audio)?;
    let output = dir.join("media.poster.jpg");
    let mut command = command(
        &engine::engines().ffmpeg.ok_or("FFmpeg is missing.")?,
        &source,
        &output,
        duration,
    );
    let result = engine::collect(&mut command, 1024, cancel)
        .await
        .and_then(|_| validate(&output));
    if result.is_err() {
        let _ = fs::remove_file(&output);
    }
    result
}
fn command(exe: &Path, source: &Path, output: &Path, duration: Option<f64>) -> Command {
    let mut c = Command::new(exe);
    c.env_clear()
        .env("LANG", "en_US.UTF-8")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    c.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-n",
        "-protocol_whitelist",
        "file,pipe",
    ]);
    if let Some(duration) = duration.filter(|n| n.is_finite() && *n > 0.0) {
        c.args(["-ss", &(duration * 0.15).min(10.0).to_string()]);
    }
    c.arg("-i")
        .arg(source)
        .args([
            "-map",
            "0:v:0",
            "-an",
            "-sn",
            "-frames:v",
            "1",
            "-vf",
            "scale=320:180:force_original_aspect_ratio=decrease",
            "-q:v",
            "3",
            "-update",
            "1",
        ])
        .arg(output);
    c
}
pub(super) fn publish(
    dir: &Path,
    assets: &Path,
    id: &str,
    limits: &super::policy::Limits,
) -> Result<Option<PathBuf>, String> {
    let source = dir.join("media.poster.jpg");
    match fs::symlink_metadata(&source) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
        Ok(_) => {
            validate(&source)?;
            let target = assets.join(format!("{id}.poster.jpg"));
            publication::publish_file_limited(&source, &target, limits)?;
            Ok(Some(target))
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn poster_publication_uses_the_selected_reserve_and_keeps_its_small_bound() {
        let root = std::env::temp_dir().join(format!("orion-poster-reserve-{}", ulid::Ulid::new()));
        let assets = root.join("assets");
        fs::create_dir_all(&assets).unwrap();
        let source = root.join("media.poster.jpg");
        fs::write(&source, [0xff, 0xd8, 0xff, 0xd9]).unwrap();
        let limits = super::super::policy::Limits {
            free_mib: 65536,
            ..Default::default()
        };
        let id = ulid::Ulid::new().to_string();
        let room = engine::disk_space(&assets, limits.free_bytes(), 4);
        let result = publish(&root, &assets, &id, &limits);
        assert_eq!(result.is_ok(), room.is_ok());
        assert_eq!(
            assets.join(format!("{id}.poster.jpg")).exists(),
            room.is_ok()
        );
        assert_eq!(fs::read(&source).unwrap(), [0xff, 0xd8, 0xff, 0xd9]);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn poster_generation_uses_only_the_owned_video_and_a_fixed_small_frame() {
        let c = command(
            Path::new("/synthetic/ffmpeg"),
            Path::new("/owned/media.mp4"),
            Path::new("/owned/media.poster.jpg"),
            Some(60.0),
        );
        let args: Vec<_> = c
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(args
            .windows(2)
            .any(|a| a == ["-protocol_whitelist", "file,pipe"]));
        assert!(args.windows(2).any(|a| a == ["-frames:v", "1"]));
        assert_eq!(args.last().unwrap(), "/owned/media.poster.jpg");
        assert!(!args.iter().any(|a| a.starts_with("http")));
    }
    #[test]
    fn incomplete_and_oversized_posters_are_not_published() {
        let root = std::env::temp_dir().join(format!("orion-poster-test-{}", ulid::Ulid::new()));
        fs::create_dir(&root).unwrap();
        let file = root.join("media.poster.jpg");
        for bytes in [vec![0xff, 0xd8], vec![0; 512 * 1024 + 1]] {
            fs::write(&file, bytes).unwrap();
            assert!(validate(&file).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    #[ignore = "requires explicitly installed FFmpeg/ffprobe; only agent-owned generated media"]
    async fn installed_native_frame_is_published_without_changing_video() {
        let root =
            std::env::temp_dir().join(format!("orion-poster-installed-{}", ulid::Ulid::new()));
        fs::create_dir(&root).unwrap();
        let video = root.join("media.mp4");
        let status = Command::new(engine::engines().ffmpeg.unwrap())
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-n",
                "-f",
                "lavfi",
                "-i",
                "color=c=green:s=640x360:r=12",
                "-t",
                "1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&video)
            .status()
            .await
            .unwrap();
        assert!(status.success());
        let before = fs::read(&video).unwrap();
        let (_send, mut cancel) = watch::channel(false);
        create(&root, Some(1.0), &mut cancel).await.unwrap();
        let assets = root.join("assets");
        fs::create_dir(&assets).unwrap();
        let id = ulid::Ulid::new().to_string();
        let image = publish(
            &root,
            &assets,
            &id,
            &super::super::policy::Limits::default(),
        )
        .unwrap()
        .unwrap();
        validate(&image).unwrap();
        let probe = Command::new(engine::engines().ffprobe.unwrap())
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=width,height,codec_name",
                "-of",
                "json",
            ])
            .arg(&image)
            .output()
            .await
            .unwrap();
        assert!(probe.status.success());
        let v: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(v["streams"][0]["codec_name"], "mjpeg");
        assert_eq!(v["streams"][0]["width"], 320);
        assert_eq!(v["streams"][0]["height"], 180);
        assert_eq!(fs::read(&video).unwrap(), before);
        fs::remove_dir_all(root).unwrap();
    }
}
