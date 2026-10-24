use super::*;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepositoryDocument {
    pub path: String,
    pub bytes: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewedFile {
    path: String,
    bytes: usize,
    sha256: String,
    text: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryReview {
    schema_version: u8,
    id: String,
    label: String,
    repository: RepositoryOrigin,
    files: Vec<ReviewedFile>,
}
fn document_path(path: &str) -> bool {
    matches!(path.to_ascii_lowercase().as_str(),
        "readme" | "readme.md" | "readme.txt" | "readme.rst" |
        "license" | "license.md" | "license.txt" | "notice" | "notice.md" | "notice.txt" |
        "package.json" | "pyproject.toml" | "cargo.toml" | "go.mod" | "requirements.txt" |
        "setup.cfg" | "dockerfile" | "compose.yaml" | "compose.yml" | "docker-compose.yml" | "docker-compose.yaml")
}
pub(super) fn documents(entries: &[TreeEntry]) -> Vec<RepositoryDocument> {
    let mut found = Vec::new();
    let mut counts = BTreeMap::new();
    for file in entries.iter().filter(|f| document_path(&f.path)) {
        *counts.entry(file.path.to_ascii_lowercase()).or_insert(0) += 1;
    }
    for file in entries.iter().filter(|f| document_path(&f.path)) {
        // An ambiguous root document must not block an unrelated skill subtree.
        if counts[&file.path.to_ascii_lowercase()] != 1 { continue; }
        if file.kind == "blob" && file.mode == "100644" && git_hash(&file.sha)
            && file.size.is_some_and(|n| n > 0 && n <= 256 * 1024) {
            found.push(RepositoryDocument { path: file.path.clone(), bytes: file.size.unwrap() });
        }
    }
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}
fn selected_documents<'a>(source: &'a RepositorySnapshot, paths: &[String]) -> Result<Vec<&'a TreeEntry>, String> {
    if paths.is_empty() || paths.len() > 4 || paths.iter().collect::<HashSet<_>>().len() != paths.len() {
        return Err("Choose one to four distinct review documents".into());
    }
    let available = documents(&source.entries);
    paths.iter().map(|p| {
        if !available.iter().any(|f| &f.path == p) { return Err("Document was not offered in this pinned inspection".into()); }
        source.entries.iter().find(|f| &f.path == p).ok_or_else(|| "Pinned document missing".into())
    }).collect()
}
fn decoded(file: &TreeEntry, bytes: Vec<u8>) -> Result<ReviewedFile, String> {
    if bytes.len() > 256 * 1024 || Some(bytes.len()) != file.size { return Err("Pinned document size mismatch".into()); }
    if bytes.starts_with(b"version https://git-lfs.github.com/spec/v1") || secret_risk(&file.path, &bytes) {
        return Err("Document contains a Git LFS pointer or possible credentials; nothing was accepted".into());
    }
    let sha256 = hash(&bytes);
    let text = String::from_utf8(bytes).map_err(|_| "Review documents must be UTF-8 text")?;
    if text.contains('\0') || text.starts_with("#!") { return Err("Binary or executable document refused".into()); }
    Ok(ReviewedFile { path: file.path.clone(), bytes: text.len(), sha256, text })
}
async fn acquire_documents(source: &RepositorySnapshot, paths: &[String]) -> Result<RepositoryReview, String> {
    let selected = selected_documents(source, paths)?;
    let origin = source.discovery.repository.clone().ok_or("Missing pinned provenance")?;
    let client = client()?;
    let mut files = Vec::new();
    for file in selected {
        let mut url = reqwest::Url::parse("https://raw.githubusercontent.com/").unwrap();
        url.path_segments_mut().map_err(|_| "Invalid review URL")?.pop_if_empty()
            .push(&source.repository.owner).push(&source.repository.name).push(&origin.commit).push(&file.path);
        files.push(decoded(file, get(&client, url, file.size.unwrap()).await?)?);
    }
    Ok(RepositoryReview { schema_version: 1, id: ulid::Ulid::new().to_string(), label: source.discovery.label.clone(), repository: origin, files })
}
#[tauri::command]
pub async fn intake_github_review(discovery_id: String, paths: Vec<String>, job_id: String) -> Result<RepositoryReview, String> {
    id_check(&discovery_id)?;
    let source = {
        let mut session = SESSION.lock().map_err(|_| "Inspection session unavailable")?;
        session.expire();
        session.github_sources.get(&discovery_id).map(|(_, s)| s.clone()).ok_or("Repository inspection expired; inspect again")?
    };
    run_job(job_id, acquire_documents(&source, &paths)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::tests::{entry, source};
    #[test]
    fn catalog_is_root_documents_only_without_install_authority() {
        let s = source(vec![entry("README.md", "100644", 20), entry("package.json", "100644", 50), entry(".env", "100644", 30), entry("docs/README.md", "100644", 20), entry("setup.py", "100755", 10)]);
        assert!(s.discovery.entries.is_empty());
        assert_eq!(documents(&s.entries).len(), 2);
        assert!(selected(&s, "README.md", &[]).is_err());
        assert!(selected_documents(&s, &[".env".into()]).is_err());
        assert!(selected_documents(&s, &["../README.md".into()]).is_err());
        assert!(selected_documents(&s, &["README.md".into(), "README.md".into()]).is_err());
        assert_eq!(selected_documents(&s, &["package.json".into()]).unwrap().len(), 1);
    }
    #[test]
    fn refuses_unsafe_modes_sizes_and_case_collisions() {
        for (mode, size) in [("120000", 20), ("160000", 20), ("100755", 20), ("100644", 262145)] {
            assert!(documents(&[entry("README.md", mode, size)]).is_empty());
        }
        let mixed = source(vec![entry("README.md", "100644", 10), entry("readme.md", "100644", 10), entry("skills/one/SKILL.md", "100644", 20)]);
        assert!(documents(&mixed.entries).is_empty());
        assert_eq!(selected(&mixed, "skills/one/SKILL.md", &[]).unwrap().len(), 1);
    }
    #[test]
    fn validates_entire_text_and_hashes_without_running_manifests() {
        let bytes = br#"{"scripts":{"install":"touch /tmp/must-not-run"}}"#.to_vec();
        let file = entry("package.json", "100644", bytes.len());
        let result = decoded(&file, bytes.clone()).unwrap();
        assert_eq!(result.sha256, hash(&bytes));
        assert!(result.text.contains("must-not-run"));
        assert!(decoded(&file, vec![0]).is_err());
        for body in [b"\xff".to_vec(), b"abc\0def".to_vec(), b"#!/bin/sh".to_vec(), b"version https://git-lfs.github.com/spec/v1".to_vec(), format!("sk-{}", "a".repeat(40)).into_bytes()] {
            assert!(decoded(&entry("README.md", "100644", body.len()), body).is_err());
        }
    }
}
