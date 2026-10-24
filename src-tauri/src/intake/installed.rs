use super::*;
use rusqlite::OptionalExtension;

const MAX_INSTALLED: usize = 24;
const MAX_INSTALLED_BYTES: usize = 128 * 1024 * 1024;
const MAX_CONTEXT_BYTES: usize = 256 * 1024;

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    skill_id: String,
    enabled: bool,
    active: Candidate,
    versions: Vec<Candidate>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextSelection {
    skill_id: String,
    version_id: String,
    paths: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPart {
    skill_id: String,
    version_id: String,
    path: String,
    sha256: String,
    text: String,
}
fn skill_id_check(id: &str) -> Result<(), String> {
    id_check(
        id.strip_prefix("imported:")
            .ok_or("Not an imported skill identity")?,
    )
}
fn owned(conn: &Connection, id: &str, expected: Option<&str>) -> Result<InstalledSkill, String> {
    skill_id_check(id)?;
    let (version, enabled, name, instructions, tools, builtin): (String, bool, String, String, String, bool) = conn.query_row(
        "SELECT l.active_version,l.enabled,s.name,s.instructions,s.tools_json,s.builtin FROM skill_package_links l JOIN skills s ON s.id=l.skill_id WHERE l.skill_id=?1", [id],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?)),
    ).map_err(|_| "Imported skill unavailable; reload Skill Codex")?;
    if expected.is_some_and(|v| v != version) {
        return Err("Installed version changed; review it again".into());
    }
    let mut stmt = conn.prepare("SELECT id FROM skill_package_versions WHERE skill_id=?1 ORDER BY created_at DESC,id LIMIT 3").map_err(|_| "Cannot read installed versions")?;
    let ids = stmt
        .query_map([id], |r| r.get::<_, String>(0))
        .map_err(|_| "Cannot read installed versions")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Cannot read installed versions")?;
    if ids.is_empty() || ids.len() > 2 || !ids.contains(&version) {
        return Err("Invalid installed version ownership".into());
    }
    let versions = ids
        .iter()
        .map(|v| load_package(conn, v, true).map(|p| p.summary))
        .collect::<Result<Vec<_>, _>>()?;
    let active = versions.iter().find(|v| v.id == version).unwrap().clone();
    if name != active.metadata.name || !instructions.is_empty() || tools != "[]" || builtin {
        return Err("Imported skill identity/instruction authority mismatch".into());
    }
    Ok(InstalledSkill {
        skill_id: id.into(),
        enabled,
        active,
        versions,
    })
}
fn list_installed(conn: &Connection) -> Result<Vec<InstalledSkill>, String> {
    let (count, bytes): (usize, usize) = conn
        .query_row(
            "SELECT count(*),coalesce(sum(total_bytes),0) FROM skill_package_versions",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Cannot load installed packages; update the native app")?;
    if count > MAX_INSTALLED * 2 || bytes > MAX_INSTALLED_BYTES {
        return Err("Installed package quota exceeded".into());
    }
    let mut stmt = conn
        .prepare("SELECT skill_id FROM skill_package_links ORDER BY skill_id LIMIT 25")
        .map_err(|_| "Cannot load installed skills")?;
    let ids = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| "Cannot load installed skills")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Cannot load installed skills")?;
    if ids.len() > MAX_INSTALLED {
        return Err("Installed skill quota exceeded".into());
    }
    ids.iter().map(|id| owned(conn, id, None)).collect()
}
fn same_source(a: &Candidate, b: &Candidate) -> bool {
    a.metadata.name == b.metadata.name
        && a.entrypoint == b.entrypoint
        && match (&a.repository, &b.repository) {
            (Some(a), Some(b)) => a.url == b.url,
            (None, None) => a.source_label == b.source_label,
            _ => false,
        }
}
fn promote(
    conn: &mut Connection,
    candidate_id: &str,
    expected_hash: &str,
    target: Option<(&str, &str)>,
    acknowledged: bool,
) -> Result<InstalledSkill, String> {
    id_check(candidate_id)?;
    if !acknowledged {
        return Err(
            "Review the source, attribution and instruction-only installation first".into(),
        );
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Cannot begin skill installation")?;
    let receipt: Option<(String,String,bool)> = tx.query_row("SELECT manifest_hash,skill_id,removed FROM skill_package_receipts WHERE candidate_id=?1", [candidate_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|_| "Cannot read installation receipt")?;
    if let Some((hash, id, removed)) = receipt {
        if hash != expected_hash || removed || target.is_some_and(|(t, _)| t != id) {
            return Err("Installation receipt conflicts or was removed; inspect again".into());
        }
        return owned(&tx, &id, Some(candidate_id));
    }
    let package = load(&tx, candidate_id)?;
    if package.summary.artifact_hash != expected_hash {
        return Err("Reviewed artifact changed; nothing was installed".into());
    }
    if !package
        .summary
        .files
        .iter()
        .any(|f| attribution_name(&f.path))
    {
        return Err("Include the source LICENSE/NOTICE bytes and review distribution rights before installing".into());
    }
    let existing = list_installed(&tx)?;
    let (id, previous, enabled) = if let Some((id, expected)) = target {
        let installed = owned(&tx, id, Some(expected))?;
        if !same_source(&installed.active, &package.summary) {
            return Err("This is a different source or skill; install it separately".into());
        }
        (id.to_string(), Some(installed.active.id), installed.enabled)
    } else {
        if existing.len() >= MAX_INSTALLED {
            return Err("24 imported skills are already installed".into());
        }
        (format!("imported:{}", ulid::Ulid::new()), None, true)
    };
    let s = &package.summary;
    if previous.is_none() {
        // Package instructions never enter the legacy freeform/grant path.
        tx.execute("INSERT INTO skills(id,name,icon,accent,instructions,tools_json,builtin,created_at,updated_at) VALUES (?1,?2,'BookOpen','#b14cff','','[]',0,?3,?3)", params![id,s.metadata.name,s.created_at]).map_err(|_| "Cannot create host-owned skill identity")?;
    }
    tx.execute("INSERT INTO skill_package_versions(id,skill_id,schema_version,manifest_hash,summary_json,total_bytes,created_at) SELECT id,?2,schema_version,manifest_hash,summary_json,total_bytes,created_at FROM skill_intake_candidates WHERE id=?1", params![candidate_id,id]).map_err(|_| "Cannot publish skill version")?;
    tx.execute("INSERT INTO skill_package_files SELECT candidate_id,path,sha256,contents FROM skill_intake_files WHERE candidate_id=?1", [candidate_id]).map_err(|_| "Cannot publish skill resources")?;
    tx.execute("INSERT INTO skill_package_links(skill_id,active_version,enabled) VALUES (?1,?2,?3) ON CONFLICT(skill_id) DO UPDATE SET active_version=excluded.active_version", params![id,candidate_id,enabled]).map_err(|_| "Cannot publish active version")?;
    tx.execute(
        "DELETE FROM skill_package_versions WHERE skill_id=?1 AND id<>?2 AND id<>?3",
        params![
            id,
            candidate_id,
            previous.as_deref().unwrap_or(candidate_id)
        ],
    )
    .map_err(|_| "Cannot retain rollback version")?;
    tx.execute(
        "INSERT INTO skill_package_receipts(candidate_id,manifest_hash,skill_id) VALUES (?1,?2,?3)",
        params![candidate_id, expected_hash, id],
    )
    .map_err(|_| "Cannot retain installation receipt")?;
    tx.execute(
        "DELETE FROM skill_intake_candidates WHERE id=?1",
        [candidate_id],
    )
    .map_err(|_| "Cannot consume staged candidate")?;
    let installed = list_installed(&tx)?
        .into_iter()
        .find(|s| s.skill_id == id)
        .ok_or("Installed skill was not published")?;
    tx.commit()
        .map_err(|_| "Could not commit installation; previous skills are unchanged")?;
    Ok(installed)
}
fn change(
    conn: &mut Connection,
    id: &str,
    expected: &str,
    action: &str,
    version: Option<&str>,
) -> Result<(), String> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Cannot begin skill change")?;
    let installed = owned(&tx, id, Some(expected))?;
    match action {
        "enable" | "disable" => {
            tx.execute(
                "UPDATE skill_package_links SET enabled=?2 WHERE skill_id=?1",
                params![id, action == "enable"],
            )
            .map_err(|_| "Cannot change enabled state")?;
        }
        "rollback" => {
            let v = version.ok_or("Choose a retained version")?;
            if !installed.versions.iter().any(|s| s.id == v) {
                return Err("Rollback version does not belong to this skill".into());
            }
            tx.execute(
                "UPDATE skill_package_links SET active_version=?2 WHERE skill_id=?1",
                params![id, v],
            )
            .map_err(|_| "Cannot roll back skill")?;
        }
        "remove" => {
            tx.execute(
                "UPDATE skill_package_receipts SET removed=1 WHERE skill_id=?1",
                [id],
            )
            .map_err(|_| "Cannot retain removal receipt")?;
            tx.execute("DELETE FROM skill_package_links WHERE skill_id=?1", [id])
                .map_err(|_| "Cannot remove installed link")?;
            tx.execute("DELETE FROM skills WHERE id=?1 AND builtin=0", [id])
                .map_err(|_| "Cannot remove installed skill")?;
        }
        _ => return Err("Unsupported skill lifecycle action".into()),
    }
    tx.commit()
        .map_err(|_| "Skill change was not committed; previous state is unchanged".into())
}
fn attribution_name(path: &str) -> bool {
    [
        "LICENSE",
        "LICENSE.md",
        "LICENSE.txt",
        "NOTICE",
        "NOTICE.md",
        "NOTICE.txt",
    ]
    .contains(&path.rsplit('/').next().unwrap_or(""))
}
fn context(
    conn: &mut Connection,
    selections: &[ContextSelection],
) -> Result<Vec<ContextPart>, String> {
    if selections.is_empty() || selections.len() > 4 {
        return Err("Select between one and four imported skills".into());
    }
    let tx = conn
        .transaction()
        .map_err(|_| "Cannot begin skill context read")?;
    let mut ids = HashSet::new();
    let mut out = Vec::new();
    let mut total = 0;
    for selected in selections {
        if !ids.insert(&selected.skill_id) || selected.paths.len() > 8 {
            return Err("Duplicate skill or too many resources".into());
        }
        let installed = owned(&tx, &selected.skill_id, Some(&selected.version_id))?;
        if !installed.enabled {
            return Err("An attached imported skill is disabled; enable it or detach it".into());
        }
        let package = load_package(&tx, &selected.version_id, true)?;
        let main = format!("{}/SKILL.md", package.summary.metadata.name);
        let mut paths = HashSet::new();
        for path in std::iter::once(&main).chain(selected.paths.iter()) {
            safe_dir::relative(path)?;
            if !paths.insert(path) {
                return Err("Duplicate attached resource".into());
            }
            let file = package
                .summary
                .files
                .iter()
                .find(|f| &f.path == path)
                .ok_or("Selected resource is not in this version")?;
            let bytes = package
                .contents
                .get(path)
                .ok_or("Selected resource unavailable")?;
            if !matches!(file.kind.as_str(), "text" | "attribution")
                || file.source_mode == 0o100755
                || bytes.starts_with(b"#!")
                || !(attribution_name(path)
                    || ["md", "txt", "json", "csv"].contains(
                        &path
                            .rsplit('.')
                            .next()
                            .unwrap_or("")
                            .to_ascii_lowercase()
                            .as_str(),
                    ))
            {
                return Err("Only Markdown, text, JSON, CSV and attribution may be attached; scripts and opaque resources stay inactive".into());
            }
            let text =
                std::str::from_utf8(bytes).map_err(|_| "Selected resource is not UTF-8 text")?;
            if text.contains('\0') {
                return Err("Selected resource contains binary data".into());
            }
            total += bytes.len();
            if total > MAX_CONTEXT_BYTES {
                return Err("Skill context exceeds 256 KiB; choose fewer resources. Nothing was truncated or sent.".into());
            }
            out.push(ContextPart {
                skill_id: selected.skill_id.clone(),
                version_id: selected.version_id.clone(),
                path: path.clone(),
                sha256: file.sha256.clone(),
                text: text.into(),
            });
        }
    }
    Ok(out)
}
#[tauri::command]
pub async fn intake_installed(app: tauri::AppHandle) -> Result<Vec<InstalledSkill>, String> {
    tauri::async_runtime::spawn_blocking(move || list_installed(&database(&app)?))
        .await
        .map_err(|_| "Installed skill reader stopped")?
}
#[tauri::command]
pub async fn intake_install(
    app: tauri::AppHandle,
    candidate_id: String,
    expected_hash: String,
    target_id: Option<String>,
    expected_version: Option<String>,
    acknowledged: bool,
) -> Result<InstalledSkill, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = match (target_id.as_deref(), expected_version.as_deref()) {
            (None, None) => None,
            (Some(id), Some(v)) => Some((id, v)),
            _ => return Err("Incomplete update identity".into()),
        };
        promote(
            &mut database(&app)?,
            &candidate_id,
            &expected_hash,
            target,
            acknowledged,
        )
    })
    .await
    .map_err(|_| "Installation worker stopped")?
}
#[tauri::command]
pub async fn intake_skill_change(
    app: tauri::AppHandle,
    skill_id: String,
    expected_version: String,
    action: String,
    version: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        change(
            &mut database(&app)?,
            &skill_id,
            &expected_version,
            &action,
            version.as_deref(),
        )
    })
    .await
    .map_err(|_| "Skill lifecycle worker stopped")?
}
#[tauri::command]
pub async fn intake_skill_context(
    app: tauri::AppHandle,
    selections: Vec<ContextSelection>,
) -> Result<Vec<ContextPart>, String> {
    tauri::async_runtime::spawn_blocking(move || context(&mut database(&app)?, &selections))
        .await
        .map_err(|_| "Skill context reader stopped")?
}
#[tauri::command]
pub async fn intake_installed_read(
    app: tauri::AppHandle,
    skill_id: String,
    expected_version: String,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = database(&app)?;
        owned(&conn, &skill_id, Some(&expected_version))?;
        safe_dir::relative(&path)?;
        let package = load_package(&conn, &expected_version, true)?;
        let bytes = package
            .contents
            .get(&path)
            .ok_or("Resource is not in this installed version")?;
        if bytes.len() > MAX_CONTEXT_BYTES {
            return Err("Preview exceeds 256 KiB; original bytes are preserved".into());
        }
        let text = std::str::from_utf8(bytes).map_err(|_| "Opaque resource has no text preview")?;
        if text.contains('\0') {
            return Err("Opaque resource has no text preview".into());
        }
        Ok(text.into())
    })
    .await
    .map_err(|_| "Installed preview reader stopped")?
}
#[cfg(test)]
mod tests;
