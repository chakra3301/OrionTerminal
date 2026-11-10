//! Opt-in authored-file acceptance through Orion's actual publish/restore path.
//! Generated fixtures test the runner only; they cannot satisfy corpus acceptance.
use super::*;
use photocraft_engine::doc::{Document, Rect};
use sha2::{Digest, Sha256};
use std::path::Component;

const MANIFEST: &str = include_str!("../../resources/xdesign-photoshop-corpus.sha256");

fn verified_files(root: &Path, manifest: &str) -> Result<Vec<(String, PathBuf)>, String> {
    let root = root.canonicalize().map_err(|e| format!("Photoshop corpus unavailable: {e}"))?;
    let mut records = Vec::new();
    let mut names = std::collections::HashSet::new();
    for line in manifest.lines().filter(|line| !line.trim().is_empty()) {
        let (digest, name) = line.split_once("  ").ok_or("Invalid Photoshop corpus manifest")?;
        if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) || name.is_empty()
            || !names.insert(name.to_string()) || !Path::new(name).components().all(|c| matches!(c, Component::Normal(_))) {
            return Err("Invalid Photoshop corpus manifest entry".into());
        }
        let path = root.join(name).canonicalize().map_err(|e| format!("Missing {name}: {e}"))?;
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if !path.starts_with(&root) || !metadata.is_file() || metadata.len() > MAX_INPUT_BYTES {
            return Err(format!("Invalid corpus file: {name}"));
        }
        let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        std::io::copy(&mut file, &mut hash).map_err(|e| e.to_string())?;
        if format!("{:x}", hash.finalize()) != digest.to_lowercase() { return Err(format!("Corpus checksum mismatch: {name}")); }
        records.push((name.into(), path));
    }
    if records.is_empty() { return Err("Photoshop corpus manifest is empty".into()); }
    Ok(records)
}

fn signature(doc: &Document) -> Value {
    json!({"width":doc.size.width,"height":doc.size.height,"mode":format!("{:?}",doc.mode),
        "depth":format!("{:?}",doc.depth),"layers":doc.layer_count(),
        "layerNames":doc.walk().into_iter().map(|(_,_,layer)|layer.name.clone()).collect::<Vec<_>>()})
}

fn difference(a: &Document, b: &Document) -> Result<f32, String> {
    if a.size != b.size { return Err("Re-export changed the document size".into()); }
    let mut maximum = 0.0_f32;
    for y in (0..a.size.height).step_by(128) {
        for x in (0..a.size.width).step_by(512) {
            let rect = Rect::from_xywh(x as i32, y as i32, 512.min(a.size.width-x), 128.min(a.size.height-y));
            let left = photocraft_compose::render(a, rect);
            let right = photocraft_compose::render(b, rect);
            for (left, right) in left.px.iter().zip(&right.px) {
                for c in 0..4 {
                    let delta = if c == 3 { (left[c]-right[c]).abs() } else { (left[c]*left[3]-right[c]*right[3]).abs() };
                    if !delta.is_finite() { return Err("Rendering produced non-finite pixels".into()); }
                    maximum = maximum.max(delta);
                }
            }
        }
    }
    Ok(maximum)
}

fn oracle(doc: &Document, bytes: &[u8]) -> Result<Value, String> {
    let file = photocraft_psd::PsdFile::from_bytes(bytes).map_err(|e| e.to_string())?;
    // The independent RGBA8 decoder does not apply an ICC display transform.
    // Other modes need the upstream float/thumbnail oracles, not a false match.
    if !matches!(file.header.color_mode, photocraft_psd::ColorMode::Rgb | photocraft_psd::ColorMode::Grayscale)
        || file.has_real_merged_data() == Some(false) || u64::from(doc.size.width)*u64::from(doc.size.height)>16_777_216 {
        return Ok(json!({"status":"unverified","reason":"Requires float/color-mode/thumbnail oracle or exceeds the 16MP independent decode limit"}));
    }
    // Photoshop mattes transparent merged images over white; the pinned IO
    // helper removes that matte from the independently decoded composite.
    let expected = photocraft_io::merged_composite(&file).map_err(|e| e.to_string())?;
    if (file.header.width,file.header.height)!=(doc.size.width,doc.size.height)
        || expected.len()!=doc.size.width as usize*doc.size.height as usize { return Err("Oracle size differs from import".into()); }
    let mut maximum = 0.0_f32;
    for y in (0..doc.size.height).step_by(128) {
        let rendered = photocraft_compose::render(doc,Rect::from_xywh(0,y as i32,doc.size.width,128.min(doc.size.height-y)));
        for (index, ours) in rendered.px.iter().enumerate() {
            let target=expected[(y as usize)*doc.size.width as usize+index];
            let ours=if file.merged_has_alpha(){*ours}else{let white=1.0-ours[3];[ours[0]*ours[3]+white,ours[1]*ours[3]+white,ours[2]*ours[3]+white,1.0]};
            for c in 0..4 {
                let delta=if c==3 {(ours[c]-target[c]).abs()}else{(ours[c]*ours[3]-target[c]*target[3]).abs()};
                if !delta.is_finite(){return Err("Oracle comparison produced non-finite pixels".into());}maximum=maximum.max(delta);
            }
        }
    }
    Ok(json!({"status":if maximum<=2.0/255.0+1e-5{"passed"}else{"failed"},"maxPremultipliedError":maximum,"tolerance":2.0/255.0}))
}

fn check_file(name: &str, bytes: &[u8], directory: &Path) -> Result<Value,String> {
    let imported=photocraft_io::import(name,bytes).map_err(|e|e.to_string())?;
    let original=signature(&imported.document);
    let oracle=oracle(&imported.document,bytes)?;
    let mut engine=Session::new();engine.add_document(imported.document,None);
    let mut session=PhotoSession{engine,color_settings:None,version:String::new(),original_path:Some(name.into()),writer:Default::default()};
    let saved=publish(directory,"acceptance",&mut session)?;
    let restored=restore(directory,&saved.version,Some(name.into()))?;
    let doc=&session.engine.active().ok_or("Missing imported document")?.doc;
    let restored_doc=&restored.engine.active().ok_or("Missing restored document")?.doc;
    if signature(restored_doc)!=original||difference(doc,restored_doc)?!=0.0{return Err("Orion native save/reopen changed document structure or pixels".into());}
    let format=if name.to_ascii_lowercase().ends_with(".psb"){"psb"}else{"psd"};
    let exported=photocraft_io::export(restored_doc,format,&Default::default()).map_err(|e|e.to_string())?;
    let reopened=photocraft_io::import(name,&exported.bytes).map_err(|e|e.to_string())?;
    let error=difference(doc,&reopened.document)?;
    let structure=signature(&reopened.document)==original;
    let status=if error<=1.0/255.0+1e-5&&structure&&oracle["status"]=="passed"{"passed"}else{"failed"};
    Ok(json!({"name":name,"status":status,"document":original,"importWarnings":imported.warnings,
        "exportWarnings":exported.warnings,"reimportWarnings":reopened.warnings,"oracle":oracle,
        "nativeSave":"passed","reexportStructure":structure,"maxReexportError":error,"exportBytes":exported.bytes.len()}))
}

#[test]
fn xdesign_authored_manifest_rejects_missing_changed_and_escaping_fixtures() {
    let dir=std::env::temp_dir().join(format!("orion-corpus-manifest-{}",ulid::Ulid::new()));std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("image.psd"),b"example").unwrap();let digest=format!("{:x}",Sha256::digest(b"example"));
    assert_eq!(verified_files(&dir,&format!("{digest}  image.psd")).unwrap().len(),1);
    for manifest in [String::new(),format!("{digest}  missing.psd"),format!("{digest}  ../image.psd"),format!("{}  image.psd","0".repeat(64))]{assert!(verified_files(&dir,&manifest).is_err());}
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn xdesign_authored_runner_checks_generated_psd_and_psb_without_calling_them_authored() {
    let mut engine=Session::new();engine.execute("file.new",json!({"width":24,"height":24,"background":"transparent"})).unwrap();
    engine.execute("paint.stroke",json!({"points":[[12,12,1]],"size":8,"color":"#528ace"})).unwrap();
    let root=std::env::temp_dir().join(format!("orion-corpus-runner-{}",ulid::Ulid::new()));
    for format in ["psd","psb"]{let export=photocraft_io::export(&engine.active().unwrap().doc,format,&Default::default()).unwrap();
        let record=check_file(&format!("generated.{format}"),&export.bytes,&root.join(format)).unwrap();assert_eq!(record["status"],"passed","{record}");}
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires all checksum-pinned Photoshop-authored fixtures; run test:xdesign:photoshop"]
fn xdesign_photoshop_authored_acceptance() {
    let output=std::env::var_os("XDESIGN_PHOTOSHOP_REPORT").map(PathBuf::from).expect("Set XDESIGN_PHOTOSHOP_REPORT");
    let corpus=std::env::var_os("XDESIGN_PHOTOSHOP_CORPUS").map(PathBuf::from).expect("Set XDESIGN_PHOTOSHOP_CORPUS");
    let files=verified_files(&corpus,MANIFEST).expect("All pinned authored files must exist and match their checksums");
    let temporary=std::env::temp_dir().join(format!("orion-photoshop-acceptance-{}",ulid::Ulid::new()));let mut cases=Vec::new();
    for (index,(name,path)) in files.iter().enumerate(){
        let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{let bytes=std::fs::read(path).map_err(|e|e.to_string())?;check_file(name,&bytes,&temporary.join(index.to_string()))}));
        cases.push(match result {Ok(Ok(record))=>record,Ok(Err(error))=>json!({"name":name,"status":"failed","error":error}),Err(_)=>json!({"name":name,"status":"failed","error":"Native import/render panicked"})});
        let report=json!({"kind":"Photoshop authored merged-composite oracle and Orion native save/re-export", "corpusCommit":"f5b1178cab15309e05b7b504545df3c701f6d8fd","manifestSha256":format!("{:x}",Sha256::digest(MANIFEST.as_bytes())),"cases":cases});
        std::fs::write(&output,serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        let _=std::fs::remove_dir_all(temporary.join(index.to_string()));
    }
    let _=std::fs::remove_dir_all(&temporary);
    assert!(cases.iter().all(|case|case["status"]=="passed"),"Authored Photoshop acceptance failed; inspect {}",output.display());
}
