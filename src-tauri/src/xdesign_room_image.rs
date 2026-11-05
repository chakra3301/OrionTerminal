use super::{identifier, invalid, RoomFailure};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub(super) const METADATA_LIMIT: usize = 128 * 1024;
pub(super) const CHUNK_MESSAGE_LIMIT: usize = 1_500_000;
pub(super) const STATUS_RESPONSE_LIMIT: usize = 256 * 1024;
pub(super) const CATALOG_RESPONSE_LIMIT: usize = 32 * 1024 * 1024;
const CHUNK_BYTES: usize = 1024 * 1024;
const ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
fn fields<'a>(value: &'a Value, keys: &[&str]) -> Result<&'a Map<String, Value>, RoomFailure> {
    let map = value.as_object().ok_or_else(invalid)?;
    if map.len() != keys.len() || keys.iter().any(|key| !map.contains_key(*key)) { return Err(invalid()); } Ok(map)
}
pub(super) fn hash(value: &str) -> Result<(), RoomFailure> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) { return Err(invalid()); } Ok(())
}
pub(super) fn index(index: u32) -> Result<(), RoomFailure> { if index >= 512 { return Err(invalid()); } Ok(()) }
fn number(value: &Value, min: u64, max: u64) -> Result<u64, RoomFailure> { value.as_u64().filter(|n| (min..=max).contains(n)).ok_or_else(invalid) }
pub(super) fn manifest(value: &Value) -> Result<(), RoomFailure> {
    let map = fields(value, &["version","kind","imageId","revisionId","previousRevisionId","name","width","height","previewWidth","previewHeight","archiveBytes","archiveDigest","previewDigest","chunkDigests"])?;
    if value["version"].as_u64() != Some(1) || value["kind"].as_str() != Some("orion.xdesign.image") { return Err(invalid()); }
    identifier(value["imageId"].as_str().ok_or_else(invalid)?)?;
    for key in ["revisionId","archiveDigest","previewDigest"] { hash(value[key].as_str().ok_or_else(invalid)?)?; }
    if !value["previousRevisionId"].is_null() { hash(value["previousRevisionId"].as_str().ok_or_else(invalid)?)?; }
    let name = value["name"].as_str().ok_or_else(invalid)?;
    if name.trim().is_empty() || name.encode_utf16().count() > 200 || name.chars().any(char::is_control) { return Err(invalid()); }
    let width = number(&value["width"], 1, 268_435_456)?; let height = number(&value["height"], 1, 268_435_456)?;
    if width * height > 268_435_456 { return Err(invalid()); }
    number(&value["previewWidth"], 1, width.min(2048))?; number(&value["previewHeight"], 1, height.min(2048))?;
    let bytes = number(&value["archiveBytes"], 1, ARCHIVE_BYTES)?;
    let chunks = value["chunkDigests"].as_array().ok_or_else(invalid)?;
    if chunks.len() != bytes.div_ceil(CHUNK_BYTES as u64) as usize { return Err(invalid()); }
    for chunk in chunks { hash(chunk.as_str().ok_or_else(invalid)?)?; }
    let canonical: BTreeMap<_, _> = map.iter().filter(|(key, _)| key.as_str() != "revisionId").collect();
    let encoded = serde_json::to_vec(&canonical).map_err(|_| invalid())?;
    if format!("{:x}", Sha256::digest(encoded)) != value["revisionId"].as_str().ok_or_else(invalid)? { return Err(invalid()); } Ok(())
}
pub(super) fn begin(value: &Value) -> Result<(), RoomFailure> {
    fields(value, &["version","requestId","manifest"])?;
    if value["version"].as_u64() != Some(1) { return Err(invalid()); }
    identifier(value["requestId"].as_str().ok_or_else(invalid)?)?; manifest(&value["manifest"])
}
pub(super) fn read(value: &Value) -> Result<(), RoomFailure> {
    fields(value, &["version","imageId","revisionId"])?;
    if value["version"].as_u64() != Some(1) { return Err(invalid()); }
    identifier(value["imageId"].as_str().ok_or_else(invalid)?)?;
    if !value["revisionId"].is_null() { hash(value["revisionId"].as_str().ok_or_else(invalid)?)?; } Ok(())
}
pub(super) fn chunk(value: &Value, expected_index: u32) -> Result<(), RoomFailure> {
    fields(value, &["version","index","sha256","data"])?; index(expected_index)?;
    if value["version"].as_u64() != Some(1) || value["index"].as_u64() != Some(u64::from(expected_index)) { return Err(invalid()); }
    let checksum = value["sha256"].as_str().ok_or_else(invalid)?; hash(checksum)?;
    let data = value["data"].as_str().ok_or_else(invalid)?;
    if data.len() > CHUNK_BYTES.div_ceil(3) * 4 { return Err(invalid()); }
    let bytes = STANDARD.decode(data).map_err(|_| invalid())?;
    if bytes.is_empty() || bytes.len() > CHUNK_BYTES || STANDARD.encode(&bytes) != data || format!("{:x}", Sha256::digest(&bytes)) != checksum { return Err(invalid()); } Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> Value {
        serde_json::from_str(include_str!("xdesign_room_image_manifest_test.json")).unwrap()
    }
    #[test]
    fn closed_canonical_manifests_refuse_unknown_fields_changed_bytes_and_versions() {
        let value = json!({"version":1,"requestId":"image_request_0001","manifest":fixture()}); assert!(begin(&value).is_ok());
        for field in ["credential","archiveDigest","width","chunkDigests","previousRevisionId","version"] {
            let mut changed = value.clone(); changed["manifest"][field] = json!(false); assert!(begin(&changed).is_err());
        }
        let mut changed = value.clone(); changed["manifest"]["name"] = json!("Other image"); assert!(begin(&changed).is_err());
        let mut changed = value.clone(); changed["documentId"] = json!("other_document_001"); assert!(begin(&changed).is_err());
        let mut changed = value; changed["requestId"] = json!("../local-path"); assert!(begin(&changed).is_err());
    }
    #[test]
    fn chunks_validate_raw_bytes_exact_index_canonical_encoding_and_bounds() {
        let bytes = b"original editable bytes"; let value = json!({"version":1,"index":0,"sha256":format!("{:x}",Sha256::digest(bytes)),"data":STANDARD.encode(bytes)});
        assert!(chunk(&value,0).is_ok()); assert!(chunk(&value,1).is_err()); assert!(index(512).is_err());
        for field in ["data","sha256","version","index"] { let mut changed = value.clone(); changed[field] = json!("invalid"); assert!(chunk(&changed,0).is_err()); }
        let mut changed = value; changed["secret"] = json!("private"); assert!(chunk(&changed,0).is_err());
    }
}
