use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::future::BoxFuture;
mod store;
pub mod prepared;
const RECIPE_ID: &str = "2048-classic-v1";
const SOURCE_LIMIT: usize = 256 * 1024;
const RECORD_LIMIT: usize = 384 * 1024;
const CAPACITY: usize = 8;
const PRIMARY_TREE: &str = "693fbb47db2d71aa65cc0e566a288473970233e6";
const DECLARATION: &str = include_str!("../../../../src/features/staticApps/recipe2048.json");

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Recipe {
    version: u8,
    id: String,
    primary_repository: String,
    primary_commit: String,
    engine_paths: Vec<String>,
    files: Vec<Spec>,
    excluded: Vec<String>,
    limitations: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Spec {
    repository: String,
    commit: String,
    path: String,
    bytes: usize,
    sha256: String,
    git_blob_sha: String,
    kind: String,
    package_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_mode: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceFile {
    repository: String,
    commit: String,
    path: String,
    source_mode: String,
    data_base64: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourcePacket {
    version: u8,
    recipe_id: String,
    files: Vec<SourceFile>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceEvidence {
    repository: String,
    commit: String,
    path: String,
    source_mode: String,
    bytes: usize,
    sha256: String,
    git_blob_sha: String,
    package_path: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureOrigin {
    url: String,
    requested_ref: String,
    commit: String,
    tree: String,
}
impl From<RepositoryOrigin> for CaptureOrigin {
    fn from(origin: RepositoryOrigin) -> Self {
        Self {
            url: origin.url,
            requested_ref: origin.requested_ref,
            commit: origin.commit,
            tree: origin.tree,
        }
    }
}
impl CaptureOrigin {
    fn validate(&self) -> Result<(), String> {
        RepositoryOrigin {
            url: self.url.clone(),
            requested_ref: self.requested_ref.clone(),
            commit: self.commit.clone(),
            tree: self.tree.clone(),
        }
        .validate()
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureSummary {
    schema_version: u8,
    id: String,
    recipe_id: String,
    source_hash: String,
    capture_hash: String,
    total_bytes: usize,
    file_count: usize,
    created_at: u64,
    origins: Vec<CaptureOrigin>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StaticCapture {
    summary: CaptureSummary,
    packet: SourcePacket,
}
fn source_key(repo: &str, commit: &str, path: &str) -> String {
    format!("{repo}@{commit}/{path}")
}
fn hash_check(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn recipe(id: &str) -> Result<Recipe, String> {
    if id != RECIPE_ID {
        return Err("Unsupported static-app recipe; no repository conversion was attempted".into());
    }
    let mut r: Recipe =
        serde_json::from_str(DECLARATION).map_err(|_| "Owned static-app recipe is invalid")?;
    let mut keys = HashSet::new();
    let mut paths = HashSet::new();
    if r.version != 1
        || r.id != RECIPE_ID
        || r.primary_repository != "gabrielecirulli/2048"
        || r.primary_commit != "478b6ec346e3787f589e4af751378d06ded4cbbc"
        || r.files.len() != 24
        || r.engine_paths.len() != 7
        || r.excluded.is_empty()
        || r.limitations.is_empty()
    {
        return Err("Owned recipe identity or limits changed".into());
    }
    for f in &r.files {
        let repo = Repository::parse(&format!(
            "https://github.com/{}/tree/{}",
            f.repository, f.commit
        ))?;
        if !git_hash(&repo.reference)
            || !git_hash(&f.git_blob_sha)
            || !hash_check(&f.sha256)
            || f.bytes == 0
            || f.bytes > 128 * 1024
            || !["text", "font"].contains(&f.kind.as_str())
            || f.source_mode
                .as_ref()
                .is_some_and(|m| !["100644", "100755"].contains(&m.as_str()))
            || !keys.insert(source_key(&f.repository, &f.commit, &f.path))
            || !paths.insert(f.package_path.to_ascii_lowercase())
        {
            return Err("Owned recipe contains unsupported files".into());
        }
        safe_dir::relative(&f.path)?;
        safe_dir::relative(&f.package_path)?;
    }
    if r.files.iter().map(|f| f.bytes).sum::<usize>() > SOURCE_LIMIT {
        return Err("Owned recipe exceeds source bounds".into());
    }
    r.files
        .sort_by_key(|f| source_key(&f.repository, &f.commit, &f.path));
    Ok(r)
}
fn selected_entry<'a>(
    source: &'a RepositorySnapshot,
    spec: &Spec,
) -> Result<&'a TreeEntry, String> {
    let origin = source
        .discovery
        .repository
        .as_ref()
        .ok_or("Missing pinned repository origin")?;
    if origin.url != format!("https://github.com/{}", spec.repository)
        || origin.requested_ref != spec.commit
        || origin.commit != spec.commit
    {
        return Err("Recipe repository/revision mismatch".into());
    }
    let parts: Vec<_> = spec.path.split('/').collect();
    for i in 1..parts.len() {
        let prefix = parts[..i].join("/");
        let parent = source
            .entries
            .iter()
            .find(|e| e.path == prefix)
            .ok_or("Recipe ancestor directory missing")?;
        if parent.kind != "tree" || parent.mode != "040000" || !git_hash(&parent.sha) {
            return Err("Recipe source has a link, submodule or non-directory ancestor".into());
        }
    }
    if source
        .entries
        .iter()
        .filter(|e| e.path.eq_ignore_ascii_case(&spec.path))
        .count()
        != 1
    {
        return Err("Recipe source path is missing or case-ambiguous".into());
    }
    let e = source
        .entries
        .iter()
        .find(|e| e.path == spec.path)
        .ok_or("Recipe source path missing")?;
    if e.kind != "blob"
        || !["100644", "100755"].contains(&e.mode.as_str())
        || spec.source_mode.as_ref().is_some_and(|m| m != &e.mode)
        || e.sha != spec.git_blob_sha
        || e.size != Some(spec.bytes)
    {
        return Err("Pinned recipe blob, size or mode changed".into());
    }
    Ok(e)
}
fn checked_bytes(spec: &Spec, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() != spec.bytes
        || hash(bytes) != spec.sha256
        || bytes.starts_with(b"version https://git-lfs.github.com/spec/v1")
        || secret_risk(&spec.path, bytes)
    {
        return Err(format!(
            "Pinned recipe bytes failed integrity: {}",
            spec.path
        ));
    }
    if spec.kind == "text" {
        let text = std::str::from_utf8(bytes).map_err(|_| "Recipe text is not UTF-8")?;
        if text.contains('\0') || text.starts_with("#!") {
            return Err("Recipe text contains unsupported executable/binary content".into());
        }
    }
    Ok(())
}
fn validate_packet(packet: &SourcePacket) -> Result<(Vec<SourceEvidence>, String), String> {
    let r = recipe(&packet.recipe_id)?;
    if packet.version != 1 || packet.files.len() != r.files.len() {
        return Err("Invalid complete recipe source packet".into());
    }
    let catalog: BTreeMap<_, _> = r
        .files
        .iter()
        .map(|f| (source_key(&f.repository, &f.commit, &f.path), f))
        .collect();
    let mut seen = HashSet::new();
    let mut evidence = Vec::new();
    for f in &packet.files {
        if f.repository.len() > 128 || f.commit.len() != 40 || f.path.len() > 240 {
            return Err("Source identity exceeds bounds".into());
        }
        let key = source_key(&f.repository, &f.commit, &f.path);
        let spec = catalog
            .get(&key)
            .ok_or("Source is not part of the pinned recipe")?;
        if !seen.insert(key)
            || !["100644", "100755"].contains(&f.source_mode.as_str())
            || spec
                .source_mode
                .as_ref()
                .is_some_and(|m| m != &f.source_mode)
            || f.data_base64.len() != 4 * spec.bytes.div_ceil(3)
        {
            return Err("Duplicate source or invalid mode/byte limits".into());
        }
        let bytes = STANDARD
            .decode(&f.data_base64)
            .map_err(|_| "Invalid source byte encoding")?;
        if STANDARD.encode(&bytes) != f.data_base64 {
            return Err("Noncanonical source byte encoding".into());
        }
        checked_bytes(spec, &bytes)?;
        evidence.push(SourceEvidence {
            repository: f.repository.clone(),
            commit: f.commit.clone(),
            path: f.path.clone(),
            source_mode: f.source_mode.clone(),
            bytes: spec.bytes,
            sha256: spec.sha256.clone(),
            git_blob_sha: spec.git_blob_sha.clone(),
            package_path: spec.package_path.clone(),
        });
    }
    evidence.sort_by_key(|f| source_key(&f.repository, &f.commit, &f.path));
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Identity<'a> {
        version: u8,
        recipe_id: &'a str,
        files: &'a [SourceEvidence],
    }
    let encoded = serde_json::to_vec(&Identity {
        version: 1,
        recipe_id: RECIPE_ID,
        files: &evidence,
    })
    .map_err(|_| "Cannot encode source identity")?;
    Ok((evidence, hash(&encoded)))
}
fn validate_origins(origins: &[CaptureOrigin]) -> Result<(), String> {
    let r = recipe(RECIPE_ID)?;
    let expected: BTreeMap<_, _> = r
        .files
        .iter()
        .map(|f| {
            (
                format!("https://github.com/{}", f.repository),
                f.commit.clone(),
            )
        })
        .collect();
    if origins.len() != expected.len() {
        return Err("Incomplete recipe origin inventory".into());
    }
    let mut seen = HashSet::new();
    for origin in origins {
        origin.validate()?;
        if !seen.insert(origin.url.clone())
            || expected.get(&origin.url) != Some(&origin.commit)
            || origin.requested_ref != origin.commit
            || (origin.url == "https://github.com/gabrielecirulli/2048"
                && origin.tree != PRIMARY_TREE)
        {
            return Err("Recipe origin identity changed".into());
        }
    }
    Ok(())
}
fn capture_hash(summary: &CaptureSummary, packet: &SourcePacket) -> Result<String, String> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Identity<'a> {
        schema_version: u8,
        id: &'a str,
        recipe_id: &'a str,
        source_hash: &'a str,
        total_bytes: usize,
        created_at: u64,
        origins: &'a [CaptureOrigin],
        packet: &'a SourcePacket,
    }
    serde_json::to_vec(&Identity {
        schema_version: summary.schema_version,
        id: &summary.id,
        recipe_id: &summary.recipe_id,
        source_hash: &summary.source_hash,
        total_bytes: summary.total_bytes,
        created_at: summary.created_at,
        origins: &summary.origins,
        packet,
    })
    .map(|b| hash(&b))
    .map_err(|_| "Cannot bind source capture".into())
}
fn validate_capture(capture: &StaticCapture) -> Result<(), String> {
    let s = &capture.summary;
    id_check(&s.id)?;
    if ulid::Ulid::from_string(&s.id)
        .map_err(|_| "Invalid capture ID")?
        .to_string()
        != s.id
    {
        return Err("Noncanonical captured source identity".into());
    }
    if s.schema_version != 1
        || s.recipe_id != RECIPE_ID
        || s.file_count != 24
        || s.created_at > 9_007_199_254_740_991
        || !hash_check(&s.source_hash)
        || !hash_check(&s.capture_hash)
    {
        return Err("Unsupported static source capture metadata".into());
    }
    validate_origins(&s.origins)?;
    let (evidence, source_hash) = validate_packet(&capture.packet)?;
    if source_hash != s.source_hash
        || evidence.iter().map(|f| f.bytes).sum::<usize>() != s.total_bytes
        || s.total_bytes > SOURCE_LIMIT
        || capture_hash(s, &capture.packet)? != s.capture_hash
        || serde_json::to_vec(capture)
            .map_err(|_| "Cannot encode capture")?
            .len()
            > RECORD_LIMIT
    {
        return Err("Static source capture integrity mismatch".into());
    }
    Ok(())
}
trait Transport: Sync {
    fn discover<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Result<RepositorySnapshot, String>>;
    fn download<'a>(
        &'a self,
        source: &'a RepositorySnapshot,
        file: &'a TreeEntry,
    ) -> BoxFuture<'a, Result<Vec<u8>, String>>;
}
struct HttpTransport(reqwest::Client);
impl Transport for HttpTransport {
    fn discover<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Result<RepositorySnapshot, String>> {
        Box::pin(discover_repository(url))
    }
    fn download<'a>(
        &'a self,
        source: &'a RepositorySnapshot,
        file: &'a TreeEntry,
    ) -> BoxFuture<'a, Result<Vec<u8>, String>> {
        Box::pin(async move {
            let origin = source
                .discovery
                .repository
                .as_ref()
                .ok_or("Missing pinned repository")?;
            let mut url = reqwest::Url::parse("https://raw.githubusercontent.com/").unwrap();
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| "Invalid recipe endpoint")?;
            segments
                .pop_if_empty()
                .push(&source.repository.owner)
                .push(&source.repository.name)
                .push(&origin.commit);
            for part in file.path.split('/') {
                segments.push(part);
            }
            drop(segments);
            get(&self.0, url, file.size.ok_or("Missing pinned recipe size")?).await
        })
    }
}
async fn acquire_recipe(id: &str, transport: &impl Transport) -> Result<StaticCapture, String> {
    let r = recipe(id)?;
    let mut packet = SourcePacket {
        version: 1,
        recipe_id: RECIPE_ID.into(),
        files: Vec::new(),
    };
    let mut origins = Vec::new();
    let repositories: BTreeMap<_, _> = r
        .files
        .iter()
        .map(|f| (f.repository.clone(), f.commit.clone()))
        .collect();
    for (name, commit) in repositories {
        let url = format!("https://github.com/{name}/tree/{commit}");
        let source = transport.discover(&url).await?;
        let origin = source
            .discovery
            .repository
            .clone()
            .ok_or("Missing recipe origin")?;
        if origin.url != format!("https://github.com/{name}")
            || origin.commit != commit
            || origin.requested_ref != commit
            || (name == "gabrielecirulli/2048" && origin.tree != PRIMARY_TREE)
        {
            return Err("Resolved recipe commit/tree identity mismatch".into());
        }
        for spec in r.files.iter().filter(|f| f.repository == name) {
            let entry = selected_entry(&source, spec)?;
            let bytes = transport.download(&source, entry).await?;
            checked_bytes(spec, &bytes)?;
            packet.files.push(SourceFile {
                repository: spec.repository.clone(),
                commit: spec.commit.clone(),
                path: spec.path.clone(),
                source_mode: entry.mode.clone(),
                data_base64: STANDARD.encode(bytes),
            });
        }
        origins.push(CaptureOrigin::from(origin));
    }
    packet
        .files
        .sort_by_key(|f| source_key(&f.repository, &f.commit, &f.path));
    origins.sort_by(|a, b| a.url.cmp(&b.url));
    let (evidence, source_hash) = validate_packet(&packet)?;
    let mut summary = CaptureSummary {
        schema_version: 1,
        id: ulid::Ulid::new().to_string(),
        recipe_id: RECIPE_ID.into(),
        source_hash,
        capture_hash: String::new(),
        total_bytes: evidence.iter().map(|f| f.bytes).sum(),
        file_count: evidence.len(),
        created_at: now(),
        origins,
    };
    summary.capture_hash = capture_hash(&summary, &packet)?;
    let result = StaticCapture { summary, packet };
    validate_capture(&result)?;
    Ok(result)
}
#[tauri::command]
pub async fn intake_static_fetch(
    app: AppHandle,
    recipe_id: String,
    job_id: String,
) -> Result<StaticCapture, String> {
    recipe(&recipe_id)?;
    let transport = HttpTransport(client()?);
    run_capture_job(job_id, acquire_recipe(&recipe_id, &transport), |capture| {
        let mut conn = database(&app)?;
        conn.busy_timeout(Duration::from_millis(500))
            .map_err(|_| "Capture database timeout unavailable")?;
        store::publish(&mut conn, &capture)?;
        Ok(capture)
    })
    .await
}
#[tauri::command]
pub async fn intake_static_cancel(job_id: String) -> Result<(), String> {
    blocking(move || intake_github_cancel(job_id)).await
}
#[tauri::command]
pub async fn intake_static_list(app: AppHandle) -> Result<Vec<CaptureSummary>, String> {
    blocking(move || store::list(&database(&app)?)).await
}
#[tauri::command]
pub async fn intake_static_read(
    app: AppHandle,
    id: String,
    expected_hash: String,
) -> Result<StaticCapture, String> {
    blocking(move || {
        let capture = store::load(&database(&app)?, &id)?;
        if capture.summary.capture_hash != expected_hash {
            return Err("Captured source changed; reload before preparation".into());
        }
        Ok(capture)
    })
    .await
}
#[tauri::command]
pub async fn intake_static_discard(
    app: AppHandle,
    id: String,
    expected_hash: String,
) -> Result<(), String> {
    blocking(move || store::discard(&mut database(&app)?, &id, &expected_hash)).await
}

#[cfg(test)]
mod tests;
#[cfg(test)]
pub(in crate::intake) mod acceptance;
