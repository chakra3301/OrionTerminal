use super::*;
use crate::plugin_runtime::{intake::inspect_captured, PluginInspection};
mod store;
pub mod install;
const OUTPUT_LIMIT: usize = 2 * 1024 * 1024;
const ENCODED_LIMIT: usize = 3 * 1024 * 1024;
const ZERO_ID: &str = "00000000000000000000000000";
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Inventory {
    path: String,
    bytes: usize,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Catalog {
    version: u8,
    recipe_id: String,
    files: Vec<Inventory>,
    manifest_template: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutputFile {
    path: String,
    bytes: usize,
    sha256: String,
    data_base64: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate {
    version: u8,
    recipe_id: String,
    candidate_id: String,
    plugin_id: String,
    source_hash: String,
    recipe_hash: String,
    output_hash: String,
    total_bytes: usize,
    files: Vec<OutputFile>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedRecord {
    schema_version: u8,
    source: CaptureSummary,
    created_at: u64,
    candidate: Candidate,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSummary {
    schema_version: u8,
    id: String,
    source: CaptureSummary,
    plugin_id: String,
    recipe_hash: String,
    output_hash: String,
    total_bytes: usize,
    created_at: u64,
    inspection: PluginInspection,
}
#[derive(Serialize)]
struct CodeHash {
    path: String,
    sha256: String,
}
fn json_bytes(value: &impl Serialize) -> Result<Vec<u8>, String> {
    let mut bytes =
        serde_json::to_vec_pretty(value).map_err(|_| "Cannot serialize owned recipe")?;
    bytes.push(b'\n');
    Ok(bytes)
}
fn owned_code() -> Vec<CodeHash> {
    [
        (
            "generator.ts",
            include_str!("../../../../../src/features/staticApps/generator.ts"),
        ),
        (
            "template.ts",
            include_str!("../../../../../src/features/staticApps/template.ts"),
        ),
        (
            "source.ts",
            include_str!("../../../../../src/features/staticApps/source.ts"),
        ),
        (
            "recipe.ts",
            include_str!("../../../../../src/features/staticApps/recipe.ts"),
        ),
        (
            "contracts.ts",
            include_str!("../../../../../src/features/staticApps/contracts.ts"),
        ),
        (
            "hash.ts",
            include_str!("../../../../../src/features/staticApps/hash.ts"),
        ),
        (
            "CHANGES.md",
            include_str!("../../../../../src/features/staticApps/changes2048.md"),
        ),
        (
            "APPEARANCE.md",
            include_str!("../../../../../src/features/staticApps/appearance2048.md"),
        ),
    ]
    .into_iter()
    .map(|(path, code)| CodeHash {
        path: path.into(),
        sha256: hash(code.as_bytes()),
    })
    .collect()
}
fn adapters() -> Vec<Inventory> {
    [
        (
            "controller.js",
            include_str!("../../../../../src/features/staticApps/adapter2048/controller.js"),
        ),
        (
            "input.js",
            include_str!("../../../../../src/features/staticApps/adapter2048/input.js"),
        ),
        (
            "boot.js",
            include_str!("../../../../../src/features/staticApps/adapter2048/boot.js"),
        ),
    ]
    .into_iter()
    .map(|(name, code)| Inventory {
        path: format!("adapter/{name}"),
        bytes: code.len(),
        sha256: hash(code.as_bytes()),
    })
    .collect()
}
fn recipe_hash(
    declaration: &Recipe,
    code: &[CodeHash],
    adapters: &[Inventory],
) -> Result<String, String> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Identity<'a> {
        declaration: &'a Recipe,
        implementation_hashes: &'a [CodeHash],
        adapter_hashes: &'a [Inventory],
        appearance_policy: &'a str,
    }
    json_bytes(&Identity {
        declaration,
        implementation_hashes: code,
        adapter_hashes: adapters,
        appearance_policy: "orion-appearance-v1/2048",
    })
    .map(|b| hash(&b))
}
fn validate(
    candidate: &Candidate,
    capture: &StaticCapture,
) -> Result<(PluginInspection, BTreeMap<String, Vec<u8>>), String> {
    validate_capture(capture)?;
    let parsed_id =
        ulid::Ulid::from_string(&candidate.candidate_id).map_err(|_| "Invalid preparation ID")?;
    if parsed_id.to_string() != candidate.candidate_id
        || candidate.version != 1
        || candidate.recipe_id != RECIPE_ID
        || candidate.source_hash != capture.summary.source_hash
        || candidate.plugin_id
            != format!(
                "dev.orion.prepared2048.{}",
                candidate.candidate_id.to_ascii_lowercase()
            )
        || candidate.files.len() != 35
        || candidate.total_bytes > OUTPUT_LIMIT
        || candidate.total_bytes == 0
        || !hash_check(&candidate.output_hash)
    {
        return Err("Prepared identity/source/version or bounds changed".into());
    }
    let declaration = recipe(RECIPE_ID)?;
    let code = owned_code();
    let adapter_hashes = adapters();
    if candidate.recipe_hash != recipe_hash(&declaration, &code, &adapter_hashes)? {
        return Err("Owned recipe changed; prepare a fresh candidate".into());
    }
    let catalog: Catalog = serde_json::from_str(include_str!(
        "../../../../../src/features/staticApps/output2048.json"
    ))
    .map_err(|_| "Owned output contract is invalid")?;
    if catalog.version != 1 || catalog.recipe_id != RECIPE_ID || catalog.files.len() != 33 {
        return Err("Unsupported owned output contract".into());
    }
    let expected: BTreeMap<_, _> = catalog.files.iter().map(|f| (f.path.clone(), f)).collect();
    if expected.len() != 33
        || adapter_hashes
            .iter()
            .any(|f| expected.get(&f.path).is_none_or(|e| *e != f))
    {
        return Err("Owned adapter/output contract changed".into());
    }
    let mut files = BTreeMap::new();
    let mut inventory = Vec::new();
    let mut total = 0usize;
    for file in &candidate.files {
        safe_dir::relative(&file.path)?;
        if file.bytes == 0
            || file.bytes > OUTPUT_LIMIT
            || file.data_base64.len() != 4 * file.bytes.div_ceil(3)
            || !hash_check(&file.sha256)
            || inventory
                .last()
                .is_some_and(|f: &Inventory| f.path >= file.path)
        {
            return Err("Prepared file ordering, paths or bounds changed".into());
        }
        total = total
            .checked_add(file.bytes)
            .filter(|n| *n <= OUTPUT_LIMIT)
            .ok_or("Prepared aggregate exceeds bounds")?;
        let bytes = STANDARD
            .decode(&file.data_base64)
            .map_err(|_| "Invalid prepared byte encoding")?;
        if bytes.len() != file.bytes
            || STANDARD.encode(&bytes) != file.data_base64
            || hash(&bytes) != file.sha256
        {
            return Err("Prepared bytes changed".into());
        }
        let item = Inventory {
            path: file.path.clone(),
            bytes: file.bytes,
            sha256: file.sha256.clone(),
        };
        if !["orion-plugin.json", "PROVENANCE.json"].contains(&file.path.as_str())
            && expected.get(&file.path).is_none_or(|f| **f != item)
        {
            return Err("Prepared payload differs from the owned recipe".into());
        }
        inventory.push(item);
        files.insert(file.path.clone(), bytes);
    }
    if total != candidate.total_bytes
        || files.len() != 35
        || expected.keys().any(|p| !files.contains_key(p))
    {
        return Err("Incomplete prepared inventory".into());
    }
    let manifest = catalog.manifest_template.replace(
        &format!("dev.orion.prepared2048.{ZERO_ID}"),
        &candidate.plugin_id,
    );
    if files.get("orion-plugin.json") != Some(&manifest.into_bytes()) {
        return Err("Prepared manifest differs from owned template".into());
    }
    let (source_inventory, _) = validate_packet(&capture.packet)?;
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Provenance<'a> {
        version: u8,
        recipe_id: &'a str,
        recipe_hash: &'a str,
        candidate_id: &'a str,
        plugin_id: &'a str,
        source_hash: &'a str,
        source_inventory: &'a [SourceEvidence],
        adapter_hashes: &'a [Inventory],
        implementation_hashes: &'a [CodeHash],
        runtime_engine_paths: &'a [String],
        runtime_adapter_paths: [&'a str; 3],
        appearance_policy: &'a str,
        limitations: &'a [String],
        excluded: &'a [String],
        payload_before_provenance: Vec<&'a Inventory>,
        authority: &'a str,
    }
    let expected_provenance = json_bytes(&Provenance {
        version: 1,
        recipe_id: RECIPE_ID,
        recipe_hash: &candidate.recipe_hash,
        candidate_id: &candidate.candidate_id,
        plugin_id: &candidate.plugin_id,
        source_hash: &candidate.source_hash,
        source_inventory: &source_inventory,
        adapter_hashes: &adapter_hashes,
        implementation_hashes: &code,
        runtime_engine_paths: &declaration.engine_paths,
        runtime_adapter_paths: ["controller.js", "input.js", "boot.js"],
        appearance_policy: "orion-appearance-v1/2048",
        limitations: &declaration.limitations,
        excluded: &declaration.excluded,
        payload_before_provenance: inventory
            .iter()
            .filter(|f| f.path != "PROVENANCE.json")
            .collect(),
        authority: "none; installation and enablement require separate review",
    })?;
    if files.get("PROVENANCE.json") != Some(&expected_provenance) {
        return Err("Prepared provenance differs from revalidated source/owned recipe".into());
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Identity<'a> {
        version: u8,
        recipe_id: &'a str,
        source_hash: &'a str,
        recipe_hash: &'a str,
        candidate_id: &'a str,
        plugin_id: &'a str,
        files: &'a [Inventory],
    }
    let output = hash(&json_bytes(&Identity {
        version: 1,
        recipe_id: RECIPE_ID,
        source_hash: &candidate.source_hash,
        recipe_hash: &candidate.recipe_hash,
        candidate_id: &candidate.candidate_id,
        plugin_id: &candidate.plugin_id,
        files: &inventory,
    })?);
    if output != candidate.output_hash {
        return Err("Prepared output identity changed".into());
    }
    Ok((inspect_captured(&files)?, files))
}
fn summary(record: &PreparedRecord, capture: &StaticCapture) -> Result<PreparedSummary, String> {
    if record.schema_version != 1
        || record.created_at > 9_007_199_254_740_991
        || serde_json::to_vec(record)
            .map_err(|_| "Invalid prepared record")?
            .len()
            > ENCODED_LIMIT
        || serde_json::to_value(&record.source).map_err(|_| "Invalid source reference")?
            != serde_json::to_value(&capture.summary).map_err(|_| "Invalid source reference")?
    {
        return Err("Prepared source reference/version changed".into());
    }
    let (inspection, _) = validate(&record.candidate, capture)?;
    let c = &record.candidate;
    Ok(PreparedSummary {
        schema_version: 1,
        id: c.candidate_id.clone(),
        source: record.source.clone(),
        plugin_id: c.plugin_id.clone(),
        recipe_hash: c.recipe_hash.clone(),
        output_hash: c.output_hash.clone(),
        total_bytes: c.total_bytes,
        created_at: record.created_at,
        inspection,
    })
}
#[tauri::command]
pub async fn intake_prepared_save(
    app: AppHandle,
    source_id: String,
    expected_capture_hash: String,
    candidate_json: String,
) -> Result<PreparedSummary, String> {
    if candidate_json.len() > ENCODED_LIMIT {
        return Err("Prepared bytes exceed encoded bounds".into());
    }
    blocking(move || {
        let candidate: Candidate = serde_json::from_str(&candidate_json)
            .map_err(|_| "Unsupported prepared candidate fields")?;
        store::save(
            &mut database(&app)?,
            &source_id,
            &expected_capture_hash,
            candidate,
        )
    })
    .await
}
#[tauri::command]
pub async fn intake_prepared_list(app: AppHandle) -> Result<Vec<PreparedSummary>, String> {
    blocking(move || store::list(&database(&app)?)).await
}
#[tauri::command]
pub async fn intake_prepared_read(
    app: AppHandle,
    id: String,
    expected_output_hash: String,
) -> Result<PreparedRecord, String> {
    blocking(move || {
        let r = store::load(&database(&app)?, &id)?;
        if r.candidate.output_hash != expected_output_hash {
            return Err("Prepared candidate changed; reload review".into());
        }
        Ok(r)
    })
    .await
}
#[tauri::command]
pub async fn intake_prepared_discard(
    app: AppHandle,
    id: String,
    expected_output_hash: String,
) -> Result<(), String> {
    blocking(move || store::discard(&mut database(&app)?, &id, &expected_output_hash)).await
}
#[cfg(test)]
mod tests;
