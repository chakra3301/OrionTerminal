use serde::Serialize;

const MAX_INPUT: usize = 4 * 1024 * 1024;
const MAX_CUES: usize = 20_000;
const MAX_TEXT: usize = 2 * 1024 * 1024;
const MAX_CUE_TEXT: usize = 4096;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Cue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

fn timestamp(raw: &str, vtt: bool) -> Result<f64, String> {
    let separator = if vtt { '.' } else { ',' };
    let (clock, millis) = raw
        .rsplit_once(separator)
        .ok_or("Invalid caption timestamp.")?;
    if millis.len() != 3 || !millis.bytes().all(|b| b.is_ascii_digit()) || clock.len() > 18 {
        return Err("Invalid caption timestamp.".into());
    }
    let parts: Vec<_> = clock.split(':').collect();
    if !(parts.len() == 3 || (vtt && parts.len() == 2))
        || parts
            .iter()
            .any(|p| p.len() < 2 || !p.bytes().all(|b| b.is_ascii_digit()))
        || parts[parts.len() - 1].len() != 2
        || parts[parts.len() - 2].len() != 2
    {
        return Err("Invalid caption timestamp.".into());
    }
    let seconds = parts[parts.len() - 1]
        .parse::<u32>()
        .map_err(|_| "Invalid caption timestamp.")?;
    let minutes = parts[parts.len() - 2]
        .parse::<u32>()
        .map_err(|_| "Invalid caption timestamp.")?;
    let hours = if parts.len() == 3 {
        parts[0]
            .parse::<u32>()
            .map_err(|_| "Invalid caption timestamp.")?
    } else {
        0
    };
    if seconds >= 60 || minutes >= 60 {
        return Err("Invalid caption timestamp.".into());
    }
    Ok(f64::from(hours) * 3600.0
        + f64::from(minutes) * 60.0
        + f64::from(seconds)
        + f64::from(millis.parse::<u16>().unwrap()) / 1000.0)
}
fn plain_text(text: &str) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = text;
    while !rest.is_empty() {
        if rest.starts_with('<') {
            if let Some(end) = rest.find('>').filter(|end| *end <= 256) {
                let tag = rest[1..end].trim().trim_start_matches('/');
                let name = tag
                    .split([' ', '.', '\t'])
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if [
                    "b", "i", "u", "c", "v", "lang", "ruby", "rt", "font", "br", "p",
                ]
                .contains(&name.as_str())
                    || timestamp(tag, true).is_ok()
                {
                    if ["br", "p"].contains(&name.as_str()) {
                        out.push('\n');
                    }
                    rest = &rest[end + 1..];
                    continue;
                }
            }
        }
        if rest.starts_with('&') {
            if let Some(end) = rest.find(';').filter(|end| *end <= 16) {
                let entity = &rest[1..end];
                let decoded = match entity {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    "nbsp" => Some(' '),
                    "lrm" => Some('\u{200e}'),
                    "rlm" => Some('\u{200f}'),
                    _ => entity
                        .strip_prefix("#x")
                        .or_else(|| entity.strip_prefix("#X"))
                        .and_then(|n| u32::from_str_radix(n, 16).ok())
                        .or_else(|| entity.strip_prefix('#').and_then(|n| n.parse::<u32>().ok()))
                        .and_then(char::from_u32),
                };
                if let Some(c) = decoded {
                    if c.is_control() && !['\n', '\t'].contains(&c) {
                        return Err("Caption text contains unsupported control characters.".into());
                    }
                    out.push(c);
                    rest = &rest[end + 1..];
                    continue;
                }
            }
        }
        let c = rest.chars().next().unwrap();
        out.push(c);
        rest = &rest[c.len_utf8()..];
        if out.len() > MAX_CUE_TEXT {
            return Err("A caption cue exceeds 4096 bytes.".into());
        }
    }
    if out.len() > MAX_CUE_TEXT {
        return Err("A caption cue exceeds 4096 bytes.".into());
    }
    Ok(out
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n"))
}

pub(super) fn parse(bytes: &[u8], duration: Option<f64>) -> Result<Vec<Cue>, String> {
    if bytes.len() > MAX_INPUT {
        return Err("Caption input exceeds 4 MiB.".into());
    }
    if duration.is_some_and(|d| !d.is_finite() || d <= 0.0) {
        return Err("Cannot verify the caption source duration.".into());
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "Captions must be UTF-8 text.")?
        .trim_start_matches('\u{feff}');
    if text
        .chars()
        .any(|c| c.is_control() && !['\r', '\n', '\t'].contains(&c))
    {
        return Err("Caption text contains unsupported control characters.".into());
    }
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let first = text.lines().next().unwrap_or("");
    let vtt = first == "WEBVTT" || first.starts_with("WEBVTT ") || first.starts_with("WEBVTT\t");
    if vtt && first.contains("-->") {
        return Err("Invalid WebVTT header.".into());
    }
    let mut cues = Vec::new();
    let mut total = 0;
    for (index, block) in text.split("\n\n").enumerate() {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let mut lines = block.lines();
        let first = lines.next().unwrap();
        if index == 0 && vtt {
            for line in lines {
                if line.trim_start().starts_with("X-TIMESTAMP-MAP") {
                    return Err(
                        "Timestamp-mapped captions must first be normalized by FFmpeg.".into(),
                    );
                }
                if line.contains("-->") {
                    return Err("WebVTT header must be separated from timed cues.".into());
                }
            }
            continue;
        }
        if vtt
            && (first == "NOTE"
                || first.starts_with("NOTE ")
                || first.starts_with("NOTE\t")
                || first == "STYLE"
                || first == "REGION")
        {
            continue;
        }
        let time = if first.contains("-->") {
            first
        } else {
            lines.next().ok_or("Caption block has no timing line.")?
        };
        let (start, end) = time
            .split_once("-->")
            .ok_or("Caption block has no timing line.")?;
        let end = end
            .split_whitespace()
            .next()
            .ok_or("Caption end timestamp is missing.")?;
        let (start, end) = (timestamp(start.trim(), vtt)?, timestamp(end, vtt)?);
        if end <= start
            || duration.is_some_and(|duration| start >= duration + 0.01 || end > duration + 1.0)
        {
            return Err("Caption timing falls outside the source timeline.".into());
        }
        let mut raw = String::new();
        for line in lines {
            if raw.len() + line.len() + 1 > MAX_CUE_TEXT * 2 {
                return Err("A caption cue is too large.".into());
            }
            if !raw.is_empty() {
                raw.push('\n');
            }
            raw.push_str(line);
        }
        let text = plain_text(&raw)?;
        if text.is_empty() {
            continue;
        }
        total += text.len();
        if total > MAX_TEXT || cues.len() >= MAX_CUES {
            return Err("Caption transcript exceeds its text or cue limit.".into());
        }
        cues.push(Cue { start, end, text });
    }
    if !vtt && cues.is_empty() {
        return Err("No valid SubRip or WebVTT caption cues were found.".into());
    }
    cues.sort_by(|a, b| a.start.total_cmp(&b.start).then(a.end.total_cmp(&b.end)));
    Ok(cues)
}

pub(super) fn search_query(input: &str) -> Result<String, String> {
    let terms: Vec<_> = input.split_whitespace().take(9).collect();
    if input.len() > 256
        || terms.is_empty()
        || terms.len() > 8
        || input.chars().any(char::is_control)
        || terms
            .iter()
            .any(|term| !term.chars().any(char::is_alphanumeric))
    {
        return Err("Enter 1–8 caption-search words (up to 256 bytes).".into());
    }
    let count = terms.len();
    Ok(terms
        .iter()
        .enumerate()
        .map(|(index, term)| {
            format!(
                "\"{}\"{}",
                term.replace('"', "\"\""),
                if index + 1 == count { "*" } else { "" }
            )
        })
        .collect::<Vec<_>>()
        .join(" AND "))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vtt_and_subrip_have_real_bounded_times_and_plain_text() {
        let cues=parse(b"\xef\xbb\xbfWEBVTT\r\n\r\nNOTE ignore --> fake\r\nmetadata\r\n\r\nc1\r\n00:01.250 --> 00:03.000 align:start\r\n<v Ada><b>Hello &amp; welcome</b></v>\r\n<c.green>Line &#x32;</c>\r\n\r\n00:02.000 --> 00:04.000\r\n<00:02.500>overlap",Some(5.0)).unwrap();
        assert_eq!(cues.len(), 2);
        assert_eq!(
            cues[0],
            Cue {
                start: 1.25,
                end: 3.0,
                text: "Hello & welcome\nLine 2".into()
            }
        );
        assert_eq!(cues[1].text, "overlap");
        let srt = parse(
            b"2\n00:00:03,000 --> 00:00:04,000\nSecond\n\n1\n00:00:01,000 --> 00:00:02,000\nFirst",
            Some(5.0),
        )
        .unwrap();
        assert_eq!(srt[0].text, "First");
        assert_eq!(srt[1].start, 3.0);
    }
    #[test]
    fn metadata_is_not_silently_indexed_or_timestamp_maps_ignored() {
        assert!(parse(
            b"WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n\n",
            None
        )
        .is_err());
        assert!(parse(b"WEBVTT\n\nnot a cue", None).is_err());
        assert!(parse(b"WEBVTT\n00:00.000 --> 00:01.000\ntext", None).is_err());
        assert!(parse(b"plain text", None).is_err());
        assert!(parse(b"", None).is_err());
        assert!(parse(
            b"WEBVTT\n\nSTYLE\n::cue { color: red }\n\nREGION\nid:x",
            None
        )
        .unwrap()
        .is_empty());
    }
    #[test]
    fn invalid_timestamps_encoding_controls_and_ranges_refuse() {
        for input in [
            b"00:61.000 --> 00:62.000\ntext".as_slice(),
            b"00:00.1 --> 00:02.000\ntext",
            b"00:01.000 --> 00:00.000\ntext",
            b"00:00.000 --> 00:99.000\ntext",
        ] {
            let mut v = b"WEBVTT\n\n".to_vec();
            v.extend_from_slice(input);
            assert!(parse(&v, None).is_err());
        }
        assert!(parse(b"WEBVTT\n\n00:00.000 --> 00:04.000\ntext", Some(1.0)).is_err());
        assert!(parse(b"\xff", None).is_err());
        assert!(parse(b"WEBVTT\n\n00:00.000 --> 00:01.000\n&#0;", None).is_err());
        assert!(parse(b"WEBVTT", Some(f64::NAN)).is_err());
    }
    #[test]
    fn caption_search_uses_literal_bounded_terms_not_fts_operators() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE VIRTUAL TABLE captions USING fts5(text); INSERT INTO captions VALUES ('hello world'); INSERT INTO captions VALUES ('hello OR world');").unwrap();
        let count = |query: &str| {
            db.query_row(
                "SELECT count(*) FROM captions WHERE captions MATCH ?1",
                [search_query(query).unwrap()],
                |row| row.get::<_, i64>(0),
            )
            .unwrap()
        };
        assert_eq!(count("hello wor"), 2);
        assert_eq!(count("hello OR world"), 1);
        assert_eq!(count("hello\" OR absent"), 0);
        assert_eq!(count("text:hello"), 0);
        for query in ["", "*", "hello\nworld", "a b c d e f g h i"] {
            assert!(search_query(query).is_err());
        }
        assert!(search_query(&"x".repeat(257)).is_err());
    }
    #[test]
    fn aggregate_text_and_cue_counts_are_bounded() {
        let too_many = format!(
            "WEBVTT\n\n{}",
            "00:00.000 --> 00:01.000\nhi\n\n".repeat(MAX_CUES + 1)
        );
        assert!(parse(too_many.as_bytes(), None)
            .unwrap_err()
            .contains("text or cue limit"));
        let large_cue = format!("00:00.000 --> 00:01.000\n{}\n\n", "a".repeat(2000));
        let large = format!("WEBVTT\n\n{}", large_cue.repeat(MAX_TEXT / 2000 + 1));
        assert!(large.len() < MAX_INPUT);
        assert!(parse(large.as_bytes(), None)
            .unwrap_err()
            .contains("text or cue limit"));
    }
    #[test]
    fn raw_and_decoded_sizes_are_bounded_and_literal_math_survives() {
        assert!(parse(&vec![b' '; MAX_INPUT + 1], None).is_err());
        let large = format!(
            "WEBVTT\n\n00:00.000 --> 00:01.000\n{}",
            "a".repeat(MAX_CUE_TEXT + 1)
        );
        assert!(parse(large.as_bytes(), None).is_err());
        let text = parse(
            b"WEBVTT\n\n00:00.000 --> 00:01.000\n2 < 3 > 1 &lt;script&gt; literal",
            None,
        )
        .unwrap();
        assert_eq!(text[0].text, "2 < 3 > 1 <script> literal");
    }
}
