// Raster image generation for XDesign's AI.
//
// Unlike the streaming chat runtime (`runtime/`), image generation is a single
// non-streaming request/response. Two backends keyed off the provider kind:
//   - OpenAI-compatible: POST {base}/images/generations  (gpt-image-1 / dall-e-3)
//   - Google:            POST {base}/models/{model}:predict  (Imagen)
// Both return base64 PNG bytes that the frontend ingests into the Archives
// asset library and places as an editable image layer.
//
// Pure helpers (request builders + response parsers + size mapping) are
// unit-tested; the HTTP call is the thin side-effect (mirrors runtime/openai.rs).
// [P-AUTH] request/response shapes are doc-grounded; validate against a real
// key on the first live run and patch field names if they differ.

use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize, Clone, Debug)]
pub struct GeneratedImage {
    pub b64: String,
    pub mime: String,
}

const OPENAI_DEFAULT_BASE: &str = "https://api.openai.com/v1";
const GOOGLE_DEFAULT_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

fn trim_base<'a>(base_url: &'a str, default: &'a str) -> &'a str {
    let b = base_url.trim().trim_end_matches('/');
    if b.is_empty() {
        default
    } else {
        b
    }
}

// ---- OpenAI-compatible (gpt-image-1 / dall-e-3) ----------------------------

pub fn openai_image_endpoint(base_url: &str) -> String {
    format!("{}/images/generations", trim_base(base_url, OPENAI_DEFAULT_BASE))
}

/// dall-e-* needs `response_format: b64_json`; gpt-image-1 always returns
/// base64 and REJECTS the param, so we only send it for dall-e models.
fn is_dalle(model: &str) -> bool {
    model.to_lowercase().starts_with("dall-e")
}

pub fn openai_image_body(model: &str, prompt: &str, size: &str) -> Value {
    let mut b = json!({
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": size,
    });
    if is_dalle(model) {
        b["response_format"] = json!("b64_json");
    }
    b
}

/// Pull the base64 PNG out of an OpenAI image response. Surfaces an `error`
/// envelope as a readable message.
pub fn parse_openai_image(v: &Value) -> Result<GeneratedImage, String> {
    if let Some(msg) = v.pointer("/error/message").and_then(|x| x.as_str()) {
        return Err(msg.to_string());
    }
    let b64 = v
        .pointer("/data/0/b64_json")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "no image data in response (expected data[0].b64_json)".to_string())?;
    Ok(GeneratedImage {
        b64: b64.to_string(),
        mime: "image/png".to_string(),
    })
}

// ---- Google Imagen ---------------------------------------------------------

pub fn imagen_endpoint(base_url: &str, model: &str) -> String {
    format!(
        "{}/models/{}:predict",
        trim_base(base_url, GOOGLE_DEFAULT_BASE),
        model
    )
}

/// Map a "WxH" size to the closest Imagen aspect-ratio token. Imagen takes an
/// aspect ratio, not pixel dims.
pub fn size_to_aspect(size: &str) -> &'static str {
    let mut it = size.split(['x', 'X', '×']);
    let w = it.next().and_then(|s| s.trim().parse::<f64>().ok());
    let h = it.next().and_then(|s| s.trim().parse::<f64>().ok());
    match (w, h) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 => {
            let r = w / h;
            // Pick the nearest supported Imagen ratio.
            let options: [(&str, f64); 5] = [
                ("1:1", 1.0),
                ("3:4", 3.0 / 4.0),
                ("4:3", 4.0 / 3.0),
                ("9:16", 9.0 / 16.0),
                ("16:9", 16.0 / 9.0),
            ];
            options
                .iter()
                .min_by(|a, b| {
                    (a.1 - r)
                        .abs()
                        .partial_cmp(&(b.1 - r).abs())
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|x| x.0)
                .unwrap_or("1:1")
        }
        _ => "1:1",
    }
}

pub fn imagen_body(prompt: &str, aspect: &str) -> Value {
    json!({
        "instances": [{ "prompt": prompt }],
        "parameters": { "sampleCount": 1, "aspectRatio": aspect },
    })
}

/// Pull the base64 image out of an Imagen `:predict` response.
pub fn parse_imagen(v: &Value) -> Result<GeneratedImage, String> {
    if let Some(msg) = v.pointer("/error/message").and_then(|x| x.as_str()) {
        return Err(msg.to_string());
    }
    let pred = v
        .pointer("/predictions/0")
        .ok_or_else(|| "no predictions in response".to_string())?;
    let b64 = pred
        .get("bytesBase64Encoded")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "no bytesBase64Encoded in prediction".to_string())?;
    let mime = pred
        .get("mimeType")
        .and_then(|x| x.as_str())
        .unwrap_or("image/png")
        .to_string();
    Ok(GeneratedImage {
        b64: b64.to_string(),
        mime,
    })
}

// ---- Command (thin side-effect) --------------------------------------------

/// Generate one raster image. `provider_kind` "google" → Imagen; every other
/// kind speaks the OpenAI-compatible /images/generations endpoint. Returns
/// base64 image bytes + mime; the frontend ingests them into the asset library.
#[tauri::command]
pub async fn xdesign_image_gen(
    provider_kind: String,
    base_url: String,
    key_ref: String,
    model: String,
    prompt: String,
    size: String,
) -> Result<GeneratedImage, String> {
    let key = crate::provider_keys::read(&key_ref).unwrap_or_default();
    if key.trim().is_empty() {
        return Err("no API key configured for this provider".into());
    }
    let client = reqwest::Client::new();

    let (url, body, headers): (String, Value, Vec<(String, String)>) = if provider_kind == "google" {
        (
            imagen_endpoint(&base_url, &model),
            imagen_body(&prompt, size_to_aspect(&size)),
            vec![
                ("content-type".into(), "application/json".into()),
                ("x-goog-api-key".into(), key.trim().to_string()),
            ],
        )
    } else {
        (
            openai_image_endpoint(&base_url),
            openai_image_body(&model, &prompt, &size),
            vec![
                ("content-type".into(), "application/json".into()),
                ("authorization".into(), format!("Bearer {}", key.trim())),
            ],
        )
    };

    let mut rb = client.post(&url).json(&body);
    for (k, v) in headers {
        rb = rb.header(k, v);
    }
    let resp = rb.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|_| {
        let brief: String = text.chars().take(500).collect();
        format!("HTTP {}: {}", status, brief)
    })?;
    if !status.is_success() {
        // Prefer a structured error message; fall back to the raw body.
        let parsed = if provider_kind == "google" {
            parse_imagen(&v)
        } else {
            parse_openai_image(&v)
        };
        return Err(parsed
            .err()
            .unwrap_or_else(|| format!("HTTP {}", status)));
    }
    if provider_kind == "google" {
        parse_imagen(&v)
    } else {
        parse_openai_image(&v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_endpoint_defaults_and_respects_base() {
        assert_eq!(
            openai_image_endpoint(""),
            "https://api.openai.com/v1/images/generations"
        );
        assert_eq!(
            openai_image_endpoint("http://localhost:11434/v1/"),
            "http://localhost:11434/v1/images/generations"
        );
    }

    #[test]
    fn openai_body_omits_response_format_for_gpt_image() {
        let b = openai_image_body("gpt-image-1", "a cat", "1024x1024");
        assert_eq!(b["model"], "gpt-image-1");
        assert_eq!(b["prompt"], "a cat");
        assert_eq!(b["n"], 1);
        assert_eq!(b["size"], "1024x1024");
        assert!(b.get("response_format").is_none());
    }

    #[test]
    fn openai_body_sets_response_format_for_dalle() {
        let b = openai_image_body("dall-e-3", "a dog", "1024x1024");
        assert_eq!(b["response_format"], "b64_json");
    }

    #[test]
    fn parses_openai_image() {
        let v = json!({ "data": [{ "b64_json": "AAAA" }] });
        let g = parse_openai_image(&v).unwrap();
        assert_eq!(g.b64, "AAAA");
        assert_eq!(g.mime, "image/png");
    }

    #[test]
    fn openai_error_envelope_surfaces_message() {
        let v = json!({ "error": { "message": "billing hard limit reached" } });
        assert_eq!(
            parse_openai_image(&v).unwrap_err(),
            "billing hard limit reached"
        );
    }

    #[test]
    fn openai_missing_data_errors() {
        let v = json!({ "data": [] });
        assert!(parse_openai_image(&v).is_err());
    }

    #[test]
    fn imagen_endpoint_builds_predict_url() {
        assert_eq!(
            imagen_endpoint("", "imagen-4.0-generate-001"),
            "https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict"
        );
    }

    #[test]
    fn imagen_body_shape() {
        let b = imagen_body("a forest", "16:9");
        assert_eq!(b["instances"][0]["prompt"], "a forest");
        assert_eq!(b["parameters"]["sampleCount"], 1);
        assert_eq!(b["parameters"]["aspectRatio"], "16:9");
    }

    #[test]
    fn parses_imagen() {
        let v = json!({ "predictions": [{ "bytesBase64Encoded": "BBBB", "mimeType": "image/png" }] });
        let g = parse_imagen(&v).unwrap();
        assert_eq!(g.b64, "BBBB");
        assert_eq!(g.mime, "image/png");
    }

    #[test]
    fn imagen_defaults_mime_when_absent() {
        let v = json!({ "predictions": [{ "bytesBase64Encoded": "CCCC" }] });
        assert_eq!(parse_imagen(&v).unwrap().mime, "image/png");
    }

    #[test]
    fn imagen_error_and_empty() {
        let err = json!({ "error": { "message": "quota exceeded" } });
        assert_eq!(parse_imagen(&err).unwrap_err(), "quota exceeded");
        let empty = json!({ "predictions": [] });
        assert!(parse_imagen(&empty).is_err());
    }

    #[test]
    fn size_maps_to_nearest_aspect() {
        assert_eq!(size_to_aspect("1024x1024"), "1:1");
        assert_eq!(size_to_aspect("1792x1024"), "16:9");
        assert_eq!(size_to_aspect("1024x1792"), "9:16");
        assert_eq!(size_to_aspect("1536x1024"), "4:3");
        assert_eq!(size_to_aspect("1024x1536"), "3:4");
        assert_eq!(size_to_aspect("garbage"), "1:1");
    }
}
