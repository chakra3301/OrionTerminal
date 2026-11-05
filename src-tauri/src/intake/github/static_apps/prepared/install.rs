use super::*;
use crate::plugin_runtime::{intake, InstalledPlugin};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedApproval {
    schema_version: u8,
    id: String,
    output_hash: String,
    capture_hash: String,
    fingerprint: String,
    permissions: Vec<String>,
    rights_reviewed: bool,
}

fn install_reviewed(
    conn: &mut Connection,
    approval: PreparedApproval,
    publish: impl FnOnce(
        BTreeMap<String, Vec<u8>>,
        &str,
        Vec<String>,
        bool,
    ) -> Result<InstalledPlugin, String>,
) -> Result<InstalledPlugin, String> {
    if approval.schema_version != 1 || !approval.rights_reviewed {
        return Err(
            "Review prepared source rights and permission requests before installation".into(),
        );
    }
    id_check(&approval.id)?;
    if !hash_check(&approval.output_hash)
        || !hash_check(&approval.capture_hash)
        || !hash_check(&approval.fingerprint)
        || approval.permissions != ["storage.plugin"]
    {
        return Err("Invalid prepared installation review; nothing was installed".into());
    }
    // Keep discard/source publication behind this ordering point until package publication settles.
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Cannot lock prepared review; reload before installation")?;
    store::list(&tx)?;
    let record = store::load(&tx, &approval.id)?;
    if record.candidate.output_hash != approval.output_hash
        || record.source.capture_hash != approval.capture_hash
    {
        return Err("Prepared candidate/source changed since installation review; reload".into());
    }
    let capture = super::super::store::load(&tx, &record.source.id)?;
    let (inspection, files) = validate(&record.candidate, &capture)?;
    if inspection.fingerprint != approval.fingerprint
        || inspection.manifest.permissions != approval.permissions
    {
        return Err("Prepared package fingerprint or permissions changed; review again".into());
    }
    publish(
        files,
        &approval.fingerprint,
        approval.permissions,
        approval.rights_reviewed,
    )
}

#[tauri::command]
pub async fn intake_prepared_install(
    app: AppHandle,
    approval: PreparedApproval,
) -> Result<InstalledPlugin, String> {
    blocking(move || {
        install_reviewed(
            &mut database(&app)?,
            approval,
            |files, fingerprint, permissions, rights| {
                intake::publish_prepared_disabled(
                    &intake::prepared_packages_root(&app)?,
                    files,
                    fingerprint,
                    permissions,
                    rights,
                )
            },
        )
    })
    .await
}

#[cfg(test)]
mod tests;
