use super::{binary, identifier, invalid, RoomFailure};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

pub(super) const BODY_LIMIT: usize = 52 * 1024 * 1024;
pub(super) const REVISION_RESPONSE_LIMIT: usize = BODY_LIMIT + 64 * 1024;
pub(super) const CATALOG_RESPONSE_LIMIT: usize = 8 * 1024 * 1024;
pub(super) const RECEIPT_RESPONSE_LIMIT: usize = 64 * 1024;

fn fields<'a>(value: &'a Value, required: &[&str], optional: &[&str]) -> Result<&'a Map<String, Value>, RoomFailure> {
    let map = value.as_object().ok_or_else(invalid)?;
    if required.iter().any(|key| !map.contains_key(*key)) || map.keys().any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str())) { return Err(invalid()); }
    Ok(map)
}
fn text(value: &Value, limit: usize, empty: bool) -> Result<&str, RoomFailure> {
    let value = value.as_str().ok_or_else(invalid)?;
    if value.encode_utf16().count() > limit || !empty && value.trim().is_empty() { return Err(invalid()); }
    Ok(value)
}
fn identity(value: &Value, asset: bool) -> Result<&str, RoomFailure> {
    let value = value.as_str().ok_or_else(invalid)?;
    if value.is_empty() || value.len() > if asset { 256 } else { 128 } || !value.as_bytes()[0].is_ascii_alphanumeric()
        || !value.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte) || asset && byte == b'/') { return Err(invalid()); }
    Ok(value)
}
fn hash(value: &Value) -> Result<&str, RoomFailure> {
    let value = value.as_str().ok_or_else(invalid)?;
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) { return Err(invalid()); }
    Ok(value)
}
pub(super) fn publish(value: &Value) -> Result<(), RoomFailure> {
    fields(value, &["version", "requestId", "bundle"], &[])?;
    if value["version"].as_u64() != Some(1) { return Err(invalid()); }
    identifier(value["requestId"].as_str().ok_or_else(invalid)?)?;
    let bundle = &value["bundle"];
    fields(bundle, &["version", "manifest", "graph", "checksum"], &[])?;
    if bundle["version"].as_u64() != Some(1) { return Err(invalid()); }
    let graph = text(&bundle["graph"], BODY_LIMIT, false)?;
    let checksum = hash(&bundle["checksum"])?;
    let encoded = serde_json::to_vec(&json!({"graph":graph})).map_err(|_| invalid())?;
    if format!("{:x}", Sha256::digest(&encoded)) != checksum { return Err(invalid()); }
    let manifest = &bundle["manifest"];
    fields(manifest, &["schemaVersion", "libraryId", "name", "description", "revisionId", "previousRevisionId", "publishedAt", "assets"], &[])?;
    if manifest["schemaVersion"].as_u64() != Some(1) { return Err(invalid()); }
    identity(&manifest["libraryId"], false)?; hash(&manifest["revisionId"])?;
    if !manifest["previousRevisionId"].is_null() { hash(&manifest["previousRevisionId"])?; }
    text(&manifest["name"], 200, false)?; text(&manifest["description"], 4000, true)?; text(&manifest["publishedAt"], 64, false)?;
    let assets = manifest["assets"].as_array().ok_or_else(invalid)?;
    if assets.len() > 10_000 { return Err(invalid()); }
    let mut keys = HashSet::new();
    for asset in assets {
        let map = fields(asset, &["key", "type", "name", "description", "sourceNodeId", "contentHash"], &["thumbnail"])?;
        if !keys.insert(identity(&asset["key"], true)?) || ![Some("COMPONENT"), Some("COMPONENT_SET")].contains(&asset["type"].as_str()) { return Err(invalid()); }
        text(&asset["name"], 200, true)?; text(&asset["description"], 4000, true)?; text(&asset["sourceNodeId"], 128, false)?; hash(&asset["contentHash"])?;
        if let Some(preview) = map.get("thumbnail") { binary(preview, 1024 * 1024, 0)?; }
    }
    Ok(())
}
pub(super) fn read(value: &Value) -> Result<(), RoomFailure> {
    fields(value, &["version", "libraryId", "revisionId"], &[])?;
    if value["version"].as_u64() != Some(1) { return Err(invalid()); }
    identity(&value["libraryId"], false)?;
    if !value["revisionId"].is_null() { hash(&value["revisionId"])?; }
    Ok(())
}
