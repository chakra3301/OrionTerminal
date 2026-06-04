use serde::Serialize;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    ".venv",
    "__pycache__",
    ".DS_Store",
];

#[derive(Serialize)]
pub struct TreeNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<TreeNode>>,
}

fn is_ignored(name: &str) -> bool {
    IGNORED_DIRS.iter().any(|i| *i == name)
}

fn build_tree(root: &Path, max_depth: usize) -> Result<TreeNode, String> {
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned());

    let mut node = TreeNode {
        name,
        path: root.to_string_lossy().into_owned(),
        is_dir: true,
        children: Some(Vec::new()),
    };

    if !root.is_dir() {
        node.is_dir = false;
        node.children = None;
        return Ok(node);
    }

    let mut children: Vec<TreeNode> = Vec::new();
    let entries = std::fs::read_dir(root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let fname = match path.file_name() {
            Some(n) => n.to_string_lossy().into_owned(),
            None => continue,
        };
        if is_ignored(&fname) {
            continue;
        }
        let is_dir = path.is_dir();
        if is_dir && max_depth > 0 {
            match build_tree(&path, max_depth - 1) {
                Ok(child) => children.push(child),
                Err(_) => continue,
            }
        } else {
            children.push(TreeNode {
                name: fname,
                path: path.to_string_lossy().into_owned(),
                is_dir,
                children: if is_dir { Some(Vec::new()) } else { None },
            });
        }
    }

    children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    node.children = Some(children);
    Ok(node)
}

#[tauri::command]
pub fn read_dir_tree(path: String, max_depth: Option<usize>) -> Result<TreeNode, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {}", path));
    }
    build_tree(&p, max_depth.unwrap_or(6))
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    PathBuf::from(&path).exists()
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("file not found: {}", path));
    }
    if p.is_dir() {
        return Err(format!("path is a directory: {}", path));
    }
    let metadata = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    if metadata.len() > 5_000_000 {
        return Err(format!("file too large ({} bytes)", metadata.len()));
    }
    std::fs::read_to_string(&p).map_err(|e| e.to_string())
}

/// Read a (binary) file and return its bytes base64-encoded, for media the
/// webview renders via a `data:` URL — images/video/audio/pdf clicked in the
/// file tree. Capped so a giant file can't blow up the IPC payload; the
/// `TOO_LARGE:<bytes>` sentinel lets the viewer show a friendly message.
#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("file not found: {}", path));
    }
    if p.is_dir() {
        return Err(format!("path is a directory: {}", path));
    }
    let metadata = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    const MAX: u64 = 20_000_000;
    if metadata.len() > MAX {
        return Err(format!("TOO_LARGE:{}", metadata.len()));
    }
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    Ok(crate::claude_cli::base64_encode(&bytes))
}

#[tauri::command]
pub fn count_files(path: String) -> Result<usize, String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err("not a directory".into());
    }
    let count = WalkDir::new(&p)
        .into_iter()
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|s| !is_ignored(s))
                .unwrap_or(true)
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .count();
    Ok(count)
}

#[tauri::command]
pub fn save_file_atomic(path: String, contents: String) -> Result<(), String> {
    use std::fs::{rename, File};
    use std::io::Write;

    let target = PathBuf::from(&path);
    let parent = target
        .parent()
        .ok_or_else(|| format!("no parent directory: {}", path))?;
    if !parent.exists() {
        return Err(format!("parent dir missing: {}", parent.display()));
    }

    let fname = target
        .file_name()
        .ok_or_else(|| format!("no file name: {}", path))?
        .to_string_lossy()
        .into_owned();
    let tmp = parent.join(format!(".{}.orion.tmp", fname));

    {
        let mut f = File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(())
}
