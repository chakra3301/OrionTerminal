use super::*;
pub mod review;
pub mod static_apps;
use std::future::Future;
use tokio::sync::oneshot;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepositoryOrigin {
    pub url: String,
    pub requested_ref: String,
    pub commit: String,
    pub tree: String,
}
impl RepositoryOrigin {
    pub fn validate(&self) -> Result<(), String> {
        let repo = Repository::parse(&self.url)?;
        if self.url != repo.url()
            || !(self.requested_ref == "HEAD" || git_hash(&self.requested_ref))
            || !git_hash(&self.commit)
            || !git_hash(&self.tree)
        {
            return Err("Invalid pinned repository provenance".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq)]
struct Repository {
    owner: String,
    name: String,
    reference: String,
}
impl Repository {
    fn parse(input: &str) -> Result<Self, String> {
        if input.len() > 512 || input.trim() != input {
            return Err("Use a public HTTPS GitHub repository URL".into());
        }
        let path = input
            .strip_prefix("https://github.com/")
            .ok_or("Only public https://github.com/owner/repo links are supported right now")?
            .trim_end_matches('/');
        let parts: Vec<_> = path.split('/').collect();
        if parts.len() != 2 && parts.len() != 4 {
            return Err("Use the repository root link, or /tree/<full commit SHA>".into());
        }
        let owner = parts[0];
        let name = parts[1].strip_suffix(".git").unwrap_or(parts[1]);
        if owner.is_empty()
            || owner.len() > 39
            || owner.starts_with('-')
            || owner.ends_with('-')
            || !owner
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            || name.is_empty()
            || name.len() > 100
            || [".", ".."].contains(&name)
            || !name
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        {
            return Err("Invalid GitHub owner/repository. Credentials, query strings and encoded paths are not accepted.".into());
        }
        let reference = if parts.len() == 4 {
            if parts[2] != "tree" || !git_hash(parts[3]) {
                return Err("For branch links, paste the repository root instead; only full commit SHA links are supported".into());
            }
            parts[3]
        } else {
            "HEAD"
        };
        Ok(Self {
            owner: owner.into(),
            name: name.into(),
            reference: reference.into(),
        })
    }
    fn url(&self) -> String {
        format!("https://github.com/{}/{}", self.owner, self.name)
    }
    fn api(&self, suffix: &str) -> String {
        format!(
            "https://api.github.com/repos/{}/{}/{suffix}",
            self.owner, self.name
        )
    }
}
fn git_hash(s: &str) -> bool {
    s.len() == 40
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
#[derive(Clone, Debug, Deserialize)]
struct TreeEntry {
    path: String,
    mode: String,
    #[serde(rename = "type")]
    kind: String,
    sha: String,
    size: Option<usize>,
}
#[derive(Deserialize)]
struct TreeResponse {
    sha: String,
    truncated: bool,
    tree: Vec<TreeEntry>,
}
#[derive(Deserialize)]
struct CommitResponse {
    sha: String,
    commit: CommitBody,
}
#[derive(Deserialize)]
struct CommitBody {
    tree: TreeIdentity,
}
#[derive(Deserialize)]
struct TreeIdentity {
    sha: String,
}
#[derive(Clone)]
pub(super) struct RepositorySnapshot {
    repository: Repository,
    pub discovery: Discovery,
    entries: Vec<TreeEntry>,
}
fn snapshot(
    repository: Repository,
    commit: String,
    tree: TreeResponse,
) -> Result<RepositorySnapshot, String> {
    if !git_hash(&commit) || !git_hash(&tree.sha) || tree.truncated || tree.tree.len() > 4096 {
        return Err("Repository tree is truncated, invalid or exceeds 4096 entries; no partial snapshot was accepted".into());
    }
    let mut seen = HashSet::new();
    if tree
        .tree
        .iter()
        .any(|e| e.path.len() > 4096 || !seen.insert(e.path.clone()))
    {
        return Err("Repository tree contains invalid/duplicate paths".into());
    }
    let entries: Vec<_> = tree
        .tree
        .iter()
        .filter(|e| e.path == "SKILL.md" || e.path.ends_with("/SKILL.md"))
        .map(|e| EntryPoint {
            path: e.path.clone(),
        })
        .collect();
    if entries.len() > 64 {
        return Err("Repository exceeds 64 skill entrypoints".into());
    }
    for entry in &entries {
        safe_dir::relative(&entry.path)?;
    }
    let review_files = review::documents(&tree.tree);
    let attribution_files = tree
        .tree
        .iter()
        .filter(|e| {
            [
                "LICENSE",
                "LICENSE.md",
                "LICENSE.txt",
                "NOTICE",
                "NOTICE.md",
                "NOTICE.txt",
            ]
            .contains(&e.path.as_str())
        })
        .map(|e| e.path.clone())
        .collect();
    let origin = RepositoryOrigin {
        url: repository.url(),
        requested_ref: repository.reference.clone(),
        commit,
        tree: tree.sha,
    };
    origin.validate()?;
    Ok(RepositorySnapshot {
        discovery: Discovery {
            id: ulid::Ulid::new().to_string(),
            label: format!("{}/{}", repository.owner, repository.name),
            entries,
            attribution_files,
            review_files: Some(review_files),
            repository: Some(origin),
        },
        repository,
        entries: tree.tree,
    })
}
fn selected<'a>(
    source: &'a RepositorySnapshot,
    entry: &str,
    attribution: &[String],
) -> Result<Vec<(&'a TreeEntry, String)>, String> {
    if !source.discovery.entries.iter().any(|e| e.path == entry) || attribution.len() > 6 {
        return Err("Select a discovered skill and its attribution files".into());
    }
    let scope = entry.strip_suffix("SKILL.md").unwrap();
    let mut seen = HashSet::new();
    for path in attribution {
        if !seen.insert(path) || !source.discovery.attribution_files.contains(path) {
            return Err("Attribution was not discovered or was repeated".into());
        }
    }
    let mut targets = HashSet::new();
    let mut selected = Vec::new();
    let mut bytes = 0usize;
    let mut walked = 0usize;
    for file in &source.entries {
        let relative = if let Some(relative) = file.path.strip_prefix(scope) {
            if relative.is_empty() {
                continue;
            }
            relative.to_string()
        } else if attribution.contains(&file.path) {
            format!("__orion_attribution/{}", file.path)
        } else {
            continue;
        };
        walked += 1;
        if walked > 256 {
            return Err("Selected package exceeds 256 tree entries".into());
        }
        safe_dir::relative(&relative)?;
        if relative.split('/').count() > 9
            || (file.path.starts_with(scope)
                && relative
                    .split('/')
                    .any(|p| p.eq_ignore_ascii_case("__orion_attribution")))
        {
            return Err("Selected package exceeds depth or uses a reserved path".into());
        }
        if !targets.insert(relative.to_ascii_lowercase()) {
            return Err("Selected package has case-colliding paths".into());
        }
        if file.kind == "tree" {
            if !file.path.starts_with(scope) {
                return Err("Selected attribution must be a regular file".into());
            }
            if file.mode != "040000" || !git_hash(&file.sha) {
                return Err("Invalid selected directory entry".into());
            }
            continue;
        }
        if file.kind != "blob"
            || !["100644", "100755"].contains(&file.mode.as_str())
            || !git_hash(&file.sha)
        {
            return Err(
                "Selected package contains symlinks, submodules or unsupported entries".into(),
            );
        }
        let size = file.size.ok_or("Missing file size in pinned tree")?;
        let limit = if relative.rsplit('/').next() == Some("SKILL.md") {
            128 * 1024
        } else {
            1024 * 1024
        };
        if size > limit {
            return Err("Selected file exceeds its byte limit".into());
        }
        bytes = bytes.checked_add(size).ok_or("Invalid package size")?;
        selected.push((file, relative));
        if selected.len() > MAX_FILES || bytes > MAX_BYTES {
            return Err("Selected package exceeds 128 files or 8 MiB".into());
        }
    }
    if selected.is_empty() {
        return Err("Selected skill disappeared from pinned tree".into());
    }
    Ok(selected)
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .user_agent("Orion-Terminal-Incubator/1")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Cannot initialize repository inspection".into())
}
fn append_chunk(bytes: &mut Vec<u8>, chunk: &[u8], max: usize) -> Result<(), String> {
    if bytes.len().saturating_add(chunk.len()) > max {
        return Err("GitHub response exceeds its byte limit".into());
    }
    bytes.extend_from_slice(chunk);
    Ok(())
}
async fn get(client: &reqwest::Client, url: reqwest::Url, max: usize) -> Result<Vec<u8>, String> {
    if url.scheme() != "https"
        || ![Some("api.github.com"), Some("raw.githubusercontent.com")].contains(&url.host_str())
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err("Repository request destination denied".into());
    }
    let mut response = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("Accept-Encoding", "identity")
        .send()
        .await
        .map_err(|_| "GitHub request failed or timed out")?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            403 | 429 => "GitHub rate limit or access restriction. Retry later; no credentials were used.".into(),
            404 => "Public repository/revision unavailable. Private repositories and implicit authentication are not supported.".into(),
            300..=399 => "GitHub redirected this repository. Paste its canonical destination URL; redirects are not followed.".into(),
            code => format!("GitHub returned HTTP {code}; no source was accepted."),
        });
    }
    if response.content_length().is_some_and(|n| n > max as u64) {
        return Err("GitHub response exceeds its byte limit".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "GitHub download interrupted")?
    {
        append_chunk(&mut bytes, &chunk, max)?;
    }
    Ok(bytes)
}
async fn discover_repository(input: &str) -> Result<RepositorySnapshot, String> {
    let repo = Repository::parse(input)?;
    let client = client()?;
    // The single-commit endpoint includes file patches; the list endpoint keeps discovery metadata-only.
    let suffix = if repo.reference == "HEAD" {
        "commits?per_page=1".to_string()
    } else {
        format!("commits?per_page=1&sha={}", repo.reference)
    };
    let data = get(
        &client,
        reqwest::Url::parse(&repo.api(&suffix)).map_err(|_| "Invalid repository endpoint")?,
        512 * 1024,
    )
    .await?;
    let mut commits: Vec<CommitResponse> =
        serde_json::from_slice(&data).map_err(|_| "Malformed GitHub commit response")?;
    if commits.len() != 1 {
        return Err("Expected one resolved repository commit".into());
    }
    let commit = commits.pop().unwrap();
    if !git_hash(&commit.sha)
        || !git_hash(&commit.commit.tree.sha)
        || (repo.reference != "HEAD" && repo.reference != commit.sha)
    {
        return Err("GitHub commit identity mismatch".into());
    }
    let data = get(
        &client,
        reqwest::Url::parse(
            &repo.api(&format!("git/trees/{}?recursive=1", commit.commit.tree.sha)),
        )
        .map_err(|_| "Invalid tree endpoint")?,
        4 * 1024 * 1024,
    )
    .await?;
    let tree: TreeResponse =
        serde_json::from_slice(&data).map_err(|_| "Malformed GitHub tree response")?;
    if tree.sha != commit.commit.tree.sha {
        return Err("GitHub tree identity mismatch".into());
    }
    snapshot(repo, commit.sha, tree)
}
async fn acquire(
    source: &RepositorySnapshot,
    entry: &str,
    attribution: &[String],
) -> Result<Package, String> {
    let files = selected(source, entry, attribution)?;
    let origin = source
        .discovery
        .repository
        .as_ref()
        .ok_or("Missing repository provenance")?;
    let client = client()?;
    let mut contents = BTreeMap::new();
    let mut origins = BTreeMap::new();
    for (file, relative) in files {
        let mut url = reqwest::Url::parse("https://raw.githubusercontent.com/").unwrap();
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| "Invalid resource endpoint")?;
            segments
                .pop_if_empty()
                .push(&source.repository.owner)
                .push(&source.repository.name)
                .push(&origin.commit);
            for part in file.path.split('/') {
                segments.push(part);
            }
        }
        let bytes = get(&client, url, file.size.unwrap()).await?;
        if bytes.len() != file.size.unwrap() {
            return Err("Pinned resource size mismatch; inspect again".into());
        }
        if bytes.starts_with(b"version https://git-lfs.github.com/spec/v1") {
            return Err(
                "Git LFS resources require a separate acquisition path; nothing was staged".into(),
            );
        }
        if secret_risk(&file.path, &bytes) {
            return Err("Possible credentials detected. Source was not staged; inspect a separately reviewed/redacted local copy.".into());
        }
        origins.insert(relative.clone(), file.path.clone());
        contents.insert(
            relative,
            (
                bytes,
                if file.mode == "100755" {
                    0o100755
                } else {
                    0o100644
                },
            ),
        );
    }
    assemble(
        &source.discovery.label,
        entry,
        contents,
        origins,
        Some(origin.clone()),
    )
}

type Jobs = BTreeMap<String, (Instant, Option<oneshot::Sender<()>>)>;
static JOBS: Lazy<Mutex<Jobs>> = Lazy::new(|| Mutex::new(BTreeMap::new()));
struct Job(String);
impl Drop for Job {
    fn drop(&mut self) {
        if let Ok(mut jobs) = JOBS.lock() {
            if let Some(state) = jobs.get_mut(&self.0) {
                *state = (Instant::now(), None);
            }
        }
    }
}
fn register_job(id: String) -> Result<(Job, oneshot::Receiver<()>), String> {
    id_check(&id)?;
    let (send, cancel) = oneshot::channel();
    {
        let mut jobs = JOBS
            .lock()
            .map_err(|_| "Repository job state unavailable")?;
        jobs.retain(|_, (at, sender)| sender.is_some() || at.elapsed() < TTL);
        if jobs.contains_key(&id) {
            return Err(
                "Repository request cancelled or already used; start a new inspection".into(),
            );
        }
        if jobs.len() >= 256 || jobs.values().filter(|(_, sender)| sender.is_some()).count() >= 2 {
            return Err(
                "Repository inspection capacity reached; cancel or finish the current requests"
                    .into(),
            );
        }
        jobs.insert(id.clone(), (Instant::now(), Some(send)));
    }
    Ok((Job(id), cancel))
}
async fn run_job<T>(
    id: String,
    work: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let (_job, cancel) = register_job(id)?;
    tokio::select! {
        biased;
        _ = cancel => Err("Repository inspection cancelled".into()),
        result = tokio::time::timeout(Duration::from_secs(90), work) => result.map_err(|_| "Repository inspection exceeded 90 seconds; nothing was staged")?,
    }
}
async fn run_capture_job<T, R>(
    id: String,
    work: impl Future<Output = Result<T, String>>,
    publish: impl FnOnce(T) -> Result<R, String>,
) -> Result<R, String> {
    let (_job, cancel) = register_job(id.clone())?;
    let value = tokio::select! {
        biased;
        _ = cancel => return Err("Repository inspection cancelled; nothing was staged".into()),
        result = tokio::time::timeout(Duration::from_secs(90), work) => result.map_err(|_| "Repository inspection exceeded 90 seconds; nothing was staged")??,
    };
    let mut jobs = JOBS
        .lock()
        .map_err(|_| "Repository job state unavailable")?;
    let state = jobs.get_mut(&id).ok_or("Repository capture expired")?;
    if state.1.is_none() {
        return Err("Repository inspection cancelled; nothing was staged".into());
    }
    // Cancellation and durable publication have one ordering point; publication is bounded synchronous work.
    let result = publish(value);
    *state = (Instant::now(), None);
    drop(jobs);
    result
}
#[tauri::command]
pub fn intake_github_cancel(job_id: String) -> Result<(), String> {
    id_check(&job_id)?;
    let mut jobs = JOBS
        .lock()
        .map_err(|_| "Repository job state unavailable")?;
    jobs.retain(|_, (at, sender)| sender.is_some() || at.elapsed() < TTL);
    if let Some((at, sender)) = jobs.get_mut(&job_id) {
        if let Some(sender) = sender.take() {
            let _ = sender.send(());
        }
        *at = Instant::now();
    } else if jobs.len() < 256 {
        jobs.insert(job_id, (Instant::now(), None));
    }
    Ok(())
}
#[cfg(test)]
pub(super) async fn live_pinned_taste_packages() -> Result<Vec<Package>, String> {
    let source = run_job(
        ulid::Ulid::new().to_string(),
        discover_repository(
            "https://github.com/Leonxlnx/taste-skill/tree/e79ca9ec7e071eb3a3b623c4fb752e853fc3ed58",
        ),
    )
    .await?;
    assert_eq!(source.discovery.entries.len(), 13);
    let mut packages = Vec::new();
    for entry in [
        "skills/taste-skill/SKILL.md",
        "skills/stitch-skill/SKILL.md",
    ] {
        packages.push(
            run_job(
                ulid::Ulid::new().to_string(),
                acquire(&source, entry, &["LICENSE".into()]),
            )
            .await?,
        );
    }
    Ok(packages)
}

#[tauri::command]
pub async fn intake_github_discover(url: String, job_id: String) -> Result<Discovery, String> {
    let source = run_job(job_id, discover_repository(&url)).await?;
    let mut session = SESSION
        .lock()
        .map_err(|_| "Inspection session unavailable")?;
    session.expire();
    if session.github_sources.len() >= 4 {
        return Err("Too many open repository inspections".into());
    }
    let discovery = source.discovery.clone();
    session
        .github_sources
        .insert(discovery.id.clone(), (Instant::now(), source));
    Ok(discovery)
}
#[tauri::command]
pub async fn intake_github_inspect(
    discovery_id: String,
    entrypoint: String,
    attribution: Vec<String>,
    job_id: String,
) -> Result<Candidate, String> {
    let source = {
        let mut session = SESSION
            .lock()
            .map_err(|_| "Inspection session unavailable")?;
        session.expire();
        session
            .github_sources
            .get(&discovery_id)
            .map(|(_, s)| s.clone())
            .ok_or("Repository inspection expired; inspect the link again")?
    };
    let package = run_job(job_id, acquire(&source, &entrypoint, &attribution)).await?;
    let mut session = SESSION
        .lock()
        .map_err(|_| "Inspection session unavailable")?;
    session.expire();
    if session.packages.len() >= 4 {
        return Err("Too many open package previews".into());
    }
    let summary = package.summary.clone();
    session
        .packages
        .insert(summary.id.clone(), (Instant::now(), package));
    Ok(summary)
}

#[cfg(test)]
mod tests;
