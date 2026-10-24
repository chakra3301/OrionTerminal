use base64::{engine::general_purpose::STANDARD, Engine};
use once_cell::sync::Lazy;
use reqwest::{Client, RequestBuilder, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{sync::atomic::{AtomicUsize, Ordering}, time::Duration};

const JSON_LIMIT: usize = 2 * 1024 * 1024;
const IMAGE_LIMIT: usize = 16 * 1024 * 1024;
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
static CLIENT: Lazy<Result<Client, String>> = Lazy::new(|| Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(25)).connect_timeout(Duration::from_secs(8)).build().map_err(|_| "Asset connection could not initialize".into()));

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PhotoProvider { Pexels, Unsplash }
impl PhotoProvider {
    fn key_ref(self) -> &'static str { match self { Self::Pexels => "xdesign-stock-pexels", Self::Unsplash => "xdesign-stock-unsplash" } }
}
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum AssetRequest {
    IconSearch { query: String, limit: u16, prefix: Option<String> },
    IconCollection { prefix: String, names: Vec<String> },
    IconInfo { prefix: String },
    Photos { provider: PhotoProvider, query: String, orientation: String, per_page: u16, target_dim: u32 },
    PhotoDownload { source_id: String },
}
struct Lease;
impl Lease {
    fn acquire() -> Result<Self, String> {
        if ACTIVE.fetch_add(1, Ordering::SeqCst) >= 4 { ACTIVE.fetch_sub(1, Ordering::SeqCst); return Err("Wait for the current asset requests to finish".into()); }
        Ok(Self)
    }
}
impl Drop for Lease { fn drop(&mut self) { ACTIVE.fetch_sub(1, Ordering::SeqCst); } }
fn identifier(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128 || !value.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-') { return Err("Invalid icon name or set".into()); }
    Ok(())
}
fn query(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 512 || value.chars().any(char::is_control) { return Err("Enter a search query up to 512 bytes".into()); }
    Ok(())
}
fn source_id(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128 || !value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') { return Err("Invalid stock photo identifier".into()); }
    Ok(())
}
fn endpoint(request: &AssetRequest) -> Result<Url, String> {
    let mut url = Url::parse(match request {
        AssetRequest::Photos { provider: PhotoProvider::Pexels, .. } => "https://api.pexels.com/v1/search",
        AssetRequest::Photos { .. } => "https://api.unsplash.com/search/photos",
        AssetRequest::PhotoDownload { source_id: id } => { source_id(id)?; return Url::parse(&format!("https://api.unsplash.com/photos/{id}/download")).map_err(|_| "Invalid download request".into()); },
        _ => "https://api.iconify.design/",
    }).map_err(|_| "Invalid asset endpoint")?;
    match request {
        AssetRequest::IconSearch { query: text, limit, prefix } => {
            query(text)?; if !(1..=100).contains(limit) { return Err("Choose 1–100 icon results".into()); }
            url.set_path("/search"); url.query_pairs_mut().append_pair("query",text).append_pair("limit",&limit.to_string());
            if let Some(prefix) = prefix { identifier(prefix)?; url.query_pairs_mut().append_pair("prefix",prefix); }
        },
        AssetRequest::IconCollection { prefix, names } => {
            identifier(prefix)?; if names.is_empty() || names.len() > 64 { return Err("Fetch 1–64 icons per set".into()); } for name in names { identifier(name)?; }
            url.set_path(&format!("/{prefix}.json")); url.query_pairs_mut().append_pair("icons",&names.join(","));
        },
        AssetRequest::IconInfo { prefix } => { identifier(prefix)?; url.set_path("/collection"); url.query_pairs_mut().append_pair("prefix",prefix).append_pair("info","1"); },
        AssetRequest::Photos { query: text, orientation, per_page, target_dim, .. } => {
            query(text)?; if !(1..=30).contains(per_page) || !(1..=16384).contains(target_dim) || !["landscape","portrait","square"].contains(&orientation.as_str()) { return Err("Invalid stock search options".into()); }
            let orient = if matches!(request,AssetRequest::Photos{provider:PhotoProvider::Unsplash,..}) && orientation == "square" { "squarish" } else { orientation };
            url.query_pairs_mut().append_pair("query",text).append_pair("per_page",&per_page.to_string()).append_pair("orientation",orient);
        },
        AssetRequest::PhotoDownload { .. } => unreachable!(),
    }
    Ok(url)
}
fn authenticated(client: &Client, request: &AssetRequest, credential: Option<&str>) -> Result<RequestBuilder, String> {
    let builder = client.get(endpoint(request)?);
    match request {
        AssetRequest::Photos { provider, .. } => match provider {
            PhotoProvider::Pexels => Ok(builder.header("Authorization",credential.ok_or("Configure a Pexels API key in Resources → Connections")?)),
            PhotoProvider::Unsplash => Ok(builder.header("Authorization",format!("Client-ID {}",credential.ok_or("Configure an Unsplash access key in Resources → Connections")?)).header("Accept-Version","v1")),
        },
        AssetRequest::PhotoDownload { .. } => Ok(builder.header("Authorization",format!("Client-ID {}",credential.ok_or("Configure an Unsplash access key in Resources → Connections")?)).header("Accept-Version","v1")),
        _ => Ok(builder),
    }
}
async fn bounded_body(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if !response.status().is_success() { return Err(format!("Asset service returned HTTP {}",response.status().as_u16())); }
    if response.content_length().is_some_and(|size| size > limit as u64) || response.headers().get(reqwest::header::CONTENT_LENGTH).and_then(|value| value.to_str().ok()).and_then(|value| value.parse::<u64>().ok()).is_some_and(|size| size > limit as u64) { return Err("Asset response is too large".into()); }
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Asset response interrupted")? {
        if data.len().checked_add(chunk.len()).is_none_or(|size| size > limit) { return Err("Asset response is too large".into()); }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}
pub fn image_url(provider: PhotoProvider, value: &str) -> Result<Url, String> {
    if value.len() > 4096 { return Err("Invalid photo URL".into()); }
    let url = Url::parse(value).map_err(|_| "Invalid photo URL")?;
    let permitted = match provider { PhotoProvider::Pexels => url.host_str() == Some("images.pexels.com"), PhotoProvider::Unsplash => url.host_str() == Some("images.unsplash.com") || url.host_str() == Some("plus.unsplash.com") };
    if !permitted || url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() || url.port().is_some_and(|p| p != 443) { return Err("Use an image URL returned by the selected stock provider".into()); }
    Ok(url)
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> { value.get(key).and_then(Value::as_str).filter(|s| !s.is_empty() && s.len() <= 4096).ok_or_else(|| format!("Invalid stock photo {key}")) }
fn dimension(value: &Value, key: &str) -> Result<u64, String> { value.get(key).and_then(Value::as_u64).filter(|v| *v > 0 && *v <= 100_000).ok_or_else(|| "Invalid stock dimensions".into()) }
fn photo_results(request: &AssetRequest, data: Value) -> Result<Value, String> {
    let AssetRequest::Photos { provider, target_dim, .. } = request else { return Ok(data); };
    let photos = data.get(match provider { PhotoProvider::Pexels => "photos", PhotoProvider::Unsplash => "results" }).and_then(Value::as_array).filter(|items| items.len() <= 30).ok_or("Invalid stock search response")?;
    let mut results = Vec::new();
    for photo in photos {
        let width = dimension(photo,"width")?; let height = dimension(photo,"height")?;
        let (id,url,thumb,photographer,page,artist) = match provider {
            PhotoProvider::Pexels => {
                let id = photo.get("id").and_then(Value::as_u64).ok_or("Invalid Pexels photo ID")?.to_string();
                let src = photo.get("src").ok_or("Invalid Pexels image sizes")?;
                let size = match target_dim { 0..=200 => "small", 201..=400 => "medium", 401..=800 => "large", 801..=1600 => "large2x", _ => "original" };
                (id,text(src,size)?,text(src,"medium")?,text(photo,"photographer")?,text(photo,"url")?,text(photo,"photographer_url")?)
            },
            PhotoProvider::Unsplash => {
                let id = text(photo,"id")?.to_string(); source_id(&id)?;
                let urls = photo.get("urls").ok_or("Invalid Unsplash image sizes")?;
                let size = match target_dim { 0..=200 => "thumb", 201..=400 => "small", 401..=1080 => "regular", _ => "full" };
                let user = photo.get("user").ok_or("Invalid Unsplash photographer")?;
                (id,text(urls,size)?,text(urls,"small")?,text(user,"name")?,text(photo.get("links").ok_or("Invalid Unsplash links")?,"html")?,text(user.get("links").ok_or("Invalid Unsplash author links")?,"html")?)
            },
        };
        image_url(*provider,url)?; image_url(*provider,thumb)?;
        results.push(json!({"sourceId":id,"url":url,"thumbnail":thumb,"width":width,"height":height,"photographer":photographer,"page":page,"artist":artist,"provider":provider}));
    }
    Ok(json!({"photos":results}))
}
#[tauri::command]
pub async fn xdesign_asset_request(request: AssetRequest) -> Result<Value, String> {
    let _lease = Lease::acquire()?;
    endpoint(&request)?;
    let provider = match &request { AssetRequest::Photos { provider, .. } => Some(*provider), AssetRequest::PhotoDownload { .. } => Some(PhotoProvider::Unsplash), _ => None };
    let credential = provider.and_then(|provider| crate::provider_keys::read(provider.key_ref()));
    let client = CLIENT.as_ref().map_err(Clone::clone)?;
    let response = authenticated(client,&request,credential.as_deref())?.send().await.map_err(|_| "Asset service could not connect")?;
    let bytes = bounded_body(response,JSON_LIMIT).await?;
    let data = serde_json::from_slice(&bytes).map_err(|_| "Invalid asset service response")?;
    photo_results(&request,data)
}
#[derive(Serialize)]
pub struct StockImage { base64: String, width: u32, height: u32 }
fn image_dimensions(bytes: &[u8]) -> Result<(u32,u32), String> {
    let pair = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() >= 33 && &bytes[12..16] == b"IHDR" && u32::from_be_bytes(bytes[8..12].try_into().unwrap()) == 13 {
        Some((u32::from_be_bytes(bytes[16..20].try_into().unwrap()),u32::from_be_bytes(bytes[20..24].try_into().unwrap())))
    } else if bytes.starts_with(&[0xff,0xd8]) {
        let mut at=2;let mut found=None;
        for _ in 0..8192 {
            if at+1 >= bytes.len() || bytes[at]!=0xff { break; } while at<bytes.len() && bytes[at]==0xff { at+=1; } if at>=bytes.len(){break;}
            let marker=bytes[at];at+=1;if marker==0xd9 || marker==0xda {break;}if marker==0x01 || (0xd0..=0xd7).contains(&marker){continue;}
            if at+2>bytes.len(){break;}let length=u16::from_be_bytes([bytes[at],bytes[at+1]]) as usize;if length<2 || at+length>bytes.len(){break;}
            if [0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].contains(&marker) && length>=8 {found=Some((u16::from_be_bytes([bytes[at+5],bytes[at+6]]) as u32,u16::from_be_bytes([bytes[at+3],bytes[at+4]]) as u32));break;}
            at+=length;
        }
        found
    } else if bytes.len()>=25 && &bytes[..4]==b"RIFF" && &bytes[8..12]==b"WEBP" && u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize + 8 == bytes.len() {
        let chunk=&bytes[12..16];let length=u32::from_le_bytes(bytes[16..20].try_into().unwrap()) as usize;let data=&bytes[20..];
        if length>data.len(){None} else if chunk==b"VP8X" && length>=10 {Some((1+u32::from_le_bytes([data[4],data[5],data[6],0]),1+u32::from_le_bytes([data[7],data[8],data[9],0])))}
        else if chunk==b"VP8L" && length>=5 && data[0]==0x2f {Some((1+((data[1] as u32 | (data[2] as u32)<<8)&0x3fff),1+(((data[2] as u32)>>6 | (data[3] as u32)<<2 | (data[4] as u32)<<10)&0x3fff)))}
        else if chunk==b"VP8 " && length>=10 && data[3..6]==[0x9d,0x01,0x2a] {Some(((u16::from_le_bytes([data[6],data[7]])&0x3fff) as u32,(u16::from_le_bytes([data[8],data[9]])&0x3fff) as u32))}else{None}
    } else {None};
    let (w,h)=pair.ok_or("Use a PNG, JPEG or WebP stock image with valid dimensions")?;
    if w == 0 || h == 0 || w as u64 * h as u64 > 16_777_216 { return Err("Choose a stock image up to 16 megapixels".into()); }
    Ok((w,h))
}
#[tauri::command]
pub async fn xdesign_stock_image(provider: PhotoProvider, url: String) -> Result<StockImage, String> {
    let _lease = Lease::acquire()?;
    let response = CLIENT.as_ref().map_err(Clone::clone)?.get(image_url(provider,&url)?).send().await.map_err(|_| "Stock image could not download")?;
    let bytes = bounded_body(response,IMAGE_LIMIT).await?;
    let (width,height) = image_dimensions(&bytes)?;
    Ok(StockImage { base64: STANDARD.encode(bytes), width, height })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn xdesign_assets_endpoints_and_request_validation() {
        let request = AssetRequest::IconSearch { query:"heart & arrow".into(),limit:15,prefix:Some("lucide".into()) };
        let url=endpoint(&request).unwrap();assert_eq!(url.host_str(),Some("api.iconify.design"));assert_eq!(url.query_pairs().find(|(key,_)|key=="query").unwrap().1,"heart & arrow");
        assert!(endpoint(&AssetRequest::IconInfo{prefix:"../bad".into()}).is_err());assert!(endpoint(&AssetRequest::IconCollection{prefix:"mdi".into(),names:vec![]}).is_err());assert!(endpoint(&AssetRequest::IconSearch{query:"x".into(),limit:0,prefix:None}).is_err());
        assert!(serde_json::from_value::<AssetRequest>(json!({"kind":"iconInfo","prefix":"mdi","url":"https://evil.test"})).is_err());
    }
    #[test]
    fn xdesign_assets_credentials_do_not_enter_urls_or_icon_headers() {
        let client=Client::new();let request=AssetRequest::Photos{provider:PhotoProvider::Unsplash,query:"ocean".into(),orientation:"square".into(),per_page:15,target_dim:1000};
        let built=authenticated(&client,&request,Some("fixture-secret")).unwrap().build().unwrap();assert!(!built.url().as_str().contains("fixture-secret"));assert_eq!(built.headers()["Authorization"],"Client-ID fixture-secret");assert!(built.url().as_str().contains("squarish"));assert!(authenticated(&client,&request,None).is_err());
        let icon=authenticated(&client,&AssetRequest::IconInfo{prefix:"lucide".into()},Some("fixture-secret")).unwrap().build().unwrap();assert!(!icon.headers().contains_key("Authorization"));
    }
    #[test]
    fn xdesign_assets_cdn_and_download_boundaries() {
        assert!(image_url(PhotoProvider::Pexels,"https://images.pexels.com/photos/1/a.jpeg?w=400").is_ok());
        for value in ["http://images.pexels.com/a","https://images.pexels.com.evil.test/a","https://secret@images.pexels.com/a","https://images.pexels.com:8443/a","https://images.pexels.com/a#x","https://127.0.0.1/a","https://images.unsplash.com/a"] {assert!(image_url(PhotoProvider::Pexels,value).is_err());}
        assert_eq!(endpoint(&AssetRequest::PhotoDownload{source_id:"ID_123-abc".into()}).unwrap().path(),"/photos/ID_123-abc/download");assert!(endpoint(&AssetRequest::PhotoDownload{source_id:"../foo".into()}).is_err());
    }
    #[test]
    fn xdesign_assets_sizes_attribution_and_bad_responses() {
        let request=AssetRequest::Photos{provider:PhotoProvider::Pexels,query:"landscape".into(),orientation:"landscape".into(),per_page:15,target_dim:700};
        let data=json!({"photos":[{"id":1,"width":2000,"height":1000,"photographer":"Artist","url":"https://www.pexels.com/photo/1","photographer_url":"https://www.pexels.com/@artist","src":{"large":"https://images.pexels.com/a.jpeg?w=800","medium":"https://images.pexels.com/a.jpeg?w=400"}}]});
        let result=photo_results(&request,data.clone()).unwrap();assert_eq!(result["photos"][0]["photographer"],"Artist");assert_eq!(result["photos"][0]["sourceId"],"1");assert!(result["photos"][0]["url"].as_str().unwrap().contains("800"));
        let mut bad=data;bad["photos"][0]["src"]["large"]=json!("https://evil.test/a");assert!(photo_results(&request,bad).is_err());assert!(photo_results(&request,json!({})).is_err());
    }
    #[test]
    fn xdesign_assets_image_dimensions_without_pixel_decode() {
        let mut bytes=b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR".to_vec();bytes.extend(12u32.to_be_bytes());bytes.extend(8u32.to_be_bytes());bytes.extend([8,6,0,0,0,0,0,0,0]);assert_eq!(image_dimensions(&bytes).unwrap(),(12,8));assert!(image_dimensions(b"not an image").is_err());
        bytes[16..20].copy_from_slice(&100_000u32.to_be_bytes());bytes[20..24].copy_from_slice(&100_000u32.to_be_bytes());assert!(image_dimensions(&bytes).is_err());
        let jpeg=[0xff,0xd8,0xff,0xc0,0,8,8,0,8,0,12,0];assert_eq!(image_dimensions(&jpeg).unwrap(),(12,8));
        let mut webp=b"RIFF".to_vec();webp.extend(22u32.to_le_bytes());webp.extend(b"WEBPVP8X");webp.extend(10u32.to_le_bytes());webp.extend([0,0,0,0,11,0,0,7,0,0]);assert_eq!(image_dimensions(&webp).unwrap(),(12,8));
    }
    #[tokio::test]
    async fn xdesign_assets_response_status_and_stream_admission() {
        let body=tauri::http::Response::builder().status(200).body(vec![1u8,2,3]).unwrap();assert_eq!(bounded_body(body.into(),3).await.unwrap(),vec![1,2,3]);
        let declared=tauri::http::Response::builder().status(200).header("Content-Length","500").body(vec![1u8]).unwrap();assert!(bounded_body(declared.into(),10).await.unwrap_err().contains("too large"));
        let stream=futures_util::stream::iter([Ok::<Vec<u8>,std::io::Error>(vec![1u8;5]),Ok(vec![1u8;500])]);
        let streamed=tauri::http::Response::builder().status(200).header("Content-Length","1").body(reqwest::Body::wrap_stream(stream)).unwrap();assert!(bounded_body(streamed.into(),10).await.unwrap_err().contains("too large"));
        let denied=tauri::http::Response::builder().status(401).body(vec![] as Vec<u8>).unwrap();assert_eq!(bounded_body(denied.into(),10).await.unwrap_err(),"Asset service returned HTTP 401");
    }
    #[test]
    fn xdesign_assets_unsplash_metadata_and_header_dimension_variants() {
        let request=AssetRequest::Photos{provider:PhotoProvider::Unsplash,query:"ocean".into(),orientation:"portrait".into(),per_page:15,target_dim:400};
        let data=json!({"results":[{"id":"one","width":1000,"height":2000,"urls":{"small":"https://images.unsplash.com/one?w=400"},"user":{"name":"Artist","links":{"html":"https://unsplash.com/@artist"}},"links":{"html":"https://unsplash.com/photos/one"}}]});
        let result=photo_results(&request,data).unwrap();assert_eq!(result["photos"][0]["provider"],"unsplash");assert_eq!(result["photos"][0]["artist"],"https://unsplash.com/@artist");
        let mut webp=b"RIFF".to_vec();webp.extend(22u32.to_le_bytes());webp.extend(b"WEBPVP8 ");webp.extend(10u32.to_le_bytes());webp.extend([0,0,0,0x9d,0x01,0x2a,12,0,8,0]);assert_eq!(image_dimensions(&webp).unwrap(),(12,8));
        let mut lossless=b"RIFF".to_vec();lossless.extend(18u32.to_le_bytes());lossless.extend(b"WEBPVP8L");lossless.extend(5u32.to_le_bytes());lossless.extend([0x2f,11,0xc0,1,0,0]);assert_eq!(image_dimensions(&lossless).unwrap(),(12,8));
        webp[4]=0;assert!(image_dimensions(&webp).is_err());assert!(image_dimensions(&[0xff,0xd8,0xff,0xc0,0,20]).is_err());
    }

    #[test]
    fn xdesign_assets_operation_leases_release_after_failure() {
        let leases=(0..4).map(|_|Lease::acquire().unwrap()).collect::<Vec<_>>();assert!(Lease::acquire().is_err());assert_eq!(ACTIVE.load(Ordering::SeqCst),4);drop(leases);assert_eq!(ACTIVE.load(Ordering::SeqCst),0);let lease=Lease::acquire().unwrap();drop(lease);assert_eq!(ACTIVE.load(Ordering::SeqCst),0);
    }

}
