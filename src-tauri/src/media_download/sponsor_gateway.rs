use crate::media_download::sponsor::{Choice, Mode, CATEGORIES};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::JoinHandle,
    time::timeout,
};

const MAX_HEADERS: usize = 8 * 1024;
const MAX_BODY: usize = 256 * 1024;
const MAX_ENTRIES: usize = 2000;
const HEADER_TIMEOUT: Duration = Duration::from_secs(10);
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(20);
const ACTIONS: &[&str] = &["skip", "poi", "chapter"];
const FAILURE: &str = "SponsorBlock lookup could not be verified. Retry or turn SponsorBlock off.";
type GatewayResult<T> = Result<T, &'static str>;

#[derive(Default)]
struct Verification {
    verified: AtomicBool,
    failed: AtomicBool,
    busy: AtomicBool,
}

impl Verification {
    fn verify(&self) -> Result<(), String> {
        if self.failed.load(Ordering::SeqCst)
            || self.busy.load(Ordering::SeqCst)
            || !self.verified.load(Ordering::SeqCst)
        {
            return Err(FAILURE.into());
        }
        Ok(())
    }
}

pub(super) struct Gateway {
    url: String,
    verification: Arc<Verification>,
    task: JoinHandle<()>,
}

enum Upstream {
    Production,
    #[cfg(test)]
    Test(reqwest::Url),
}

impl Upstream {
    fn base(&self) -> &str {
        match self {
            Self::Production => "https://sponsor.ajay.app",
            #[cfg(test)]
            Self::Test(url) => url.as_str().trim_end_matches('/'),
        }
    }
}

impl Gateway {
    pub(super) async fn start(choice: &Choice) -> Result<Option<Self>, String> {
        if choice.mode == Mode::Off {
            return Ok(None);
        }
        Self::bind(choice, Upstream::Production).await.map(Some)
    }

    #[cfg(test)]
    pub(super) async fn start_test(
        choice: &Choice,
        upstream: &str,
    ) -> Result<Option<Self>, String> {
        if choice.mode == Mode::Off {
            return Ok(None);
        }
        let url = test_upstream(upstream).map_err(str::to_owned)?;
        Self::bind(choice, Upstream::Test(url)).await.map(Some)
    }

    async fn bind(choice: &Choice, upstream: Upstream) -> Result<Self, String> {
        let categories = choice.categories();
        if categories.is_empty()
            || categories.len() > CATEGORIES.len()
            || categories.iter().enumerate().any(|(i, category)| {
                !CATEGORIES.contains(&category.as_str()) || categories[..i].contains(category)
            })
        {
            return Err("Choose distinct supported SponsorBlock categories.".into());
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .https_only(matches!(&upstream, Upstream::Production))
            .timeout(UPSTREAM_TIMEOUT)
            .build()
            .map_err(|_| "SponsorBlock gateway could not initialize.")?;
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| "SponsorBlock gateway could not listen locally.")?;
        let address = listener
            .local_addr()
            .map_err(|_| "SponsorBlock gateway could not find its local address.")?;
        let nonce = ulid::Ulid::new().to_string();
        let url = format!("http://{address}/{nonce}");
        let verification = Arc::new(Verification::default());
        let state = Arc::clone(&verification);
        let task = tokio::spawn(async move {
            loop {
                let (mut stream, _) = match listener.accept().await {
                    Ok(connection) => connection,
                    Err(_) => {
                        state.failed.store(true, Ordering::SeqCst);
                        break;
                    }
                };
                state.busy.store(true, Ordering::SeqCst);
                let result = lookup(&mut stream, &nonce, &categories, &client, &upstream).await;
                match result {
                    Ok(body) => {
                        if respond(&mut stream, true, &body).await.is_ok() {
                            state.verified.store(true, Ordering::SeqCst);
                        } else {
                            state.failed.store(true, Ordering::SeqCst);
                        }
                    }
                    Err(_) => {
                        // A retry must never erase an earlier malformed or unbounded result.
                        state.failed.store(true, Ordering::SeqCst);
                        let _ = respond(&mut stream, false, b"SponsorBlock lookup failed.").await;
                    }
                }
                state.busy.store(false, Ordering::SeqCst);
            }
        });
        Ok(Self {
            url,
            verification,
            task,
        })
    }

    pub(super) fn url(&self) -> &str {
        &self.url
    }

    pub(super) fn verify(&self) -> Result<(), String> {
        if self.task.is_finished() {
            return Err(FAILURE.into());
        }
        self.verification.verify()
    }
}

impl Drop for Gateway {
    fn drop(&mut self) {
        // The owned task also owns every in-flight upstream future; none may outlive the child.
        self.task.abort();
    }
}

#[cfg(test)]
fn test_upstream(upstream: &str) -> GatewayResult<reqwest::Url> {
    let url = reqwest::Url::parse(upstream).map_err(|_| "Invalid test SponsorBlock upstream.")?;
    let loopback = url
        .host_str()
        .and_then(|host| {
            host.trim_start_matches('[')
                .trim_end_matches(']')
                .parse::<std::net::IpAddr>()
                .ok()
        })
        .is_some_and(|ip| ip.is_loopback());
    if url.scheme() != "http"
        || !loopback
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port_or_known_default() == Some(0)
    {
        return Err("Test SponsorBlock upstream must be a loopback HTTP origin.");
    }
    Ok(url)
}

async fn read_headers<R: AsyncRead + Unpin>(reader: &mut R) -> GatewayResult<Vec<u8>> {
    timeout(HEADER_TIMEOUT, async {
        let mut headers = Vec::new();
        let mut buffer = [0_u8; 1024];
        loop {
            let remaining = MAX_HEADERS - headers.len();
            if remaining == 0 {
                return Err("SponsorBlock request headers are too large.");
            }
            let length = remaining.min(buffer.len());
            let read = reader
                .read(&mut buffer[..length])
                .await
                .map_err(|_| "SponsorBlock request could not be read.")?;
            if read == 0 {
                return Err("SponsorBlock request headers are incomplete.");
            }
            headers.extend_from_slice(&buffer[..read]);
            if let Some(end) = headers.windows(4).position(|part| part == b"\r\n\r\n") {
                if end + 4 != headers.len() {
                    return Err("SponsorBlock request must not contain a body or pipeline.");
                }
                return Ok(headers);
            }
        }
    })
    .await
    .map_err(|_| "SponsorBlock request headers timed out.")?
}

fn request_prefix(headers: &[u8], nonce: &str, categories: &[String]) -> GatewayResult<String> {
    if headers.len() > MAX_HEADERS || !headers.ends_with(b"\r\n\r\n") {
        return Err("Invalid SponsorBlock request headers.");
    }
    let headers =
        std::str::from_utf8(headers).map_err(|_| "Invalid SponsorBlock request headers.")?;
    let mut lines = headers[..headers.len() - 4].split("\r\n");
    let mut request = lines
        .next()
        .ok_or("Missing SponsorBlock request.")?
        .split(' ');
    if request.next() != Some("GET") {
        return Err("SponsorBlock gateway accepts only GET requests.");
    }
    let target = request.next().ok_or("Missing SponsorBlock request path.")?;
    if !matches!(request.next(), Some("HTTP/1.0" | "HTTP/1.1")) || request.next().is_some() {
        return Err("Invalid SponsorBlock request line.");
    }
    let mut content_length = false;
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or("Invalid SponsorBlock request header.")?;
        if name.is_empty()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte))
            || value
                .bytes()
                .any(|byte| byte.is_ascii_control() && byte != b'\t')
            || name.eq_ignore_ascii_case("transfer-encoding")
        {
            return Err("Invalid SponsorBlock request header.");
        }
        if name.eq_ignore_ascii_case("content-length") {
            if content_length || value.trim() != "0" {
                return Err("SponsorBlock request must not contain a body.");
            }
            content_length = true;
        }
    }
    let (path, query) = target
        .split_once('?')
        .ok_or("Missing SponsorBlock request query.")?;
    let expected_path = format!("/{nonce}/api/skipSegments/");
    let prefix = path
        .strip_prefix(&expected_path)
        .filter(|prefix| {
            prefix.len() == 4
                && prefix
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
        .ok_or("Invalid SponsorBlock request path.")?;
    if query.contains('#')
        || query
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b' ')
    {
        return Err("Invalid SponsorBlock request query.");
    }
    let parsed = reqwest::Url::parse(&format!("http://127.0.0.1/?{query}"))
        .map_err(|_| "Invalid SponsorBlock request query.")?;
    let (mut service, mut requested, mut actions) = (false, false, false);
    for (name, value) in parsed.query_pairs() {
        match name.as_ref() {
            "service" if !service && value == "YouTube" => service = true,
            "categories" if !requested && exact_set(&value, categories) => requested = true,
            "actionTypes" if !actions && exact_set(&value, ACTIONS) => actions = true,
            _ => return Err("Unexpected SponsorBlock request query."),
        }
    }
    if !service || !requested || !actions {
        return Err("Incomplete SponsorBlock request query.");
    }
    Ok(prefix.to_owned())
}

fn exact_set<T: AsRef<str>>(json: &str, expected: &[T]) -> bool {
    let Ok(values) = serde_json::from_str::<Vec<String>>(json) else {
        return false;
    };
    values.len() == expected.len()
        && values.iter().enumerate().all(|(i, value)| {
            expected.iter().any(|item| item.as_ref() == value) && !values[..i].contains(value)
        })
}

fn append_bounded(body: &mut Vec<u8>, chunk: &[u8]) -> GatewayResult<()> {
    if chunk.len() > MAX_BODY.saturating_sub(body.len()) {
        return Err("SponsorBlock response is too large.");
    }
    body.extend_from_slice(chunk);
    Ok(())
}

fn validate_body(body: &[u8], categories: &[String]) -> GatewayResult<Vec<u8>> {
    if body.len() > MAX_BODY {
        return Err("SponsorBlock response is too large.");
    }
    let value: Value =
        serde_json::from_slice(body).map_err(|_| "SponsorBlock response is not valid JSON.")?;
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= MAX_ENTRIES)
        .ok_or("SponsorBlock response must be a bounded array.")?;
    let mut count = 0;
    let mut videos = BTreeSet::new();
    for row in rows {
        let row = row.as_object().ok_or("Invalid SponsorBlock video row.")?;
        if !row
            .get("videoID")
            .and_then(Value::as_str)
            .is_some_and(|id| {
                id.len() == 11
                    && id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
            })
            || !valid_duration(row.get("videoDuration"))
        {
            return Err("Invalid SponsorBlock video row.");
        }
        if !videos.insert(row["videoID"].as_str().unwrap()) {
            return Err("Duplicate SponsorBlock video rows.");
        }
        let segments = row
            .get("segments")
            .and_then(Value::as_array)
            .filter(|segments| segments.len() <= MAX_ENTRIES)
            .ok_or("Invalid SponsorBlock segments.")?;
        count += segments.len();
        if count > MAX_ENTRIES {
            return Err("Too many SponsorBlock segments.");
        }
        for segment in segments {
            let segment = segment.as_object().ok_or("Invalid SponsorBlock segment.")?;
            let range = segment
                .get("segment")
                .and_then(Value::as_array)
                .filter(|range| range.len() == 2)
                .ok_or("Invalid SponsorBlock segment range.")?;
            if !matches!((range[0].as_f64(), range[1].as_f64()),
                (Some(a), Some(b)) if a.is_finite() && b.is_finite() && a >= 0.0 && b >= a)
                || !segment
                    .get("category")
                    .and_then(Value::as_str)
                    .is_some_and(|category| {
                        CATEGORIES.contains(&category)
                            && categories.iter().any(|requested| requested == category)
                    })
                || !segment
                    .get("actionType")
                    .and_then(Value::as_str)
                    .is_some_and(|action| ACTIONS.contains(&action))
                || !valid_duration(segment.get("videoDuration"))
            {
                return Err("Invalid SponsorBlock segment.");
            }
        }
    }
    // Re-encode the validated value so the engine cannot interpret duplicate JSON keys differently.
    let encoded = serde_json::to_vec(&value).map_err(|_| "Invalid SponsorBlock response.")?;
    if encoded.len() > MAX_BODY {
        return Err("SponsorBlock response is too large.");
    }
    Ok(encoded)
}

fn valid_duration(value: Option<&Value>) -> bool {
    value.is_none_or(|value| {
        value
            .as_f64()
            .is_some_and(|duration| duration.is_finite() && duration > 0.0)
    })
}

async fn lookup(
    stream: &mut TcpStream,
    nonce: &str,
    categories: &[String],
    client: &reqwest::Client,
    upstream: &Upstream,
) -> GatewayResult<Vec<u8>> {
    let headers = read_headers(stream).await?;
    let prefix = request_prefix(&headers, nonce, categories)?;
    let categories_json =
        serde_json::to_string(categories).map_err(|_| "Invalid SponsorBlock categories.")?;
    let actions_json =
        serde_json::to_string(ACTIONS).map_err(|_| "Invalid SponsorBlock actions.")?;
    let mut response = client
        .get(format!("{}/api/skipSegments/{prefix}", upstream.base()))
        .query(&[
            ("service", "YouTube"),
            ("categories", categories_json.as_str()),
            ("actionTypes", actions_json.as_str()),
        ])
        .send()
        .await
        .map_err(|_| "SponsorBlock upstream request failed.")?;
    match response.status() {
        reqwest::StatusCode::NOT_FOUND => return Ok(b"[]".to_vec()),
        reqwest::StatusCode::OK => (),
        _ => return Err("SponsorBlock upstream returned an unexpected status."),
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY as u64)
    {
        return Err("SponsorBlock response is too large.");
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "SponsorBlock response could not be read.")?
    {
        append_bounded(&mut body, &chunk)?;
    }
    validate_body(&body, categories)
}

async fn respond(stream: &mut TcpStream, valid: bool, body: &[u8]) -> GatewayResult<()> {
    let (status, content_type) = if valid {
        ("200 OK", "application/json")
    } else {
        ("502 Bad Gateway", "text/plain")
    };
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    timeout(HEADER_TIMEOUT, async {
        stream.write_all(headers.as_bytes()).await?;
        stream.write_all(body).await?;
        stream.shutdown().await
    })
    .await
    .map_err(|_| "SponsorBlock local response timed out.")?
    .map_err(|_| "SponsorBlock local response failed.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn choice() -> Choice {
        Choice {
            mode: Mode::Mark,
            categories: vec!["sponsor".into(), "intro".into()],
        }
    }

    fn row() -> Value {
        json!({"videoID":"abcdefgh_-1", "segments":[{
            "segment":[0, 1.5], "category":"sponsor", "actionType":"skip", "videoDuration":10
        }]})
    }

    fn request(nonce: &str, categories: &[String]) -> Vec<u8> {
        let mut url = reqwest::Url::parse("http://127.0.0.1/").unwrap();
        url.set_path(&format!("/{nonce}/api/skipSegments/abcd"));
        url.query_pairs_mut()
            .append_pair("service", "YouTube")
            .append_pair("categories", &serde_json::to_string(categories).unwrap())
            .append_pair("actionTypes", r#"["chapter","skip","poi"]"#);
        format!("GET {}?{} HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: private\r\nAuthorization: secret\r\n\r\n", url.path(), url.query().unwrap()).into_bytes()
    }

    #[test]
    fn requests_require_exact_path_query_and_distinct_sets() {
        let categories = choice().categories();
        let valid = request("nonce", &categories);
        assert_eq!(
            request_prefix(&valid, "nonce", &categories).unwrap(),
            "abcd"
        );
        let text = String::from_utf8(valid).unwrap();
        for invalid in [
            text.replace("GET ", "POST "),
            text.replace("/nonce/", "/wrong/"),
            text.replace("/abcd?", "/abcD?"),
            text.replace("/abcd?", "/abcde?"),
            text.replace("/abcd?", "/../abcd?"),
            text.replace("/nonce/", "http://example.com/nonce/"),
            text.replace("service=YouTube", "service=Other"),
            text.replace("service=YouTube", "service=YouTube&service=YouTube"),
            text.replace("service=YouTube", "service=YouTube&extra=1"),
            text.replace("service=YouTube", "service=YouTube#fragment"),
            text.replace("Host:", "Transfer-Encoding: chunked\r\nHost:"),
            text.replace("Host:", "Content-Length: 1\r\nHost:"),
            text.replace("Host:", "Content-Length: 0\r\nContent-Length: 0\r\nHost:"),
        ] {
            assert!(request_prefix(invalid.as_bytes(), "nonce", &categories).is_err());
        }
        for invalid in [
            vec!["sponsor".into()],
            vec!["sponsor".into(), "sponsor".into()],
        ] {
            assert!(request_prefix(&request("nonce", &invalid), "nonce", &categories).is_err());
        }
        for invalid in [
            "null",
            "{}",
            "false",
            r#"["skip","poi"]"#,
            r#"["skip","skip","chapter"]"#,
        ] {
            assert!(!exact_set(invalid, ACTIONS));
        }
        assert!(exact_set(r#"["poi","chapter","skip"]"#, ACTIONS));
    }

    #[tokio::test]
    async fn header_reader_bounds_bytes_and_requires_completion() {
        let mut valid = &b"GET / HTTP/1.1\r\nHost: local\r\n\r\n"[..];
        assert!(read_headers(&mut valid).await.is_ok());
        let oversized = vec![b'x'; MAX_HEADERS + 1];
        assert!(read_headers(&mut oversized.as_slice()).await.is_err());
        let mut incomplete = &b"GET / HTTP/1.1\r\n"[..];
        assert!(read_headers(&mut incomplete).await.is_err());
        let mut pipeline = &b"GET / HTTP/1.1\r\n\r\nGET / HTTP/1.1\r\n\r\n"[..];
        assert!(read_headers(&mut pipeline).await.is_err());
        let mut exact = b"GET / HTTP/1.1\r\nX: ".to_vec();
        exact.resize(MAX_HEADERS - 4, b'x');
        exact.extend_from_slice(b"\r\n\r\n");
        assert_eq!(
            read_headers(&mut exact.as_slice()).await.unwrap().len(),
            MAX_HEADERS
        );
    }

    #[test]
    fn byte_bound_is_enforced_before_append_or_parse() {
        let mut body = vec![b' '; MAX_BODY - 2];
        append_bounded(&mut body, b"[]").unwrap();
        assert!(validate_body(&body, &choice().categories()).is_ok());
        assert!(append_bounded(&mut body, b"x").is_err());
        assert_eq!(body.len(), MAX_BODY);
        body.push(b' ');
        assert!(validate_body(&body, &choice().categories()).is_err());
    }

    #[test]
    fn schema_never_accepts_false_empty_or_malformed_results() {
        let categories = choice().categories();
        assert_eq!(validate_body(b"[]", &categories).unwrap(), b"[]");
        assert!(validate_body(&serde_json::to_vec(&json!([row()])).unwrap(), &categories).is_ok());
        for invalid in [
            b"null".as_slice(),
            b"{}",
            b"false",
            b"true",
            b"0",
            b"",
            b"[",
            b"[null]",
            b"[{}]",
        ] {
            assert!(validate_body(invalid, &categories).is_err());
        }
        for (field, value) in [
            ("segment", json!([-1, 2])),
            ("segment", json!([2, 1])),
            ("segment", json!([0, 1, 2])),
            ("segment", json!([null, 1])),
            ("segment", json!(["0", 1])),
            ("category", json!("outro")),
            ("category", json!("unknown")),
            ("actionType", json!("mute")),
            ("videoDuration", json!(0)),
            ("videoDuration", json!(-1)),
            ("videoDuration", Value::Null),
            ("videoDuration", json!("10")),
        ] {
            let mut invalid = row();
            invalid["segments"][0][field] = value;
            assert!(
                validate_body(&serde_json::to_vec(&json!([invalid])).unwrap(), &categories)
                    .is_err()
            );
        }
        for id in ["short", "abcdefghij!", "abcdefghijé", "abcdefghijkl"] {
            let mut invalid = row();
            invalid["videoID"] = json!(id);
            assert!(
                validate_body(&serde_json::to_vec(&json!([invalid])).unwrap(), &categories)
                    .is_err()
            );
        }
        for field in ["segment", "category", "actionType"] {
            let mut invalid = row();
            invalid["segments"][0]
                .as_object_mut()
                .unwrap()
                .remove(field);
            assert!(
                validate_body(&serde_json::to_vec(&json!([invalid])).unwrap(), &categories)
                    .is_err()
            );
        }
        let mut point = row();
        point["segments"][0]["segment"] = json!([2, 2]);
        point["segments"][0]["actionType"] = json!("poi");
        point["segments"][0]
            .as_object_mut()
            .unwrap()
            .remove("videoDuration");
        assert!(validate_body(&serde_json::to_vec(&json!([point])).unwrap(), &categories).is_ok());
        assert!(validate_body(br#"[{"videoID":"abcdefgh_-1","segments":[{"segment":[0,1e999],"category":"sponsor","actionType":"skip"}]}]"#, &categories).is_err());
    }

    #[test]
    fn row_and_per_row_and_total_segment_caps_are_independent() {
        let categories = choice().categories();
        let mut empty_rows: Vec<_> = (0..MAX_ENTRIES)
            .map(|i| json!({"videoID":format!("{i:011}"),"segments":[]}))
            .collect();
        assert!(validate_body(&serde_json::to_vec(&empty_rows).unwrap(), &categories).is_ok());
        empty_rows.push(json!({"videoID":"abcdefgh_-1","segments":[]}));
        assert!(validate_body(&serde_json::to_vec(&empty_rows).unwrap(), &categories).is_err());
        assert!(validate_body(
            &serde_json::to_vec(&json!([{"videoID":"abcdefgh_-1","segments":[]},row()])).unwrap(),
            &categories
        )
        .is_err());
        let segment = row()["segments"][0].clone();
        let mut full_row = row();
        full_row["segments"] = json!(vec![segment.clone(); MAX_ENTRIES]);
        assert!(validate_body(
            &serde_json::to_vec(&json!([full_row.clone()])).unwrap(),
            &categories
        )
        .is_ok());
        let mut other = row();
        other["videoID"] = json!("abcdefgh_-2");
        assert!(validate_body(
            &serde_json::to_vec(&json!([full_row, other])).unwrap(),
            &categories
        )
        .is_err());
        let mut over_row = row();
        over_row["segments"] = json!(vec![segment; MAX_ENTRIES + 1]);
        assert!(validate_body(
            &serde_json::to_vec(&json!([over_row])).unwrap(),
            &categories
        )
        .is_err());
    }

    #[test]
    fn test_origin_is_literal_loopback_http_only() {
        for valid in ["http://127.0.0.1:1234", "http://[::1]:1234/"] {
            assert!(test_upstream(valid).is_ok());
        }
        for invalid in [
            "https://127.0.0.1:1234",
            "http://localhost:1234",
            "http://example.com",
            "http://192.168.0.1",
            "http://user:secret@127.0.0.1",
            "http://127.0.0.1/path",
            "http://127.0.0.1?x=1",
            "http://127.0.0.1#fragment",
            "http://127.0.0.1:0",
        ] {
            assert!(test_upstream(invalid).is_err());
        }
    }

    #[tokio::test]
    async fn off_has_no_gateway_even_with_invalid_test_origin() {
        assert!(Gateway::start(&Choice::default()).await.unwrap().is_none());
        assert!(Gateway::start_test(&Choice::default(), "not an origin")
            .await
            .unwrap()
            .is_none());
    }

    async fn exchange(gateway: &Gateway) -> Vec<u8> {
        let url = reqwest::Url::parse(gateway.url()).unwrap();
        let mut stream = TcpStream::connect(("127.0.0.1", url.port().unwrap()))
            .await
            .unwrap();
        stream
            .write_all(&request(
                url.path().trim_start_matches('/'),
                &choice().categories(),
            ))
            .await
            .unwrap();
        let mut response = Vec::new();
        timeout(Duration::from_secs(2), stream.read_to_end(&mut response))
            .await
            .unwrap()
            .unwrap();
        timeout(Duration::from_secs(2), async {
            while gateway.verification.busy.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        response
    }

    async fn fixture(listener: &TcpListener, status: &str, body: &[u8]) -> Vec<u8> {
        let (mut stream, _) = timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let request = read_headers(&mut stream).await.unwrap();
        let headers = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(headers.as_bytes()).await.unwrap();
        stream.write_all(body).await.unwrap();
        stream.shutdown().await.unwrap();
        request
    }

    #[tokio::test]
    async fn synthetic_valid_response_is_verified_and_incoming_credentials_are_not_forwarded() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let gateway = Gateway::start_test(
            &choice(),
            &format!("http://{}", listener.local_addr().unwrap()),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(gateway.verify().is_err());
        let body = serde_json::to_vec(&json!([row()])).unwrap();
        let (response, forwarded) =
            tokio::join!(exchange(&gateway), fixture(&listener, "200 OK", &body));
        assert!(response.starts_with(b"HTTP/1.1 200 OK\r\n"));
        let forwarded = String::from_utf8(forwarded).unwrap();
        assert!(forwarded.starts_with("GET /api/skipSegments/abcd?"));
        assert!(!forwarded.to_ascii_lowercase().contains("cookie:"));
        assert!(!forwarded.to_ascii_lowercase().contains("authorization:"));
        assert!(!forwarded.contains("private"));
        assert!(!forwarded.contains("secret"));
        assert!(gateway.verify().is_ok());
    }

    #[tokio::test]
    async fn synthetic_404_ignores_unread_body_and_verifies_empty() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let gateway = Gateway::start_test(
            &choice(),
            &format!("http://{}", listener.local_addr().unwrap()),
        )
        .await
        .unwrap()
        .unwrap();
        let upstream = async {
            let (mut stream, _) = listener.accept().await.unwrap();
            read_headers(&mut stream).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 999999999\r\n\r\n")
                .await
                .unwrap();
            // No body is sent: a 404 must not wait for or allocate the advertised bytes.
        };
        let (response, ()) = tokio::join!(exchange(&gateway), upstream);
        assert!(response.starts_with(b"HTTP/1.1 200 OK\r\n"));
        assert!(response.ends_with(b"\r\n\r\n[]"));
        assert!(gateway.verify().is_ok());
    }

    #[tokio::test]
    async fn synthetic_errors_latch_across_a_later_success() {
        for body in [b"null".as_slice(), b"{}", b"false", b"[{}]"] {
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .await
                .unwrap();
            let gateway = Gateway::start_test(
                &choice(),
                &format!("http://{}", listener.local_addr().unwrap()),
            )
            .await
            .unwrap()
            .unwrap();
            let (response, _) =
                tokio::join!(exchange(&gateway), fixture(&listener, "200 OK", body));
            assert!(response.starts_with(b"HTTP/1.1 502 Bad Gateway\r\n"));
            assert!(gateway.verify().is_err());
            let (response, _) =
                tokio::join!(exchange(&gateway), fixture(&listener, "200 OK", b"[]"));
            assert!(response.starts_with(b"HTTP/1.1 200 OK\r\n"));
            assert!(gateway.verify().is_err());
        }
    }

    #[tokio::test]
    async fn synthetic_declared_overlimit_never_waits_for_the_body() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let gateway = Gateway::start_test(
            &choice(),
            &format!("http://{}", listener.local_addr().unwrap()),
        )
        .await
        .unwrap()
        .unwrap();
        let upstream = async {
            let (mut stream, _) = listener.accept().await.unwrap();
            read_headers(&mut stream).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 999999999\r\n\r\n")
                .await
                .unwrap();
        };
        let (response, ()) = tokio::join!(exchange(&gateway), upstream);
        assert!(response.starts_with(b"HTTP/1.1 502 Bad Gateway\r\n"));
        assert!(gateway.verify().is_err());
    }

    #[tokio::test]
    async fn dropping_gateway_aborts_its_in_flight_lookup() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let gateway = Gateway::start_test(
            &choice(),
            &format!("http://{}", listener.local_addr().unwrap()),
        )
        .await
        .unwrap()
        .unwrap();
        let abort = gateway.task.abort_handle();
        let url = reqwest::Url::parse(gateway.url()).unwrap();
        let mut local = TcpStream::connect(("127.0.0.1", url.port().unwrap()))
            .await
            .unwrap();
        local
            .write_all(&request(
                url.path().trim_start_matches('/'),
                &choice().categories(),
            ))
            .await
            .unwrap();
        let (mut upstream, _) = timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        read_headers(&mut upstream).await.unwrap();
        assert!(gateway.verification.busy.load(Ordering::SeqCst));
        drop(gateway);
        timeout(Duration::from_secs(2), async {
            while !abort.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let mut byte = [0];
        assert_eq!(
            timeout(Duration::from_secs(2), local.read(&mut byte))
                .await
                .unwrap()
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn synthetic_chunked_overlimit_and_redirect_fail_closed() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let gateway = Gateway::start_test(
            &choice(),
            &format!("http://{}", listener.local_addr().unwrap()),
        )
        .await
        .unwrap()
        .unwrap();
        let upstream = async {
            let (mut stream, _) = listener.accept().await.unwrap();
            read_headers(&mut stream).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
                .await
                .unwrap();
            let chunk = vec![b' '; 4096];
            for _ in 0..=(MAX_BODY / chunk.len()) {
                if stream.write_all(b"1000\r\n").await.is_err()
                    || stream.write_all(&chunk).await.is_err()
                    || stream.write_all(b"\r\n").await.is_err()
                {
                    break;
                }
            }
            let _ = stream.write_all(b"0\r\n\r\n").await;
        };
        let (response, ()) = tokio::join!(exchange(&gateway), upstream);
        assert!(response.starts_with(b"HTTP/1.1 502 Bad Gateway\r\n"));
        assert!(gateway.verify().is_err());
        let upstream = async {
            let (mut stream, _) = listener.accept().await.unwrap();
            read_headers(&mut stream).await.unwrap();
            stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://192.0.2.1/private\r\nContent-Length: 0\r\n\r\n").await.unwrap();
        };
        let (response, ()) = tokio::join!(exchange(&gateway), upstream);
        assert!(response.starts_with(b"HTTP/1.1 502 Bad Gateway\r\n"));
        assert!(gateway.verify().is_err());
    }
}
