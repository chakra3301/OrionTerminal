use base64::{engine::general_purpose::STANDARD, Engine};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use reqwest::{header, Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, future::Future, sync::{atomic::{AtomicUsize, Ordering}, Arc}, time::Duration};
use tokio::sync::watch;

#[path = "xdesign_room_library.rs"]
mod library;
#[path = "xdesign_room_image.rs"]
mod image;
#[path = "xdesign_room_image_files.rs"]
pub(crate) mod image_files;

const BODY_LIMIT: usize = 46 * 1024 * 1024;
const VECTOR_LIMIT: usize = 1024 * 1024;
const UPDATE_LIMIT: usize = 32 * 1024 * 1024;
const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;
static REGISTRY: Lazy<Registry> = Lazy::new(Registry::default);
static SLOTS: Lazy<Arc<Slots>> = Lazy::new(|| Arc::new(Slots::default()));
static CLIENT: Lazy<Result<Client, RoomFailure>> = Lazy::new(|| Client::builder()
    .redirect(reqwest::redirect::Policy::none()).no_proxy()
    .connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(30))
    .build().map_err(|_| failure(503, "network", "The room connection could not initialize.")));

#[derive(Debug, Serialize)]
pub struct RoomFailure { status: u16, code: &'static str, message: &'static str }
fn failure(status: u16, code: &'static str, message: &'static str) -> RoomFailure { RoomFailure { status, code, message } }
fn invalid() -> RoomFailure { failure(422, "invalid", "Invalid room connection or operation.") }
fn cancelled() -> RoomFailure { failure(499, "cancelled", "The room operation was cancelled.") }
fn identifier(value: &str) -> Result<(), RoomFailure> {
    if !(16..=128).contains(&value.len()) || !value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') { return Err(invalid()); }
    Ok(())
}
fn label(value: &str) -> Result<(), RoomFailure> {
    if value.trim().is_empty() || value.encode_utf16().count() > 128 || value.chars().any(char::is_control) { return Err(invalid()); }
    Ok(())
}
fn server(value: &str) -> Result<Url, RoomFailure> {
    if value.is_empty() || value.len() > 2048 || value.chars().any(|c| c.is_control() || c.is_whitespace()) { return Err(invalid()); }
    let url = Url::parse(value).map_err(|_| invalid())?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "[::1]" | "::1"));
    if !(url.scheme() == "https" || url.scheme() == "http" && loopback) || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some() || value.split("://").nth(1).is_some_and(|tail| tail.split('/').next().unwrap_or("").contains('@'))
        || url.path() != "/" || url.query().is_some() || url.fragment().is_some() || url.port_or_known_default().is_none_or(|port| port == 0) { return Err(invalid()); }
    Ok(url)
}
fn credential_ref(url: &Url, document: Option<&str>) -> Result<String, RoomFailure> {
    if let Some(id) = document { identifier(id)?; }
    let origin = format!("{:x}", Sha256::digest(url.as_str().as_bytes()));
    Ok(format!("xdesign-room:{origin}:{}", document.unwrap_or("administrator")))
}
fn binary(value: &Value, max: usize, minimum: usize) -> Result<(), RoomFailure> {
    let value = value.as_str().ok_or_else(invalid)?;
    if value.len() > max.div_ceil(3) * 4 { return Err(invalid()); }
    let bytes = STANDARD.decode(value).map_err(|_| invalid())?;
    if bytes.len() < minimum || bytes.len() > max || STANDARD.encode(&bytes) != value { return Err(invalid()); }
    Ok(())
}
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Operation {
    Sync { message: Value },
    Presence { message: Value },
    Comment { message: Value, recover_only: bool },
    CommentHistory { #[serde(default, deserialize_with = "optional_history_cursor")] before: Option<u64> },
    Create { name: String, owner_name: String, checkpoint: String, #[serde(default, deserialize_with = "optional_id")] request_id: Option<String> },
    Members {},
    CommentAuthors {},
    CommentOwnership {},
    AssignCommentAuthor { message: Value },
    RecoverCommentAuthor { request_id: String },
    LibraryCatalog {},
    LibraryRevision { message: Value },
    PublishLibrary { message: Value },
    RecoverLibrary { request_id: String },
    ImageCatalog {},
    ImageRevision { message: Value },
    BeginImage { message: Value },
    ImageUpload { request_id: String },
    PutImageChunk { request_id: String, index: u32, message: Value },
    CommitImage { request_id: String },
    DismissImage { request_id: String },
    ImageChunk { image_id: String, revision_id: String, index: u32 },
    Invite { name: String, role: Role, #[serde(default, deserialize_with = "optional_id")] request_id: Option<String> },
    Recover { request_id: String, grant_kind: GrantKind },
    Change { member_id: String, role: Role },
    Revoke { member_id: String },
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role { Editor, Viewer }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GrantKind { Create, Invite }
fn optional_id<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> { String::deserialize(deserializer).map(Some) }
fn optional_history_cursor<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<u64>, D::Error> { u64::deserialize(deserializer).map(Some) }
struct Plan { method: Method, url: Url, body: Option<Vec<u8>>, administrator: bool, response_limit: usize }
fn presence_point(value: &Value) -> Result<(), RoomFailure> {
    let values = value.as_array().ok_or_else(invalid)?;
    if values.len() != 2 || values.iter().any(|value| value.as_f64().is_none_or(|n| !n.is_finite() || n.abs() > 1e8)) { return Err(invalid()); } Ok(())
}
fn scene_id(value: &Value) -> Result<(), RoomFailure> {
    let id = value.as_str().ok_or_else(invalid)?; if id.is_empty() || id.encode_utf16().count() > 128 || id.chars().any(char::is_control) { return Err(invalid()); } Ok(())
}
fn presence_message(message: &Value, document_id: &str) -> Result<(), RoomFailure> {
    let map = message.as_object().ok_or_else(invalid)?;
    if map.len() != 5 || map.keys().any(|key| !["version", "documentId", "clientId", "sequence", "state"].contains(&key.as_str())) || message["version"].as_u64() != Some(1) || message["documentId"].as_str() != Some(document_id) || message["sequence"].as_u64().is_none_or(|n| n == 0 || n > MAX_SEQUENCE) { return Err(invalid()); }
    let client_id = message["clientId"].as_str().ok_or_else(invalid)?; identifier(client_id)?;
    if message["state"].is_null() { return Ok(()); }
    let state = message["state"].as_object().ok_or_else(invalid)?;
    if state.len() != 5 || state.keys().any(|key| !["pageId", "cursor", "selection", "view", "following"].contains(&key.as_str())) { return Err(invalid()); }
    scene_id(&state["pageId"])?; if !state["cursor"].is_null() { presence_point(&state["cursor"])?; }
    let selected = state["selection"].as_array().ok_or_else(invalid)?; let mut seen = std::collections::HashSet::new();
    if selected.len() > 64 { return Err(invalid()); } for id in selected { scene_id(id)?; if !seen.insert(id.as_str().ok_or_else(invalid)?) { return Err(invalid()); } }
    let view = state["view"].as_object().ok_or_else(invalid)?;
    if view.len() != 4 || view.keys().any(|key| !["center", "zoom", "width", "height"].contains(&key.as_str())) || view["zoom"].as_f64().is_none_or(|n| !n.is_finite() || !(1e-8..=256.0).contains(&n)) || ["width", "height"].iter().any(|key| view[*key].as_f64().is_none_or(|n| !n.is_finite() || !(1.0..=100_000.0).contains(&n))) { return Err(invalid()); }
    presence_point(&view["center"])?;
    if !state["following"].is_null() { let target = state["following"].as_str().ok_or_else(invalid)?; identifier(target)?; if target == client_id { return Err(invalid()); } }
    Ok(())
}
fn comment_id(value: &Value) -> Result<(), RoomFailure> {
    let value = value.as_str().ok_or_else(invalid)?;
    if value.is_empty() || value.len() > 128 || !value.bytes().all(|c| c.is_ascii_alphanumeric() || b":_./-".contains(&c)) { return Err(invalid()); } Ok(())
}
fn comment_anchor(value: &Value) -> Result<(), RoomFailure> {
    let map = value.as_object().ok_or_else(invalid)?;
    if map.len() != if map.contains_key("nodeId") { 4 } else { 3 } || map.keys().any(|key| !["points", "fallback", "format", "nodeId"].contains(&key.as_str())) || value["format"].as_str() != Some("local") { return Err(invalid()); }
    let points = value["points"].as_array().ok_or_else(invalid)?;
    let fallback = value["fallback"].as_array().ok_or_else(invalid)?;
    if ![1,4].contains(&points.len()) || points.len() != fallback.len() { return Err(invalid()); }
    for point in points.iter().chain(fallback.iter()) {
        let map = point.as_object().ok_or_else(invalid)?;
        if map.len() != 2 || map.keys().any(|key| !["x", "y"].contains(&key.as_str())) || ["x", "y"].iter().any(|key| point[*key].as_f64().is_none_or(|n| !n.is_finite() || n.abs() > 1e9)) { return Err(invalid()); }
    }
    if let Some(id) = map.get("nodeId") { comment_id(id)?; } Ok(())
}
fn comment_message(message: &Value, document_id: &str) -> Result<(), RoomFailure> {
    let map = message.as_object().ok_or_else(invalid)?;
    if map.len() != 7 || map.keys().any(|key| !["version","type","documentId","clientId","requestId","vector","command"].contains(&key.as_str())) || message["version"].as_u64() != Some(1) || message["type"].as_str() != Some("comment") || message["documentId"].as_str() != Some(document_id) { return Err(invalid()); }
    for key in ["clientId", "requestId"] { identifier(message[key].as_str().ok_or_else(invalid)?)?; } binary(&message["vector"], VECTOR_LIMIT, 1)?;
    let command = &message["command"];
    let fields = command.as_object().ok_or_else(invalid)?;
    let allowed: &[&str] = match command["type"].as_str() {
        Some("add") => &["type","pageId","anchor","body"], Some("reply") => &["type","threadId","body"], Some("edit") => &["type","threadId","messageId","body"], Some("delete") => &["type","threadId","messageId"], Some("resolve") => &["type","threadId","resolved"], Some("move") => &["type","threadId","pageId","anchor"], Some("react") => &["type","threadId","messageId","emoji"], Some("history") => &["type","threadId","sourceClientId","sourceRequestId","direction","step"], _ => return Err(invalid()),
    };
    if fields.len() != allowed.len() || fields.keys().any(|key| !allowed.contains(&key.as_str())) { return Err(invalid()); }
    for key in ["threadId", "messageId", "pageId"] { if let Some(value) = fields.get(key) { comment_id(value)?; } }
    if let Some(value) = fields.get("body") { let text = value.as_str().ok_or_else(invalid)?; if text.trim().is_empty() || text.encode_utf16().count() > 8192 { return Err(invalid()); } }
    if let Some(value) = fields.get("anchor") { comment_anchor(value)?; }
    if fields.contains_key("resolved") && command["resolved"].as_bool().is_none() || fields.contains_key("emoji") && ![Some("👍"),Some("❤️"),Some("🎉"),Some("👀"),Some("✅"),Some("🙏")].contains(&command["emoji"].as_str()) { return Err(invalid()); }
    if command["type"].as_str() == Some("history") {
        for key in ["sourceClientId","sourceRequestId"] { identifier(command[key].as_str().ok_or_else(invalid)?)?; }
        if ![Some("undo"),Some("redo")].contains(&command["direction"].as_str()) || !command["step"].as_u64().is_some_and(|step| step < 9_007_199_254_740_991) { return Err(invalid()); }
    }
    Ok(())
}
fn comment_author_message(message: &Value) -> Result<(), RoomFailure> {
    let map = message.as_object().ok_or_else(invalid)?;
    if map.len() != 5 || map.keys().any(|key| !["version","authorId","memberId","step","requestId"].contains(&key.as_str())) || message["version"].as_u64() != Some(1) || message["step"].as_u64().is_none_or(|step| step >= MAX_SEQUENCE) { return Err(invalid()); }
    comment_id(&message["authorId"])?; identifier(message["requestId"].as_str().ok_or_else(invalid)?)?;
    if !message["memberId"].is_null() { identifier(message["memberId"].as_str().ok_or_else(invalid)?)?; }
    Ok(())
}
fn plan(origin: &Url, document_id: &str, operation: &Operation) -> Result<Plan, RoomFailure> {
    identifier(document_id)?;
    let root = format!("v1/rooms/{document_id}");
    let (method, path, body, administrator) = match operation {
        Operation::ImageCatalog {} => (Method::GET, format!("{root}/images"), None, false),
        Operation::ImageRevision { message } => { image::read(message)?; (Method::POST, format!("{root}/images/revision"), Some(message.clone()), false) },
        Operation::BeginImage { message } => { image::begin(message)?; (Method::POST, format!("{root}/images/uploads"), Some(message.clone()), false) },
        Operation::ImageUpload { request_id } => { identifier(request_id)?; (Method::GET, format!("{root}/images/uploads/{request_id}"), None, false) },
        Operation::PutImageChunk { request_id, index, message } => { identifier(request_id)?; image::chunk(message, *index)?; (Method::PUT, format!("{root}/images/uploads/{request_id}/chunks/{index}"), Some(message.clone()), false) },
        Operation::CommitImage { request_id } => { identifier(request_id)?; (Method::POST, format!("{root}/images/uploads/{request_id}/commit"), Some(json!({"version":1,"requestId":request_id})), false) },
        Operation::DismissImage { request_id } => { identifier(request_id)?; (Method::DELETE, format!("{root}/images/uploads/{request_id}"), None, false) },
        Operation::ImageChunk { image_id, revision_id, index } => { identifier(image_id)?; image::hash(revision_id)?; image::index(*index)?; (Method::GET, format!("{root}/images/{image_id}/revisions/{revision_id}/chunks/{index}"), None, false) },
        Operation::Presence { message } => { presence_message(message, document_id)?; (Method::POST, format!("{root}/presence"), Some(message.clone()), false) },
        Operation::Comment { message, recover_only } => { comment_message(message, document_id)?; (Method::POST, format!("{root}/comments{}", if *recover_only { "/recover" } else { "" }), Some(message.clone()), false) },
        Operation::CommentHistory { before } => {
            if before.is_some_and(|cursor| cursor == 0 || cursor > 9_007_199_254_740_991) { return Err(invalid()); }
            (Method::GET, format!("{root}/comments/history{}", before.map_or(String::new(), |cursor| format!("/{cursor}"))), None, false)
        },
        Operation::Sync { message } => {
            let map = message.as_object().ok_or_else(invalid)?;
            let update = message.get("type").and_then(Value::as_str) == Some("update");
            if message.get("version").and_then(Value::as_u64) != Some(1) || ![Some("sync"), Some("update")].contains(&message.get("type").and_then(Value::as_str))
                || map.len() != if update { 7 } else { 6 }
                || map.keys().any(|key| !["version", "type", "documentId", "clientId", "requestId", "vector", "update"].contains(&key.as_str()))
                || message.get("documentId").and_then(Value::as_str) != Some(document_id) { return Err(invalid()); }
            for field in ["clientId", "requestId"] { identifier(message.get(field).and_then(Value::as_str).ok_or_else(invalid)?)?; }
            binary(&message["vector"], VECTOR_LIMIT, 1)?;
            if update { binary(&message["update"], UPDATE_LIMIT, 2)?; } else if map.contains_key("update") { return Err(invalid()); }
            (Method::POST, format!("{root}/sync"), Some(message.clone()), false)
        },
        Operation::Create { name, owner_name, checkpoint, request_id } => {
            label(name)?; label(owner_name)?; binary(&Value::String(checkpoint.clone()), UPDATE_LIMIT, 2)?;
            let mut body = json!({"version":1,"documentId":document_id,"name":name,"ownerName":owner_name,"checkpoint":checkpoint});
            if let Some(id) = request_id { identifier(id)?; body["requestId"] = json!(id); }
            (Method::POST, "v1/rooms".into(), Some(body), true)
        },
        Operation::CommentAuthors {} => (Method::GET, format!("{root}/comments/authors"), None, false),
        Operation::CommentOwnership {} => (Method::GET, format!("{root}/comments/ownership"), None, false),
        Operation::AssignCommentAuthor { message } => { comment_author_message(message)?; (Method::POST, format!("{root}/comments/authors"), Some(message.clone()), false) },
        Operation::RecoverCommentAuthor { request_id } => { identifier(request_id)?; (Method::GET, format!("{root}/comments/authors/grants/{request_id}"), None, false) },
        Operation::LibraryCatalog {} => (Method::GET, format!("{root}/libraries"), None, false),
        Operation::LibraryRevision { message } => { library::read(message)?; (Method::POST, format!("{root}/libraries/revision"), Some(message.clone()), false) },
        Operation::PublishLibrary { message } => { library::publish(message)?; (Method::POST, format!("{root}/libraries"), Some(message.clone()), false) },
        Operation::RecoverLibrary { request_id } => { identifier(request_id)?; (Method::GET, format!("{root}/libraries/receipts/{request_id}"), None, false) },
        Operation::Members {} => (Method::GET, format!("{root}/members"), None, false),
        Operation::Invite { name, role, request_id } => {
            label(name)?; let mut body = json!({"version":1,"name":name,"role":role});
            if let Some(id) = request_id { identifier(id)?; body["requestId"] = json!(id); }
            (Method::POST, format!("{root}/members"), Some(body), false)
        },
        Operation::Recover { request_id, grant_kind } => {
            identifier(request_id)?; let creation = matches!(grant_kind, GrantKind::Create);
            (Method::GET, format!("{root}/grants/{}/{request_id}", if creation { "create" } else { "invite" }), None, creation)
        },
        Operation::Change { member_id, role } => { identifier(member_id)?; (Method::PATCH, format!("{root}/members/{member_id}"), Some(json!({"version":1,"role":role})), false) },
        Operation::Revoke { member_id } => { identifier(member_id)?; (Method::DELETE, format!("{root}/members/{member_id}"), None, false) },
    };
    let body = body.map(|body| serde_json::to_vec(&body).map_err(|_| invalid())).transpose()?;
    if matches!(operation, Operation::Presence { .. }) && body.as_ref().is_some_and(|body| body.len() > 64 * 1024) { return Err(failure(413, "capacity", "The presence request exceeds its transfer limit.")); }
    if matches!(operation, Operation::Comment { .. }) && body.as_ref().is_some_and(|body| body.len() > 2 * 1024 * 1024) { return Err(failure(413, "capacity", "The comment request exceeds its transfer limit.")); }
    if matches!(operation, Operation::AssignCommentAuthor { .. }) && body.as_ref().is_some_and(|body| body.len() > 4096) { return Err(failure(413, "capacity", "The author grant request exceeds its transfer limit.")); }
    let body_limit = match operation { Operation::PublishLibrary { .. } => library::BODY_LIMIT, Operation::LibraryRevision { .. } => 4096,
        Operation::PutImageChunk { .. } => image::CHUNK_MESSAGE_LIMIT, Operation::BeginImage { .. } | Operation::ImageRevision { .. } | Operation::CommitImage { .. } => image::METADATA_LIMIT, _ => BODY_LIMIT };
    if body.as_ref().is_some_and(|body| body.len() > body_limit) { return Err(failure(413, "capacity", "The room request exceeds its transfer limit.")); }
    let response_limit = match operation {
        Operation::ImageCatalog {} => image::CATALOG_RESPONSE_LIMIT,
        Operation::ImageChunk { .. } => image::CHUNK_MESSAGE_LIMIT + 4096,
        Operation::ImageRevision { .. } => image::METADATA_LIMIT,
        Operation::BeginImage { .. } | Operation::ImageUpload { .. } | Operation::PutImageChunk { .. } | Operation::CommitImage { .. } | Operation::DismissImage { .. } => image::STATUS_RESPONSE_LIMIT,
        Operation::LibraryCatalog {} => library::CATALOG_RESPONSE_LIMIT,
        Operation::LibraryRevision { .. } => library::REVISION_RESPONSE_LIMIT,
        Operation::PublishLibrary { .. } | Operation::RecoverLibrary { .. } => library::RECEIPT_RESPONSE_LIMIT,
        Operation::Presence { .. } => 4 * 1024 * 1024,
        Operation::CommentAuthors { .. } => 8 * 1024 * 1024,
        Operation::CommentOwnership { .. } => 2 * 1024 * 1024,
        Operation::AssignCommentAuthor { .. } | Operation::RecoverCommentAuthor { .. } => 4096,
        Operation::CommentHistory { .. } => 1024 * 1024,
        _ => BODY_LIMIT,
    };
    Ok(Plan { method, url: origin.join(&path).map_err(|_| invalid())?, body, administrator, response_limit })
}
#[derive(Default)]
struct Slots(AtomicUsize);
impl Slots {
    fn acquire(self: &Arc<Self>) -> Result<Slot, RoomFailure> {
        if self.0.fetch_add(1, Ordering::SeqCst) >= 4 { self.0.fetch_sub(1, Ordering::SeqCst); return Err(failure(503, "busy", "Wait for the current room operations to finish.")); }
        Ok(Slot(self.clone()))
    }
}
struct Slot(Arc<Slots>);
impl Drop for Slot { fn drop(&mut self) { self.0.0.fetch_sub(1, Ordering::SeqCst); } }
#[derive(Default)]
struct SessionState { closed: bool, last_started: u64, cancelled_through: u64, active: Option<(u64, watch::Sender<bool>)> }
struct Session { origin: Url, document_id: String, state: Mutex<SessionState> }
struct Work { session: Arc<Session>, sequence: u64, _slot: Slot }
impl Drop for Work {
    fn drop(&mut self) {
        let mut state = self.session.state.lock();
        if state.active.as_ref().is_some_and(|(sequence, _)| *sequence == self.sequence) { state.active = None; }
    }
}
impl Session {
    fn current(&self,sequence:u64)->Result<(),RoomFailure>{let state=self.state.lock();if state.closed||sequence<=state.cancelled_through||state.active.as_ref().is_none_or(|(active,_)|*active!=sequence){return Err(cancelled());}Ok(())}
    fn start(self: &Arc<Self>, sequence: u64, slots: &Arc<Slots>) -> Result<(Arc<Work>, watch::Receiver<bool>), RoomFailure> {
        if sequence == 0 || sequence > MAX_SEQUENCE { return Err(invalid()); }
        let mut state = self.state.lock();
        if state.closed || sequence <= state.cancelled_through { return Err(cancelled()); }
        if state.active.is_some() { return Err(failure(503, "busy", "Wait for the current room operation to finish.")); }
        if sequence <= state.last_started { return Err(invalid()); }
        let slot = slots.acquire()?;
        let (sender, receiver) = watch::channel(false);
        state.last_started = sequence; state.active = Some((sequence, sender));
        Ok((Arc::new(Work { session: self.clone(), sequence, _slot: slot }), receiver))
    }
    fn cancel(&self, sequence: u64) -> Result<(), RoomFailure> {
        if sequence == 0 || sequence > MAX_SEQUENCE { return Err(invalid()); }
        let mut state = self.state.lock(); state.cancelled_through = state.cancelled_through.max(sequence);
        if let Some((active, sender)) = &state.active { if *active <= sequence { let _ = sender.send(true); } }
        Ok(())
    }
    fn close(&self) {
        let mut state = self.state.lock(); state.closed = true;
        if let Some((_, sender)) = &state.active { let _ = sender.send(true); }
    }
}
#[derive(Default)]
struct Registry(Mutex<HashMap<String, Arc<Session>>>);
impl Registry {
    fn open(&self, server_url: &str, document_id: String) -> Result<String, RoomFailure> {
        let origin = server(server_url)?; identifier(&document_id)?;
        let mut sessions = self.0.lock();
        if sessions.len() >= 8 { return Err(failure(503, "busy", "Close an unused room connection before opening another.")); }
        let handle = ulid::Ulid::new().to_string();
        sessions.insert(handle.clone(), Arc::new(Session { origin, document_id, state: Mutex::new(SessionState::default()) }));
        Ok(handle)
    }
    fn get(&self, handle: &str) -> Result<Arc<Session>, RoomFailure> { identifier(handle)?; self.0.lock().get(handle).cloned().ok_or_else(cancelled) }
    fn close(&self, handle: &str) -> Result<(), RoomFailure> { identifier(handle)?; if let Some(session) = self.0.lock().remove(handle) { session.close(); } Ok(()) }
}
async fn bounded<T>(mut receiver: watch::Receiver<bool>, duration: Duration, future: impl Future<Output = Result<T, RoomFailure>>) -> Result<T, RoomFailure> {
    if *receiver.borrow() { return Err(cancelled()); }
    tokio::select! {
        biased;
        _ = receiver.changed() => Err(cancelled()),
        result = tokio::time::timeout(duration, future) => result.unwrap_or_else(|_| Err(failure(504, "timeout", "The room operation timed out. Its server outcome is unknown."))),
    }
}
async fn prepare<T: Send + 'static>(work: Arc<Work>, task: impl FnOnce(&Session) -> Result<T, RoomFailure> + Send + 'static) -> Result<T, RoomFailure> {
    // A cancelled blocking validator still owns its native operation slot until it returns.
    tokio::task::spawn_blocking(move || task(&work.session)).await.map_err(|_| failure(503, "bridge", "The desktop room operation could not finish."))?
}
fn headers(secret: &str) -> Result<header::HeaderValue, RoomFailure> {
    if !(32..=256).contains(&secret.len()) || !secret.bytes().all(|c| c.is_ascii_graphic()) { return Err(failure(401, "credential", "Configure a valid room credential.")); }
    let mut value = header::HeaderValue::from_bytes(format!("Bearer {secret}").as_bytes()).map_err(|_| invalid())?;
    value.set_sensitive(true); Ok(value)
}
fn validate_credential(document: Option<&str>, secret: &str) -> Result<(), RoomFailure> {
    headers(secret)?;
    if document.is_some() {
        let (member, token) = secret.split_once('.').ok_or_else(invalid)?; identifier(member)?;
        if token.len() != 43 || !token.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') { return Err(invalid()); }
    }
    Ok(())
}
async fn reply(mut response: reqwest::Response, limit: usize) -> Result<Value, RoomFailure> {
    let status = response.status();
    if !status.is_success() {
        let status = if status.is_redirection() { 422 } else { status.as_u16() };
        let mut code = "http";
        if response.headers().get(header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).and_then(|value| value.split(';').next()) == Some("application/json")
            && response.headers().get(header::CONTENT_ENCODING).is_none_or(|value| value == "identity")
            && response.content_length().is_none_or(|length| length <= 64 * 1024) {
            let mut bytes = Vec::new();
            while let Ok(Some(chunk)) = response.chunk().await {
                if bytes.len().checked_add(chunk.len()).is_none_or(|length| length > 64 * 1024) { bytes.clear(); break; }
                bytes.extend_from_slice(&chunk);
            }
            if let Ok(data) = serde_json::from_slice::<Value>(&bytes) {
                if data.get("version").and_then(Value::as_u64) == Some(1) {
                    code = match (status, data.get("error").and_then(Value::as_str)) { (403, Some("readonly")) => "readonly", (403, Some("comments")) => "comments", (409, Some("conflict")) => "conflict", (409, Some("retry")) => "retry", (409, Some("dependencies")) => "dependencies", (404, Some("receipt-missing")) => "receipt", _ => "http" };
                }
            }
        }
        return Err(failure(status, code, "The room service refused the operation."));
    }
    if response.headers().get(header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).and_then(|value| value.split(';').next()) != Some("application/json")
        || response.headers().get(header::CONTENT_ENCODING).is_some_and(|value| value != "identity") { return Err(failure(422, "protocol", "Unsupported room response format.")); }
    if response.content_length().is_some_and(|bytes| bytes > limit as u64)
        || response.headers().get(header::CONTENT_LENGTH).is_some_and(|value| value.to_str().ok().and_then(|value| value.parse::<u64>().ok()).is_none_or(|bytes| bytes > limit as u64)) { return Err(failure(413, "capacity", "The room response exceeds its transfer limit.")); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| failure(503, "network", "The room response was interrupted."))? {
        if bytes.len().checked_add(chunk.len()).is_none_or(|length| length > limit) { return Err(failure(413, "capacity", "The room response exceeds its transfer limit.")); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| failure(422, "protocol", "Invalid room response JSON."))
}
#[tauri::command]
pub fn xdesign_room_open(server_url: String, document_id: String) -> Result<String, RoomFailure> { REGISTRY.open(&server_url, document_id) }
#[tauri::command]
pub fn xdesign_room_cancel(handle: String, sequence: u64) -> Result<(), RoomFailure> { match REGISTRY.get(&handle) { Ok(session) => session.cancel(sequence), Err(error) if error.code == "cancelled" => Ok(()), Err(error) => Err(error) } }
#[tauri::command]
pub fn xdesign_room_close(handle: String) -> Result<(), RoomFailure> { REGISTRY.close(&handle) }
#[tauri::command]
pub async fn xdesign_room_request(handle: String, sequence: u64, operation: Operation) -> Result<Value, RoomFailure> {
    let session = REGISTRY.get(&handle)?;
    let (work, receiver) = session.start(sequence, &SLOTS)?;
    bounded(receiver, Duration::from_secs(30), async move {
        let request = prepare(work.clone(), move |session| plan(&session.origin, &session.document_id, &operation)).await?;
        let response_limit = request.response_limit;
        let key_ref = credential_ref(&work.session.origin, if request.administrator { None } else { Some(&work.session.document_id) })?;
        // OS keychain calls cannot be aborted; keep their slot until the thread returns.
        let keychain_work = work.clone();
        let secret = tokio::task::spawn_blocking(move || { let _work = keychain_work; crate::provider_keys::read(&key_ref) }).await
            .map_err(|_| failure(503, "credential", "Room credential storage could not be read."))?
            .ok_or_else(|| failure(401, "credential", "Configure a room credential for this server and document."))?;
        validate_credential(if request.administrator { None } else { Some(&work.session.document_id) }, &secret)?;
        let client = CLIENT.as_ref().map_err(|_| failure(503, "network", "The room connection could not initialize."))?;
        let mut builder = client.request(request.method, request.url).header(header::AUTHORIZATION, headers(&secret)?)
            .header(header::ACCEPT, "application/json").header(header::ACCEPT_ENCODING, "identity").header(header::CACHE_CONTROL, "no-store");
        if let Some(body) = request.body { builder = builder.header(header::CONTENT_TYPE, "application/json").body(body); }
        let response = builder.send().await.map_err(|_| failure(503, "network", "The room service could not connect. Its server outcome may be unknown."))?;
        let result = reply(response, response_limit).await; drop(work); result
    }).await
}
#[tauri::command]
pub async fn xdesign_room_image_file_request(app:tauri::AppHandle,handle:String,sequence:u64,operation:image_files::Operation)->Result<Value,RoomFailure>{
    use tauri::Manager;
    if operation.version!=1{return Err(invalid());}identifier(&operation.member_id)?;
    let root=app.path().app_data_dir().map_err(|_|invalid())?.join("assets/xdesign");
    let session=REGISTRY.get(&handle)?;let (work,receiver)=session.start(sequence,&SLOTS)?;
    let deadline=std::time::Instant::now()+Duration::from_secs(30);let timeout_session=session.clone();
    let result=bounded(receiver,Duration::from_secs(30),async move{
        prepare(work.clone(),move|session|{
            static FILE_GATE:Lazy<Mutex<()>>=Lazy::new(||Mutex::new(()));
            let _gate=FILE_GATE.try_lock().ok_or_else(||failure(503,"busy","Wait for the current native image transfer to finish."))?;
            let mut check=||{session.current(sequence)?;if std::time::Instant::now()>=deadline{return Err(failure(504,"timeout","The image operation timed out. Its local outcome may be unknown."));}Ok(())};
            check()?;let secret=crate::provider_keys::read(&credential_ref(&session.origin,Some(&session.document_id))?).ok_or_else(||failure(401,"credential","Configure the original room credential before accessing its image transfer."))?;
            validate_credential(Some(&session.document_id),&secret)?;
            if secret.split_once('.').map(|(member,_)|member)!=Some(operation.member_id.as_str()){return Err(failure(403,"credential","The image transfer belongs to another room member."));}
            crate::xdesign_photo::room_transfer_access(&root).map_err(|_|failure(503,"file","Image storage is unavailable; original transfers were retained."))?;
            let store=image_files::Store::new(&root,session.origin.as_str(),&session.document_id,&operation.member_id,&operation.project_id,&operation.transfer_id)?;
            store.run(operation.action,&mut check)
        }).await
    }).await;
    if result.as_ref().is_err_and(|error|error.code=="timeout"){let _=timeout_session.cancel(sequence);}result
}
#[tauri::command]
pub fn xdesign_room_key_set(server_url: String, document_id: Option<String>, secret: String) -> Result<(), RoomFailure> {
    let key_ref = credential_ref(&server(&server_url)?, document_id.as_deref())?; validate_credential(document_id.as_deref(), &secret)?;
    crate::provider_keys::provider_key_set(key_ref, secret).map_err(|_| failure(503, "credential", "Room credential storage could not be updated."))
}
#[tauri::command]
pub fn xdesign_room_key_clear(server_url: String, document_id: Option<String>) -> Result<(), RoomFailure> {
    let key_ref = credential_ref(&server(&server_url)?, document_id.as_deref())?;
    crate::provider_keys::provider_key_clear(key_ref).map_err(|_| failure(503, "credential", "Room credential storage could not be cleared."))
}
#[tauri::command]
pub fn xdesign_room_key_status(server_url: String, document_id: Option<String>) -> Result<bool, RoomFailure> {
    let key_ref = credential_ref(&server(&server_url)?, document_id.as_deref())?;
    Ok(crate::provider_keys::read(&key_ref).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    const DOC: &str = "design_document_0001";
    fn session() -> Arc<Session> { Arc::new(Session { origin: server("https://rooms.example.test").unwrap(), document_id: DOC.into(), state: Mutex::new(SessionState::default()) }) }
    fn message() -> Value { json!({"version":1,"type":"sync","documentId":DOC,"clientId":"client_0000000001","requestId":"request_000000001","vector":"AA=="}) }
    #[test]
    fn image_routes_use_only_pinned_member_credentials_and_independent_transfer_limits() {
        let origin = server("https://rooms.example.test").unwrap(); let request_id = "image_request_0001"; let image_id = "image_document_0001"; let revision = "a".repeat(64);
        let routes = vec![
            (Operation::ImageCatalog {}, Method::GET, "images".into(), image::CATALOG_RESPONSE_LIMIT),
            (Operation::ImageRevision { message: json!({"version":1,"imageId":image_id,"revisionId":null}) }, Method::POST, "images/revision".into(), image::METADATA_LIMIT),
            (Operation::ImageUpload { request_id:request_id.into() }, Method::GET, format!("images/uploads/{request_id}"), image::STATUS_RESPONSE_LIMIT),
            (Operation::DismissImage { request_id:request_id.into() }, Method::DELETE, format!("images/uploads/{request_id}"), image::STATUS_RESPONSE_LIMIT),
            (Operation::CommitImage { request_id:request_id.into() }, Method::POST, format!("images/uploads/{request_id}/commit"), image::STATUS_RESPONSE_LIMIT),
            (Operation::ImageChunk { image_id:image_id.into(), revision_id:revision.clone(), index:511 }, Method::GET, format!("images/{image_id}/revisions/{revision}/chunks/511"), image::CHUNK_MESSAGE_LIMIT+4096),
        ];
        for (operation, method, path, limit) in routes {
            let request=plan(&origin,DOC,&operation).unwrap();assert_eq!(request.method,method);assert_eq!(request.url.path(),format!("/v1/rooms/{DOC}/{path}"));assert!(!request.administrator);assert_eq!(request.response_limit,limit);
            if method==Method::POST { assert!(request.body.is_some()); } else { assert!(request.body.is_none()); }
        }
        let bytes=b"editable image archive chunk";
        let packet=json!({"version":1,"index":0,"sha256":format!("{:x}",Sha256::digest(bytes)),"data":STANDARD.encode(bytes)});
        let request=plan(&origin,DOC,&Operation::PutImageChunk{request_id:request_id.into(),index:0,message:packet.clone()}).unwrap();
        assert_eq!(request.method,Method::PUT);assert!(!request.administrator);assert_eq!(serde_json::from_slice::<Value>(&request.body.unwrap()).unwrap(),packet);
        assert_eq!(plan(&origin,DOC,&Operation::Sync{message:message()}).unwrap().response_limit,BODY_LIMIT);
    }
    #[test]
    fn image_operations_refuse_foreign_paths_new_fields_bad_hashes_and_unbounded_indices() {
        let origin=server("https://rooms.example.test").unwrap();
        for operation in [
            json!({"kind":"imageUpload","requestId":"../secret"}),json!({"kind":"imageCatalog","credential":"secret"}),
            json!({"kind":"imageChunk","imageId":"image_document_0001","revisionId":"A".repeat(64),"index":0}),
            json!({"kind":"imageChunk","imageId":"image_document_0001","revisionId":"a".repeat(64),"index":512}),
            json!({"kind":"imageRevision","message":{"version":2,"imageId":"image_document_0001","revisionId":null}}),
            json!({"kind":"commitImage","requestId":"image_request_0001","manifest":{}}),
            json!({"kind":"beginImage","message":{"version":1,"requestId":"image_request_0001","manifest":{}}}),
        ] {
            assert!(serde_json::from_value::<Operation>(operation).map(|op|plan(&origin,DOC,&op).is_err()).unwrap_or(true));
        }
    }
    fn response(status: u16, content_type: &str, body: Vec<u8>) -> reqwest::Response {
        tauri::http::Response::builder().status(status).header("Content-Type", content_type).body(reqwest::Body::from(body)).unwrap().into()
    }
    fn library_packet(graph: &str) -> Value {
        let checksum = format!("{:x}", Sha256::digest(serde_json::to_vec(&json!({"graph":graph})).unwrap()));
        json!({"version":1,"requestId":"library_request_001","bundle":{"version":1,"graph":graph,"checksum":checksum,"manifest":{"schemaVersion":1,"libraryId":"library:original.1","name":"Components 🙂","description":"Original description","revisionId":"a".repeat(64),"previousRevisionId":null,"publishedAt":"2026-10-11T12:00:00.000Z","assets":[{"key":"asset/icon:main","type":"COMPONENT","name":"Icon","description":"","sourceNodeId":"1:2","contentHash":"b".repeat(64),"thumbnail":"AAEC/w=="}]}}})
    }
    #[test]
    fn library_routes_are_closed_member_operations_with_separate_transfer_limits() {
        let origin = server("https://rooms.example.test").unwrap();
        let packet = library_packet("portable graph");
        for (operation, path, method, limit, body) in [
            (Operation::LibraryCatalog{}, "libraries", Method::GET, library::CATALOG_RESPONSE_LIMIT, None),
            (Operation::LibraryRevision{message:json!({"version":1,"libraryId":"library:original.1","revisionId":null})}, "libraries/revision", Method::POST, library::REVISION_RESPONSE_LIMIT, Some(json!({"version":1,"libraryId":"library:original.1","revisionId":null}))),
            (Operation::PublishLibrary{message:packet.clone()}, "libraries", Method::POST, library::RECEIPT_RESPONSE_LIMIT, Some(packet)),
            (Operation::RecoverLibrary{request_id:"library_request_001".into()}, "libraries/receipts/library_request_001", Method::GET, library::RECEIPT_RESPONSE_LIMIT, None),
        ] {
            let request=plan(&origin,DOC,&operation).unwrap(); assert_eq!(request.method,method); assert_eq!(request.url.path(),format!("/v1/rooms/{DOC}/{path}")); assert!(!request.administrator); assert_eq!(request.response_limit,limit);
            assert_eq!(request.body.map(|bytes|serde_json::from_slice::<Value>(&bytes).unwrap()),body);
        }
        let historic = plan(&origin,DOC,&Operation::LibraryRevision{message:json!({"version":1,"libraryId":"library:original.1","revisionId":"a".repeat(64)})}).unwrap(); assert!(!historic.url.as_str().contains("library:original"));
        assert_eq!(plan(&origin,DOC,&Operation::Sync{message:message()}).unwrap().response_limit,BODY_LIMIT);
    }
    #[test]
    fn malformed_library_fields_and_resources_cannot_reach_the_request() {
        let origin=server("https://rooms.example.test").unwrap();
        for value in [json!({"kind":"libraryCatalog","actor":"forged"}),json!({"kind":"libraryRevision","message":{},"url":"https://foreign.test"}),json!({"kind":"publishLibrary","message":{},"role":"owner"}),json!({"kind":"recoverLibrary","requestId":null})] { assert!(serde_json::from_value::<Operation>(value).is_err()); }
        let good=library_packet("portable graph");
        for (pointer,value) in [("/version",json!(2)),("/requestId",json!("short")),("/bundle/version",json!(2)),("/bundle/graph",json!("altered")),("/bundle/checksum",json!("b".repeat(64))),("/bundle/manifest/schemaVersion",json!(2)),("/bundle/manifest/libraryId",json!("../outside")),("/bundle/manifest/name",json!(" ")),("/bundle/manifest/previousRevisionId",json!("bad")),("/bundle/manifest/revisionId",json!("A".repeat(64))),("/bundle/manifest/publishedAt",json!("x".repeat(65))),("/bundle/manifest/assets/0/key",json!("?bad")),("/bundle/manifest/assets/0/type",json!("FRAME")),("/bundle/manifest/assets/0/thumbnail",json!("AB==")),("/bundle/manifest/assets/0/sourceNodeId",json!(""))] {
            let mut changed=good.clone(); *changed.pointer_mut(pointer).unwrap()=value; assert!(plan(&origin,DOC,&Operation::PublishLibrary{message:changed}).is_err(),"{pointer}");
        }
        for pointer in ["", "/bundle", "/bundle/manifest", "/bundle/manifest/assets/0"] {
            let mut changed=good.clone(); changed.pointer_mut(pointer).unwrap()["credential"]=json!("foreign"); assert!(plan(&origin,DOC,&Operation::PublishLibrary{message:changed}).is_err());
        }
        let mut duplicate=good.clone(); duplicate["bundle"]["manifest"]["assets"].as_array_mut().unwrap().push(good["bundle"]["manifest"]["assets"][0].clone()); assert!(plan(&origin,DOC,&Operation::PublishLibrary{message:duplicate}).is_err());
        for value in [json!({"version":2,"libraryId":"library","revisionId":null}),json!({"version":1,"libraryId":"bad/path","revisionId":null}),json!({"version":1,"libraryId":"library","revisionId":"small"}),json!({"version":1,"libraryId":"library"}),json!({"version":1,"libraryId":"library","revisionId":null,"credential":"foreign"})] { assert!(plan(&origin,DOC,&Operation::LibraryRevision{message:value}).is_err()); }
        assert!(plan(&origin,DOC,&Operation::RecoverLibrary{request_id:"../foreign".into()}).is_err());
    }
    #[test]
    fn library_transfer_admits_valid_unicode_and_larger_bundles_without_widening_artwork_bounds() {
        let origin=server("https://rooms.example.test").unwrap(); let mut unicode=library_packet("图\"\\\n🙂");
        unicode["bundle"]["manifest"]["name"]=json!("🙂".repeat(100)); unicode["bundle"]["manifest"]["description"]=json!("图".repeat(4000));
        assert!(plan(&origin,DOC,&Operation::PublishLibrary{message:unicode.clone()}).is_ok()); unicode["bundle"]["manifest"]["name"]=json!("🙂".repeat(101)); assert!(plan(&origin,DOC,&Operation::PublishLibrary{message:unicode}).is_err());
        let larger=library_packet(&"x".repeat(BODY_LIMIT+1024)); let request=plan(&origin,DOC,&Operation::PublishLibrary{message:larger}).unwrap(); assert!(request.body.unwrap().len()>BODY_LIMIT);
        let oversized=library_packet(&"x".repeat(library::BODY_LIMIT)); assert_eq!(plan(&origin,DOC,&Operation::PublishLibrary{message:oversized}).err().unwrap().status,413);
        assert_eq!(plan(&origin,DOC,&Operation::Sync{message:message()}).unwrap().response_limit,BODY_LIMIT);
    }
    #[test]
    fn comment_author_routes_and_grants_are_scoped_and_bounded() {
        let origin = server("https://rooms.example.test").unwrap();
        for (operation,path,limit) in [(Operation::CommentAuthors{}, "comments/authors", 8*1024*1024), (Operation::CommentOwnership{}, "comments/ownership", 2*1024*1024), (Operation::RecoverCommentAuthor{request_id:"author_request_001".into()}, "comments/authors/grants/author_request_001", 4096)] {
            let request = plan(&origin,DOC,&operation).unwrap(); assert_eq!(request.method,Method::GET); assert_eq!(request.url.path(),format!("/v1/rooms/{DOC}/{path}")); assert!(!request.administrator); assert!(request.body.is_none()); assert_eq!(request.response_limit,limit);
        }
        for member in [Value::Null,json!("member_identity_001")] {
            let message = json!({"version":1,"authorId":"local:author/1","memberId":member,"step":0,"requestId":"author_request_001"});
            let operation: Operation = serde_json::from_value(json!({"kind":"assignCommentAuthor","message":message})).unwrap();
            let request = plan(&origin,DOC,&operation).unwrap(); assert_eq!(request.method,Method::POST); assert_eq!(request.url.path(),format!("/v1/rooms/{DOC}/comments/authors")); assert!(!request.administrator); assert_eq!(request.response_limit,4096); assert_eq!(serde_json::from_slice::<Value>(&request.body.unwrap()).unwrap(),message);
        }
    }
    #[test]
    fn malformed_comment_author_operations_cannot_dispatch() {
        let origin = server("https://rooms.example.test").unwrap();
        for value in [json!({"kind":"commentAuthors","secret":"bad"}),json!({"kind":"commentOwnership","actor":"forged"}),json!({"kind":"recoverCommentAuthor","requestId":null}),json!({"kind":"assignCommentAuthor","message":{},"role":"owner"})] { assert!(serde_json::from_value::<Operation>(value).is_err()); }
        let good = json!({"version":1,"authorId":"legacy","memberId":null,"step":0,"requestId":"author_request_001"});
        for (key,value) in [("version",json!(2)),("authorId",json!("evil?author")),("memberId",json!("short")),("step",json!(-1)),("step",json!(1.5)),("step",json!(MAX_SEQUENCE)),("requestId",json!("short")),("actor",json!("spoof"))] { let mut message=good.clone(); message[key]=value; assert!(plan(&origin,DOC,&Operation::AssignCommentAuthor{message}).is_err()); }
        for key in ["version","authorId","memberId","step","requestId"] { let mut message=good.clone(); message.as_object_mut().unwrap().remove(key); assert!(plan(&origin,DOC,&Operation::AssignCommentAuthor{message}).is_err()); }
        assert!(plan(&origin,DOC,&Operation::RecoverCommentAuthor{request_id:"bad/route".into()}).is_err());
    }
    #[test]
    fn origins_and_credentials_stay_scoped() {
        for value in ["https://rooms.example.test", "http://127.0.0.1:4787", "http://[::1]:4787"] { assert!(server(value).is_ok(), "{value}"); }
        for value in ["http://rooms.example.test", "http://localhost:4787", "https://user:secret@rooms.example.test", "https://@rooms.example.test", "https://rooms.example.test/path", "https://rooms.example.test?secret=x", "https://rooms.example.test#x", "file:///tmp/room", "https://rooms.example.test:0", " https://rooms.example.test", "https://rooms.example.test\n"] { assert!(server(value).is_err(), "{value}"); }
        let origin = server("https://rooms.example.test:443/").unwrap();
        assert_eq!(credential_ref(&origin, Some(DOC)).unwrap(), credential_ref(&server("https://rooms.example.test").unwrap(), Some(DOC)).unwrap());
        assert_ne!(credential_ref(&origin, Some(DOC)).unwrap(), credential_ref(&origin, None).unwrap());
        assert_ne!(credential_ref(&origin, Some(DOC)).unwrap(), credential_ref(&server("https://elsewhere.example.test").unwrap(), Some(DOC)).unwrap());
        assert_ne!(credential_ref(&origin, Some(DOC)).unwrap(), credential_ref(&origin, Some("design_document_0002")).unwrap());
        assert!(headers(&"a".repeat(32)).unwrap().is_sensitive()); assert!(headers(&format!("{}\r\n", "a".repeat(32))).is_err());
        assert!(validate_credential(None,&"a".repeat(32)).is_ok());assert!(validate_credential(Some(DOC),&"a".repeat(32)).is_err());
        assert!(validate_credential(Some(DOC),&format!("membership_0000001.{}","a".repeat(43))).is_ok());
        for value in [format!("membership_0000001.{}","a".repeat(42)),format!("../outside.{}","a".repeat(43)),format!("membership_0000001.{}+","a".repeat(42))] { assert!(validate_credential(Some(DOC),&value).is_err()); }
    }
    #[test]
    fn routes_and_bodies_are_closed_and_pinned() {
        let origin = server("https://rooms.example.test").unwrap();
        let packet = message(); let request = plan(&origin, DOC, &Operation::Sync { message: packet.clone() }).unwrap();
        assert_eq!(request.url.as_str(), format!("https://rooms.example.test/v1/rooms/{DOC}/sync")); assert_eq!(request.method, Method::POST); assert!(!request.administrator);
        assert_eq!(serde_json::from_slice::<Value>(&request.body.unwrap()).unwrap(), packet);
        for patch in [json!({"version":2}),json!({"documentId":"other_document_001"}),json!({"query":"secret"}),json!({"vector":"AB=="}),json!({"update":"AAA="}),json!({"clientId":"../escape"})] {
            let mut packet = message(); for (key,value) in patch.as_object().unwrap() { packet[key]=value.clone(); } assert!(plan(&origin,DOC,&Operation::Sync{message:packet}).is_err());
        }
        let mut packet = message(); packet["type"]=json!("update"); packet["update"]=json!("AAA="); assert!(plan(&origin,DOC,&Operation::Sync{message:packet}).is_ok());
        assert!(binary(&json!("AAA="),1,1).is_err()); assert!(binary(&json!(""),10,1).is_err());
        assert!(serde_json::from_value::<Operation>(json!({"kind":"members","url":"https://elsewhere.test"})).is_err());
        assert!(serde_json::from_value::<Operation>(json!({"kind":"members"})).is_ok());
        assert!(serde_json::from_value::<Operation>(json!({"kind":"create","name":"Room","ownerName":"Owner","checkpoint":"AAA="})).is_ok());
        assert!(serde_json::from_value::<Operation>(json!({"kind":"change","memberId":"membership_0000001","role":"editor"})).is_ok());
        assert!(serde_json::from_value::<Operation>(json!({"kind":"sync","message":message(),"extra":true})).is_err());
        assert!(serde_json::from_value::<Operation>(json!({"kind":"invite","name":"Peer","role":"owner"})).is_err());
        let create=plan(&origin,DOC,&Operation::Create{name:"Room".into(),owner_name:"Owner".into(),checkpoint:"AAA=".into(),request_id:None}).unwrap(); assert!(create.administrator);assert_eq!(create.url.path(),"/v1/rooms");
        for operation in [Operation::Members {},Operation::Invite{name:"Peer".into(),role:Role::Viewer,request_id:None},Operation::Change{member_id:"membership_0000001".into(),role:Role::Editor},Operation::Revoke{member_id:"membership_0000001".into()}] { let request=plan(&origin,DOC,&operation).unwrap();assert!(!request.administrator);assert!(request.url.path().starts_with(&format!("/v1/rooms/{DOC}/members"))); }
    }
    #[test]
    fn grant_receipts_pin_identifiers_routes_and_authority() {
        let origin = server("https://rooms.example.test").unwrap(); let request_id = "grant_request_00001";
        for (kind, creation) in [("create", true), ("invite", false)] {
            let operation: Operation = serde_json::from_value(json!({"kind":"recover","grantKind":kind,"requestId":request_id})).unwrap();
            let request = plan(&origin,DOC,&operation).unwrap(); assert_eq!(request.method,Method::GET); assert!(request.body.is_none()); assert_eq!(request.administrator,creation); assert_eq!(request.url.path(),format!("/v1/rooms/{DOC}/grants/{kind}/{request_id}"));
        }
        for input in [json!({"kind":"create","name":"Room","ownerName":"Owner","checkpoint":"AAA=","requestId":request_id}),json!({"kind":"invite","name":"Peer","role":"viewer","requestId":request_id})] {
            let operation: Operation=serde_json::from_value(input).unwrap(); let request=plan(&origin,DOC,&operation).unwrap(); assert_eq!(serde_json::from_slice::<Value>(&request.body.unwrap()).unwrap()["requestId"],json!(request_id));
        }
        for input in [json!({"kind":"recover","grantKind":"owner","requestId":request_id}),json!({"kind":"recover","grantKind":"create","requestId":request_id,"credential":"secret"}),json!({"kind":"invite","name":"Peer","role":"viewer","requestId":null})] { assert!(serde_json::from_value::<Operation>(input).is_err()); }
        let operation: Operation=serde_json::from_value(json!({"kind":"recover","grantKind":"invite","requestId":"../outside"})).unwrap(); assert!(plan(&origin,DOC,&operation).is_err());
    }
    #[test]
    fn comment_commands_and_recovery_are_closed_scoped_member_operations() {
        let origin = server("https://rooms.example.test").unwrap();
        let anchor = json!({"points":[{"x":0.25,"y":0.5}],"fallback":[{"x":12,"y":24}],"format":"local","nodeId":"2:0"});
        let commands = [json!({"type":"add","pageId":"1:0","anchor":anchor,"body":"Viewer 👩🏽‍🎨"}),json!({"type":"reply","threadId":"thread","body":"Reply"}),json!({"type":"edit","threadId":"thread","messageId":"reply","body":"Edit"}),json!({"type":"delete","threadId":"thread","messageId":"reply"}),json!({"type":"resolve","threadId":"thread","resolved":true}),json!({"type":"move","threadId":"thread","pageId":"1:0","anchor":anchor}),json!({"type":"react","threadId":"thread","messageId":"reply","emoji":"👍"})];
        for command in commands {
            let packet = json!({"version":1,"type":"comment","documentId":DOC,"clientId":"comment_client_001","requestId":"comment_request_001","vector":"AA==","command":command});
            for recover_only in [false,true] {
                let input = json!({"kind":"comment","message":packet,"recoverOnly":recover_only});
                let operation: Operation = serde_json::from_value(input).unwrap(); let request = plan(&origin,DOC,&operation).unwrap();
                assert_eq!(request.method,Method::POST); assert_eq!(request.url.path(),format!("/v1/rooms/{DOC}/comments{}",if recover_only{"/recover"}else{""})); assert!(!request.administrator); assert_eq!(request.response_limit,BODY_LIMIT); assert_eq!(serde_json::from_slice::<Value>(&request.body.unwrap()).unwrap(),packet);
            }
            for patch in [json!({"author":{"id":"member","name":"Fake"}}),json!({"createdAt":1000}),json!({"update":"AAA="}),json!({"documentId":"other_document_001"}),json!({"vector":"AB=="})] {
                let mut changed = packet.clone(); for (key,value) in patch.as_object().unwrap() { changed[key]=value.clone(); } assert!(plan(&origin,DOC,&Operation::Comment{message:changed,recover_only:false}).is_err());
            }
            let mut changed = packet; changed["command"]["author"]=json!({"id":"member","name":"Fake"}); assert!(plan(&origin,DOC,&Operation::Comment{message:changed,recover_only:false}).is_err());
        }
        for input in [json!({"kind":"comment","message":{}}),json!({"kind":"comment","message":{},"recoverOnly":null}),json!({"kind":"comment","message":{},"recoverOnly":false,"url":"https://elsewhere.test"})] { assert!(serde_json::from_value::<Operation>(input).is_err()); }
    }
    #[test]
    fn comment_text_regions_and_optional_fields_obey_exact_bounds() {
        let origin = server("https://rooms.example.test").unwrap(); let base = json!({"version":1,"type":"comment","documentId":DOC,"clientId":"comment_client_001","requestId":"comment_request_001","vector":"AA==","command":{"type":"reply","threadId":"thread","body":"🙂".repeat(4096)}});
        assert!(plan(&origin,DOC,&Operation::Comment{message:base.clone(),recover_only:false}).is_ok());
        for body in [json!("🙂".repeat(4097)),json!(" \n"),Value::Null] { let mut packet=base.clone();packet["command"]["body"]=body;assert!(plan(&origin,DOC,&Operation::Comment{message:packet,recover_only:false}).is_err()); }
        let region = json!({"points":[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1}],"fallback":[{"x":0,"y":0},{"x":100,"y":0},{"x":100,"y":100},{"x":0,"y":100}],"format":"local"}); assert!(comment_anchor(&region).is_ok());
        for patch in [json!({"nodeId":null}),json!({"format":"fig"}),json!({"instancePath":["2:0"]}),json!({"points":[{"x":1000000001i64,"y":0}]}),json!({"fallback":[{"x":0,"y":0}]})] { let mut changed=region.clone();for(key,value)in patch.as_object().unwrap(){changed[key]=value.clone();}assert!(comment_anchor(&changed).is_err()); }
    }
    #[test]
    fn comment_history_is_member_scoped_closed_and_bounded() {
        let origin = server("https://rooms.example.test").unwrap();
        for before in [None, Some(1), Some(9_007_199_254_740_991)] {
            let request = plan(&origin,DOC,&Operation::CommentHistory{before}).unwrap();
            assert_eq!(request.method,Method::GET); assert!(!request.administrator); assert_eq!(request.response_limit,1024*1024); assert!(request.body.is_none());
            assert_eq!(request.url.path(),format!("/v1/rooms/{DOC}/comments/history{}",before.map_or(String::new(),|cursor|format!("/{cursor}"))));
        }
        for before in [0,9_007_199_254_740_992] { assert!(plan(&origin,DOC,&Operation::CommentHistory{before:Some(before)}).is_err()); }
        for value in [json!({"kind":"commentHistory","before":null}),json!({"kind":"commentHistory","before":-1}),json!({"kind":"commentHistory","url":"https://foreign.test"})] { assert!(serde_json::from_value::<Operation>(value).is_err()); }
        let packet=json!({"version":1,"type":"comment","documentId":DOC,"clientId":"history_client_001","requestId":"history_request_001","vector":"AA==","command":{"type":"history","threadId":"thread","sourceClientId":"original_client_001","sourceRequestId":"original_request_001","direction":"undo","step":0}});
        assert!(plan(&origin,DOC,&Operation::Comment{message:packet.clone(),recover_only:false}).is_ok());
        for patch in [json!({"step":-1}),json!({"step":9_007_199_254_740_991u64}),json!({"direction":"restore"}),json!({"sourceClientId":"../foreign"}),json!({"snapshot":{}})] {
            let mut changed=packet.clone(); for(key,value) in patch.as_object().unwrap() {changed["command"][key]=value.clone();} assert!(plan(&origin,DOC,&Operation::Comment{message:changed,recover_only:false}).is_err());
        }
    }
    #[test]
    fn presence_is_ephemeral_scoped_bounded_and_cannot_claim_membership() {
        let origin = server("https://rooms.example.test").unwrap();
        let packet = json!({"version":1,"documentId":DOC,"clientId":"presence_client_001","sequence":1,"state":{"pageId":"1:0","cursor":[12,24],"selection":["2:0"],"view":{"center":[0,0],"zoom":0.001,"width":800,"height":600},"following":null}});
        let request = plan(&origin, DOC, &Operation::Presence { message: packet.clone() }).unwrap(); assert_eq!(request.url.path(), format!("/v1/rooms/{DOC}/presence")); assert_eq!(request.method, Method::POST); assert!(!request.administrator); assert_eq!(request.response_limit, 4 * 1024 * 1024);
        assert_eq!(serde_json::from_slice::<Value>(&request.body.unwrap()).unwrap(), packet);
        for patch in [json!({"actor":{"role":"owner"}}),json!({"documentId":"other_document_001"}),json!({"sequence":0}),json!({"sequence":9007199254740992u64}),json!({"clientId":"../escape"})] {
            let mut changed = packet.clone(); for (key, value) in patch.as_object().unwrap() { changed[key] = value.clone(); } assert!(plan(&origin,DOC,&Operation::Presence { message: changed }).is_err());
        }
        for patch in [json!({"following":"presence_client_001"}),json!({"cursor":[100000001,0]}),json!({"selection":["2:0","2:0"]}),json!({"view":{"center":[0,0],"zoom":0,"width":800,"height":600}}),json!({"extra":true})] {
            let mut changed = packet.clone(); for (key, value) in patch.as_object().unwrap() { changed["state"][key] = value.clone(); } assert!(plan(&origin,DOC,&Operation::Presence { message: changed }).is_err());
        }
        let mut leaving = packet; leaving["state"] = Value::Null; assert!(plan(&origin,DOC,&Operation::Presence { message: leaving }).is_ok());
        assert!(serde_json::from_value::<Operation>(json!({"kind":"presence","message":{},"url":"https://elsewhere.test"})).is_err());
    }
    #[test]
    fn registry_and_slots_bound_lifetimes() {
        let registry=Registry::default(); let slots=Arc::new(Slots::default()); let mut handles=Vec::new();
        for _ in 0..8 { handles.push(registry.open("https://rooms.example.test",DOC.into()).unwrap()); } assert_eq!(registry.open("https://rooms.example.test",DOC.into()).unwrap_err().code,"busy");
        let session=registry.get(&handles[0]).unwrap(); let (work,_)=session.start(1,&slots).unwrap(); assert_eq!(session.start(2,&slots).err().unwrap().code,"busy");
        registry.close(&handles[0]).unwrap();registry.close(&handles[0]).unwrap();assert!(session.state.lock().closed);assert!(registry.get(&handles[0]).is_err());drop(work);assert_eq!(slots.0.load(Ordering::SeqCst),0);
        let leases=(0..4).map(|_|slots.acquire().unwrap()).collect::<Vec<_>>();assert_eq!(slots.acquire().err().unwrap().code,"busy");drop(leases);assert!(slots.acquire().is_ok());
    }
    #[test]
    fn native_file_callbacks_reject_cancelled_closed_and_completed_sequences() {
        let session=session();let slots=Arc::new(Slots::default());let (work,_)=session.start(1,&slots).unwrap();assert!(session.current(1).is_ok());assert_eq!(session.current(2).unwrap_err().status,499);
        session.cancel(1).unwrap();assert_eq!(session.current(1).unwrap_err().status,499);assert_eq!(slots.0.load(Ordering::SeqCst),1);drop(work);
        let (work,_)=session.start(2,&slots).unwrap();assert!(session.current(2).is_ok());drop(work);assert_eq!(session.current(2).unwrap_err().status,499);
        let (work,_)=session.start(3,&slots).unwrap();session.close();assert_eq!(session.current(3).unwrap_err().status,499);drop(work);assert_eq!(slots.0.load(Ordering::SeqCst),0);
    }
    #[tokio::test]
    async fn cancellation_covers_dispatch_races_and_old_sequences() {
        let session=session();let slots=Arc::new(Slots::default());session.cancel(1).unwrap();assert_eq!(session.start(1,&slots).err().unwrap().code,"cancelled");
        let (work,receiver)=session.start(2,&slots).unwrap();session.cancel(1).unwrap();assert!(!*receiver.borrow());
        session.cancel(2).unwrap();assert_eq!(bounded(receiver,Duration::from_secs(1),std::future::pending::<Result<(),RoomFailure>>()).await.unwrap_err().code,"cancelled");drop(work);
        let (work,receiver)=session.start(3,&slots).unwrap();let keychain_work=work.clone();
        let result=bounded(receiver,Duration::from_millis(5),std::future::pending::<Result<(),RoomFailure>>()).await;assert_eq!(result.unwrap_err().status,504);drop(work);
        assert_eq!(session.start(4,&slots).err().unwrap().code,"busy");drop(keychain_work);assert_eq!(slots.0.load(Ordering::SeqCst),0);
        let (work,receiver)=session.start(4,&slots).unwrap();session.close();assert_eq!(bounded(receiver,Duration::from_secs(1),async{Ok(())}).await.unwrap_err().code,"cancelled");drop(work);
    }
    #[tokio::test]
    async fn cancellation_interrupts_a_pending_operation() {
        let session=session();let slots=Arc::new(Slots::default());let (work,receiver)=session.start(1,&slots).unwrap();
        let task=tokio::spawn(bounded(receiver,Duration::from_secs(1),std::future::pending::<Result<(),RoomFailure>>()));tokio::task::yield_now().await;session.cancel(1).unwrap();
        assert_eq!(task.await.unwrap().unwrap_err().code,"cancelled");drop(work);assert!(session.start(2,&slots).is_ok());
    }
    #[tokio::test]
    async fn cancelled_blocking_preparation_retains_its_slot_until_the_thread_finishes() {
        let session=session(); let slots=Arc::new(Slots::default()); let (work,receiver)=session.start(1,&slots).unwrap();
        let (started,ready)=tokio::sync::oneshot::channel(); let (release,permit)=std::sync::mpsc::channel();
        let task=tokio::spawn(bounded(receiver,Duration::from_secs(2),prepare(work,move |session| {
            let _=started.send(()); permit.recv().map_err(|_|invalid())?; plan(&session.origin,&session.document_id,&Operation::LibraryCatalog{})
        })));
        ready.await.unwrap(); session.cancel(1).unwrap(); assert_eq!(task.await.unwrap().err().unwrap().code,"cancelled");
        assert_eq!(slots.0.load(Ordering::SeqCst),1); assert_eq!(session.start(2,&slots).err().unwrap().code,"busy"); release.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(2),async { while slots.0.load(Ordering::SeqCst)!=0 { tokio::task::yield_now().await; } }).await.unwrap();
        assert!(session.start(2,&slots).is_ok());
    }
    #[tokio::test]
    async fn actual_response_streams_are_bounded_and_error_text_is_not_reflected() {
        assert_eq!(reply(response(200,"application/json; charset=utf-8",b"{\"version\":1}".to_vec()),100).await.unwrap(),json!({"version":1}));
        assert_eq!(reply(response(200,"application/json",b"malformed".to_vec()),100).await.unwrap_err().code,"protocol");
        assert_eq!(reply(response(200,"text/html",b"secret".to_vec()),100).await.unwrap_err().code,"protocol");
        let error=reply(response(401,"text/html",b"credential-in-error".to_vec()),100).await.unwrap_err();assert_eq!(error.status,401);assert!(!serde_json::to_string(&error).unwrap().contains("credential-in-error"));
        assert_eq!(reply(response(302,"text/html",vec![]),100).await.unwrap_err().status,422);
        assert_eq!(reply(response(403,"application/json",br#"{"version":1,"error":"readonly","message":"untrusted"}"#.to_vec()),100).await.unwrap_err().code,"readonly");
        assert_eq!(reply(response(403,"application/json",br#"{"version":1,"error":"comments","message":"untrusted"}"#.to_vec()),100).await.unwrap_err().code,"comments");
        assert_eq!(reply(response(409,"application/json",br#"{"version":1,"error":"conflict"}"#.to_vec()),100).await.unwrap_err().code,"conflict");
        assert_eq!(reply(response(409,"application/json",br#"{"version":1,"error":"retry"}"#.to_vec()),100).await.unwrap_err().code,"retry");
        assert_eq!(reply(response(409,"application/json",br#"{"version":1,"error":"dependencies"}"#.to_vec()),100).await.unwrap_err().code,"dependencies");
        assert_eq!(reply(response(404,"application/json",br#"{"version":1,"error":"receipt-missing"}"#.to_vec()),100).await.unwrap_err().code,"receipt");
        assert_eq!(reply(response(404,"application/json",br#"{"version":1,"error":"missing"}"#.to_vec()),100).await.unwrap_err().code,"http");
        let encoded=tauri::http::Response::builder().status(200).header("Content-Type","application/json").header("Content-Encoding","gzip").body(reqwest::Body::from("{}")).unwrap();assert_eq!(reply(encoded.into(),100).await.unwrap_err().code,"protocol");
        let stream=futures_util::stream::iter(vec![Ok::<_,std::io::Error>(bytes::Bytes::from_static(b"1234")),Ok(bytes::Bytes::from_static(b"5678"))]);
        let streamed=tauri::http::Response::builder().status(200).header("Content-Type","application/json").header("Content-Length","1").body(reqwest::Body::wrap_stream(stream)).unwrap();assert_eq!(reply(streamed.into(),6).await.unwrap_err().status,413);
        let declared=tauri::http::Response::builder().status(200).header("Content-Type","application/json").header("Content-Length","200").body(reqwest::Body::from("{}")).unwrap();assert_eq!(reply(declared.into(),100).await.unwrap_err().status,413);
    }
}
