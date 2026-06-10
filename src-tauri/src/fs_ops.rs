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

#[derive(Serialize)]
pub struct SearchMatch {
    line: usize,
    column: usize,
    preview: String,
}

#[derive(Serialize)]
pub struct FileMatches {
    path: String,
    matches: Vec<SearchMatch>,
}

/// Project-wide content search (the ⌘⇧F panel). Literal substring match,
/// case-insensitive by default; skips ignored dirs, binary/non-UTF-8 files,
/// and anything over 2 MB. Bounded by `max_results` so a broad query can't
/// stall the UI.
#[tauri::command]
pub fn search_in_files(
    root: String,
    query: String,
    case_sensitive: Option<bool>,
    max_results: Option<usize>,
) -> Result<Vec<FileMatches>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("not a directory".into());
    }
    let cs = case_sensitive.unwrap_or(false);
    let needle = if cs { query.clone() } else { query.to_lowercase() };
    let cap = max_results.unwrap_or(2000);
    let mut out: Vec<FileMatches> = Vec::new();
    let mut total = 0usize;

    let walker = WalkDir::new(&root_path).into_iter().filter_entry(|e| {
        e.file_name()
            .to_str()
            .map(|s| !is_ignored(s))
            .unwrap_or(true)
    });

    for entry in walker.filter_map(|e| e.ok()) {
        if total >= cap {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if let Ok(meta) = path.metadata() {
            if meta.len() > 2_000_000 {
                continue;
            }
        }
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue, // binary / non-utf8
        };
        let mut file_matches: Vec<SearchMatch> = Vec::new();
        for (i, line) in content.lines().enumerate() {
            let hay = if cs { line.to_string() } else { line.to_lowercase() };
            let mut start = 0usize;
            while let Some(rel) = hay[start..].find(&needle) {
                let col_byte = start + rel;
                let column = hay[..col_byte].chars().count() + 1;
                let preview: String = line.chars().take(400).collect();
                file_matches.push(SearchMatch {
                    line: i + 1,
                    column,
                    preview,
                });
                total += 1;
                start = col_byte + needle.len().max(1);
                if total >= cap || start >= hay.len() {
                    break;
                }
            }
            if total >= cap {
                break;
            }
        }
        if !file_matches.is_empty() {
            out.push(FileMatches {
                path: path.to_string_lossy().into_owned(),
                matches: file_matches,
            });
        }
    }

    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(out)
}

/// Create a new file (with parent dirs) or directory. Errors if it exists.
#[tauri::command]
pub fn create_path(path: String, is_dir: bool) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err(format!("already exists: {}", path));
    }
    if is_dir {
        std::fs::create_dir_all(&p).map_err(|e| e.to_string())
    } else {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::File::create(&p).map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Rename/move a path. Refuses to clobber an existing target.
#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    let to_p = PathBuf::from(&to);
    if to_p.exists() {
        return Err(format!("target exists: {}", to));
    }
    if let Some(parent) = to_p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// Permanently delete a file or directory tree. The UI confirms first.
#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(());
    }
    if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

/// Reveal a path in Finder (macOS).
#[tauri::command]
pub fn reveal_in_os(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("unsupported platform".into())
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
