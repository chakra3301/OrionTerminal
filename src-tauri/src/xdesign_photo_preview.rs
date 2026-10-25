//! Temporary native effects previews. Source state, disk versions and tool
//! libraries are untouched; applying uses the normal immutable-version path.
use super::{render_view_preview, PhotoTile, PhotoViewPreview};
use photocraft_engine::{DocState, Session};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[path = "xdesign_photo_preview_cache.rs"]
mod completed_cache;
#[path = "xdesign_photo_preview_jobs.rs"]
mod controlled_jobs;
#[path = "xdesign_photo_geometry_admission.rs"]
mod geometry_admission;

#[cfg(test)]
#[path = "xdesign_photo_preview_cache_tests.rs"]
mod cache_tests;

#[cfg(test)]
#[path = "xdesign_photo_basic_filter_preview_tests.rs"]
mod basic_filter_tests;

#[cfg(test)]
use super::{color_views, display, execute_view_command, render_color_view_preview};

const MAX_PREVIEW_REGIONS: usize = 8;
const MAX_PREVIEW_REGION_PIXELS: u64 = 2_097_152;
const MAX_PREVIEW_BASE_BYTES: usize = 24 * 1024 * 1024;
const MAX_PREVIEW_TILE_BYTES: usize = 2 * 1024 * 1024;
const MAX_PREVIEW_TOTAL_BYTES: usize = 48 * 1024 * 1024;
const BASIC_FILTER_EDITS: [&str; 7] = [
    "filter.blur.gaussianBlur",
    "filter.blur.boxBlur",
    "filter.blur.motionBlur",
    "filter.blur.radialBlur",
    "filter.blur.surfaceBlur",
    "filter.sharpen.unsharpMask",
    "filter.sharpen.smartSharpen",
];
const DETAIL_COMMANDS: [&str; 5] = [
    "filter.blurGallery.fieldBlur",
    "filter.blurGallery.irisBlur",
    "filter.blurGallery.spinBlur",
    "filter.blurGallery.pathBlur",
    "filter.blurGallery.tiltShift",
];

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PreviewRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub scale: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreviewTile {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub scale: u32,
    pub pixel_width: u32,
    pub pixel_height: u32,
    pub png: String,
}

pub(super) struct PreviewWithRegions {
    pub preview: PhotoViewPreview,
    pub tiles: Option<Vec<PreviewTile>>,
    pub original_tiles: Option<Vec<PreviewTile>>,
}

fn validate_regions(command: &str, regions: Option<&[PreviewRegion]>, width: u32, height: u32) -> Result<(), String> {
    let Some(regions) = regions.filter(|regions| !regions.is_empty()) else { return Ok(()); };
    if !DETAIL_COMMANDS.contains(&command) { return Err("Detail regions are available only for Blur Gallery previews".into()); }
    if regions.len() > MAX_PREVIEW_REGIONS { return Err("A Blur Gallery detail preview can request at most 8 regions".into()); }
    let mut pixels = 0u64;
    for region in regions {
        super::tiles::validate_dimensions(region.width, region.height, region.scale)?;
        if region.x >= width || region.y >= height || region.x.checked_add(region.width).is_none_or(|end| end > width) || region.y.checked_add(region.height).is_none_or(|end| end > height) {
            return Err("A Blur Gallery detail region must be inside the source image".into());
        }
        pixels = pixels.checked_add(u64::from(region.width.div_ceil(region.scale)) * u64::from(region.height.div_ceil(region.scale))).ok_or("Blur Gallery detail preview exceeds its pixel bound")?;
        if pixels > MAX_PREVIEW_REGION_PIXELS { return Err("Blur Gallery detail preview exceeds its 2,097,152 output-pixel bound".into()); }
    }
    Ok(())
}

fn detail_tile(tile: PhotoTile) -> Result<PreviewTile, String> {
    if tile.png.len() > MAX_PREVIEW_TILE_BYTES { return Err("A Blur Gallery detail tile exceeds 2 MB encoded".into()); }
    Ok(PreviewTile { x: tile.x, y: tile.y, width: tile.width, height: tile.height, scale: tile.scale, pixel_width: tile.pixel_width, pixel_height: tile.pixel_height, png: tile.png })
}

fn initial_preview_bytes(png: &str) -> Result<usize, String> {
    if png.len() > MAX_PREVIEW_BASE_BYTES { return Err("Blur Gallery base preview exceeds 24 MB encoded".into()); }
    Ok(png.len())
}

fn add_preview_tile_bytes(total: usize, png: &str) -> Result<usize, String> {
    if png.len() > MAX_PREVIEW_TILE_BYTES { return Err("A Blur Gallery detail tile exceeds 2 MB encoded".into()); }
    let total = total.checked_add(png.len()).ok_or("Blur Gallery previews exceed the encoded-byte bound")?;
    if total > MAX_PREVIEW_TOTAL_BYTES { return Err("Blur Gallery base and detail previews exceed 48 MB encoded".into()); }
    Ok(total)
}

fn edit_input_bytes(preview: &PhotoViewPreview) -> Result<usize,String> {
    let mut bytes=0usize;
    if let Some(result)=&preview.result {for key in ["lensEdit","blurEdit"] {
        if let Some(input)=result[key]["input"]["png"].as_str() {bytes=bytes.checked_add(initial_preview_bytes(input)?).ok_or("Filter input previews exceed the encoded-byte bound")?;}
        if let Some(tiles)=result[key]["inputTiles"].as_array() {for tile in tiles {bytes=add_preview_tile_bytes(bytes,tile["png"].as_str().ok_or("Invalid filter input tile")?)?;}}
    }}
    Ok(bytes)
}

fn combined_preview_bytes(preview: &PhotoViewPreview) -> Result<usize,String> {
    let bytes=initial_preview_bytes(&preview.png)?.checked_add(edit_input_bytes(preview)?).ok_or("Filter previews exceed the encoded-byte bound")?;
    if bytes>MAX_PREVIEW_TOTAL_BYTES {return Err("Filter input, output and detail previews exceed 48 MB encoded".into());}
    Ok(bytes)
}

pub(super) const ADJUSTMENTS: [&str; 16] = [
    "brightnessContrast",
    "levels",
    "curves",
    "exposure",
    "vibrance",
    "hueSaturation",
    "blackWhite",
    "colorBalance",
    "photoFilter",
    "channelMixer",
    "gradientMap",
    "selectiveColor",
    "colorLookup",
    "invert",
    "posterize",
    "threshold",
];

/// Pixel adjustments with their own engine parameters; they preview but do not use the shared adjustment-layer path.
const PIXEL_ADJUSTMENTS: [&str; 3] = ["shadowsHighlights", "replaceColor", "matchColor"];

/// Images above this render each preview frame too slowly to follow a drag.
const FULL_PREVIEW_PIXELS: u64 = 16_777_216;

/// Adjustments work pixel by pixel, so they look the same on a smaller copy; edits measured in pixels need the full image.
fn reducible(command: &str) -> bool {
    command == "layer.setAdjustment"
        || ["image.adjustments.", "layer.newAdjustmentLayer."].iter().filter_map(|prefix| command.strip_prefix(prefix)).any(|kind| ADJUSTMENTS.contains(&kind))
}

/// The image reduced to the size its previews display at. It is kept for the next frame; holding the source weakly
/// keeps its allocation, so a matching pointer means the same unchanged image rather than a reused address.
fn reduced_copy(doc: &std::sync::Arc<photocraft_engine::doc::Document>) -> Result<std::sync::Arc<photocraft_engine::doc::Document>, String> {
    use std::sync::{Arc, Mutex, Weak};
    type Reduced = Option<(Weak<photocraft_engine::doc::Document>, Arc<photocraft_engine::doc::Document>)>;
    static REDUCED: Mutex<Reduced> = Mutex::new(None);
    let mut cached = REDUCED.lock().map_err(|_| "Image preview cache needs to be restarted")?;
    if let Some((source, copy)) = cached.as_ref() {
        if std::ptr::eq(source.as_ptr(), Arc::as_ptr(doc)) { return Ok(copy.clone()); }
    }
    let factor = doc.size.width.max(doc.size.height).div_ceil(2048).max(1);
    let mut engine = Session::new();
    engine.add_document((**doc).clone(), None);
    engine.execute("image.imageSize", serde_json::json!({"width": doc.size.width.div_ceil(factor), "height": doc.size.height.div_ceil(factor), "resample": "bilinear"})).map_err(|error| error.to_string())?;
    let copy = engine.active().ok_or("No preview image")?.doc.clone();
    *cached = Some((Arc::downgrade(doc), copy.clone()));
    Ok(copy)
}

// Embed a selected LUT before engine parsing. The bounded read also avoids
// rereading a changing file while this preview or edit is being composed.
pub(super) fn lut_params(command: &str, mut params: Value) -> Result<Value, String> {
    if [
        "image.adjustments.colorLookup",
        "layer.newAdjustmentLayer.colorLookup",
        "layer.setAdjustment",
    ]
    .contains(&command)
    {
        if let Some(path) = params["file"].as_str().filter(|path| !path.is_empty()) {
            use std::io::Read;
            const MAX: u64 = 64 * 1024 * 1024;
            let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
            let metadata = file.metadata().map_err(|error| error.to_string())?;
            if !metadata.is_file() || metadata.len() > MAX {
                return Err("Lookup table import exceeds 64MB".into());
            }
            let name = std::path::Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("lut.cube")
                .to_owned();
            let mut bytes = Vec::new();
            file.take(MAX + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            if bytes.len() as u64 > MAX {
                return Err("Lookup table import exceeds 64MB".into());
            }
            let data = String::from_utf8(bytes)
                .map_err(|_| "Lookup table must be a text .cube, .3dl or .look file")?;
            let object = params.as_object_mut().ok_or("Invalid lookup parameters")?;
            object.remove("file");
            object.insert("data".into(), Value::String(data));
            object.insert("fileName".into(), Value::String(name));
        }
    }
    Ok(params)
}

pub(super) fn render(
    state: &DocState,
    command: &str,
    params: Value,
) -> Result<PhotoViewPreview, String> {
    render_with_selection_view(state, command, params, None)
}

pub(super) fn validate_filter_input(command: &str, params: &Value) -> Result<(), String> {
    if command == "filter.distort.displace" {
        if let Some(path) = params.get("mapPath").and_then(Value::as_str).filter(|path| !path.is_empty()) {
            let metadata = std::fs::metadata(path).map_err(|error| format!("Cannot open displacement map: {error}"))?;
            if !metadata.is_file() || metadata.len() > super::MAX_INPUT_BYTES {
                return Err("Displacement map must be a regular file no larger than 512MB".into());
            }
        }
    }
    Ok(())
}

pub(super) fn render_with_selection_view(state: &DocState, command: &str, params: Value, selection_view: Option<&str>) -> Result<PhotoViewPreview, String> {
    Ok(render_internal(state,None,command,params,selection_view,None)?.preview)
}
fn smart_filter_edit<'a>(state: &'a DocState, command: &str, params: &Value) -> Option<(&'a photocraft_engine::doc::SmartObject, usize)> {
    params["layer"].as_u64()?; params["index"].as_u64()?;
    lens_edit_lookup(state, command, params)
}

fn lens_edit_lookup<'a>(state: &'a DocState, command: &str, params: &Value) -> Option<(&'a photocraft_engine::doc::SmartObject, usize)> {
    if command != "layer.smartFilter.setParams" { return None; }
    let id = params.get("layer").and_then(Value::as_u64).map(photocraft_engine::doc::LayerId).or(state.active_layer)?;
    let photocraft_engine::doc::LayerContent::Smart(smart) = &state.doc.layer(id)?.content else { return None; };
    let index = match params.get("index") { Some(value) => usize::try_from(value.as_u64()?).ok()?, None => smart.smart_filters.len().checked_sub(1)? };
    smart.smart_filters.get(index)?;
    Some((smart, index))
}

pub(super) fn prepare_lens_edit(engine: &Session, command: &str, mut params: Value) -> Result<Value, String> {
    let Some(state) = engine.active() else { return Ok(params); };
    let Some((smart, index)) = lens_edit_lookup(state, command, &params) else { return Ok(params); };
    let filter = &smart.smart_filters[index];
    if !["filter.lensCorrection", "filter.adaptiveWideAngle"].contains(&filter.command.as_str()) { return Ok(params); }
    let mut validation = params.clone();
    if validation.get("layer").is_none() { validation["layer"] = serde_json::json!(state.active_layer.ok_or("No active Smart Object")?.0); }
    if validation.get("index").is_none() { validation["index"] = serde_json::json!(index); }
    validate_lens_input(engine, command, &validation)?;
    let mut merged = filter.params.as_object().ok_or("Stored lens settings are not an object")?.clone();
    merged.extend(params["params"].as_object().ok_or("Lens settings must be an object")?.clone());
    let settings = Value::Object(merged.clone());
    let info = state.doc.metadata.exif.as_ref().map(|bytes| photocraft_algo::exif::read(bytes));
    if filter.command == "filter.lensCorrection" {
        let mut to_resolve = settings.clone(); to_resolve["autoScale"] = Value::Bool(false);
        let resolved = photocraft_engine::lens_cmds::lens_params(&filter.command, &to_resolve, state.doc.bounds(), info.as_ref()).map_err(|error| error.to_string())?;
        merged.insert("angle".into(), serde_json::json!(resolved.angle));
        // Native setParams merges objects. A canonical null clears a stored line without
        // adding its angle again; auto-fit keeps its manual baseline for deterministic replay.
        merged.insert("straighten".into(), Value::Null);
        merged.insert("autoScale".into(), serde_json::json!(settings["autoScale"].as_bool().unwrap_or(false)));
        if resolved.profile.is_some() {
            let focal = settings["focalLength"].as_f64().filter(|value| value.is_finite()).unwrap_or(0.);
            let focal = if settings["profile"].as_str() == Some("auto") {
                info.as_ref().and_then(|info| info.focal_length_35mm.or(info.focal_length)).or((focal > 0.).then_some(focal)).unwrap_or(50.)
            } else if focal > 0. { focal } else { 50. };
            merged.insert("profile".into(), serde_json::json!("generic"));
            merged.insert("focalLength".into(), serde_json::json!(focal));
        } else { merged.insert("profile".into(), serde_json::json!("none")); }
    } else {
        let resolved = photocraft_engine::lens_cmds::wide_params(&filter.command, &settings, info.as_ref()).map_err(|error| error.to_string())?;
        let mut known = serde_json::to_value(resolved).map_err(|error| error.to_string())?;
        // Constraint descriptors can carry unknown imported fields; only the typed scalar
        // fields need EXIF/default resolution, so retain the original constraint objects.
        known.as_object_mut().unwrap().remove("constraints");
        merged.extend(known.as_object().unwrap().clone());
        merged.entry("interpolation").or_insert_with(|| serde_json::json!("bicubic"));
    }
    params["params"] = Value::Object(merged);
    Ok(params)
}

fn filter_edit_input(engine: &Session, command: &str, params: &Value, regions: Option<&[PreviewRegion]>) -> Result<Option<(&'static str, Value)>, String> {
    use photocraft_engine::doc::{Document, Layer, LayerContent, SmartSource};
    let ordinary=super::linked_replay::gallery_target(engine,command,params)?;
    let Some(state) = engine.active() else { return Ok(None); };
    let (smart,index,id,visible)=if let Some(layer)=ordinary {
        let LayerContent::Smart(smart)=&state.doc.layer(layer).ok_or("No filter layer")?.content else{return Err("No Smart Object filter input".into());};
        (smart,smart.smart_filters.len(),command,true)
    } else {
        let Some((smart,index))=smart_filter_edit(state,command,params) else{return Ok(None);};
        let filter=&smart.smart_filters[index];(smart,index,filter.command.as_str(),filter.visible)
    };
    let blur = DETAIL_COMMANDS.contains(&id);
    if !blur && !["filter.lensCorrection", "filter.adaptiveWideAngle"].contains(&id) { return Ok(None); }
    validate_lens_input(engine, command, params)?;
    let prepared = prepare_lens_edit(engine, command, params.clone())?;
    let settings = &prepared["params"];
    let cached=ordinary.is_some()&&matches!(&smart.source,SmartSource::Linked{path} if path.is_empty());
    let (input,frame,bounds)=if cached {
        let bounds=state.doc.selection.as_ref().map(|selection|selection.content_bounds()).filter(|bounds|!bounds.is_empty()).unwrap_or(state.doc.bounds());
        (smart.cache.clone().ok_or("The Smart Object has no cached filter input")?,state.doc.bounds(),bounds)
    } else {
        super::linked_replay::check_stack(smart)?;
        let mut when_running=smart.clone();when_running.filters_enabled=true;when_running.smart_filters.truncate(index);when_running.filter_mask=None;
        let placed=super::linked_replay::placed_source(&state.doc,&when_running)?.ok_or("The Smart Object source is unavailable; its filter input cannot be shown")?;
        // Lens/Wide uses the native placed union; Gallery keeps document coordinates.
        let frame=state.doc.bounds().union(&placed.content_bounds());
        (photocraft_engine::smart_cmds::apply_smart_filters(&placed,&when_running,state.doc.bounds()),frame,state.doc.bounds())
    };
    let mut doc = Document::new("Filter input", state.doc.size, state.doc.mode, state.doc.depth);
    doc.id = state.doc.id; doc.icc_profile = state.doc.icc_profile.clone();
    doc.color_table = state.doc.color_table.clone(); doc.duotone = state.doc.duotone.clone();
    doc.layers = vec![Layer::new("Input when this filter runs", LayerContent::Raster(input))];
    let color = super::display::View::new(&engine.color, &doc)?;
    let input = super::render_color_view_preview(&doc, &Default::default(), Some(&color))?;
    initial_preview_bytes(&input.png)?;
    let mut metadata=serde_json::json!({"input":{"png":input.png,"width":state.doc.size.width,"height":state.doc.size.height,"pixelWidth":input.width,"pixelHeight":input.height},"stackEnabled":smart.filters_enabled,"filterVisible":visible});
    if blur {
        metadata["bounds"]=serde_json::json!([bounds.x0,bounds.y0,bounds.width(),bounds.height()]);
        if ordinary.is_some(){metadata["mode"]=serde_json::json!(if cached{"cache"}else{"source"});}
        let mut tiles=Vec::new();let mut bytes=initial_preview_bytes(metadata["input"]["png"].as_str().unwrap())?;
        for region in regions.unwrap_or(&[]) {
            let tile=detail_tile(super::tiles::render_color_region(&doc,&Default::default(),Some(&color),region.x,region.y,region.width,region.height,region.scale)?)?;
            bytes=add_preview_tile_bytes(bytes,&tile.png)?;tiles.push(tile);
        }
        metadata["inputTiles"]=serde_json::to_value(tiles).map_err(|error|error.to_string())?;
        return Ok(Some(("blurEdit", metadata)));
    }
    let (resolved, curves) = if id == "filter.lensCorrection" {
        let lens = photocraft_engine::lens_cmds::lens_params(id, settings, frame, None).map_err(|error| error.to_string())?;
        (serde_json::json!({"angle":lens.angle,"scale":lens.scale,"autoScale":settings["autoScale"].as_bool().unwrap_or(false)}), Value::Null)
    } else {
        let wide = photocraft_engine::lens_cmds::wide_params(id, settings, None).map_err(|error| error.to_string())?;
        let camera = photocraft_algo::wideangle::Camera::new(&wide, frame);
        let curves = wide.constraints.iter().take(128).map(|line| camera.arc(line.a, line.b, 24)).collect::<Vec<_>>();
        (serde_json::to_value(&wide).map_err(|error| error.to_string())?, serde_json::json!(curves))
    };
    metadata["frame"]=serde_json::json!([frame.x0,frame.y0,frame.x1,frame.y1]); metadata["resolved"]=resolved; metadata["curves"]=curves;
    Ok(Some(("lensEdit",metadata)))
}
fn blur_prior_items(previous: &[Value], items: &[Value], keys: &[&str], anchors: &[&str]) -> Vec<Option<usize>> {
    let previous=if previous.len()<=256 {previous}else{&[]};
    fn meaningful(value: &Value) -> bool {
        let number=|value:&Value|value.as_f64().is_some_and(|value|value.is_finite()&&(value as f32).is_finite());
        match value {Value::Array(values)=>!values.is_empty()&&values.len()<=256&&values.iter().all(|value|number(value)||value.as_array().is_some_and(|point|point.len()==2&&point.iter().all(number))),_=>number(value)}
    }
    let mut used=vec![false;previous.len()];let mut matched=vec![None;items.len()];
    for (at,item) in items.iter().enumerate() {if let Some(old)=previous.iter().enumerate().position(|(index,old)|!used[index]&&old==item) {matched[at]=Some(old);used[old]=true;}}
    for (at,item) in items.iter().enumerate() {
        if matched[at].is_some() {continue;}
        let mut best=None;let mut tied=false;
        for (index,old) in previous.iter().enumerate().filter(|(index,_)|!used[*index]) {
            let counts=match (old,item) {
                (Value::Object(old),Value::Object(new))=>Some((anchors.iter().filter(|key|old.get(**key).is_some_and(|value|new.get(**key)==Some(value)&&meaningful(value))).count(),keys.iter().filter(|key|old.get(**key)!=new.get(**key)).count())),
                (Value::Array(old),Value::Array(new)) if old.len()==new.len()=>{let same=old.iter().zip(new).filter(|(a,b)|a==b&&meaningful(a)).count();let differences=old.iter().zip(new).filter(|(a,b)|a!=b).count();Some((same,differences))},
                _=>None,
            };
            let Some((same,differences))=counts.filter(|(same,_)|*same>0) else{continue;};
            let score=(differences,std::cmp::Reverse(same));
            match best {None=>{best=Some((score,index));tied=false;},Some((current,_)) if score<current=>{best=Some((score,index));tied=false;},Some((current,_)) if score==current=>tied=true,_=>{}}
        }
        if !tied {if let Some((_,old))=best {matched[at]=Some(old);used[old]=true;}}
    }
    matched
}

fn validate_blur_edit(id: &str, stored: &Value, incoming: &Value) -> Result<(), String> {
    type Range = (&'static str, f64, f64);
    let mut merged=stored.as_object().ok_or("Stored Blur Gallery settings are not an object")?.clone();
    merged.extend(incoming.as_object().ok_or("Blur Gallery settings must be an object")?.clone());
    let settings=Value::Object(merged);
    let check=|old:&Value,new:&Value,ranges:&[Range]|->Result<(),String>{
        for &(key,min,max) in ranges {
            if new.get(key)==old.get(key) {continue;}
            if let Some(value)=new.get(key) {
                let value=value.as_f64().ok_or_else(||format!("Blur Gallery {key} must be a finite number"))?;
                let native=value as f32;
                if !value.is_finite()||!native.is_finite()||value<min||value>max||native<min as f32||native>max as f32 {return Err(format!("Blur Gallery {key} is outside its supported range"));}
            }
        }
        Ok(())
    };
    let common=[("centerX",0.,1.),("centerY",0.,1.)];
    let (scalars,rows): (Vec<Range>,Vec<Range>)=match id {
        "filter.blurGallery.fieldBlur" => (vec![("blur",0.,500.)],vec![("x",0.,1.),("y",0.,1.),("blur",0.,500.)]),
        "filter.blurGallery.irisBlur" => (vec![("blur",0.,500.),("radiusX",0.01,1.),("radiusY",0.01,1.),("angle",-180.,180.),("roundness",0.,100.),("feather",0.,0.99)],vec![("x",0.,1.),("y",0.,1.),("blur",0.,500.),("radiusX",0.001,1.),("radiusY",0.001,1.),("angle",-180.,180.),("roundness",0.,100.),("feather",0.,0.99)]),
        "filter.blurGallery.spinBlur" => (vec![("blurAngle",0.,360.),("radiusX",0.01,1.),("radiusY",0.01,1.),("angle",-180.,180.)],vec![("x",0.,1.),("y",0.,1.),("blurAngle",0.,360.),("radiusX",0.001,1.),("radiusY",0.001,1.),("angle",-180.,180.)]),
        "filter.blurGallery.pathBlur" => (vec![("startX",0.,1.),("startY",0.,1.),("endX",0.,1.),("endY",0.,1.),("speed",0.,500.),("taper",0.,100.)],vec![("speed",0.,500.),("taper",0.,100.)]),
        _ => (vec![("blur",0.,500.),("angle",-90.,90.),("focus",0.,1.),("transition",0.01,1.)],vec![]),
    };
    if id!="filter.blurGallery.pathBlur" {check(stored,&settings,&common)?;}
    check(stored,&settings,&scalars)?;
    let key=if id=="filter.blurGallery.pathBlur" {"paths"} else {"pins"};
    if id=="filter.blurGallery.tiltShift"||settings.get(key)==stored.get(key) {return Ok(());}
    let Some(value)=settings.get(key) else{return Ok(());};
    let items=value.as_array().ok_or("Blur Gallery geometry must be an array")?;
    if items.len()>256 {return Err("Blur Gallery supports at most 256 geometry items".into());}
    let previous=stored[key].as_array().map(Vec::as_slice).unwrap_or(&[]);
    // Rows have no persistent identity. Reserve exact survivors, then preserve legacy
    // fields only for a unique remaining geometry match; decoration never identifies a row.
    let mut keys=rows.iter().map(|(key,_,_)|*key).collect::<Vec<_>>();if key=="paths" {keys.push("points");}
    let anchors=keys.iter().copied().filter(|key|!["blur","blurAngle"].contains(key)).collect::<Vec<_>>();
    let matched=blur_prior_items(previous,items,&keys,&anchors);
    for (index,item) in items.iter().enumerate() {
        let old=matched[index].map(|index|&previous[index]).unwrap_or(&Value::Null);
        if old==item {continue;}
        if !item.is_object(){return Err("Blur Gallery geometry items must be objects".into());}
        check(old,item,&rows)?;
        if key=="paths"&&item.get("points")!=old.get("points") {
            if let Some(points)=item.get("points") {
                let points=points.as_array().filter(|points|(2..=256).contains(&points.len())).ok_or("Blur Gallery paths need 2 to 256 points")?;
                let old_points=old["points"].as_array().map(Vec::as_slice).unwrap_or(&[]);let matched=blur_prior_items(old_points,points,&[],&[]);
                for (at,point) in points.iter().enumerate() {
                    let old=matched[at].map(|index|&old_points[index]).unwrap_or(&Value::Null);
                    let point=point.as_array().filter(|point|point.len()==2).ok_or("Blur Gallery points need two coordinates")?;
                    for (axis,value) in point.iter().enumerate() {
                        if old.get(axis)==Some(value) {continue;}
                        if !value.as_f64().is_some_and(|value|value.is_finite()&&(value as f32).is_finite()&&(0.0..=1.0).contains(&value)) {return Err("Blur Gallery path coordinates must be finite normalized values".into());}
                    }
                }
            }
        }
    }
    Ok(())
}

pub(super) fn validate_geometry_input(engine: &Session, command: &str, params: &Value) -> Result<(), String> {
    geometry_admission::validate(engine, command, params)
}

fn validate_basic_filter_edit(command: &str, stored: &Value, incoming: &Value) -> Result<(), String> {
    let mut merged = stored.as_object().ok_or("Stored filter settings must be an object")?.clone();
    merged.extend(incoming.as_object().ok_or("Filter settings must be an object")?.clone());
    let fields: &[(&str, f64, f64)] = match command {
        "filter.blur.gaussianBlur" => &[("radius", 0.1, 1000.)],
        "filter.blur.boxBlur" => &[("radius", 1., 2000.)],
        "filter.blur.motionBlur" => &[("angle", -360., 360.), ("distance", 1., 2000.)],
        "filter.blur.radialBlur" => &[("amount", 1., 100.), ("centerX", 0., 1.), ("centerY", 0., 1.)],
        "filter.blur.surfaceBlur" => &[("radius", 1., 100.), ("threshold", 2., 255.)],
        "filter.sharpen.unsharpMask" => &[("amount", 1., 500.), ("radius", 0.1, 1000.), ("threshold", 0., 255.)],
        "filter.sharpen.smartSharpen" => &[("amount", 1., 500.), ("radius", 0.1, 64.), ("reduceNoise", 0., 100.)],
        _ => return Ok(()),
    };
    for &(key, min, max) in fields {
        let previous = stored.get(key);
        let edited = merged.get(key);
        if edited == previous || edited.and_then(Value::as_f64).zip(previous.and_then(Value::as_f64)).is_some_and(|(a, b)| a == b) { continue; }
        if !merged.get(key).and_then(Value::as_f64).is_some_and(|value| value.is_finite() && (value as f32).is_finite() && value >= min && value <= max) {
            return Err(format!("Filter {key} must be a finite number between {min} and {max}"));
        }
    }
    if command == "filter.blur.radialBlur" && merged.get("method") != stored.get("method")
        && !merged.get("method").and_then(Value::as_str).is_some_and(|method| ["spin", "zoom"].contains(&method)) {
        return Err("Radial Blur method must be spin or zoom".into());
    }
    Ok(())
}

pub(super) fn validate_lens_input(engine: &Session, command: &str, params: &Value) -> Result<(), String> {
    validate_geometry_input(engine, command, params)?;
    let state = engine.active();
    let layer = state.and_then(|state| params["layer"].as_u64().map(photocraft_engine::doc::LayerId).or(state.active_layer).and_then(|id| state.doc.layer(id)));
    let stored = if command == "layer.smartFilter.setParams" {
        state.and_then(|state|lens_edit_lookup(state,command,params)).map(|(smart,index)|&smart.smart_filters[index])
    } else { None };
    let id = stored.map(|filter| filter.command.as_str()).unwrap_or(command);
    if BASIC_FILTER_EDITS.contains(&id) {
        if engine.disabled_reason(command).is_some() { return Ok(()); }
        if let Some(filter) = stored { return validate_basic_filter_edit(id, &filter.params, &params["params"]); }
    }
    if DETAIL_COMMANDS.contains(&id) {
        if let Some(filter)=stored {return validate_blur_edit(id,&filter.params,&params["params"]);}
    }
    if id == "filter.cameraRaw" && stored.is_some() {
        let stored = &stored.unwrap().params;
        let mut merged = stored.clone();
        let incoming = params["params"].as_object().ok_or("Camera Raw settings must be an object")?;
        merged.as_object_mut().ok_or("Stored Camera Raw settings are not an object")?.extend(incoming.clone());
        let original = photocraft_engine::lens_cmds::raw_params(id, stored).map_err(|error| error.to_string())?;
        let edited = photocraft_engine::lens_cmds::raw_params(id, &merged).map_err(|error| error.to_string())?;
        edited.validate_changes(&original)?;
        fn finite(value: &Value) -> bool {
            match value { Value::Null => false, Value::Array(items) => items.iter().all(finite), Value::Object(items) => items.values().all(finite), _ => true }
        }
        // Serde represents nonfinite native f32 values as null. Check changed known fields,
        // preserving untouched legacy data and unrelated unknown JSON.
        let native = serde_json::to_value(&edited).map_err(|error| error.to_string())?;
        for (key, value) in native.as_object().ok_or("Invalid Camera Raw settings")? {
            if merged.get(key) != stored.get(key) && !finite(value) {
                return Err("Camera Raw numeric settings must remain finite at native precision".into());
            }
        }
        return Ok(());
    }
    if !["filter.lensCorrection", "filter.adaptiveWideAngle"].contains(&id) { return Ok(()); }
    let settings = if let Some(filter) = stored {
        let mut merged = filter.params.as_object().ok_or("Stored lens settings are not an object")?.clone();
        merged.extend(params["params"].as_object().ok_or("Lens settings must be an object")?.clone());
        Value::Object(merged)
    } else { params.clone() };
    if !settings.is_object() { return Err("Invalid lens filter settings".into()); }
    let changed = |key: &str| stored.is_none_or(|filter| filter.params.get(key) != settings.get(key));
    if stored.is_some() {
        for key in ["focalLength","distortion","redCyan","blueYellow","vignetteAmount","vignetteMidpoint","vertical","horizontal","angle","scale","cropFactor"] {
            if changed(key) && settings.get(key).is_some_and(|value| !value.as_f64().is_some_and(f64::is_finite)) { return Err(format!("Lens {key} must be a finite number")); }
        }
        for key in ["autoScale","correctDistortion","correctVignette","correctCA"] {
            if changed(key) && settings.get(key).is_some_and(|value| !value.is_boolean()) { return Err(format!("Lens {key} must be a Boolean")); }
        }
    }
    let point = |value: &Value| value.as_array().is_some_and(|point| point.len() == 2 && point.iter().all(|coordinate| coordinate.as_f64().is_some_and(f64::is_finite)));
    let line = |a: &Value, b: &Value| point(a) && point(b) && (a[0].as_f64() != b[0].as_f64() || a[1].as_f64() != b[1].as_f64());
    if id == "filter.lensCorrection" {
        if let Some(straighten) = settings.get("straighten").filter(|value| !(stored.is_some() && value.is_null())).filter(|_| changed("straighten")) {
            if !straighten.as_array().is_some_and(|points| points.len() == 2 && line(&points[0], &points[1])) { return Err("Lens straightening needs two distinct finite pixel-space endpoints".into()); }
        }
    } else {
        if let Some(constraints) = settings.get("constraints").filter(|_| changed("constraints")) {
            if !constraints.as_array().is_some_and(|constraints| constraints.len() <= 128 && constraints.iter().all(|constraint| line(&constraint["a"], &constraint["b"]) && constraint.get("orientation").is_none_or(|orientation| ["free", "horizontal", "vertical"].contains(&orientation.as_str().unwrap_or(""))))) {
                return Err("Wide-angle correction needs at most 128 distinct finite line constraints".into());
            }
        }
        let interpolation = settings.get("interpolation").and_then(Value::as_str).unwrap_or("bicubic");
        if !["nearest", "bilinear", "bicubic"].contains(&interpolation) { return Err("Unknown wide-angle interpolation".into()); }
        // The pinned smart-filter renderer replays WideAngle with bicubic interpolation.
        if interpolation != "bicubic" && layer.is_some_and(|layer| matches!(layer.content, photocraft_engine::doc::LayerContent::Smart(_))) {
            return Err("Adaptive Wide Angle on Smart Objects requires bicubic interpolation".into());
        }
    }
    Ok(())
}
pub(super) fn render_with_color(state:&DocState,color:&super::color_views::Snapshot,command:&str,params:Value,selection_view:Option<&str>)->Result<PhotoViewPreview,String>{Ok(render_internal(state,Some(color),command,params,selection_view,None)?.preview)}
pub(super) fn render_with_color_regions(state:&DocState,color:&super::color_views::Snapshot,command:&str,params:Value,selection_view:Option<&str>,regions:Option<&[PreviewRegion]>)->Result<PreviewWithRegions,String>{render_internal(state,Some(color),command,params,selection_view,regions)}
fn render_internal(state:&DocState,color:Option<&super::color_views::Snapshot>,command:&str,params:Value,selection_view:Option<&str>,regions:Option<&[PreviewRegion]>)->Result<PreviewWithRegions,String>{
    render_using_cache(state,color,command,params,selection_view,regions,None)
}
pub(super) fn render_controlled_with_color_regions(owner:&str,version:&str,state:&DocState,color:&super::color_views::Snapshot,command:&str,params:Value,selection_view:Option<&str>,regions:Option<&[PreviewRegion]>,control:&super::preview_requests::Token)->Result<PreviewWithRegions,String>{
    render_cached_with_control(owner,version,state,color,command,params,selection_view,regions,Some(control),None,None)
}
/// Match Color reads its statistics from a second document, which sits beside the image as document 1 for the preview only.
pub(super) fn render_controlled_with_source(owner:&str,version:&str,state:&DocState,color:&super::color_views::Snapshot,command:&str,params:Value,selection_view:Option<&str>,regions:Option<&[PreviewRegion]>,control:&super::preview_requests::Token,source:Option<photocraft_engine::doc::Document>)->Result<PreviewWithRegions,String>{
    render_cached_with_control(owner,version,state,color,command,params,selection_view,regions,Some(control),None,source)
}
pub(super) fn render_repeat(owner:&str,version:&str,state:&DocState,color:&super::color_views::Snapshot,invocation:super::repeat::Invocation,selection_view:Option<&str>,regions:Option<&[PreviewRegion]>,control:&super::preview_requests::Token)->Result<PreviewWithRegions,String>{
    let command=invocation.command.clone();let params=invocation.params.clone();
    render_cached_with_control(owner,version,state,color,&command,params,selection_view,regions,Some(control),Some(invocation),None)
}
fn render_cached_with_control(owner:&str,version:&str,state:&DocState,color:&super::color_views::Snapshot,command:&str,params:Value,selection_view:Option<&str>,regions:Option<&[PreviewRegion]>,control:Option<&super::preview_requests::Token>,repeat:Option<super::repeat::Invocation>,source:Option<photocraft_engine::doc::Document>)->Result<PreviewWithRegions,String>{
    use std::sync::{Mutex, OnceLock};
    static CACHE: OnceLock<Mutex<completed_cache::Cache>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(completed_cache::Cache::default()));
    render_using_cache_repeat(state,Some(color),command,params,selection_view,regions,Some(completed_cache::Request{owner,version,cache,control}),repeat,source)
}
fn render_using_cache(state:&DocState,color:Option<&super::color_views::Snapshot>,command:&str,params:Value,selection_view:Option<&str>,regions:Option<&[PreviewRegion]>,cache:Option<completed_cache::Request<'_>>)->Result<PreviewWithRegions,String>{
    render_using_cache_repeat(state,color,command,params,selection_view,regions,cache,None,None)
}
fn render_using_cache_repeat(state:&DocState,color:Option<&super::color_views::Snapshot>,command:&str,params:Value,selection_view:Option<&str>,regions:Option<&[PreviewRegion]>,cache:Option<completed_cache::Request<'_>>,repeat:Option<super::repeat::Invocation>,source:Option<photocraft_engine::doc::Document>)->Result<PreviewWithRegions,String>{
    let control=cache.as_ref().and_then(|request|request.control);
    if let Some(control)=control {control.check()?;}
    let selection = super::selection_preview::COMMANDS.contains(&command);
    if selection_view.is_some() && !selection { return Err("Selection views are available only for selection previews".into()); }
    let selection_view = if selection { Some(selection_view.unwrap_or("mask")) } else { None };
    if let Some(view) = selection_view { super::selection_preview::validate(view)?; }
    let adjustment = ["image.adjustments.", "layer.newAdjustmentLayer."]
        .iter()
        .filter_map(|prefix| command.strip_prefix(prefix))
        .any(|kind| ADJUSTMENTS.contains(&kind) || PIXEL_ADJUSTMENTS.contains(&kind));
    let pixel_filter = photocraft_engine::filters::params_for(command, &params).is_some();
    let edited_filter = smart_filter_edit(state,command,&params).map(|(smart,index)|&smart.smart_filters[index]);
    let supported_edit = edited_filter.is_some_and(|filter| ["filter.cameraRaw","filter.lensCorrection","filter.adaptiveWideAngle"].contains(&filter.command.as_str())||DETAIL_COMMANDS.contains(&filter.command.as_str())||BASIC_FILTER_EDITS.contains(&filter.command.as_str()));
    if !adjustment && !selection && !pixel_filter && !supported_edit && !super::color_views::COMMANDS.contains(&command)
        && ![
            "filter.cameraRaw",
            "filter.lensCorrection",
            "filter.adaptiveWideAngle",
            "filter.liquify",
            "edit.puppetWarp",
            "edit.perspectiveWarp",
            "image.xdesignPerspectiveCrop",
            "edit.transform.warp",
            "edit.transform",
            "type.edit",
            "type.warpText",
            "gradient.fill.set",
            "gradient.fill.create",
            "layer.newFillLayer.solidColor",
            "layer.setAdjustment",
            "layer.setProps",
            "layer.layerStyle.editEffect",
            "layer.layerStyle.blendingOptions",
            "layer.layerStyle.globalLight",
            "filter.blur.gaussianBlur",
            "filter.blur.motionBlur",
            "filter.sharpen.unsharpMask",
            "filter.noise.addNoise",
            "filter.pixelate.mosaic",
            "filter.distort.twirl",
            "image.applyImage",
            "image.calculations",
            "select.loadSelection",
            "edit.assignProfile",
            "edit.convertToProfile",
        ]
        .contains(&command)
    {
        return Err("This action does not support a temporary preview".into());
    }
    let mut params = params;
    // A fill layer's Color Picker previews it with the New Layer options it will be made with; the engine's command takes only the colour.
    let fill_props = if command == "layer.newFillLayer.solidColor" { params.as_object_mut().and_then(|params| params.remove("props")) } else { None };
    let detail_command=edited_filter.map(|filter|filter.command.as_str()).filter(|command|DETAIL_COMMANDS.contains(command)).unwrap_or(command);
    validate_regions(detail_command,regions,state.doc.size.width,state.doc.size.height)?;
    let parameter_limit=if super::profiles::COMMANDS.contains(&command)||super::color_views::COMMANDS.contains(&command){super::profiles::PARAMETER_BYTES}else{1024*1024};
    if !params.is_object() || params.to_string().len() > parameter_limit {
        return Err("Invalid preview parameters".into());
    }
    let large = u64::from(state.doc.size.width) * u64::from(state.doc.size.height) > FULL_PREVIEW_PIXELS;
    let reduce = large && reducible(command);
    if large && !reduce && !["image.applyImage", "image.calculations", "select.loadSelection"].contains(&command) {
        return Err(
            "Preview is unavailable for this image size. Apply the edit to render it.".into(),
        );
    }
    let params = lut_params(command, params)?;
    let params = if let Some(view) = selection_view { super::selection_preview::params(command, params, view)? } else { params };
    let ordinary_smart=DETAIL_COMMANDS.contains(&command)&&params["layer"].as_u64().map(photocraft_engine::doc::LayerId).or(state.active_layer)
        .and_then(|id|state.doc.layer(id)).is_some_and(|layer|matches!(layer.content,photocraft_engine::doc::LayerContent::Smart(_)));
    let cache_key = if repeat.is_none() && DETAIL_COMMANDS.contains(&command) && !ordinary_smart && !completed_cache::has_linked_target(state,&params) {
        cache.as_ref().zip(color).map(|(cache,color)| completed_cache::Key::new(cache.owner,cache.version,state,color,command,&params)).transpose()?
    } else { None };
    if let Some((cache,key)) = cache.as_ref().zip(cache_key.as_ref()) {
        let completed = cache.cache.lock().map_err(|_| "Image preview cache needs to be restarted")?.get(key,std::time::Instant::now());
        if let Some(completed) = completed {
            let filtered_color=color.ok_or("No preview color view")?.render(&completed.doc)?;
            if let Some(control)=control {control.check()?;}
            let rendered=with_regions(state,color,&completed.doc,&completed.channels,&filtered_color,completed.preview.clone(),regions)?;
            if let Some(control)=control {control.check()?;}
            return Ok(rendered);
        }
    }
    let mut engine = Session::new();
    engine.add_document((*state.doc).clone(), None);
    let mut draft = super::snapshot::capture(state,super::snapshot::HistoryPolicy::Discard);
    if reduce { draft.doc = reduced_copy(&state.doc)?; }
    *engine.active_mut().ok_or("No preview image")? = draft;
    if let Some(color)=color{color.install(&mut engine)?;}
    if edited_filter.is_some_and(|filter| BASIC_FILTER_EDITS.contains(&filter.command.as_str())) {
        validate_lens_input(&engine, command, &params)?;
    }
    super::linked_replay::prepare_preview(&mut engine,command,&params)?;
    #[cfg(test)]
    if let Some(cache)=&cache {cache.cache.lock().unwrap().executions+=1;}
    let edit_input = filter_edit_input(&engine, command, &params,regions)?;
    if let Some(source)=source {engine.add_document(source,None);engine.set_active(0);}
    let mut result = if let Some(invocation)=repeat {
        validate_filter_input(command,&params)?;
        if !super::mask_filters::separate(command)||!super::mask_filters::targets_coverage(&engine,&params){validate_lens_input(&engine,command,&params)?;}
        engine.journal=invocation.journal;
        if let Some(control)=control {control.check()?;}
        super::execute_view_command(&mut engine,"filter.lastFilter",invocation.outer)?
    }else{controlled_jobs::execute(&mut engine,command,params,control)?};
    if let Some(props) = fill_props { controlled_jobs::execute(&mut engine, "layer.setProps", props, control)?; }
    if let Some(control)=control {control.check()?;}
    let active = engine.active().ok_or("No preview image")?;
    let filtered_color=super::display::View::new(&engine.color,&active.doc)?;
    if let Some(control)=control {control.check()?;}
    #[cfg(test)]
    if let Some(cache)=&cache {cache.cache.lock().unwrap().base_encodes+=1;}
    let mut preview = if let Some(view) = selection_view { super::selection_preview::render_with_color(active, view,Some(&filtered_color))? } else if command == "select.loadSelection"
        || command == "image.calculations" && result.get("selected").is_some()
    {
        super::channels::selection_preview(active)?
    } else {
        let channels=if super::profiles::COMMANDS.contains(&command)||super::color_views::COMMANDS.contains(&command) { Default::default() } else { active.channel_view.clone() };
        super::render_color_view_preview(&active.doc, &channels,Some(&filtered_color))?
    };
    let has_edit_input=edit_input.is_some();
    if let Some((key,input)) = edit_input {
        result.as_object_mut().ok_or("Invalid filter preview result")?.insert(key.into(), input);
    }
    preview.result = Some(result);
    if has_edit_input {combined_preview_bytes(&preview)?;}
    let rendered = with_regions(state,color,&active.doc,&active.channel_view,&filtered_color,preview,regions)?;
    if let Some(control)=control {control.check()?;}
    if let Some((cache,key)) = cache.as_ref().zip(cache_key) {
        let completed = completed_cache::Completed{doc:active.doc.clone(),channels:active.channel_view.clone(),preview:rendered.preview.clone()};
        let publish=|| {
            cache.cache.lock().map_err(|_| "Image preview cache needs to be restarted")?.insert(key,completed,std::time::Instant::now());
            Ok(())
        };
        if let Some(control)=control {control.publish(publish)?;}else{publish()?;}
    }
    Ok(rendered)
}

fn with_regions(state:&DocState,source_color:Option<&super::color_views::Snapshot>,doc:&photocraft_engine::doc::Document,channels:&photocraft_engine::channel_cmds::ChannelView,color:&super::display::View,preview:PhotoViewPreview,regions:Option<&[PreviewRegion]>)->Result<PreviewWithRegions,String>{
    let Some(regions) = regions.filter(|regions| !regions.is_empty()) else { return Ok(PreviewWithRegions { preview, tiles: None, original_tiles: None }); };
    let original_color = source_color.map(|color| color.render(&state.doc)).transpose()?;
    let mut encoded_bytes = combined_preview_bytes(&preview)?;
    let mut original_tiles = Vec::with_capacity(regions.len());
    let mut tiles = Vec::with_capacity(regions.len());
    for region in regions {
        let original = super::tiles::render_color_region(&state.doc,&state.channel_view,original_color.as_deref(),region.x,region.y,region.width,region.height,region.scale)?;
        let filtered = super::tiles::render_color_region(doc,channels,Some(color),region.x,region.y,region.width,region.height,region.scale)?;
        let original = detail_tile(original)?; let filtered = detail_tile(filtered)?;
        encoded_bytes = add_preview_tile_bytes(encoded_bytes,&original.png)?;
        encoded_bytes = add_preview_tile_bytes(encoded_bytes,&filtered.png)?;
        original_tiles.push(original); tiles.push(filtered);
    }
    Ok(PreviewWithRegions { preview, tiles: Some(tiles), original_tiles: Some(original_tiles) })
}

#[cfg(test)]
mod tests {
    fn repeat_fixture(depth:u32,route:&str)->Session{
        let mut engine=ordinary_filter_fixture(depth);
        match route {
            "mask"=>{engine.execute("layer.layerMask.revealAll",json!({})).unwrap();engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();},
            "alpha"=>{engine.execute("channel.new",json!({"name":"Repeat alpha","fill":"black"})).unwrap();engine.execute("channel.target",json!({"channel":0})).unwrap();},
            "quickMask"=>{engine.execute("select.rect",json!({"x":4,"y":4,"width":12,"height":12})).unwrap();engine.execute("select.editInQuickMaskMode",json!({})).unwrap();},
            _=>{}
        }
        engine.edit("Repeat nonuniform coverage",|doc,_|{
            let area=photocraft_engine::doc::Rect::from_xywh(5,5,8,8);
            let coverage=(0..64).map(|i|(i%7) as f32/6.).collect::<Vec<_>>();
            match route {
                "mask"=>{let layer=doc.layers[0].id;doc.layer_mut(layer).unwrap().mask.as_mut().unwrap().surface.write_region(area,&coverage);},
                "alpha"=>doc.channels[0].surface.write_region(area,&coverage),
                "quickMask"=>doc.quick_mask.as_mut().unwrap().surface.write_region(area,&coverage),
                _=>{}
            };Ok(())
        }).unwrap();engine
    }
    fn assert_repeat_preview(mut engine:Session,label:&str){
        let state=engine.active().unwrap();let source=state.doc.clone();let history=state.history.entries().to_vec();let journal=engine.journal.clone();let channels=state.channel_view.clone();
        let color=super::super::color_views::Snapshot::capture(&engine).unwrap();let invocation=super::super::repeat::resolve(&engine,&json!({})).unwrap();
        assert!(invocation.journal.len()<=2);
        let owner=format!("repeat-parity-{label}");let lease=super::super::preview_requests::acquire(&owner,None).unwrap();
        let preview=render_repeat(&owner,"v1",state,&color,invocation,None,None,lease.token()).unwrap();
        assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries());assert_eq!(journal,engine.journal);assert_eq!(channels,engine.active().unwrap().channel_view);
        super::super::execute_view_command(&mut engine,"filter.lastFilter",json!({})).unwrap();let active=engine.active().unwrap();
        assert_eq!(preview.preview.png,render_view_preview(&active.doc,&active.channel_view).unwrap().png,"{label}");
        assert_ne!(&*source,&*active.doc,"{label} must perform a real repeat edit");
    }
    #[test]
    fn repeat_preview_parity_ordinary_mask_alpha_quickmask_separate_and_no_layer(){
        let _guard = crate::xdesign_photo::feedback_serial();
        for depth in [8,16,32] {for route in ["pixels","mask","alpha","quickMask"] {for separate in [false,true] {
            let mut engine=repeat_fixture(depth,route);
            let (command,params)=if separate {("filter.cameraRaw",json!({"exposure":-1.5}))}else{("filter.blur.gaussianBlur",json!({"radius":2}))};
            // Native Repeat only selects ordinary filters for pixels, even after a separate handler.
            if route=="pixels"&&separate{engine.execute("filter.blur.gaussianBlur",json!({"radius":1})).unwrap();}
            super::super::execute_view_command(&mut engine,command,params).unwrap();
            engine.execute("select.all",json!({})).unwrap();
            engine.execute("select.deselect",json!({})).unwrap();
            assert_repeat_preview(engine,&format!("{depth}-{route}-{separate}"));
        }}}
        for route in ["alpha","quickMask"] {
            let mut engine=repeat_fixture(16,route);engine.active_mut().unwrap().active_layer=None;
            super::super::execute_view_command(&mut engine,"filter.cameraRaw",json!({"exposure":-1})).unwrap();
            assert_repeat_preview(engine,&format!("no-layer-{route}"));
        }
    }
    #[test]
    fn repeat_preview_saved_target_wins_over_current_view_and_two_candidates_keep_order(){
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=repeat_fixture(8,"alpha");
        super::super::execute_view_command(&mut engine,"filter.blur.gaussianBlur",json!({"radius":1,"target":{"channel":0}})).unwrap();
        super::super::execute_view_command(&mut engine,"filter.cameraRaw",json!({"exposure":-1,"target":{"channel":0}})).unwrap();
        engine.execute("channel.target",json!({"channel":"composite"})).unwrap();
        let invocation=super::super::repeat::resolve(&engine,&json!({})).unwrap();
        assert_eq!(invocation.command,"filter.cameraRaw");assert_eq!(invocation.params["target"],json!({"channel":0}));
        assert_eq!(invocation.journal.iter().map(|(id,_)|id.as_str()).collect::<Vec<_>>(),["filter.blur.gaussianBlur","filter.cameraRaw"]);
        assert_repeat_preview(engine,"saved-alpha");
    }
    #[test]
    fn repeat_preview_invalid_saved_lens_and_displacement_and_prestart_cancel_keep_source(){
        let _guard = crate::xdesign_photo::feedback_serial();
        for (command,params) in [
            ("filter.lensCorrection",json!({"straighten":[[1,2],[1,2]],"target":"mask"})),
            ("filter.distort.displace",json!({"mapPath":"/no/such/repeat-map.png"})),
        ] {
            let mut engine=repeat_fixture(8,"mask");engine.journal.push((command.into(),params));
            let state=engine.active().unwrap();let source=state.doc.clone();let history=state.history.entries().to_vec();let journal=engine.journal.clone();
            let invocation=super::super::repeat::resolve(&engine,&json!({})).unwrap();let color=super::super::color_views::Snapshot::capture(&engine).unwrap();let owner=format!("repeat-invalid-{command}");let lease=super::super::preview_requests::acquire(&owner,None).unwrap();
            assert!(render_repeat(&owner,"v1",state,&color,invocation,None,None,lease.token()).is_err());
            assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries());assert_eq!(journal,engine.journal);
        }
        let mut engine=repeat_fixture(8,"pixels");engine.execute("filter.blur.gaussianBlur",json!({"radius":1})).unwrap();let state=engine.active().unwrap();let source=state.doc.clone();let history=state.history.entries().to_vec();let journal=engine.journal.clone();
        let invocation=super::super::repeat::resolve(&engine,&json!({})).unwrap();let color=super::super::color_views::Snapshot::capture(&engine).unwrap();let owner="repeat-prestart-cancel";let request=ulid::Ulid::new().to_string();
        super::super::preview_requests::cancel(owner,&request).unwrap();let lease=super::super::preview_requests::acquire(owner,Some(&request)).unwrap();
        assert!(render_repeat(owner,"v1",state,&color,invocation,None,None,lease.token()).err().unwrap().contains("canceled"));
        assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries());assert_eq!(journal,engine.journal);
    }

    #[test]
    fn repeat_preview_preserves_native_fallback_instead_of_direct_host_mask_routing(){
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=ordinary_filter_fixture(8);
        super::super::execute_view_command(&mut engine,"layer.layerMask.revealAll",serde_json::json!({})).unwrap();
        engine.execute("filter.blur.gaussianBlur",serde_json::json!({"radius":2})).unwrap();
        engine.edit("Mask fixture",|doc,_|{let layer=doc.layers[0].id;doc.layer_mut(layer).unwrap().mask.as_mut().unwrap().surface.write_region(photocraft_engine::doc::Rect::from_xywh(5,5,8,8),&vec![0.;64]);Ok(())}).unwrap();
        engine.execute("view.layerMask",serde_json::json!({"mode":"gray"})).unwrap();
        engine.journal.push(("filter.cameraRaw".into(),serde_json::json!({"target":"pixels","exposure":-1})));
        let state=engine.active().unwrap();let source=state.doc.clone();let history=state.history.entries().to_vec();let journal=engine.journal.clone();
        let invocation=super::super::repeat::resolve(&engine,&serde_json::json!({})).unwrap();
        assert_eq!(invocation.command,"filter.blur.gaussianBlur");assert_eq!(invocation.journal.len(),2);
        let color=super::super::color_views::Snapshot::capture(&engine).unwrap();
        let lease=super::super::preview_requests::acquire("repeat-preview-parity",None).unwrap();
        let rendered=render_repeat("repeat-preview-parity","v1",state,&color,invocation,None,None,lease.token()).unwrap();
        assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries());assert_eq!(journal,engine.journal);
        let direct=render(engine.active().unwrap(),"filter.blur.gaussianBlur",serde_json::json!({"radius":2})).unwrap();
        super::super::execute_view_command(&mut engine,"filter.lastFilter",serde_json::json!({})).unwrap();
        assert_ne!(direct.png,rendered.preview.png);
        assert_eq!(rendered.preview.png,render_view_preview(&engine.active().unwrap().doc,&engine.active().unwrap().channel_view).unwrap().png);
    }

    #[test]
    fn color_profiles_previews_match_native_icc_composites_and_keep_source_channels_history() {
        use super::*;use serde_json::json;
        for depth in [8,16,32] {
            let mut engine=Session::new();engine.execute("file.new",json!({"width":24,"height":16,"depth":depth,"background":"#50a0c080"})).unwrap();
            engine.execute("channel.target",json!({"channel":"red"})).unwrap();
            engine.execute("channel.setVisible",json!({"channel":"green","visible":false})).unwrap();
            let state=engine.active().unwrap();let doc=state.doc.clone();let channels=state.channel_view.clone();let past=state.history.past_len();
            for (command,params) in [("edit.assignProfile",json!({"profile":"display-p3"})),("edit.convertToProfile",json!({"profile":"display-p3","intent":"perceptual","bpc":false,"dither":false})),("edit.convertToProfile",json!({"profile":"sgray","dither":false})),("edit.convertToProfile",json!({"profile":"lab-d50","dither":false})),("edit.convertToProfile",json!({"profile":"coated-cmyk","dither":false}))] {
                let mut expected=Session::new();expected.add_document((*doc).clone(),None);*expected.active_mut().unwrap()=state.clone();let result=expected.execute(command,params.clone()).unwrap();
                let preview=render(state,command,params).unwrap();assert_eq!(preview.png,render_view_preview(&expected.active().unwrap().doc,&Default::default()).unwrap().png);assert_eq!(preview.result,Some(result));
                assert!(std::sync::Arc::ptr_eq(&doc,&state.doc));assert_eq!(state.channel_view,channels);assert_eq!(state.history.past_len(),past);
            }
            assert!(render(state,"edit.profileInfo",json!({})).is_err());
        }
    }
    use super::*;
    use base64::Engine;
    use serde_json::json;
    fn selection_fixture(depth:u32)->Session {
        let mut engine=Session::new();engine.execute("file.new",json!({"width":64,"height":48,"depth":depth})).unwrap();
        engine.edit("Selection workspace fixture",|doc,_|{let surface=doc.layers[0].surface_mut().unwrap();let mut data=Vec::new();for y in 0..48{for x in 0..64{let edge=1.0/(1.0+((x as f32-31.5)/1.8).exp());let noise=((x*13+y*7)%9) as f32*0.002;data.extend_from_slice(&[0.2+0.6*edge+noise,0.3+0.25*edge,0.75-0.5*edge+noise,1.0]);}}surface.write_region(photocraft_engine::doc::Rect::new(0,0,64,48),&data);Ok(())}).unwrap();engine.execute("select.rect",json!({"x":0,"y":0,"width":32,"height":48})).unwrap();engine
    }
    fn isolated_selection(state:&DocState,command:&str,params:Value)->Session {
        let mut engine=Session::new();engine.add_document((*state.doc).clone(),None);let mut copy=state.clone();copy.history=Default::default();*engine.active_mut().unwrap()=copy;super::super::execute_view_command(&mut engine,command,params).unwrap();engine
    }
    #[test]
    fn selection_workspaces_refine_previews_match_native_edges_and_every_output() {
        for depth in [8,16,32]{let engine=selection_fixture(depth);let state=engine.active().unwrap();let before=state.doc.clone();let history=state.history.entries().to_vec();
            for output in ["selection","layerMask","newLayer","newLayerWithMask"]{for decontaminate in [false,true]{let params=json!({"radius":2.5,"smartRadius":true,"smooth":12.25,"feather":1.5,"contrast":20,"shiftEdge":-12,"sampleAllLayers":true,"decontaminate":decontaminate,"amount":42,"output":output});
                let actual=isolated_selection(state,"select.refineEdge",params.clone());let result=render_with_selection_view(state,"select.refineEdge",params.clone(),Some("result")).unwrap();assert_eq!(result.png,render_view_preview(&actual.active().unwrap().doc,&Default::default()).unwrap().png,"{depth} {output} {decontaminate} result");assert_eq!(result.result.as_ref().unwrap()["output"],if decontaminate&&["selection","layerMask"].contains(&output){"newLayerWithMask"}else{output});
                let mut edge_params=params.clone();edge_params["output"]=json!("selection");edge_params["decontaminate"]=json!(false);let edges=isolated_selection(state,"select.refineEdge",edge_params);
                for view in ["mask","overlay","black","white","transparent"]{let preview=render_with_selection_view(state,"select.refineEdge",params.clone(),Some(view)).unwrap();assert_eq!(preview.png,super::super::selection_preview::render(edges.active().unwrap(),view).unwrap().png,"{depth} {output} {decontaminate} {view}");}
                assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries());
            }}
        }
    }
    #[test]
    fn selection_workspaces_focus_color_samples_and_presets_preview_native_coverage() {
        for depth in [8,16,32]{let engine=selection_fixture(depth);let state=engine.active().unwrap();let before=state.doc.clone();let history=state.history.entries().to_vec();
            for (command,params) in [("select.focusArea",json!({"range":0.375,"noise":0.125,"sampleAllLayers":true,"mode":"intersect"})),("select.colorRange",json!({"points":[[16,16],[32,16]],"subtractPoints":[[48,16]],"localized":true,"range":25,"fuzziness":50,"sampleAllLayers":true,"mode":"replace"})),("select.colorRange",json!({"colors":[[0.123456,1.2,-0.1,0.75]],"fuzziness":150,"sampleAllLayers":false,"mode":"subtract"})),("select.colorRange",json!({"select":"midtones","tonalRange":[70,90],"fuzziness":15,"invert":true,"sampleAllLayers":true,"mode":"add"})),("select.colorRange",json!({"select":"blues","sampleAllLayers":true,"mode":"replace"})),("select.colorRange",json!({"select":"outOfGamut","sampleAllLayers":true,"mode":"replace"}))]{let actual=isolated_selection(state,command,params.clone());let preview=render(state,command,params.clone()).unwrap();assert_eq!(preview.png,super::super::selection_preview::render(actual.active().unwrap(),"mask").unwrap().png,"{depth} {command} {params}");assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries());}
        }
    }
    #[test]
    fn selection_workspaces_reject_invalid_views_parameters_and_preview_size_without_mutation() {
        let mut engine=selection_fixture(16);let state=engine.active().unwrap();let before=state.doc.clone();let history=state.history.entries().to_vec();
        for result in [render_with_selection_view(state,"select.refineEdge",json!({}),Some("unknown")),render_with_selection_view(state,"filter.cameraRaw",json!({}),Some("mask")),render(state,"select.focusArea",json!([])),render(state,"select.colorRange",json!({"points":[[64,0]]})),render(state,"select.refineEdge",json!({"output":"bad"}))]{assert!(result.is_err());}
        assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries());
        std::sync::Arc::make_mut(&mut engine.active_mut().unwrap().doc).size=photocraft_engine::doc::Size::new(4097,4096);assert!(render(engine.active().unwrap(),"select.focusArea",json!({})).err().unwrap().contains("image size"));
    }
    #[test]
    fn adjustment_previews_match_isolated_alpha_and_layer_mask_views() {
        for target in ["mask", "alpha"] {
            let mut engine = Session::new();
            engine
                .execute(
                    "file.new",
                    json!({"width":24,"height":24,"background":"#4080b0"}),
                )
                .unwrap();
            let mut params = json!({});
            if target == "mask" {
                engine
                    .execute("layer.layerMask.revealAll", json!({}))
                    .unwrap();
                engine
                    .execute("view.layerMask", json!({"mode":"gray"}))
                    .unwrap();
                params["target"] = json!("mask");
            } else {
                engine
                    .execute("channel.new", json!({"name":"Alpha"}))
                    .unwrap();
                engine
                    .execute("channel.target", json!({"channel":0}))
                    .unwrap();
            }
            assert_matches_commit(&mut engine, "image.adjustments.invert", params);
            let visible = render_view_preview(
                &engine.active().unwrap().doc,
                &engine.active().unwrap().channel_view,
            )
            .unwrap();
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(visible.png)
                .unwrap();
            let pixels = photocraft_codecs::decode(&bytes).unwrap();
            assert_eq!(
                pixels.as_u8().unwrap()[0],
                if target == "mask" { 0 } else { 255 }
            );
        }
    }
    fn assert_matches_commit(engine: &mut Session, command: &str, params: Value) {
        let state = engine.active().unwrap();
        let source = state.doc.clone();
        let history = state.history.entries().to_vec();
        let preview = render(state, command, params.clone())
            .unwrap_or_else(|error| panic!("{command}: {error}"));
        assert!(std::sync::Arc::ptr_eq(
            &source,
            &engine.active().unwrap().doc
        ));
        assert_eq!(engine.active().unwrap().history.entries(), history);
        super::super::execute_view_command(engine, command, params).unwrap();
        let committed = render_view_preview(
            &engine.active().unwrap().doc,
            &engine.active().unwrap().channel_view,
        )
        .unwrap();
        assert_eq!(
            preview.png, committed.png,
            "{command} preview differs from the final edit"
        );
    }
    #[test]
    fn free_transform_previews_match_native_group_mask_and_selection_edits() {
        let mut engine = Session::new();
        engine
            .execute("file.new", json!({"width":80,"height":60}))
            .unwrap();
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[20,20,1],[50,35,1]],"size":12,"color":"#4080b0","seed":123}),
            )
            .unwrap();
        engine
            .execute("layer.layerMask.revealAll", json!({}))
            .unwrap();
        engine
            .execute(
                "paint.stroke",
                json!({"target":"mask","points":[[20,20,1]],"size":5,"color":"#000000","seed":123}),
            )
            .unwrap();
        engine
            .execute("select.rect", json!({"x":10,"y":10,"width":50,"height":30}))
            .unwrap();
        assert_matches_commit(
            &mut engine,
            "edit.transform",
            json!({"matrix":[1.2,0.2,-0.2,0.8,4,3],"interpolation":"bilinear"}),
        );
        engine.execute("select.deselect", json!({})).unwrap();
        engine.execute("layer.groupLayers", json!({})).unwrap();
        let state = engine.active().unwrap();
        let id = state.active_layer.unwrap();
        let native = state.doc.layer(id).unwrap();
        assert!(native.is_group());
        assert!(native.surface().is_none());
        let mut described = photocraft_engine::inspect::layer(native);
        super::super::content::describe(native, &state.doc, &mut described, true);
        assert!(described["transformBounds"][2].as_u64().unwrap() > 0);
        assert!(described["transformBounds"][3].as_u64().unwrap() > 0);
        assert_matches_commit(
            &mut engine,
            "edit.transform",
            json!({"layer":id.0,"matrix":[-1,0,0,1,75,2],"interpolation":"bicubic"}),
        );
    }
    #[test]
    fn editable_text_geometry_and_every_warp_preview_match_apply() {
        let mut engine = Session::new();
        engine
            .execute("file.new", json!({"width":240,"height":180}))
            .unwrap();
        let id = engine
            .execute(
                "type.create",
                json!({"text":"Editable text","box":[20,25,170,90],"size":20}),
            )
            .unwrap()["layer"]
            .as_u64()
            .unwrap();
        assert_matches_commit(
            &mut engine,
            "type.edit",
            json!({"layer":id,"box":[30,35,160,100]}),
        );
        for style in [
            "arc",
            "arcLower",
            "arcUpper",
            "arch",
            "bulge",
            "shellLower",
            "shellUpper",
            "flag",
            "wave",
            "fish",
            "rise",
            "fisheye",
            "inflate",
            "squeeze",
            "twist",
            "none",
        ] {
            assert_matches_commit(
                &mut engine,
                "type.warpText",
                json!({"layer":id,"style":style,"bend":-40,"horizontalDistortion":20,"verticalDistortion":-15,"orientation":"vertical"}),
            );
        }
    }
    #[test]
    fn layer_opacity_and_fill_previews_match_apply() {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":24,"height":24})).unwrap();
        engine.execute("paint.stroke", json!({"points":[[12,12,1]],"size":30,"color":"#4080b0","seed":101})).unwrap();
        let layer = engine.active().unwrap().active_layer.unwrap().0;
        assert_matches_commit(&mut engine, "layer.setProps", json!({"layer":layer,"opacity":0.4}));
        assert_matches_commit(&mut engine, "layer.setProps", json!({"layer":layer,"fill":0.25}));
    }
    #[test]
    fn layer_style_slider_previews_match_apply() {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":32,"height":32})).unwrap();
        engine.execute("layer.new.layer", json!({})).unwrap();
        engine.execute("paint.stroke", json!({"points":[[14,14,1]],"size":10,"color":"#4080b0","seed":101})).unwrap();
        engine.execute("layer.layerStyle.dropShadow", json!({"add":true})).unwrap();
        let layer = engine.active().unwrap().active_layer.unwrap().0;
        assert_matches_commit(&mut engine, "layer.layerStyle.editEffect", json!({"layer":layer,"index":0,"path":["distance"],"value":9.0}));
        assert_matches_commit(&mut engine, "layer.layerStyle.globalLight", json!({"layer":layer,"angle":30,"altitude":20}));
        assert_matches_commit(&mut engine, "layer.layerStyle.blendingOptions", json!({"layer":layer,"opacity":40}));
        assert_matches_commit(&mut engine, "layer.layerStyle.blendingOptions", json!({"layer":layer,"blendIf":{"channel":0,"thisLayer":[0,0,200,255]}}));
    }
    #[test]
    fn all_adjustments_preview_native_layer_and_pixel_edits_without_committing() {
        let cases = [
            (
                "brightnessContrast",
                json!({"brightness":-30,"contrast":-70,"legacy":true}),
            ),
            (
                "levels",
                json!({"inBlack":15,"outWhite":230,"red":{"gamma":1.6,"outBlack":12}}),
            ),
            (
                "curves",
                json!({"points":[[0,0],[128,180],[255,255]],"blue":[[0,10],[255,220]]}),
            ),
            ("exposure", json!({"exposure":-1,"offset":0.02,"gamma":1.1})),
            ("vibrance", json!({"vibrance":30,"saturation":15})),
            (
                "hueSaturation",
                json!({"hue":35,"blues":{"hue":-20,"saturation":25,"range":[180,225,255,285]}}),
            ),
            (
                "blackWhite",
                json!({"reds":60,"tint":true,"tintColor":"#ee8844"}),
            ),
            (
                "colorBalance",
                json!({"shadows":[10,20,0],"midtones":[-20,0,10],"highlights":[15,0,-15],"preserveLuminosity":false}),
            ),
            (
                "photoFilter",
                json!({"density":40,"color":"#006dff","preserveLuminosity":false}),
            ),
            (
                "channelMixer",
                json!({"red":[80,20,0,0],"green":[10,70,20,0],"blue":[20,0,70,5]}),
            ),
            (
                "gradientMap",
                json!({"stops":[[0,"#001122"],[0.4,"#aa5500"],[1,"#ffeecc"]],"reverse":true,"dither":true}),
            ),
            (
                "selectiveColor",
                json!({"method":"absolute","blues":[20,0,-20,5],"blacks":[0,0,0,10]}),
            ),
            (
                "colorLookup",
                json!({"lut":"tealOrange","interpolation":"tetrahedral","dither":true}),
            ),
            ("invert", json!({})),
            ("posterize", json!({"levels":5})),
            ("threshold", json!({"level":110})),
        ];
        for (kind, params) in cases {
            for route in [
                "layer.newAdjustmentLayer",
                "image.adjustments",
                "layer.setAdjustment",
                "mask",
                "alpha",
                "quickMask",
            ] {
                let mut engine = Session::new();
                engine
                    .execute("file.new", json!({"width":24,"height":24}))
                    .unwrap();
                engine
                    .execute(
                        "paint.stroke",
                        json!({"points":[[12,12,1]],"size":30,"color":"#4080b0","seed":101}),
                    )
                    .unwrap();
                let command = if route == "mask" {
                    engine
                        .execute("layer.layerMask.revealAll", json!({}))
                        .unwrap();
                    engine
                        .execute("view.layerMask", json!({"mode":"gray"}))
                        .unwrap();
                    format!("image.adjustments.{kind}")
                } else if route == "alpha" {
                    engine
                        .execute("channel.new", json!({"name":"Alpha"}))
                        .unwrap();
                    engine
                        .execute("channel.target", json!({"channel":0}))
                        .unwrap();
                    format!("image.adjustments.{kind}")
                } else if route == "quickMask" {
                    engine
                        .execute("select.editInQuickMaskMode", json!({}))
                        .unwrap();
                    format!("image.adjustments.{kind}")
                } else if route == "layer.setAdjustment" {
                    engine
                        .execute(&format!("layer.newAdjustmentLayer.{kind}"), json!({}))
                        .unwrap();
                    route.to_owned()
                } else {
                    format!("{route}.{kind}")
                };
                assert_matches_commit(&mut engine, &command, params.clone());
            }
        }
    }
    #[test]
    fn imported_lookup_previews_preserve_tables_and_explicit_reset_removes_them() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":16,"height":16,"background":"white"}),
            )
            .unwrap();
        engine
            .execute(
                "layer.newAdjustmentLayer.colorLookup",
                json!({"lut":"warm"}),
            )
            .unwrap();
        let layer = engine.active().unwrap().active_layer.unwrap();
        assert_matches_commit(
            &mut engine,
            "layer.setAdjustment",
            json!({"layer":layer.0,"interpolation":"tetrahedral","dither":true}),
        );
        let photocraft_engine::doc::LayerContent::Adjustment(
            photocraft_engine::doc::Adjustment::ColorLookup { name, lut, .. },
        ) = &engine.active().unwrap().doc.layer(layer).unwrap().content
        else {
            panic!("No lookup layer")
        };
        assert!(!name.is_empty() && lut.is_some());
        assert_matches_commit(
            &mut engine,
            "layer.setAdjustment",
            json!({"layer":layer.0,"lut":"none"}),
        );
        let photocraft_engine::doc::LayerContent::Adjustment(
            photocraft_engine::doc::Adjustment::ColorLookup { lut, .. },
        ) = &engine.active().unwrap().doc.layer(layer).unwrap().content
        else {
            panic!("No lookup layer")
        };
        assert!(lut.is_none());
    }
    #[test]
    fn lookup_file_reads_are_bounded_and_embedded_for_both_preview_and_apply() {
        let dir = std::env::temp_dir().join(format!("xdesign-lut-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("custom.cube");
        std::fs::write(
            &path,
            "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n",
        )
        .unwrap();
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":16,"height":16,"background":"white"}),
            )
            .unwrap();
        assert_matches_commit(
            &mut engine,
            "layer.newAdjustmentLayer.colorLookup",
            json!({"file":path,"interpolation":"tetrahedral"}),
        );
        let layer = engine.active().unwrap().active_layer.unwrap();
        let photocraft_engine::doc::LayerContent::Adjustment(
            photocraft_engine::doc::Adjustment::ColorLookup {
                name, size, lut, ..
            },
        ) = &engine.active().unwrap().doc.layer(layer).unwrap().content
        else {
            panic!("No lookup layer")
        };
        assert_eq!(name, "custom.cube");
        assert_eq!(*size, 2);
        assert!(lut.is_some());
        std::fs::File::create(&path)
            .unwrap()
            .set_len(64 * 1024 * 1024 + 1)
            .unwrap();
        assert!(render(
            engine.active().unwrap(),
            "layer.setAdjustment",
            json!({"file":path})
        )
        .err()
        .unwrap()
        .contains("64MB"));
        assert!(lut_params("layer.setAdjustment", json!({"file":dir})).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn common_filter_previews_use_the_same_native_pixels_as_apply() {
        for (command, params) in [
            ("filter.blur.gaussianBlur", json!({"radius":2})),
            ("filter.blur.motionBlur", json!({"angle":45,"distance":8})),
            (
                "filter.sharpen.unsharpMask",
                json!({"amount":50,"radius":1,"threshold":0}),
            ),
            ("filter.noise.addNoise", json!({"amount":10})),
            ("filter.pixelate.mosaic", json!({"cellSize":4})),
            ("filter.distort.twirl", json!({"angle":45})),
        ] {
            let mut engine = Session::new();
            engine
                .execute("file.new", json!({"width":24,"height":24}))
                .unwrap();
            engine
                .execute(
                    "paint.stroke",
                    json!({"points":[[12,12,1]],"size":10,"color":"#4080b0","seed":101}),
                )
                .unwrap();
            assert_matches_commit(&mut engine, command, params);
        }
    }

    pub(super) fn ordinary_filter_fixture(depth: u32) -> Session {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":32,"height":24,"depth":depth})).unwrap();
        engine.edit("Filter test image", |doc, _| {
            let mut data = Vec::new();
            for y in 0..24 { for x in 0..32 {
                if x > 24 && y > 18 { data.extend_from_slice(&[1.0,0.0,0.0,0.8]); continue; }
                let texture = ((x + y) % 2) as f32 * 0.08;
                data.extend_from_slice(&[
                    0.15 + 0.4 * x as f32 / 31.0 + texture + if x > 16 { 0.1 } else { 0.0 },
                    0.2 + 0.35 * y as f32 / 23.0 + texture,
                    0.15 + 0.3 * (x + y) as f32 / 54.0 + texture,
                    0.7 + (x % 5) as f32 / 20.0,
                ]);
            } }
            doc.layers[0].surface_mut().unwrap().write_region(photocraft_engine::doc::Rect::new(0,0,32,24), &data);
            Ok(())
        }).unwrap();
        engine
    }

    pub(super) fn reference_region_pixels(doc: &photocraft_engine::doc::Document, channels: &photocraft_engine::channel_cmds::ChannelView, color: &super::super::display::View, region: PreviewRegion) -> Vec<u8> {
        use photocraft_engine::doc::Rect;
        let full_rect = Rect::from_xywh(0, 0, doc.size.width, doc.size.height);
        let composite = photocraft_compose::render(doc, full_rect);
        let full = super::super::view::present(doc, channels, composite, full_rect, 1);
        let mut reduced = photocraft_compose::Buffer::transparent(Rect::from_xywh(0, 0, region.width.div_ceil(region.scale), region.height.div_ceil(region.scale)));
        for oy in 0..region.height.div_ceil(region.scale) { for ox in 0..region.width.div_ceil(region.scale) {
            let mut sum = [0f32; 4]; let mut count = 0;
            for y in oy * region.scale..((oy + 1) * region.scale).min(region.height) { for x in ox * region.scale..((ox + 1) * region.scale).min(region.width) {
                let pixel = full.px[((region.y + y) * doc.size.width + region.x + x) as usize];
                let alpha = pixel[3].clamp(0.0, 1.0);
                for c in 0..3 { sum[c] += pixel[c] * alpha; } sum[3] += alpha; count += 1;
            }}
            if sum[3] > 0.0 { for c in 0..3 { sum[c] /= sum[3]; } sum[3] /= count as f32; }
            reduced.px[(oy * region.width.div_ceil(region.scale) + ox) as usize] = sum;
        }}
        if channels.is_plain(doc) { color.rgba(&reduced).pixels } else { reduced.to_rgba8().pixels }
    }

    #[test]
    fn blur_gallery_detail_regions_match_filtered_and_original_native_pixels_at_scale_one_and_two() {
        let fixtures = [
            ("filter.blurGallery.fieldBlur", json!({"pins":[{"x":0.1,"y":0.2,"blur":3},{"x":0.8,"y":0.7,"blur":15}]})),
            ("filter.blurGallery.irisBlur", json!({"pins":[{"x":0.2,"y":0.3,"radiusX":0.2,"radiusY":0.3,"blur":8},{"x":0.8,"y":0.7,"radiusX":0.15,"radiusY":0.2,"blur":15}]})),
            ("filter.blurGallery.spinBlur", json!({"pins":[{"x":0.3,"y":0.4,"radiusX":0.3,"radiusY":0.4,"blurAngle":45},{"x":0.7,"y":0.6,"radiusX":0.2,"radiusY":0.3,"blurAngle":20}]})),
            ("filter.blurGallery.pathBlur", json!({"paths":[{"points":[[0.1,0.3],[0.5,0.7],[0.9,0.3]],"speed":20,"taper":15},{"points":[[0.3,0.1],[0.7,0.9]],"speed":10,"taper":0}]})),
            ("filter.blurGallery.tiltShift", json!({"blur":12,"centerX":0.4,"centerY":0.55,"angle":23,"focus":0.2,"transition":0.25})),
        ];
        let regions = [
            PreviewRegion { x: 3, y: 2, width: 16, height: 12, scale: 1 },
            PreviewRegion { x: 0, y: 0, width: 32, height: 24, scale: 2 },
            PreviewRegion { x: 25, y: 19, width: 7, height: 5, scale: 2 },
        ];
        for depth in [8, 16, 32] { for (command,params) in &fixtures {
            let source = ordinary_filter_fixture(depth);
            let state = source.active().unwrap(); let source_doc = state.doc.clone(); let source_history = state.history.entries().to_vec(); let source_state = state.clone();
            let color = super::super::color_views::Snapshot::capture(&source).unwrap();
            let original_color = color.render(&source_doc).unwrap();
            let rendered = render_with_color_regions(state,&color,command,params.clone(),None,Some(&regions)).unwrap();
            assert_eq!(rendered.tiles.as_ref().unwrap().len(),regions.len()); assert_eq!(rendered.original_tiles.as_ref().unwrap().len(),regions.len());
            assert!(std::sync::Arc::ptr_eq(&source_doc,&source.active().unwrap().doc)); assert_eq!(source_history,source.active().unwrap().history.entries());

            let mut expected = Session::new(); expected.add_document((*source_doc).clone(),None); *expected.active_mut().unwrap() = source_state;
            color.install(&mut expected).unwrap(); super::super::execute_view_command(&mut expected,command,params.clone()).unwrap();
            let active = expected.active().unwrap(); let filtered_color = super::super::display::View::new(&expected.color,&active.doc).unwrap();
            for (index,region) in regions.iter().enumerate() {
                let original = reference_region_pixels(&source_doc, &source.active().unwrap().channel_view, &original_color, *region);
                let filtered = reference_region_pixels(&active.doc, &active.channel_view, &filtered_color, *region);
                for (tile, expected, label) in [(rendered.original_tiles.as_ref().unwrap()[index].png.as_str(), original, "original"), (rendered.tiles.as_ref().unwrap()[index].png.as_str(), filtered, "filtered")] {
                    let encoded = base64::engine::general_purpose::STANDARD.decode(tile).unwrap();
                    let image = photocraft_codecs::decode(&encoded).unwrap();
                    assert_eq!(image.as_u8().unwrap(), expected, "{label} {depth} {command} {index}");
                }
                assert_eq!((rendered.tiles.as_ref().unwrap()[index].x,rendered.tiles.as_ref().unwrap()[index].y,rendered.tiles.as_ref().unwrap()[index].width,rendered.tiles.as_ref().unwrap()[index].height,rendered.tiles.as_ref().unwrap()[index].scale,rendered.tiles.as_ref().unwrap()[index].pixel_width,rendered.tiles.as_ref().unwrap()[index].pixel_height),(region.x,region.y,region.width,region.height,region.scale,region.width.div_ceil(region.scale),region.height.div_ceil(region.scale)));
            }
        }}
    }

    fn assert_detail_tiles_match_full_reference(
        tiles: &[PreviewTile],
        doc: &photocraft_engine::doc::Document,
        channels: &photocraft_engine::channel_cmds::ChannelView,
        color: &super::super::display::View,
        regions: &[PreviewRegion],
        label: &str,
    ) {
        for (index, region) in regions.iter().copied().enumerate() {
            let encoded = base64::engine::general_purpose::STANDARD
                .decode(&tiles[index].png)
                .unwrap();
            let image = photocraft_codecs::decode(&encoded).unwrap();
            assert_eq!(
                image.as_u8().unwrap(),
                reference_region_pixels(doc, channels, color, region),
                "{label} region {index}"
            );
        }
    }

    #[test]
    fn blur_gallery_detail_regions_cover_selections_alpha_channels_and_quick_mask() {
        let fixtures = [
            ("filter.blurGallery.fieldBlur", json!({"pins":[{"x":0.1,"y":0.2,"blur":3},{"x":0.8,"y":0.7,"blur":15}]})),
            ("filter.blurGallery.irisBlur", json!({"pins":[{"x":0.2,"y":0.3,"radiusX":0.2,"radiusY":0.3,"blur":8},{"x":0.8,"y":0.7,"radiusX":0.15,"radiusY":0.2,"blur":15}]})),
            ("filter.blurGallery.spinBlur", json!({"pins":[{"x":0.3,"y":0.4,"radiusX":0.3,"radiusY":0.4,"blurAngle":45},{"x":0.7,"y":0.6,"radiusX":0.2,"radiusY":0.3,"blurAngle":20}]})),
            ("filter.blurGallery.pathBlur", json!({"paths":[{"points":[[0.1,0.3],[0.5,0.7],[0.9,0.3]],"speed":20,"taper":15},{"points":[[0.3,0.1],[0.7,0.9]],"speed":10,"taper":0}]})),
            ("filter.blurGallery.tiltShift", json!({"blur":12,"centerX":0.4,"centerY":0.55,"angle":23,"focus":0.2,"transition":0.25})),
        ];
        let regions = [
            PreviewRegion { x: 4, y: 3, width: 16, height: 12, scale: 1 },
            PreviewRegion { x: 23, y: 17, width: 9, height: 7, scale: 2 },
        ];

        for depth in [8, 16, 32] {
            for (command, params) in &fixtures {
                let mut engine = ordinary_filter_fixture(depth);
                engine.execute("select.rect", json!({"x":7,"y":5,"width":19,"height":16})).unwrap();
                let source = engine.active().unwrap().clone();
                let source_doc = source.doc.clone();
                let source_history = source.history.entries().to_vec();
                let source_selection = source.doc.selection.clone();
                let color = super::super::color_views::Snapshot::capture(&engine).unwrap();
                let original_color = color.render(&source_doc).unwrap();
                let rendered = render_with_color_regions(&source, &color, command, params.clone(), None, Some(&regions)).unwrap();
                let mut oracle = Session::new();
                oracle.add_document((*source_doc).clone(), None);
                *oracle.active_mut().unwrap() = source.clone();
                color.install(&mut oracle).unwrap();
                super::super::execute_view_command(&mut oracle, command, params.clone()).unwrap();
                let filtered = oracle.active().unwrap();
                let filtered_color = super::super::display::View::new(&oracle.color, &filtered.doc).unwrap();

                assert_detail_tiles_match_full_reference(rendered.original_tiles.as_ref().unwrap(), &source_doc, &source.channel_view, &original_color, &regions, &format!("original selection {depth} {command}"));
                assert_detail_tiles_match_full_reference(rendered.tiles.as_ref().unwrap(), &filtered.doc, &filtered.channel_view, &filtered_color, &regions, &format!("filtered selection {depth} {command}"));
                assert_ne!(rendered.tiles.as_ref().unwrap()[0].png, rendered.original_tiles.as_ref().unwrap()[0].png, "selection fixture must produce visible filter changes: {depth} {command}");

                let before = source.doc.clone();
                let past = source.history.entries().len();
                super::super::execute_view_command(&mut engine, command, params.clone()).unwrap();
                let committed = engine.active().unwrap();
                assert_eq!(committed.doc.selection, source_selection, "selection is retained after {command}");
                assert_eq!(committed.channel_view, source.channel_view, "filter preserves the captured channel view");
                assert_eq!(committed.history.entries().len(), past + 1, "one filter application is recorded");
                assert_eq!(render_view_preview(&committed.doc, &committed.channel_view).unwrap().png, render_view_preview(&filtered.doc, &filtered.channel_view).unwrap().png);
                assert!(std::sync::Arc::ptr_eq(&before, &source.doc), "preview and commit must not mutate the retained source Arc");
                assert_eq!(source.history.entries(), source_history);
            }
        }

        for depth in [8, 16, 32] {
            for target in [json!({"channel":0}), json!("quickMask")] {
                for (command, params) in &fixtures {
                    let mut engine = ordinary_filter_fixture(depth);
                    if target == json!("quickMask") {
                        engine.execute("select.rect", json!({"x":7,"y":5,"width":18,"height":14})).unwrap();
                        engine.execute("select.editInQuickMaskMode", json!({})).unwrap();
                    } else {
                        engine.execute("channel.new", json!({"name":"Blur Gallery target","fill":"white"})).unwrap();
                        engine.execute("paint.stroke", json!({"target":{"channel":0},"points":[[8,8,1],[22,17,1]],"size":9,"color":"#000000","seed":177})).unwrap();
                        engine.execute("channel.target", json!({"channel":0})).unwrap();
                    }
                    let mut targeted = params.clone();
                    targeted["target"] = target.clone();
                    let source = engine.active().unwrap().clone();
                    let source_doc = source.doc.clone();
                    let source_history = source.history.entries().to_vec();
                    let color = super::super::color_views::Snapshot::capture(&engine).unwrap();
                    let original_color = color.render(&source_doc).unwrap();
                    let rendered = render_with_color_regions(&source, &color, command, targeted.clone(), None, Some(&regions)).unwrap();
                    let mut oracle = Session::new();
                    oracle.add_document((*source_doc).clone(), None);
                    *oracle.active_mut().unwrap() = source.clone();
                    color.install(&mut oracle).unwrap();
                    super::super::execute_view_command(&mut oracle, command, targeted.clone()).unwrap();
                    let filtered = oracle.active().unwrap();
                    let filtered_color = super::super::display::View::new(&oracle.color, &filtered.doc).unwrap();
                    assert_detail_tiles_match_full_reference(rendered.original_tiles.as_ref().unwrap(), &source_doc, &source.channel_view, &original_color, &regions, &format!("original target {depth} {command} {target}"));
                    assert_detail_tiles_match_full_reference(rendered.tiles.as_ref().unwrap(), &filtered.doc, &filtered.channel_view, &filtered_color, &regions, &format!("filtered target {depth} {command} {target}"));
                    assert_ne!(rendered.tiles.as_ref().unwrap()[0].png, rendered.original_tiles.as_ref().unwrap()[0].png, "channel-target fixture must be non-vacuous: {depth} {command} {target}");
                    assert!(std::sync::Arc::ptr_eq(&source_doc, &engine.active().unwrap().doc));
                    assert_eq!(source_history, source.history.entries());
                    super::super::execute_view_command(&mut engine, command, targeted).unwrap();
                    let committed = engine.active().unwrap();
                    assert_eq!(committed.channel_view, source.channel_view, "filter retains the active target view");
                    assert_eq!(committed.history.entries().len(), source_history.len() + 1);
                    assert_eq!(render_view_preview(&committed.doc, &committed.channel_view).unwrap().png, render_view_preview(&filtered.doc, &filtered.channel_view).unwrap().png);
                }
            }
        }
    }

    #[test]
    fn blur_gallery_smart_filter_detail_regions_keep_selection_mask_and_match_apply() {
        let fixtures = [
            ("filter.blurGallery.fieldBlur", json!({"pins":[{"x":0.1,"y":0.2,"blur":3},{"x":0.8,"y":0.7,"blur":15}]})),
            ("filter.blurGallery.irisBlur", json!({"pins":[{"x":0.2,"y":0.3,"radiusX":0.2,"radiusY":0.3,"blur":8},{"x":0.8,"y":0.7,"radiusX":0.15,"radiusY":0.2,"blur":15}]})),
            ("filter.blurGallery.spinBlur", json!({"pins":[{"x":0.3,"y":0.4,"radiusX":0.3,"radiusY":0.4,"blurAngle":45},{"x":0.7,"y":0.6,"radiusX":0.2,"radiusY":0.3,"blurAngle":20}]})),
            ("filter.blurGallery.pathBlur", json!({"paths":[{"points":[[0.1,0.3],[0.5,0.7],[0.9,0.3]],"speed":20,"taper":15},{"points":[[0.3,0.1],[0.7,0.9]],"speed":10,"taper":0}]})),
            ("filter.blurGallery.tiltShift", json!({"blur":12,"centerX":0.4,"centerY":0.55,"angle":23,"focus":0.2,"transition":0.25})),
        ];
        let regions = [PreviewRegion { x:3,y:2,width:18,height:13,scale:1 }, PreviewRegion { x:21,y:15,width:11,height:9,scale:2 }];
        for depth in [8, 16, 32] {
            for (command, params) in &fixtures {
                let mut engine = ordinary_filter_fixture(depth);
                engine.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
                engine.execute("select.rect", json!({"x":6,"y":4,"width":20,"height":17})).unwrap();
                let state = engine.active().unwrap().clone();
                let source_doc = state.doc.clone();
                let source_history = state.history.entries().to_vec();
                let source_selection = state.doc.selection.clone();
                let color = super::super::color_views::Snapshot::capture(&engine).unwrap();
                let original_color = color.render(&source_doc).unwrap();
                let rendered = render_with_color_regions(&state, &color, command, params.clone(), None, Some(&regions)).unwrap();
                let mut oracle = Session::new();
                oracle.add_document((*source_doc).clone(), None);
                *oracle.active_mut().unwrap() = state.clone();
                color.install(&mut oracle).unwrap();
                super::super::execute_view_command(&mut oracle, command, params.clone()).unwrap();
                let expected = oracle.active().unwrap();
                let expected_color = super::super::display::View::new(&oracle.color, &expected.doc).unwrap();
                assert_detail_tiles_match_full_reference(rendered.original_tiles.as_ref().unwrap(), &source_doc, &state.channel_view, &original_color, &regions, &format!("smart original {depth} {command}"));
                assert_detail_tiles_match_full_reference(rendered.tiles.as_ref().unwrap(), &expected.doc, &expected.channel_view, &expected_color, &regions, &format!("smart filtered {depth} {command}"));
                assert_ne!(rendered.tiles.as_ref().unwrap()[0].png, rendered.original_tiles.as_ref().unwrap()[0].png, "Smart Filter fixture must visibly change pixels: {depth} {command}");
                let layer_id = state.active_layer.unwrap();
                let photocraft_engine::doc::LayerContent::Smart(smart) = &expected.doc.layer(layer_id).unwrap().content else { panic!("filter should remain nondestructive") };
                assert_eq!(smart.smart_filters.len(), 1);
                assert!(smart.filter_mask.is_some(), "selection should be retained as the Smart Filter mask");
                assert_eq!(expected.doc.selection, source_selection);

                super::super::execute_view_command(&mut engine, command, params.clone()).unwrap();
                let committed = engine.active().unwrap();
                assert_eq!(committed.doc.selection, source_selection);
                assert_eq!(committed.history.entries().len(), source_history.len() + 1);
                assert_eq!(render_view_preview(&committed.doc, &committed.channel_view).unwrap().png, render_view_preview(&expected.doc, &expected.channel_view).unwrap().png);
                assert_eq!(state.history.entries(), source_history);
                assert!(std::sync::Arc::ptr_eq(&source_doc, &state.doc));
            }
        }
    }

    #[test]
    fn blur_gallery_detail_regions_preserve_channel_color_context_and_ordinary_shape() {
        let mut engine = ordinary_filter_fixture(16);
        engine.execute("channel.setVisible",json!({"channel":"green","visible":false})).unwrap();
        engine.execute("view.proofSetup",json!({"profile":"display-p3","intent":"perceptual","bpc":false})).unwrap();
        engine.execute("view.proofColors",json!({"on":true})).unwrap();
        let state=engine.active().unwrap(); let source=state.doc.clone(); let history=state.history.entries().to_vec(); let color=super::super::color_views::Snapshot::capture(&engine).unwrap();
        let regions=[PreviewRegion{x:5,y:4,width:20,height:12,scale:1}];
        let params=json!({"pins":[{"x":0.5,"y":0.5,"blur":10}]});
        let detailed=render_with_color_regions(state,&color,"filter.blurGallery.fieldBlur",params.clone(),None,Some(&regions)).unwrap();
        let ordinary=render_with_color_regions(state,&color,"filter.blurGallery.fieldBlur",params.clone(),None,None).unwrap();
        assert!(detailed.tiles.is_some()&&detailed.original_tiles.is_some()); assert!(ordinary.tiles.is_none()&&ordinary.original_tiles.is_none());
        let mut expected=Session::new(); expected.add_document((*source).clone(),None); *expected.active_mut().unwrap()=state.clone(); color.install(&mut expected).unwrap(); super::super::execute_view_command(&mut expected,"filter.blurGallery.fieldBlur",params).unwrap();
        let original_color=color.render(&source).unwrap(); let filtered_state=expected.active().unwrap(); let filtered_color=super::super::display::View::new(&expected.color,&filtered_state.doc).unwrap(); let region=regions[0];
        let expected_original=super::super::tiles::render_with_color(&source,Some(&state.channel_view),Some(&original_color),region.x,region.y,region.width,region.height,region.scale,false,false).unwrap();
        let expected_filtered=super::super::tiles::render_with_color(&filtered_state.doc,Some(&filtered_state.channel_view),Some(&filtered_color),region.x,region.y,region.width,region.height,region.scale,false,false).unwrap();
        assert_eq!(detailed.original_tiles.as_ref().unwrap()[0].png,expected_original.png); assert_eq!(detailed.tiles.as_ref().unwrap()[0].png,expected_filtered.png);
        assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc)); assert_eq!(history,engine.active().unwrap().history.entries());
    }

    #[test]
    fn preview_region_optional_reply_serialization_preserves_legacy_shape_and_strict_geometry() {
        let preview = PhotoViewPreview { width: 32, height: 24, png: "AA==".into(), result: Some(json!({"applied":true})) };
        let old = serde_json::to_value(&preview).unwrap();
        let ordinary = super::super::PhotoCommandPreview { preview, tiles: None, original_tiles: None };
        assert_eq!(serde_json::to_value(ordinary).unwrap(), old);
        for field in ["x", "y", "width", "height", "scale"] {
            let mut region = json!({"x":0,"y":0,"width":1,"height":1,"scale":1});
            for invalid in [json!(-1), json!(0.5), json!(4_294_967_296u64)] {
                region[field] = invalid; assert!(serde_json::from_value::<PreviewRegion>(region.clone()).is_err());
            }
        }
        let source = ordinary_filter_fixture(8); let color = super::super::color_views::Snapshot::capture(&source).unwrap();
        let mut state = source.active().unwrap().clone();
        std::sync::Arc::make_mut(&mut state.doc).size = photocraft_engine::doc::Size::new(4097, 4096);
        assert!(render_with_color_regions(&state, &color, "filter.blurGallery.fieldBlur", json!({"blur":10}), None, Some(&[PreviewRegion { x:0, y:0, width:32, height:24, scale:1 }])).err().unwrap().contains("image size"));
    }

    #[test]
    fn large_images_preview_adjustments_on_a_reused_reduced_copy_but_still_refuse_filters() {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":24,"height":24})).unwrap();
        engine.execute("paint.stroke", json!({"points":[[12,12,1]],"size":30,"color":"#4080b0","seed":101})).unwrap();
        let pixels = engine.active().unwrap().active_layer;
        engine.execute("layer.newAdjustmentLayer.levels", json!({})).unwrap();
        let levels = engine.active().unwrap().active_layer.unwrap().0;
        let mut state = engine.active().unwrap().clone();
        state.active_layer = pixels;
        std::sync::Arc::make_mut(&mut state.doc).size = photocraft_engine::doc::Size::new(6000, 4000);
        let before = state.doc.clone();
        for (command, params) in [("image.adjustments.curves", json!({"points":[[0,0],[128,180],[255,255]]})), ("layer.newAdjustmentLayer.invert", json!({})), ("layer.setAdjustment", json!({"layer":levels,"inBlack":15}))] {
            let preview = render(&state, command, params).unwrap();
            assert_eq!((preview.width, preview.height), (2000, 1334), "{command} renders at the usual preview size");
        }
        assert!(std::sync::Arc::ptr_eq(&before, &state.doc));
        assert_eq!(state.doc.size, photocraft_engine::doc::Size::new(6000, 4000));
        assert!(std::sync::Arc::ptr_eq(&reduced_copy(&state.doc).unwrap(), &reduced_copy(&state.doc).unwrap()), "an unchanged image reuses its reduced copy");
        for (command, params) in [("filter.blur.gaussianBlur", json!({"radius":2})), ("image.adjustments.shadowsHighlights", json!({}))] {
            assert!(render(&state, command, params).err().unwrap().contains("image size"), "{command} depends on pixel distances");
        }
    }

    #[test]
    fn blur_gallery_detail_regions_refuse_invalid_command_geometry_counts_and_encoded_budgets() {
        let engine=ordinary_filter_fixture(8); let state=engine.active().unwrap(); let color=super::super::color_views::Snapshot::capture(&engine).unwrap();
        let valid=PreviewRegion{x:0,y:0,width:32,height:24,scale:1};
        for (command,regions,error) in [
            ("filter.blur.gaussianBlur",vec![valid],"only for Blur Gallery"),
            ("filter.blurGallery.fieldBlur",vec![PreviewRegion{scale:3,..valid}],"power-of-two"),
            ("filter.blurGallery.fieldBlur",vec![PreviewRegion{x:31,width:2,..valid}],"inside the source"),
            ("filter.blurGallery.fieldBlur",vec![valid;9],"at most 8"),
        ] { assert!(render_with_color_regions(state,&color,command,json!({"radius":1}),None,Some(&regions)).err().unwrap().contains(error)); }
        let oversized=PreviewRegion{width:513,height:512,scale:1,..valid};
        assert!(render_with_color_regions(state,&color,"filter.blurGallery.fieldBlur",json!({"blur":10}),None,Some(&[oversized])).err().unwrap().contains("512 output pixels"));
        let max_regions:Vec<_>=(0..8).map(|index|PreviewRegion{x:index*512,y:0,width:512,height:512,scale:1}).collect();
        assert!(validate_regions("filter.blurGallery.fieldBlur",Some(&max_regions),4096,512).is_ok(),"the exact 2,097,152 output-pixel limit remains available");
        assert!(serde_json::from_value::<PreviewRegion>(json!({"x":0,"y":0,"width":1,"height":1,"scale":1,"extra":true})).is_err());
        assert!(detail_tile(PhotoTile{x:0,y:0,width:1,height:1,png:"x".repeat(MAX_PREVIEW_TILE_BYTES+1),selection_path:String::new(),selection_truncated:false,scale:1,pixel_width:1,pixel_height:1,selection_png:None}).err().unwrap().contains("2 MB"));
        assert!(initial_preview_bytes(&"x".repeat(MAX_PREVIEW_BASE_BYTES+1)).unwrap_err().contains("24 MB"));
        assert!(add_preview_tile_bytes(MAX_PREVIEW_TOTAL_BYTES,"x").unwrap_err().contains("48 MB"));
    }

    #[test]
    fn ordinary_filter_complete_ui_catalog_previews_match_apply_at_every_depth() {
        let fixtures: Vec<Value> = serde_json::from_str(include_str!("xdesign_filter_ui_manifest_test.json")).unwrap();
        assert_eq!(fixtures.len(),110);
        let actual: std::collections::BTreeSet<_> = fixtures.iter().map(|row| row["id"].as_str().unwrap()).collect();
        let expected: std::collections::BTreeSet<_> = photocraft_engine::command_specs().iter().filter(|spec| spec.id == "filter.lastFilter" || photocraft_engine::filters::params_for(spec.id,&json!({})).is_some()).map(|spec|spec.id).collect();
        assert_eq!(actual,expected,"Every pinned ordinary/gallery filter must have a visible UI action");
        let directory = std::env::temp_dir().join(format!("xdesign-filter-map-{}",ulid::Ulid::new()));
        std::fs::create_dir_all(&directory).unwrap();
        let map_path = directory.join("map.png");
        let map = ordinary_filter_fixture(8);
        std::fs::write(&map_path,base64::engine::general_purpose::STANDARD.decode(render_view_preview(&map.active().unwrap().doc,&Default::default()).unwrap().png).unwrap()).unwrap();
        for depth in [8,16,32] { for fixture in &fixtures {
            let command=fixture["id"].as_str().unwrap();
            if command=="filter.lastFilter" { continue; }
            let mut params=fixture["params"].clone();
            if command=="filter.distort.displace" { params["mapPath"]=json!(map_path); }
            let mut engine=ordinary_filter_fixture(depth);
            let source=render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png;
            let preview=render(engine.active().unwrap(),command,params.clone()).unwrap_or_else(|error|panic!("{command}/{depth}: {error}"));
            assert_matches_commit(&mut engine,command,params);
            if !["filter.other.custom","filter.other.offset","filter.distort.shear"].contains(&command) {
                assert!(preview.png != source,"{command}/{depth} must render an effect, not empty or unchanged pixels");
            }
            engine.execute("edit.undo",json!({})).unwrap();
            assert_eq!(render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png,source,"{command}/{depth} undo must recover the source");
        } }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn lens_filter_preview_apply_undo_matches_native_at_every_depth() {
        let defaults: Vec<Value> = serde_json::from_str(include_str!("xdesign_lens_ui_manifest_test.json")).unwrap();
        assert_eq!(defaults.iter().map(|row| row["id"].as_str().unwrap()).collect::<Vec<_>>(), ["filter.lensCorrection", "filter.adaptiveWideAngle"]);
        let mut scenarios: Vec<(&str, Value)> = defaults.iter().map(|row| (row["id"].as_str().unwrap(), row["params"].clone())).collect();
        scenarios.extend([
            ("filter.lensCorrection", json!({"distortion":-35,"redCyan":25,"blueYellow":-20,"vignetteAmount":-40,"edge":"color","edgeColor":"#507080"})),
            ("filter.lensCorrection", json!({"profile":"generic","focalLength":12,"edge":"edgeExtension","vertical":12,"horizontal":-8})),
            ("filter.lensCorrection", json!({"straighten":[[3,4],[26,12]],"angle":6,"edge":"white"})),
            ("filter.lensCorrection", json!({"straighten":[[3,4],[26,12]],"autoScale":true,"edge":"black"})),
        ]);
        for interpolation in ["nearest","bilinear","bicubic"] {
            scenarios.push(("filter.adaptiveWideAngle",json!({"scale":80,"constraints":[],"interpolation":interpolation})));
            for model in ["auto","fisheye","perspective","fullSpherical"] {
                scenarios.push(("filter.adaptiveWideAngle",json!({"model":model,"focalLength":12,"cropFactor":1.5,"scale":95,"constraints":[{"a":[3,5],"b":[28,8],"orientation":"horizontal"},{"a":[10,3],"b":[12,20],"orientation":"vertical"}],"interpolation":interpolation})));
            }
        }
        assert_eq!(scenarios.len(),21);
        for depth in [8,16,32] { for (command, params) in &scenarios {
            let mut engine=ordinary_filter_fixture(depth);
            engine.execute("select.rect",json!({"x":0,"y":0,"width":24,"height":24})).unwrap();
            let state=engine.active().unwrap();let original=state.doc.clone();let past=state.history.past_len();let source=render_view_preview(&original,&Default::default()).unwrap().png;
            let outside=original.layers[0].surface().unwrap().rgba(30,12);
            let preview=render(state,command,params.clone()).unwrap();
            let mut oracle=Session::new();oracle.add_document((*original).clone(),None);*oracle.active_mut().unwrap()=state.clone();oracle.execute(command,params.clone()).unwrap();
            assert_eq!(preview.png,render_view_preview(&oracle.active().unwrap().doc,&Default::default()).unwrap().png,"{command}/{depth}/{params}");
            assert!(std::sync::Arc::ptr_eq(&original,&engine.active().unwrap().doc));
            assert_eq!(engine.active().unwrap().history.past_len(),past);
            super::super::execute_view_command(&mut engine,command,params.clone()).unwrap();
            assert_eq!(preview.png,render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png,"{command}/{depth}/{params}");
            assert_eq!(engine.active().unwrap().history.past_len(),past+1);
            let actual=engine.active().unwrap().doc.layers[0].surface().unwrap().rgba(30,12);
            assert_eq!(actual,oracle.active().unwrap().doc.layers[0].surface().unwrap().rgba(30,12));
            assert!(actual.iter().zip(outside).all(|(a,b)| (a-b).abs()<=f32::EPSILON),"{command}/{depth}: outside-selection float rounding {actual:?}/{outside:?}");
            engine.execute("edit.undo",json!({})).unwrap();
            assert_eq!(render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png,source);
            assert_eq!(engine.active().unwrap().doc.selection,original.selection);
        } }
    }

    #[test]
    fn lens_filter_smart_resolution_reapply_and_invalid_inputs_keep_ownership() {
        let mut scenarios=vec![
            ("filter.lensCorrection",json!({"profile":"auto","autoScale":true,"edge":"edgeExtension"})),
            ("filter.lensCorrection",json!({"straighten":[[3,4],[26,12]],"angle":6,"distortion":15})),
        ];
        for model in ["auto","fisheye","perspective","fullSpherical"] {
            scenarios.push(("filter.adaptiveWideAngle",json!({"model":model,"focalLength":12,"cropFactor":1.5,"scale":95,"constraints":[{"a":[3,5],"b":[28,8],"orientation":"horizontal"}],"interpolation":"bicubic"})));
        }
        for depth in [8,16,32] { for (command, params) in &scenarios {
            let mut engine=ordinary_filter_fixture(depth);
            engine.edit("EXIF lens fixture",|doc,_|{doc.metadata.exif=Some(std::sync::Arc::new(photocraft_algo::exif::build(&photocraft_algo::exif::CameraInfo{focal_length:Some(16.),focal_length_35mm:Some(24.),..Default::default()})));Ok(())}).unwrap();
            engine.execute("layer.smartObjects.convertToSmartObject",json!({})).unwrap();
            assert_matches_commit(&mut engine,command,params.clone());
            let state=engine.active().unwrap();let id=state.active_layer.unwrap();let photocraft_engine::doc::LayerContent::Smart(smart)=&state.doc.layer(id).unwrap().content else{panic!("smart")};
            assert_eq!(smart.smart_filters.len(),1);let stored=smart.smart_filters[0].params.clone();
            if params["profile"]=="auto" {assert_eq!(stored["profile"],"generic");assert_eq!(stored["focalLength"],24.);assert!(stored.get("autoScale").is_none());}
            if params.get("straighten").is_some(){assert!(stored.get("straighten").is_none());}
            let source=state.doc.clone();let png=render_view_preview(&source,&Default::default()).unwrap().png;
            super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",json!({"layer":id.0,"index":0,"params":stored})).unwrap();
            assert_eq!(render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png,png);
        } }
        let invalid=[
            ("filter.lensCorrection",json!({"straighten":[[1,2],[1.,2.]]})),
            ("filter.lensCorrection",json!({"straighten":[[1],[2,3]]})),
            ("filter.adaptiveWideAngle",json!({"constraints":[{"a":[1,2],"b":[1,2]}]})),
            ("filter.adaptiveWideAngle",json!({"constraints":vec![json!({"a":[1,2],"b":[3,4]});129]})),
            ("filter.adaptiveWideAngle",json!({"constraints":[null]})),
            ("filter.adaptiveWideAngle",json!({"constraints":[],"interpolation":"invalid"})),
        ];
        let mut engine=ordinary_filter_fixture(8);let doc=engine.active().unwrap().doc.clone();let history=engine.active().unwrap().history.past_len();
        for (command,params) in invalid {assert!(render(engine.active().unwrap(),command,params.clone()).is_err());assert!(super::super::execute_view_command(&mut engine,command,params).is_err());assert!(std::sync::Arc::ptr_eq(&doc,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.past_len(),history);}
        engine.execute("layer.smartObjects.convertToSmartObject",json!({})).unwrap();
        let doc=engine.active().unwrap().doc.clone();let past=engine.active().unwrap().history.past_len();
        for interpolation in ["nearest","bilinear"] {let params=json!({"scale":80,"interpolation":interpolation});assert!(render(engine.active().unwrap(),"filter.adaptiveWideAngle",params.clone()).err().unwrap().contains("bicubic"));assert!(super::super::execute_view_command(&mut engine,"filter.adaptiveWideAngle",params).is_err());assert!(std::sync::Arc::ptr_eq(&doc,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.past_len(),past);}
        super::super::execute_view_command(&mut engine,"filter.adaptiveWideAngle",json!({"scale":80})).unwrap();
        let doc=engine.active().unwrap().doc.clone();let past=engine.active().unwrap().history.past_len();let id=engine.active().unwrap().active_layer.unwrap();
        assert!(super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",json!({"layer":id.0,"index":0,"params":{"scale":80,"interpolation":"nearest"}})).is_err());assert!(std::sync::Arc::ptr_eq(&doc,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.past_len(),past);
    }

    #[test]
    fn ordinary_filter_structured_arrays_and_smart_filters_preserve_native_ownership() {
        let mut kernel=vec![0;25];kernel[12]=5;kernel[7]=-1;kernel[11]=-1;kernel[13]=-1;kernel[17]=-1;
        let fixtures=[
            ("filter.noise.addNoise",json!({"amount":12.5,"distribution":"gaussian","monochromatic":true,"seed":4294967295u64})),
            ("filter.distort.wave",json!({"type":"triangle","generators":3,"seed":2147483648u64,"undefinedAreas":"repeat"})),
            ("filter.other.custom",json!({"kernel":kernel,"scale":1,"offset":0})),
            ("filter.distort.shear",json!({"points":[[0,0],[0.5,0.35],[1,0]],"undefinedAreas":"repeat"})),
            ("filter.render.lightingEffects",json!({"lights":[{"kind":"point","x":0.3,"y":0.4,"z":0.7,"color":[1,0.2,0.1],"intensity":75,"radius":0.8},{"kind":"infinite","angle":45,"elevation":30,"color":[0.1,0.4,1],"intensity":35}],"ambience":8})),
            ("filter.blurGallery.fieldBlur",json!({"pins":[{"x":0.1,"y":0.2,"blur":3},{"x":0.8,"y":0.7,"blur":15}]})),
            ("filter.blurGallery.irisBlur",json!({"pins":[{"x":0.2,"y":0.3,"radiusX":0.2,"radiusY":0.3,"blur":8},{"x":0.8,"y":0.7,"radiusX":0.15,"radiusY":0.2,"blur":15}]})),
            ("filter.blurGallery.spinBlur",json!({"pins":[{"x":0.3,"y":0.4,"radiusX":0.3,"radiusY":0.4,"blurAngle":45},{"x":0.7,"y":0.6,"radiusX":0.2,"radiusY":0.3,"blurAngle":20}]})),
            ("filter.blurGallery.pathBlur",json!({"paths":[{"points":[[0.1,0.3],[0.5,0.7],[0.9,0.3]],"speed":20,"taper":15},{"points":[[0.3,0.1],[0.7,0.9]],"speed":10,"taper":0}]})),
            ("filter.filterGallery",json!({"effects":[{"filter":"grain","params":{"intensity":40,"grainType":"soft"},"visible":true},{"filter":"glass","params":{"distortion":4,"texture":"blocks"},"visible":true},{"filter":"coloredPencil","params":{},"visible":false}]})),
        ];
        for (command,params) in fixtures {
            let mut engine=ordinary_filter_fixture(16);
            engine.execute("layer.smartObjects.convertToSmartObject",json!({})).unwrap();
            let layer=engine.active().unwrap().active_layer.unwrap();
            assert_matches_commit(&mut engine,command,params.clone());
            let photocraft_engine::doc::LayerContent::Smart(smart)=&engine.active().unwrap().doc.layer(layer).unwrap().content else {panic!("Smart filter lost its layer")};
            assert_eq!(smart.smart_filters.len(),1);assert_eq!(smart.smart_filters[0].command,command);
            let before=render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png;
            engine.execute("layer.smartFilter.setParams",json!({"layer":layer.0,"index":0,"params":params})).unwrap();
            assert_eq!(render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png,before,"{command} retained parameters must re-render identically");
        }
    }

    #[test]
    fn ordinary_filter_external_map_limits_and_repeat_last_keep_history_and_sources() {
        let directory=std::env::temp_dir().join(format!("xdesign-filter-input-{}",ulid::Ulid::new()));std::fs::create_dir_all(&directory).unwrap();
        let oversized=directory.join("oversized.png");std::fs::File::create(&oversized).unwrap().set_len(super::super::MAX_INPUT_BYTES+1).unwrap();
        let mut engine=ordinary_filter_fixture(8);let source=engine.active().unwrap().doc.clone();let past=engine.active().unwrap().history.entries().to_vec();
        for path in [&directory,&oversized] {
            assert!(super::super::execute_view_command(&mut engine,"filter.distort.displace",json!({"mapPath":path})).unwrap_err().contains("512MB"));
            assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.entries(),past);
        }
        let mut expected=ordinary_filter_fixture(8);
        engine.execute("filter.blur.gaussianBlur",json!({"radius":2})).unwrap();engine.execute("filter.lastFilter",json!({})).unwrap();
        expected.execute("filter.blur.gaussianBlur",json!({"radius":2})).unwrap();expected.execute("filter.blur.gaussianBlur",json!({"radius":2})).unwrap();
        assert_eq!(render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png,render_view_preview(&expected.active().unwrap().doc,&Default::default()).unwrap().png);
        assert!(render(engine.active().unwrap(),"filter.lastFilter",json!({})).is_err());
        assert!(render(engine.active().unwrap(),"file.new",json!({"width":1,"height":1})).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn develop_previews_render_native_pixels_without_mutating_the_source() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":24,"height":24,"background":"white"}),
            )
            .unwrap();
        let state = engine.active().unwrap();
        let before = state.doc.clone();
        let preview = render(state, "filter.cameraRaw", json!({"exposure":-2})).unwrap();
        assert_eq!((preview.width, preview.height), (24, 24));
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(preview.png)
            .unwrap();
        let image = photocraft_codecs::decode(&bytes).unwrap();
        let pixels = image.as_u8().unwrap();
        assert!(pixels[0] < 240);
        assert!(std::sync::Arc::ptr_eq(
            &before,
            &engine.active().unwrap().doc
        ));
        assert!(!engine.active().unwrap().history.can_undo());
        assert!(render(state, "file.new", json!({"width":1,"height":1})).is_err());
    }
    const CAMERA_RAW_SPLIT_ANCHORS: [u16; 9] = [0, 8192, 16384, 24576, 32768, 40960, 49152, 57344, 65535];
    const CAMERA_RAW_SPLIT_DEFAULT: [u16; 9] = [0, 9455, 17414, 24946, 35120, 44622, 50401, 56802, 65535];
    const CAMERA_RAW_SPLIT_SHIFTED: [u16; 9] = [0, 9170, 16492, 25570, 35927, 45233, 52199, 57804, 65535];

    fn camera_raw_split_codes() -> Vec<u16> {
        (0..256).map(|i| (i * 257) as u16).chain(CAMERA_RAW_SPLIT_ANCHORS).collect()
    }

    fn camera_raw_split_alpha(index: usize) -> u16 {
        [65535, 49152, 32768, 16384][index % 4]
    }

    fn camera_raw_split_fixture() -> Session {
        let codes = camera_raw_split_codes();
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":codes.len(),"height":1,"depth":16})).unwrap();
        engine.edit("16-bit parametric curve ramp", |doc, _| {
            let data = codes.iter().enumerate().flat_map(|(i, q)| {
                let value = f32::from(*q) / 65535.;
                [value, value, value, f32::from(camera_raw_split_alpha(i)) / 65535.]
            }).collect::<Vec<_>>();
            let bounds = doc.bounds();
            doc.layers[0].surface_mut().unwrap().write_region(bounds, &data);
            Ok(())
        }).unwrap();
        engine
    }

    fn camera_raw_split_params(splits: [u32; 3]) -> Value {
        json!({"curveShadows":20,"curveDarks":-10,"curveLights":30,"curveHighlights":-15,"curveSplits":splits})
    }

    // Independent f64 reference: four Gaussian region contributions, monotone envelope,
    // then interpolation of a 1024-sample LUT. No native CameraRaw/curve function is called.
    fn camera_raw_split_reference(splits: [u32; 3]) -> Vec<u16> {
        camera_raw_split_reference_codes(splits, &camera_raw_split_codes())
    }

    fn camera_raw_split_reference_codes(splits: [u32; 3], codes: &[u16]) -> Vec<u16> {
        let [a, b, c] = splits.map(|v| f64::from(v) / 100.);
        let centers = [a / 2., (a + b) / 2., (b + c) / 2., (c + 1.) / 2.];
        let widths = [a, b - a, c - b, 1. - c].map(|v| v.max(0.1));
        let amounts = [20., -10., 30., -15.];
        let mut envelope = 0f64;
        let table = (0..1024).map(|j| {
            let x = j as f64 / 1023.;
            let displacement = (0..4).map(|k| {
                let distance = (x - centers[k]) / (1.2 * widths[k]);
                amounts[k] / 100. * 0.25 * (-2. * distance * distance).exp() * 4. * x * (1. - x)
            }).sum::<f64>();
            envelope = envelope.max((x + displacement).clamp(0., 1.));
            envelope
        }).collect::<Vec<_>>();
        codes.iter().map(|q| {
            let position = f64::from(*q) / 65535. * 1023.;
            let left = (position as usize).min(1022);
            let fraction = position - left as f64;
            (65535. * (table[left] + fraction * (table[left + 1] - table[left]))).round() as u16
        }).collect()
    }

    fn camera_raw_split_assert_pixels(doc: &photocraft_engine::doc::Document, expected: &[u16]) {
        let surface = doc.layers[0].surface().unwrap();
        assert_eq!(surface.format(), photocraft_engine::doc::PixelFormat::RGBA16);
        for (i, expected) in expected.iter().enumerate() {
            let pixel = surface.rgba(i as i32, 0);
            for (channel, actual) in pixel[..3].iter().enumerate() {
                let code = (*actual * 65535.).round() as u16;
                // Fixed before execution: at most two U16 codes for native f32 LUT arithmetic.
                assert!(code.abs_diff(*expected) <= 2, "pixel {i}, channel {channel}: {code} vs {expected}");
            }
            assert_eq!(pixel[3], f32::from(camera_raw_split_alpha(i)) / 65535., "alpha {i}");
        }
    }

    fn camera_raw_split_reference_document(source: &photocraft_engine::doc::Document, expected: &[u16]) -> photocraft_engine::doc::Document {
        let mut reference = source.clone();
        let data = expected.iter().enumerate().flat_map(|(i, q)| {
            let value = f32::from(*q) / 65535.;
            [value, value, value, f32::from(camera_raw_split_alpha(i)) / 65535.]
        }).collect::<Vec<_>>();
        let bounds = reference.bounds();
        reference.layers[0].surface_mut().unwrap().write_region(bounds, &data);
        reference
    }

    #[test]
    fn camera_raw_split_manual_u16_oracle_preview_apply_and_undo() {
        assert!(CAMERA_RAW_SPLIT_DEFAULT.iter().zip(CAMERA_RAW_SPLIT_SHIFTED).any(|(a, b)| a.abs_diff(b) > 1000));
        for (splits, anchors) in [([25, 50, 75], CAMERA_RAW_SPLIT_DEFAULT), ([15, 45, 85], CAMERA_RAW_SPLIT_SHIFTED)] {
            let mut engine = camera_raw_split_fixture();
            let state = engine.active().unwrap();
            let source = state.doc.clone();
            let history = state.history.entries().to_vec();
            let journal = engine.journal.clone();
            let targets = (state.active_layer, state.selected_layers.clone(), state.channel_view.clone());
            let expected = camera_raw_split_reference(splits);
            assert_eq!(&expected[256..], &anchors);
            let reference = camera_raw_split_reference_document(&source, &expected);
            let reference_png = render_view_preview(&reference, &Default::default()).unwrap().png;
            let preview = render(state, "filter.cameraRaw", camera_raw_split_params(splits)).unwrap();
            let decode = |png: &str| photocraft_codecs::decode(&base64::engine::general_purpose::STANDARD.decode(png).unwrap()).unwrap().as_u8().unwrap().to_vec();
            let actual_display = decode(&preview.png);
            let expected_display = decode(&reference_png);
            assert_eq!(actual_display.len(), expected_display.len());
            // The independent U16 expectation can straddle an 8-bit display rounding boundary.
            assert!(actual_display.iter().zip(&expected_display).all(|(a, b)| a.abs_diff(*b) <= 1));
            assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc));
            assert_eq!(engine.active().unwrap().history.entries(), history);
            assert_eq!(engine.journal, journal);
            let state = engine.active().unwrap();
            assert_eq!((state.active_layer, state.selected_layers.clone(), state.channel_view.clone()), targets);
            super::super::execute_view_command(&mut engine, "filter.cameraRaw", camera_raw_split_params(splits)).unwrap();
            camera_raw_split_assert_pixels(&engine.active().unwrap().doc, &expected);
            assert_eq!(render_view_preview(&engine.active().unwrap().doc, &Default::default()).unwrap().png, preview.png);
            engine.execute("edit.undo", json!({})).unwrap();
            assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc));
            engine.execute("edit.redo", json!({})).unwrap();
            camera_raw_split_assert_pixels(&engine.active().unwrap().doc, &expected);
        }
    }

    #[test]
    fn camera_raw_split_neutral_identity_and_native_shape_contract() {
        let mut engine = camera_raw_split_fixture();
        let source = engine.active().unwrap().doc.clone();
        let params = json!({"curveSplits":[15,45,85]});
        let before = render_view_preview(&source, &Default::default()).unwrap().png;
        assert_eq!(render(engine.active().unwrap(), "filter.cameraRaw", params.clone()).unwrap().png, before);
        assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc));
        super::super::execute_view_command(&mut engine, "filter.cameraRaw", params).unwrap();
        assert_eq!(engine.active().unwrap().doc.layers[0].surface(), source.layers[0].surface());
        for splits in [json!([25,50]), json!([25,50,75,90]), json!([25,"50",75]), Value::Null] {
            let source = engine.active().unwrap().doc.clone();
            let past = engine.active().unwrap().history.past_len();
            let params = json!({"curveSplits":splits});
            assert!(render(engine.active().unwrap(), "filter.cameraRaw", params.clone()).is_err());
            assert!(super::super::execute_view_command(&mut engine, "filter.cameraRaw", params).is_err());
            assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc));
            assert_eq!(engine.active().unwrap().history.past_len(), past);
        }
        // Ordered 5..95 integer controls are a host policy, not a stricter native contract.
        for splits in [[95.,5.,5.], [-20.,50.,120.]] {
            let parsed = photocraft_engine::lens_cmds::raw_params("filter.cameraRaw", &json!({"curveSplits":splits})).unwrap();
            parsed.validate().unwrap();
            assert_eq!(parsed.curve_splits, splits);
        }
    }

    #[test]
    fn camera_raw_split_smart_exact_json_native_bundle_reopen_and_source_refresh() {
        use photocraft_engine::doc::{Document, LayerContent, SmartSource};
        fn params(doc: &Document) -> &Value {
            let LayerContent::Smart(smart) = &doc.layers[0].content else { panic!("missing Smart Object") };
            assert_eq!(smart.smart_filters.len(), 1);
            assert_eq!(smart.smart_filters[0].command, "filter.cameraRaw");
            &smart.smart_filters[0].params
        }
        let mut engine = camera_raw_split_fixture();
        engine.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
        let layer = engine.active().unwrap().active_layer.unwrap();
        let source_bytes = {
            let LayerContent::Smart(smart) = &engine.active().unwrap().doc.layers[0].content else { panic!("missing Smart Object") };
            let SmartSource::Embedded { bytes, .. } = &smart.source else { panic!("missing embedded source") };
            bytes.clone()
        };
        for (index, splits) in [[25,50,75], [15,45,85]].into_iter().enumerate() {
            let expected = camera_raw_split_reference(splits);
            let expected_params = camera_raw_split_params(splits);
            if index == 0 {
                super::super::execute_view_command(&mut engine, "filter.cameraRaw", expected_params.clone()).unwrap();
            } else {
                super::super::execute_view_command(&mut engine, "layer.smartFilter.setParams", json!({"layer":layer.0,"index":0,"params":{"curveSplits":splits}})).unwrap();
            }
            let doc = &engine.active().unwrap().doc;
            assert_eq!(params(doc), &expected_params);
            camera_raw_split_assert_pixels(doc, &expected);
            let LayerContent::Smart(smart) = &doc.layers[0].content else { panic!("missing Smart Object") };
            let SmartSource::Embedded { bytes, .. } = &smart.source else { panic!("missing embedded source") };
            assert!(std::sync::Arc::ptr_eq(bytes, &source_bytes));
            let bundle = photocraft_format::save_to_bytes(doc, &Default::default()).unwrap();
            assert!(photocraft_format::is_pcraft(&bundle));
            let mut reopened = photocraft_format::load_from_bytes(&bundle).unwrap();
            assert_eq!(params(&reopened), &expected_params);
            camera_raw_split_assert_pixels(&reopened, &expected);
            let LayerContent::Smart(smart) = &mut reopened.layers[0].content else { panic!("missing reopened Smart Object") };
            let SmartSource::Embedded { bytes, .. } = &smart.source else { panic!("missing reopened embedded source") };
            assert_eq!(bytes.as_slice(), source_bytes.as_slice());
            smart.cache = None;
            let reopened_layer = reopened.layers[0].id;
            assert!(photocraft_engine::smart_cmds::refresh(&mut reopened, reopened_layer).unwrap());
            assert_eq!(params(&reopened), &expected_params);
            camera_raw_split_assert_pixels(&reopened, &expected);
        }
    }

    fn camera_raw_edit_smart(doc: &photocraft_engine::doc::Document) -> &photocraft_engine::doc::SmartObject {
        let photocraft_engine::doc::LayerContent::Smart(smart) = &doc.layers[0].content else { panic!("missing Smart Object") };
        smart
    }

    fn camera_raw_edit_fixture() -> (Session, photocraft_engine::doc::Document) {
        use photocraft_engine::doc::{BlendMode, LayerContent, LayerMask};
        let mut engine = camera_raw_split_fixture();
        let source = (*engine.active().unwrap().doc).clone();
        engine.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
        let mut params = camera_raw_split_params([25,50,75]);
        params["vendor"] = json!({"original":[1,2],"nullable":null});
        params["gradeShadows"] = json!({"hue":20,"vendor":"kept"});
        super::super::execute_view_command(&mut engine, "filter.cameraRaw", params).unwrap();
        let mut kernel = [0;25]; kernel[12] = 1;
        engine.execute("filter.other.custom", json!({"kernel":kernel,"scale":1,"offset":17,"vendor":"adjacent"})).unwrap();
        engine.edit("Retained Smart Filter context", |doc, _| {
            let bounds = doc.bounds();
            let LayerContent::Smart(smart) = &mut doc.layers[0].content else { panic!("missing Smart Object") };
            let mut hidden = smart.smart_filters[1].clone();
            hidden.visible = false; hidden.opacity = 0.37; hidden.blend = BlendMode::Multiply;
            hidden.params["offset"] = json!(-90);
            smart.smart_filters.push(hidden);
            let mut mask = LayerMask::hide_all();
            mask.enabled = false; mask.linked = false; mask.density = 0.42; mask.feather = 1.5;
            mask.surface.fill_rect(bounds, &[0.25]);
            smart.filter_mask = Some(mask);
            Ok(())
        }).unwrap();
        (engine, source)
    }

    fn camera_raw_edit_expected(splits: [u32;3]) -> Vec<u16> {
        // The following identity-center Custom filter adds 17/255: exactly 4369 U16 codes.
        camera_raw_split_reference(splits).into_iter().map(|value| value.saturating_add(4369)).collect()
    }

    fn camera_raw_edit_assert_context(before: &photocraft_engine::doc::SmartObject, after: &photocraft_engine::doc::SmartObject, params: &Value) {
        let mut expected = before.clone();
        expected.smart_filters[0].params = params.clone();
        expected.cache = after.cache.clone();
        assert_eq!(after, &expected);
        let photocraft_engine::doc::SmartSource::Embedded { bytes: original, .. } = &before.source else { panic!("missing source") };
        let photocraft_engine::doc::SmartSource::Embedded { bytes: retained, .. } = &after.source else { panic!("missing source") };
        assert!(std::sync::Arc::ptr_eq(original, retained));
    }

    #[test]
    fn camera_raw_edit_existing_stack_manual_oracle_preview_apply_undo_reopen() {
        let (mut engine, raster) = camera_raw_edit_fixture();
        let state = engine.active().unwrap();
        let source = state.doc.clone();
        let history = state.history.entries().to_vec();
        let journal = engine.journal.clone();
        let targets = (state.active_layer, state.selected_layers.clone(), state.channel_view.clone());
        let layer = state.active_layer.unwrap();
        let before = camera_raw_edit_smart(&source).clone();
        let mut settings = before.smart_filters[0].params.clone(); settings["curveSplits"] = json!([15,45,85]);
        let params = json!({"layer":layer.0,"index":0,"params":settings});
        let expected = camera_raw_edit_expected([15,45,85]);
        let reordered_input = camera_raw_split_codes().into_iter().map(|value| value.saturating_add(4369)).collect::<Vec<_>>();
        let reordered = camera_raw_split_reference_codes([15,45,85], &reordered_input);
        let double_processed = camera_raw_split_reference_codes([15,45,85], &camera_raw_edit_expected([25,50,75]));
        assert!(expected.iter().zip(reordered).any(|(a,b)| a.abs_diff(b) > 100));
        assert!(expected.iter().zip(double_processed).any(|(a,b)| a.abs_diff(b) > 100));
        let reference = camera_raw_split_reference_document(&raster, &expected);
        let preview = render(state, "layer.smartFilter.setParams", params.clone()).unwrap();
        let decode = |png: &str| photocraft_codecs::decode(&base64::engine::general_purpose::STANDARD.decode(png).unwrap()).unwrap().as_u8().unwrap().to_vec();
        let expected_display = decode(&render_view_preview(&reference, &Default::default()).unwrap().png);
        let actual_display = decode(&preview.png);
        assert_eq!(actual_display.len(), expected_display.len());
        assert!(actual_display.iter().zip(expected_display).all(|(a,b)| a.abs_diff(b) <= 1));
        assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc));
        assert_eq!(history, engine.active().unwrap().history.entries());
        assert_eq!(journal, engine.journal);
        let state = engine.active().unwrap();
        assert_eq!((state.active_layer, state.selected_layers.clone(), state.channel_view.clone()), targets);
        super::super::execute_view_command(&mut engine, "layer.smartFilter.setParams", params).unwrap();
        camera_raw_split_assert_pixels(&engine.active().unwrap().doc, &expected);
        camera_raw_edit_assert_context(&before, camera_raw_edit_smart(&engine.active().unwrap().doc), &settings);
        assert_eq!(preview.png, render_view_preview(&engine.active().unwrap().doc, &Default::default()).unwrap().png);
        engine.execute("edit.undo", json!({})).unwrap();
        assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc));
        engine.execute("edit.redo", json!({})).unwrap();
        camera_raw_split_assert_pixels(&engine.active().unwrap().doc, &expected);
        let bundle = photocraft_format::save_to_bytes(&engine.active().unwrap().doc, &Default::default()).unwrap();
        let mut reopened = photocraft_format::load_from_bytes(&bundle).unwrap();
        assert_eq!(camera_raw_edit_smart(&reopened).smart_filters, camera_raw_edit_smart(&engine.active().unwrap().doc).smart_filters);
        assert_eq!(camera_raw_edit_smart(&reopened).filter_mask, before.filter_mask);
        let id = reopened.layers[0].id;
        let photocraft_engine::doc::LayerContent::Smart(smart) = &mut reopened.layers[0].content else { panic!("missing Smart Object") };
        smart.cache = None;
        assert!(photocraft_engine::smart_cmds::refresh(&mut reopened, id).unwrap());
        camera_raw_split_assert_pixels(&reopened, &expected);
        assert_eq!(camera_raw_edit_smart(&reopened).smart_filters[0].params, settings);
        assert_eq!(camera_raw_edit_smart(&reopened).source, before.source);
    }

    #[test]
    fn camera_raw_edit_legacy_curve_preserved_and_changed_curves_refuse() {
        let (mut engine, _) = camera_raw_edit_fixture();
        engine.edit("Imported legacy RAW curve", |doc, _| {
            let id = doc.layers[0].id;
            let photocraft_engine::doc::LayerContent::Smart(smart) = &mut doc.layers[0].content else { panic!("missing Smart Object") };
            smart.smart_filters[0].params["pointCurve"] = json!([[100,170]]);
            photocraft_engine::smart_cmds::refresh(doc, id)?;
            Ok(())
        }).unwrap();
        let state = engine.active().unwrap(); let layer = state.active_layer.unwrap(); let source = state.doc.clone();
        let mut expected_params = camera_raw_edit_smart(&source).smart_filters[0].params.clone(); expected_params["curveSplits"] = json!([15,45,85]);
        let params = json!({"layer":layer.0,"index":0,"params":{"curveSplits":[15,45,85]}});
        let preview = render(state, "layer.smartFilter.setParams", params.clone()).unwrap();
        assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc));
        super::super::execute_view_command(&mut engine, "layer.smartFilter.setParams", params).unwrap();
        // A one-point stored curve is identity in the pinned renderer, but invalid as a new curve.
        camera_raw_split_assert_pixels(&engine.active().unwrap().doc, &camera_raw_edit_expected([15,45,85]));
        assert_eq!(camera_raw_edit_smart(&engine.active().unwrap().doc).smart_filters[0].params, expected_params);
        assert_eq!(preview.png, render_view_preview(&engine.active().unwrap().doc, &Default::default()).unwrap().png);
        for curve in [json!([[0,0]]), json!([[0,0],[0.5,100]]), json!([[0,-1],[255,255]]), json!((0..17).map(|i|[i*15,i*15]).collect::<Vec<_>>())] {
            let source = engine.active().unwrap().doc.clone(); let past = engine.active().unwrap().history.past_len(); let journal = engine.journal.clone();
            let params = json!({"layer":layer.0,"index":0,"params":{"pointCurve":curve}});
            assert!(render(engine.active().unwrap(), "layer.smartFilter.setParams", params.clone()).is_err());
            assert!(super::super::execute_view_command(&mut engine, "layer.smartFilter.setParams", params).is_err());
            assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc));
            assert_eq!(engine.active().unwrap().history.past_len(), past); assert_eq!(engine.journal, journal);
        }
    }

    #[test]
    fn camera_raw_edit_full_reset_native_defaults_retain_unknown_settings() {
        let (mut engine, _) = camera_raw_edit_fixture();
        let before = camera_raw_edit_smart(&engine.active().unwrap().doc).clone();
        let layer = engine.active().unwrap().active_layer.unwrap();
        let mut defaults = serde_json::to_value(photocraft_algo::camera_raw::CameraRaw::default()).unwrap();
        defaults["vendor"] = before.smart_filters[0].params["vendor"].clone();
        defaults["gradeShadows"]["vendor"] = before.smart_filters[0].params["gradeShadows"]["vendor"].clone();
        let params = json!({"layer":layer.0,"index":0,"params":defaults});
        let preview = render(engine.active().unwrap(), "layer.smartFilter.setParams", params.clone()).unwrap();
        super::super::execute_view_command(&mut engine, "layer.smartFilter.setParams", params).unwrap();
        let expected = camera_raw_split_codes().into_iter().map(|q|q.saturating_add(4369)).collect::<Vec<_>>();
        camera_raw_split_assert_pixels(&engine.active().unwrap().doc, &expected);
        camera_raw_edit_assert_context(&before, camera_raw_edit_smart(&engine.active().unwrap().doc), &defaults);
        assert_eq!(preview.png, render_view_preview(&engine.active().unwrap().doc, &Default::default()).unwrap().png);
    }

    #[test]
    fn camera_raw_edit_preview_scope_and_invalid_drafts_refuse_unchanged() {
        let (mut engine, _) = camera_raw_edit_fixture(); let layer = engine.active().unwrap().active_layer.unwrap();
        let source = engine.active().unwrap().doc.clone(); let history = engine.active().unwrap().history.entries().to_vec(); let journal = engine.journal.clone();
        for params in [json!({"index":0,"params":{}}), json!({"layer":layer.0,"params":{}}), json!({"layer":layer.0,"index":1,"params":{}}), json!({"layer":layer.0,"index":u64::MAX,"params":{}}), json!({"layer":u64::MAX,"index":0,"params":{}})] {
            assert!(render(engine.active().unwrap(), "layer.smartFilter.setParams", params).is_err());
        }
        for draft in [Value::Null, json!([]), json!({"exposure":null}), json!({"exposure":1e300}), json!({"gradeShadows":{"hue":1e300}}), json!({"hslHue":[1e300,0,0,0,0,0,0,0]}), json!({"curveSplits":[20,30]})] {
            let params = json!({"layer":layer.0,"index":0,"params":draft});
            assert!(render(engine.active().unwrap(), "layer.smartFilter.setParams", params.clone()).is_err());
            assert!(super::super::execute_view_command(&mut engine, "layer.smartFilter.setParams", params).is_err());
        }
        assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc));
        assert_eq!(engine.active().unwrap().history.entries(), history); assert_eq!(engine.journal, journal);
        let ordinary = camera_raw_split_fixture();
        assert!(render(ordinary.active().unwrap(), "layer.smartFilter.setParams", json!({"layer":ordinary.active().unwrap().active_layer.unwrap().0,"index":0,"params":{}})).is_err());
    }

    fn smart_lens_edit_fixture(wide: bool) -> (Session, photocraft_engine::doc::Document) {
        let mut engine = ordinary_filter_fixture(16);
        let raster = (*engine.active().unwrap().doc).clone();
        engine.execute("layer.smartObjects.convertToSmartObject", json!({})).unwrap();
        engine.execute("layer.translate", json!({"dx":3,"dy":2})).unwrap();
        let mut kernel = [0;25]; kernel[12] = 1;
        engine.execute("filter.other.custom", json!({"kernel":kernel,"scale":1,"offset":17,"vendor":"lower"})).unwrap();
        let (command, params) = if wide { ("filter.adaptiveWideAngle", json!({"model":"perspective","focalLength":24,"cropFactor":1,"scale":100,"constraints":[],"interpolation":"bicubic","vendor":{"keep":[1,2]}})) }
            else { ("filter.lensCorrection", json!({"angle":0,"scale":100,"profile":"none","autoScale":false,"straighten":null,"vendor":{"keep":[1,2]}})) };
        // Ordinary Lens creation rejects null straightening; imported/canonical Smart data
        // uses null as the merge-compatible cleared value.
        let mut initial = params.clone(); if !wide { initial.as_object_mut().unwrap().remove("straighten"); }
        engine.execute(command, initial).unwrap();
        engine.execute("filter.other.custom", json!({"kernel":kernel,"scale":1,"offset":-12,"vendor":"upper"})).unwrap();
        engine.edit("Smart lens retained context", |doc, _| {
            let photocraft_engine::doc::LayerContent::Smart(smart) = &mut doc.layers[0].content else { panic!("missing Smart Object") };
            smart.smart_filters[1].params = params.clone();
            let mut mask = photocraft_engine::doc::LayerMask::hide_all(); mask.enabled = false; mask.linked = false; mask.density = 0.42; mask.feather = 1.5;
            mask.surface.fill_rect(photocraft_engine::doc::Rect::from_xywh(3,4,7,8), &[0.25]); smart.filter_mask = Some(mask);
            Ok(())
        }).unwrap();
        (engine, raster)
    }

    fn smart_lens_edit_manual_input(raster: &photocraft_engine::doc::Document) -> photocraft_engine::doc::Document {
        let mut expected = raster.clone(); let mut pixels = Vec::new();
        for y in 0..26 { for x in 0..35 {
            let pixel = raster.layers[0].surface().unwrap().rgba(x-3,y-2);
            pixels.extend(pixel[..3].iter().map(|value| (((*value*65535.).round() as u16).saturating_add(4369)) as f32/65535.)); pixels.push(pixel[3]);
        } }
        expected.layers[0].surface_mut().unwrap().write_region(photocraft_engine::doc::Rect::new(0,0,35,26),&pixels); expected
    }

    #[track_caller]
    fn smart_lens_edit_assert_png(actual: &str, expected: &str) {
        let decode = |png: &str| photocraft_codecs::decode(&base64::engine::general_purpose::STANDARD.decode(png).unwrap()).unwrap().as_u8().unwrap().to_vec();
        let (actual,expected) = (decode(actual),decode(expected)); assert_eq!(actual.len(),expected.len());
        let differences=actual.iter().zip(&expected).enumerate().filter_map(|(index,(a,b))| {let difference=a.abs_diff(*b);(difference>1).then_some((index,*a,*b,difference))}).collect::<Vec<_>>();
        let maximum=actual.iter().zip(&expected).map(|(a,b)|a.abs_diff(*b)).max().unwrap_or(0);
        assert!(differences.is_empty(),"PNG max difference {maximum}, differing channels {}/{}, first {:?}",differences.len(),actual.len(),&differences[..differences.len().min(16)]);
    }

    #[test]
    fn smart_lens_edit_placed_lower_input_and_manual_half_turn_keep_stack_order() {
        let (mut engine,raster) = smart_lens_edit_fixture(false); let input = smart_lens_edit_manual_input(&raster);
        let state = engine.active().unwrap(); let source = state.doc.clone(); let history = state.history.entries().to_vec(); let journal = engine.journal.clone();
        let layer = state.active_layer.unwrap(); let before = camera_raw_edit_smart(&source).clone();
        let request = json!({"layer":layer.0,"index":1,"params":{"angle":180}});
        let preview = render(state,"layer.smartFilter.setParams",request.clone()).unwrap(); let metadata = &preview.result.as_ref().unwrap()["lensEdit"];
        assert_eq!(metadata["input"]["width"],32); assert_eq!(metadata["input"]["height"],24);
        assert_eq!(metadata["frame"],json!([0,0,35,26]));
        smart_lens_edit_assert_png(metadata["input"]["png"].as_str().unwrap(),&render_view_preview(&input,&Default::default()).unwrap().png);
        assert_ne!(metadata["input"]["png"],preview.png); assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));
        assert_eq!(history,engine.active().unwrap().history.entries()); assert_eq!(journal,engine.journal);
        super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap();
        let actual = &engine.active().unwrap().doc; let mut expected = input.clone(); let mut pixels = Vec::new(); let mut interior = 0; let mut differences=Vec::new();let mut maximum=0;let mut alpha_maximum=0f32;
        for y in 0..24 { for x in 0..32 {
            let pixel = input.layers[0].surface().unwrap().rgba(34-x,25-y);
            let colors = pixel[..3].iter().map(|value| (((*value*65535.).round() as u16).saturating_sub(3084)) as f32/65535.).collect::<Vec<_>>();
            let out = actual.layers[0].surface().unwrap().rgba(x,y);
            if pixel[3]>0. { interior+=1; for c in 0..3 { let difference=((out[c]*65535.).round() as i32-(colors[c]*65535.).round() as i32).abs();maximum=maximum.max(difference);if difference>2{differences.push((x,y,c,out[c],colors[c],pixel[c],pixel[3],difference));} } }
            alpha_maximum=alpha_maximum.max((out[3]-pixel[3]).abs()); pixels.extend_from_slice(&[colors[0],colors[1],colors[2],pixel[3]]);
        } }
        assert!(differences.is_empty()&&alpha_maximum<=1./65535.,"Half turn max RGB {maximum}, differing channels {}, max alpha codes {}, first {:?}, stored {}",differences.len(),alpha_maximum*65535.,&differences[..differences.len().min(16)],camera_raw_edit_smart(actual).smart_filters[1].params);
        assert!(interior>400); let bounds=expected.bounds(); expected.layers[0].surface_mut().unwrap().write_region(bounds,&pixels);
        smart_lens_edit_assert_png(&preview.png,&render_view_preview(&expected,&Default::default()).unwrap().png);
        let after=camera_raw_edit_smart(actual); let mut retained=before.clone(); retained.smart_filters[1].params["angle"]=json!(180.); retained.cache=after.cache.clone(); assert_eq!(after,&retained);
        assert_eq!(preview.png,render_view_preview(actual,&Default::default()).unwrap().png);
        engine.execute("edit.undo",json!({})).unwrap(); assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc)); engine.execute("edit.redo",json!({})).unwrap();
        let bundle=photocraft_format::save_to_bytes(&engine.active().unwrap().doc,&Default::default()).unwrap(); let mut reopened=photocraft_format::load_from_bytes(&bundle).unwrap(); let id=reopened.layers[0].id;
        assert!(photocraft_engine::smart_cmds::refresh(&mut reopened,id).unwrap()); assert_eq!(render_view_preview(&reopened,&Default::default()).unwrap().png,preview.png); assert_eq!(camera_raw_edit_smart(&reopened).source,before.source);
    }

    #[test]
    fn smart_lens_edit_hidden_global_and_individual_visibility_pin_running_input() {
        for wide in [false,true] { for (enabled,visible) in [(false,true),(true,false)] {
            let (mut engine,raster)=smart_lens_edit_fixture(wide); engine.edit("Hidden Smart Filter",|doc,_|{let id=doc.layers[0].id; let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")}; smart.filters_enabled=enabled; smart.smart_filters[1].visible=visible; photocraft_engine::smart_cmds::refresh(doc,id)?; Ok(())}).unwrap();
            let state=engine.active().unwrap();let source=state.doc.clone();let layer=state.active_layer.unwrap();let before=camera_raw_edit_smart(&source).clone();let original=render_view_preview(&source,&Default::default()).unwrap().png;
            let request=json!({"layer":layer.0,"index":1,"params":if wide{json!({"scale":120})}else{json!({"angle":180})}});
            let preview=render(state,"layer.smartFilter.setParams",request.clone()).unwrap();let metadata=&preview.result.as_ref().unwrap()["lensEdit"];
            assert_eq!(metadata["stackEnabled"],enabled);assert_eq!(metadata["filterVisible"],visible);
            smart_lens_edit_assert_png(metadata["input"]["png"].as_str().unwrap(),&render_view_preview(&smart_lens_edit_manual_input(&raster),&Default::default()).unwrap().png);
            assert_eq!(preview.png,original);assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));
            super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap();let after=camera_raw_edit_smart(&engine.active().unwrap().doc); assert_eq!(after.filters_enabled,enabled);assert_eq!(after.smart_filters[1].visible,visible);assert_eq!(after.filter_mask,before.filter_mask);assert_eq!(after.smart_filters[0],before.smart_filters[0]);assert_eq!(after.smart_filters[2],before.smart_filters[2]);assert_eq!(render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png,original);
        } }
    }

    #[test]
    fn smart_lens_edit_straighten_auto_scale_above_150_repeats_and_reopens_exactly() {
        let (mut engine,raster)=smart_lens_edit_fixture(false);let mut manual=smart_lens_edit_manual_input(&raster);manual.size=photocraft_engine::doc::Size::new(35,26);let layer=engine.active().unwrap().active_layer.unwrap();
        let request=json!({"layer":layer.0,"index":1,"params":{"angle":0,"scale":100,"straighten":[[0,0],[8,8]],"autoScale":true}});
        let prepared=prepare_lens_edit(&engine,"layer.smartFilter.setParams",request.clone()).unwrap();assert_eq!(prepared["params"]["angle"],45.);assert_eq!(prepared["params"]["scale"],100);assert_eq!(prepared["params"]["autoScale"],true);assert!(prepared["params"]["straighten"].is_null());
        let preview=render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).unwrap();let metadata=&preview.result.as_ref().unwrap()["lensEdit"];assert_eq!(metadata["frame"],json!([0,0,35,26]));let scale=metadata["resolved"]["scale"].as_f64().unwrap();assert!(scale>150.);
        let exact=photocraft_engine::lens_cmds::lens_params("filter.lensCorrection",&request["params"],manual.bounds(),None).unwrap();let cropped=photocraft_engine::lens_cmds::lens_params("filter.lensCorrection",&request["params"],raster.bounds(),None).unwrap();assert_eq!(scale,exact.scale);assert!((scale-cropped.scale).abs()>1.);
        let mut original=Session::new();original.add_document(manual,None); original.execute("filter.lensCorrection",request["params"].clone()).unwrap();let mut kernel=[0;25];kernel[12]=1;original.execute("filter.other.custom",json!({"kernel":kernel,"scale":1,"offset":-12})).unwrap();
        eprintln!("Auto-fit original {}, prepared {}, resolved {}",request["params"],prepared["params"],preview.result.as_ref().unwrap()["lensEdit"]["resolved"]);
        let mut original_crop=(*original.active().unwrap().doc).clone();original_crop.size=raster.size;
        smart_lens_edit_assert_png(&preview.png,&render_view_preview(&original_crop,&Default::default()).unwrap().png);
        super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap(); let stable=engine.active().unwrap().doc.layers[0].surface().unwrap().read_region(engine.active().unwrap().doc.bounds());
        for _ in 0..2 { super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",json!({"layer":layer.0,"index":1,"params":{"vignetteMidpoint":50}})).unwrap();let params=&camera_raw_edit_smart(&engine.active().unwrap().doc).smart_filters[1].params;assert_eq!(params["angle"],45.);assert_eq!(params["scale"],100);assert_eq!(params["autoScale"],true);assert!(params["straighten"].is_null());assert_eq!(engine.active().unwrap().doc.layers[0].surface().unwrap().read_region(engine.active().unwrap().doc.bounds()),stable); }
        let bundle=photocraft_format::save_to_bytes(&engine.active().unwrap().doc,&Default::default()).unwrap();let mut reopened=photocraft_format::load_from_bytes(&bundle).unwrap();let id=reopened.layers[0].id;assert!(photocraft_engine::smart_cmds::refresh(&mut reopened,id).unwrap());assert_eq!(reopened.layers[0].surface().unwrap().read_region(reopened.bounds()),stable);
    }

    #[test]
    fn smart_lens_edit_wide_curves_unknown_constraints_and_bicubic_refusal() {
        let (mut engine,_)=smart_lens_edit_fixture(true);let layer=engine.active().unwrap().active_layer.unwrap();
        let constraints=json!([{"a":[4,4],"b":[20,18],"orientation":"vertical","vendor":{"precision":[1,2]}}]);let request=json!({"layer":layer.0,"index":1,"params":{"constraints":constraints,"model":"fisheye","focalLength":12.5}});
        let preview=render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).unwrap();let curves=preview.result.as_ref().unwrap()["lensEdit"]["curves"].as_array().unwrap();assert_eq!(curves.len(),1);assert!(curves[0].as_array().unwrap().len()<=25);
        assert_eq!(preview.result.as_ref().unwrap()["lensEdit"]["frame"],json!([0,0,35,26]));
        let wide=photocraft_engine::lens_cmds::wide_params("filter.adaptiveWideAngle",&json!({"constraints":constraints,"model":"fisheye","focalLength":12.5,"cropFactor":1,"scale":100}),None).unwrap();
        let expected=photocraft_algo::wideangle::Camera::new(&wide,photocraft_engine::doc::Rect::new(0,0,35,26)).arc([4.,4.],[20.,18.],24);
        let cropped=photocraft_algo::wideangle::Camera::new(&wide,photocraft_engine::doc::Rect::new(0,0,32,24)).arc([4.,4.],[20.,18.],24);
        assert_eq!(curves[0],json!(expected));assert_ne!(json!(expected),json!(cropped));
        let first=curves[0][0].as_array().unwrap();for (value,expected) in first.iter().zip([4.,4.]){assert!((value.as_f64().unwrap()-expected).abs()<1e-9);}
        super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap();assert_eq!(camera_raw_edit_smart(&engine.active().unwrap().doc).smart_filters[1].params["constraints"],constraints);assert_eq!(preview.png,render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png);
        let source=engine.active().unwrap().doc.clone();let past=engine.active().unwrap().history.past_len();
        for interpolation in ["nearest","bilinear"] { let request=json!({"layer":layer.0,"index":1,"params":{"interpolation":interpolation}});assert!(render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).err().unwrap().contains("bicubic"));assert!(super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap_err().contains("bicubic"));assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.past_len(),past); }
    }

    #[test]
    fn smart_lens_edit_active_defaults_canonicalize_without_changing_outer_identity() {
        let (mut engine,_)=smart_lens_edit_fixture(false);engine.edit("Last lens filter",|doc,_|{let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")};smart.smart_filters.truncate(2);Ok(())}).unwrap();
        let source=engine.active().unwrap().doc.clone();let request=json!({"params":{"straighten":[[0,0],[10,1]],"profile":"generic","focalLength":24.5},"coalesce":"lens-auto"});
        let prepared=prepare_lens_edit(&engine,"layer.smartFilter.setParams",request.clone()).unwrap();assert!(prepared.get("layer").is_none());assert!(prepared.get("index").is_none());assert_eq!(prepared["coalesce"],"lens-auto");assert_eq!(prepared["params"]["focalLength"],24.5);let angle=-1f64.atan2(10.).to_degrees();assert!((prepared["params"]["angle"].as_f64().unwrap()-angle).abs()<1e-12);
        assert!(render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).is_err());
        super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap();let baseline=engine.active().unwrap().doc.layers[0].surface().unwrap().read_region(engine.active().unwrap().doc.bounds());
        assert!(engine.journal.last().unwrap().1.get("layer").is_none());assert!(engine.journal.last().unwrap().1.get("index").is_none());
        super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",json!({"params":{"edge":"transparency"},"coalesce":"lens-auto"})).unwrap();assert_eq!(engine.active().unwrap().doc.layers[0].surface().unwrap().read_region(engine.active().unwrap().doc.bounds()),baseline);
        engine.execute("edit.undo",json!({})).unwrap();assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc.layers[0].surface().unwrap().read_region(engine.active().unwrap().doc.bounds()),baseline);
        for supplied in [Value::Null,json!("active"),json!(-1)] {
            let request=json!({"layer":supplied,"index":1,"params":{"straighten":[[0,0],[10,1]],"angle":0}});
            let prepared=prepare_lens_edit(&engine,"layer.smartFilter.setParams",request.clone()).unwrap();assert_eq!(prepared["layer"],supplied);assert!(prepared["params"]["straighten"].is_null());assert!((prepared["params"]["angle"].as_f64().unwrap()-angle).abs()<1e-12);
            assert!(render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).is_err());
            super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap();assert_eq!(engine.journal.last().unwrap().1["layer"],supplied);assert!(camera_raw_edit_smart(&engine.active().unwrap().doc).smart_filters[1].params["straighten"].is_null());
        }
        let source=engine.active().unwrap().doc.clone();let journal=engine.journal.clone();let past=engine.active().unwrap().history.past_len();
        for request in [json!({"layer":u64::MAX,"index":1,"params":{"angle":10}}),json!({"index":null,"params":{"angle":10}})] {
            assert!(super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).is_err());assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(engine.journal,journal);assert_eq!(engine.active().unwrap().history.past_len(),past);
        }
    }

    #[test]
    fn smart_lens_edit_exif_and_fractional_profiles_resolve_without_rounding() {
        let mut exif=b"II\x2a\0\x08\0\0\0".to_vec();exif.extend(2u16.to_le_bytes());
        for (tag,kind,value) in [(0x920Au16,5u16,38u32),(0xA405u16,3u16,49u32)] {exif.extend(tag.to_le_bytes());exif.extend(kind.to_le_bytes());exif.extend(1u32.to_le_bytes());exif.extend(value.to_le_bytes());}
        exif.extend(0u32.to_le_bytes());exif.extend(49u32.to_le_bytes());exif.extend(2u32.to_le_bytes());
        let info=photocraft_algo::exif::read(&exif);assert_eq!(info.focal_length,Some(24.5));assert_eq!(info.focal_length_35mm,Some(49.));
        for wide in [false,true] {let (mut engine,_)=smart_lens_edit_fixture(wide);engine.edit("Parent camera metadata",|doc,_|{doc.metadata.exif=Some(std::sync::Arc::new(exif.clone()));Ok(())}).unwrap();let layer=engine.active().unwrap().active_layer.unwrap();
            let settings=if wide{json!({"focalLength":0,"cropFactor":1})}else{json!({"profile":"auto","focalLength":0})};let request=json!({"layer":layer.0,"index":1,"params":settings});let prepared=prepare_lens_edit(&engine,"layer.smartFilter.setParams",request).unwrap();
            if wide{assert_eq!(prepared["params"]["focalLength"],24.5);assert_eq!(prepared["params"]["cropFactor"],2.);}else{assert_eq!(prepared["params"]["focalLength"],49.);assert_eq!(prepared["params"]["profile"],"generic");let exact=prepare_lens_edit(&engine,"layer.smartFilter.setParams",json!({"layer":layer.0,"index":1,"params":{"profile":"generic","focalLength":24.5}})).unwrap();assert_eq!(exact["params"]["focalLength"],24.5);}
            assert_eq!(prepared["params"]["vendor"],json!({"keep":[1,2]}));super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",prepared.clone()).unwrap();assert_eq!(camera_raw_edit_smart(&engine.active().unwrap().doc).smart_filters[1].params,prepared["params"]);
        }
    }

    #[test]
    fn smart_lens_edit_invalid_geometry_missing_source_and_large_preview_preserve_state() {
        for wide in [false,true] { let (mut engine,_)=smart_lens_edit_fixture(wide);let source=engine.active().unwrap().doc.clone();let layer=engine.active().unwrap().active_layer.unwrap();let history=engine.active().unwrap().history.entries().to_vec();let journal=engine.journal.clone();
            let bad=if wide {vec![json!({"constraints":[{"a":[1,1],"b":[1,1]}]}),json!({"constraints":vec![json!({"a":[1,1],"b":[2,2]});129]}),json!({"cropFactor":null})]} else {vec![json!({"straighten":[[1,1],[1,1]]}),json!({"angle":null}),json!({"autoScale":null})]};
            for params in bad {let request=json!({"layer":layer.0,"index":1,"params":params});assert!(render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).is_err());assert!(super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).is_err());}
            assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.entries(),history);assert_eq!(engine.journal,journal);
            engine.edit("Unavailable embedded source",|doc,_|{let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")};smart.source=photocraft_engine::doc::SmartSource::Linked{path:"/no/such/orion-smart-lens-source.pcraft".into()};Ok(())}).unwrap();let unavailable=engine.active().unwrap().doc.clone();let request=json!({"layer":layer.0,"index":1,"params":{"scale":110}});assert!(render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).is_err());assert!(super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).is_err());assert!(std::sync::Arc::ptr_eq(&unavailable,&engine.active().unwrap().doc));
        }
        let (mut engine,_)=smart_lens_edit_fixture(false);engine.edit("Large canvas without allocating pixels",|doc,_|{doc.size=photocraft_engine::doc::Size::new(5000,4000);Ok(())}).unwrap();let source=engine.active().unwrap().doc.clone();let request=json!({"layer":engine.active().unwrap().active_layer.unwrap().0,"index":1,"params":{"angle":12}});assert!(prepare_lens_edit(&engine,"layer.smartFilter.setParams",request.clone()).is_ok());assert!(render(engine.active().unwrap(),"layer.smartFilter.setParams",request).err().unwrap().contains("image size"));assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));
    }

    fn existing_blur_edit_fixture(id: &str) -> (Session,photocraft_engine::doc::Document) {
        let (mut engine,raster)=smart_lens_edit_fixture(false);
        engine.edit("Existing Blur Gallery",|doc,_|{
            let layer=doc.layers[0].id;
            let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")};
            smart.smart_filters[1].command=id.into();
            smart.smart_filters[1].params=json!({"blur":0,"blurAngle":0,"speed":0,"vendor":{"original":[1,2],"nullable":null}});
            photocraft_engine::smart_cmds::refresh(doc,layer)?;Ok(())
        }).unwrap();
        (engine,raster)
    }

    fn existing_blur_edit_settings(id: &str) -> Value {
        match id {
            "filter.blurGallery.fieldBlur"=>json!({"pins":[{"x":0.2,"y":0.3,"blur":1,"vendor":"left"},{"x":0.8,"y":0.7,"blur":5,"vendor":"right"}]}),
            "filter.blurGallery.irisBlur"=>json!({"pins":[{"x":0.35,"y":0.4,"radiusX":0.3,"radiusY":0.25,"angle":17,"blur":5,"feather":0.5,"roundness":10,"vendor":{"keep":1}}]}),
            "filter.blurGallery.spinBlur"=>json!({"pins":[{"x":0.4,"y":0.6,"radiusX":0.4,"radiusY":0.3,"blurAngle":25,"angle":-23,"vendor":{"keep":1}}]}),
            "filter.blurGallery.pathBlur"=>json!({"paths":[{"points":[[0.1,0.2],[0.45,0.75],[0.9,0.4]],"speed":5,"taper":17,"vendor":{"keep":1}}]}),
            _=>json!({"blur":5,"centerX":0.4,"centerY":0.6,"angle":17,"focus":0.1,"transition":0.2}),
        }
    }

    fn existing_blur_edit_direct(raster: &photocraft_engine::doc::Document,id: &str,params: Value) -> photocraft_engine::doc::Document {
        let mut direct=Session::new();direct.add_document(smart_lens_edit_manual_input(raster),None);
        direct.execute(id,params).unwrap();let mut kernel=[0;25];kernel[12]=1;
        direct.execute("filter.other.custom",json!({"kernel":kernel,"scale":1,"offset":-12})).unwrap();
        (*direct.active().unwrap().doc).clone()
    }

    #[test]
    fn existing_blur_edit_all_five_match_direct_source_stack_preserve_context_and_reopen() {
        for id in DETAIL_COMMANDS {
            let (mut engine,raster)=existing_blur_edit_fixture(id);engine.execute("select.rect",json!({"x":7,"y":5,"width":12,"height":11})).unwrap();
            let state=engine.active().unwrap();let source=state.doc.clone();let before=camera_raw_edit_smart(&source).clone();let history=state.history.entries().to_vec();let journal=engine.journal.clone();let targets=(state.active_layer,state.selected_layers.clone(),state.channel_view.clone());let layer=state.active_layer.unwrap();
            let settings=existing_blur_edit_settings(id);let request=json!({"layer":layer.0,"index":1,"params":settings});
            let preview=render(state,"layer.smartFilter.setParams",request.clone()).unwrap();let input=&preview.result.as_ref().unwrap()["blurEdit"];
            assert_eq!(input["bounds"],json!([0,0,32,24]));assert_eq!(input["input"]["width"],32);assert_eq!(input["input"]["height"],24);
            smart_lens_edit_assert_png(input["input"]["png"].as_str().unwrap(),&render_view_preview(&smart_lens_edit_manual_input(&raster),&Default::default()).unwrap().png);
            let expected=existing_blur_edit_direct(&raster,id,settings.clone());smart_lens_edit_assert_png(&preview.png,&render_view_preview(&expected,&Default::default()).unwrap().png);
            assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.entries(),history);assert_eq!(engine.journal,journal);assert_eq!((engine.active().unwrap().active_layer,engine.active().unwrap().selected_layers.clone(),engine.active().unwrap().channel_view.clone()),targets);
            super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap();let actual=&engine.active().unwrap().doc;
            assert_eq!(preview.png,render_view_preview(actual,&Default::default()).unwrap().png);
            let after=camera_raw_edit_smart(actual);let mut retained=before.clone();retained.smart_filters[1].params.as_object_mut().unwrap().extend(settings.as_object().unwrap().clone());retained.cache=after.cache.clone();assert_eq!(after,&retained);assert_eq!(after.smart_filters.len(),3);assert_eq!(actual.selection,source.selection);
            engine.execute("edit.undo",json!({})).unwrap();assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));engine.execute("edit.redo",json!({})).unwrap();
            let bundle=photocraft_format::save_to_bytes(&engine.active().unwrap().doc,&Default::default()).unwrap();let mut reopened=photocraft_format::load_from_bytes(&bundle).unwrap();let layer=reopened.layers[0].id;
            assert!(photocraft_engine::smart_cmds::refresh(&mut reopened,layer).unwrap());assert_eq!(render_view_preview(&reopened,&Default::default()).unwrap().png,preview.png);assert_eq!(camera_raw_edit_smart(&reopened).source,before.source);assert_eq!(camera_raw_edit_smart(&reopened).smart_filters,retained.smart_filters);
        }
    }

    fn existing_blur_edit_three_boxes(input: &photocraft_engine::doc::Document) -> photocraft_engine::doc::Document {
        let halo=12usize;let (width,height)=(35+2*halo,26+2*halo);let source=input.layers[0].surface().unwrap();
        let mut data=(0..height).flat_map(|y|(0..width).map(move|x|{let p=source.rgba((x as i32-halo as i32).clamp(0,34),(y as i32-halo as i32).clamp(0,25));[f64::from(p[0])*f64::from(p[3]),f64::from(p[1])*f64::from(p[3]),f64::from(p[2])*f64::from(p[3]),f64::from(p[3])]})).collect::<Vec<_>>();
        // Uniform Field Blur amount 5 gives sigma 3 and these literal box radii.
        // Extend the initial source over Gallery's 12px halo once, then crop after
        // the independent f64 cascade; re-clamping each intermediate canvas adds alpha.
        for horizontal in [true,false] {for radius in [2i32,2,3] {
            let old=data;data=vec![[0.;4];width*height];
            for y in 0..height {for x in 0..width {for delta in -radius..=radius {
                let (sx,sy)=if horizontal{((x as i32+delta).clamp(0,width as i32-1) as usize,y)}else{(x,(y as i32+delta).clamp(0,height as i32-1) as usize)};
                for c in 0..4 {data[y*width+x][c]+=old[sy*width+sx][c]/f64::from(2*radius+1);}
            }}}
        }}
        let mut pixels=Vec::with_capacity(35*26*4);
        for y in 0..26 {for x in 0..35 {let p=data[(y+halo)*width+x+halo];let alpha=(p[3]*65535.).round() as u16;let color=|c:usize|{let value=if p[3]>1e-6{p[c]/p[3]}else{0.};let code=(value.clamp(0.,1.)*65535.).round() as u16;f32::from(code.saturating_sub(3084))/65535.};pixels.extend_from_slice(&[color(0),color(1),color(2),f32::from(alpha)/65535.]);}}
        let mut expected=input.clone();expected.layers[0].surface_mut().unwrap().write_region(photocraft_engine::doc::Rect::new(0,0,35,26),&pixels);expected
    }

    #[test]
    fn existing_blur_edit_field_matches_independent_u16_three_box_oracle_at_every_pixel() {
        let (mut engine,raster)=existing_blur_edit_fixture("filter.blurGallery.fieldBlur");let layer=engine.active().unwrap().active_layer.unwrap();
        let input=smart_lens_edit_manual_input(&raster);let expected=existing_blur_edit_three_boxes(&input);
        let request=json!({"layer":layer.0,"index":1,"params":{"pins":[{"x":0.375,"y":0.625,"blur":5}]}});
        let preview=render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).unwrap();smart_lens_edit_assert_png(&preview.png,&render_view_preview(&expected,&Default::default()).unwrap().png);
        super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap();let actual=&engine.active().unwrap().doc;let mut maximum=0;let mut differences=Vec::new();
        for y in 0..24 {for x in 0..32 {let a=actual.layers[0].surface().unwrap().rgba(x,y);let e=expected.layers[0].surface().unwrap().rgba(x,y);for c in 0..4 {let delta=((a[c]*65535.).round() as i32-(e[c]*65535.).round() as i32).abs();maximum=maximum.max(delta);if delta>2{differences.push((x,y,c,a[c],e[c],delta));}}}}
        assert!(differences.is_empty(),"Three-box max {maximum}, count {}, first {:?}",differences.len(),&differences[..differences.len().min(16)]);
        assert_ne!(preview.png,render_view_preview(&input,&Default::default()).unwrap().png);assert_eq!(preview.png,render_view_preview(actual,&Default::default()).unwrap().png);
    }

    #[test]
    fn existing_blur_edit_input_details_are_lower_stack_pixels_with_one_combined_byte_budget() {
        let (engine,raster)=existing_blur_edit_fixture("filter.blurGallery.fieldBlur");let state=engine.active().unwrap();let source=state.doc.clone();let layer=state.active_layer.unwrap();let color=super::super::color_views::Snapshot::capture(&engine).unwrap();
        let regions=[PreviewRegion{x:3,y:2,width:17,height:13,scale:1},PreviewRegion{x:8,y:4,width:20,height:18,scale:2}];
        let settings=existing_blur_edit_settings("filter.blurGallery.fieldBlur");let result=render_with_color_regions(state,&color,"layer.smartFilter.setParams",json!({"layer":layer.0,"index":1,"params":settings}),None,Some(&regions)).unwrap();
        let input=smart_lens_edit_manual_input(&raster);let input_color=super::super::display::View::new(&engine.color,&input).unwrap();let tiles=result.preview.result.as_ref().unwrap()["blurEdit"]["inputTiles"].as_array().unwrap();assert_eq!(tiles.len(),regions.len());
        for (tile,region) in tiles.iter().zip(regions) {
            assert_eq!((tile["x"].as_u64().unwrap(),tile["y"].as_u64().unwrap(),tile["width"].as_u64().unwrap(),tile["height"].as_u64().unwrap(),tile["scale"].as_u64().unwrap()),(region.x as u64,region.y as u64,region.width as u64,region.height as u64,region.scale as u64));
            assert_eq!(tile["pixelWidth"],region.width.div_ceil(region.scale));assert_eq!(tile["pixelHeight"],region.height.div_ceil(region.scale));
            let bytes=base64::engine::general_purpose::STANDARD.decode(tile["png"].as_str().unwrap()).unwrap();let actual=photocraft_codecs::decode(&bytes).unwrap();let expected=reference_region_pixels(&input,&Default::default(),&input_color,region);
            assert_eq!(actual.as_u8().unwrap().len(),expected.len());assert!(actual.as_u8().unwrap().iter().zip(expected).all(|(a,b)|a.abs_diff(b)<=1));
        }
        let original_color=color.render(&source).unwrap();let expected=existing_blur_edit_direct(&raster,"filter.blurGallery.fieldBlur",settings);let filtered_color=super::super::display::View::new(&engine.color,&expected).unwrap();
        assert_detail_tiles_match_full_reference(result.original_tiles.as_ref().unwrap(),&source,&state.channel_view,&original_color,&regions,"before complete edit");
        for (tile,region) in result.tiles.as_ref().unwrap().iter().zip(regions) {let bytes=base64::engine::general_purpose::STANDARD.decode(&tile.png).unwrap();let image=photocraft_codecs::decode(&bytes).unwrap();let reference=reference_region_pixels(&expected,&state.channel_view,&filtered_color,region);assert!(image.as_u8().unwrap().iter().zip(reference).all(|(a,b)|a.abs_diff(b)<=1));}
        assert_ne!(tiles[0]["png"],result.original_tiles.as_ref().unwrap()[0].png);assert_ne!(tiles[0]["png"],result.tiles.as_ref().unwrap()[0].png);assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));
        let mut boundary=PhotoViewPreview{width:1,height:1,png:"x".repeat(MAX_PREVIEW_BASE_BYTES),result:Some(json!({"blurEdit":{"input":{"png":"i".repeat(MAX_PREVIEW_BASE_BYTES)},"inputTiles":[]}}))};
        assert_eq!(combined_preview_bytes(&boundary).unwrap(),MAX_PREVIEW_TOTAL_BYTES);boundary.result.as_mut().unwrap()["blurEdit"]["inputTiles"]=json!([{"png":"t"}]);assert!(combined_preview_bytes(&boundary).unwrap_err().contains("48 MB"));
        boundary.png.clear();boundary.result.as_mut().unwrap()["blurEdit"]["inputTiles"]=json!([{"png":"t".repeat(MAX_PREVIEW_TILE_BYTES+1)}]);assert!(combined_preview_bytes(&boundary).unwrap_err().contains("2 MB"));
        let request=json!({"layer":layer.0,"index":1,"params":{}});for invalid in [vec![PreviewRegion{scale:3,..regions[0]}],vec![PreviewRegion{x:31,width:2,..regions[0]}],vec![regions[0];9],vec![PreviewRegion{width:513,height:1,scale:1,..regions[0]}]] {assert!(render_with_color_regions(state,&color,"layer.smartFilter.setParams",request.clone(),None,Some(&invalid)).is_err());}
    }

    #[test]
    fn existing_blur_edit_hidden_running_input_preserves_nontrivial_mask_and_blend_context() {
        for id in DETAIL_COMMANDS {for (enabled,visible) in [(false,true),(true,false),(true,true)] {
            let (mut engine,raster)=existing_blur_edit_fixture(id);engine.edit("Filter visibility and blending",|doc,_|{let layer=doc.layers[0].id;let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")};smart.filters_enabled=enabled;smart.smart_filters[1].visible=visible;smart.smart_filters[1].blend=photocraft_engine::doc::BlendMode::Multiply;smart.smart_filters[1].opacity=0.37;smart.filter_mask.as_mut().unwrap().enabled=true;photocraft_engine::smart_cmds::refresh(doc,layer)?;Ok(())}).unwrap();
            let state=engine.active().unwrap();let source=state.doc.clone();let before=camera_raw_edit_smart(&source).clone();let original=render_view_preview(&source,&Default::default()).unwrap().png;let settings=existing_blur_edit_settings(id);let request=json!({"layer":state.active_layer.unwrap().0,"index":1,"params":settings});
            let preview=render(state,"layer.smartFilter.setParams",request.clone()).unwrap();let metadata=&preview.result.as_ref().unwrap()["blurEdit"];assert_eq!(metadata["stackEnabled"],enabled);assert_eq!(metadata["filterVisible"],visible);smart_lens_edit_assert_png(metadata["input"]["png"].as_str().unwrap(),&render_view_preview(&smart_lens_edit_manual_input(&raster),&Default::default()).unwrap().png);
            if !enabled||!visible {assert_eq!(preview.png,original);}
            assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap();let after=camera_raw_edit_smart(&engine.active().unwrap().doc);let mut retained=before;retained.smart_filters[1].params.as_object_mut().unwrap().extend(settings.as_object().unwrap().clone());retained.cache=after.cache.clone();assert_eq!(after,&retained);assert_eq!(preview.png,render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png);
        }}
    }

    #[test]
    fn existing_blur_edit_changed_validation_preserves_legacy_json_and_explicit_array_fallback() {
        for id in ["filter.blurGallery.fieldBlur","filter.blurGallery.pathBlur"] {
            let (mut engine,raster)=existing_blur_edit_fixture(id);let layer=engine.active().unwrap().active_layer.unwrap();let key=if id.ends_with("pathBlur"){"paths"}else{"pins"};
            let rows=if key=="pins"{json!([{"x":1.25,"y":0.4,"blur":2,"vendor":{"keep":[null,1]}},{"x":0.2,"y":0.8,"blur":1}])}else{json!([{"points":[[1.25,0.2],[0.8,0.6]],"speed":2,"vendor":{"keep":[null,1]}}])};
            let legacy=json!({(key):rows,"blur":1e300,"vendor":{"opaque":[null,{"unknown":[1,2,3]}]}});
            engine.edit("Imported legacy blur",|doc,_|{let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")};smart.smart_filters[1].params=legacy.clone();Ok(())}).unwrap();
            let request=json!({"layer":layer.0,"index":1,"params":{"vendor":{"edited":true}}});assert!(render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).is_ok());super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap();assert_eq!(camera_raw_edit_smart(&engine.active().unwrap().doc).smart_filters[1].params[key],rows);
            let mut changed=rows.clone();changed[0][if key=="pins"{"blur"}else{"speed"}]=json!(3);let request=json!({"layer":layer.0,"index":1,"params":{(key):changed}});super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap();assert_eq!(camera_raw_edit_smart(&engine.active().unwrap().doc).smart_filters[1].params[key][0]["vendor"],rows[0]["vendor"]);
            let reset=if key=="pins"{json!({"pins":[],"blur":0})}else{json!({"paths":[],"speed":0,"blur":0})};let request=json!({"layer":layer.0,"index":1,"params":reset});let preview=render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).unwrap();let expected=existing_blur_edit_direct(&raster,id,reset);smart_lens_edit_assert_png(&preview.png,&render_view_preview(&expected,&Default::default()).unwrap().png);super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap();assert_eq!(camera_raw_edit_smart(&engine.active().unwrap().doc).smart_filters[1].params[key],json!([]));assert_eq!(camera_raw_edit_smart(&engine.active().unwrap().doc).smart_filters[1].params["vendor"],json!({"edited":true}));
        }
    }

    #[test]
    fn existing_blur_edit_removed_legacy_rows_match_geometry_without_lending_invalid_values_to_new_rows() {
        let (mut engine,_)=existing_blur_edit_fixture("filter.blurGallery.fieldBlur");let layer=engine.active().unwrap().active_layer.unwrap();
        let legacy=json!({"x":0.8,"y":0.7,"blur":900,"vendor":{"unchanged":[1,2]}});
        engine.edit("Legacy row identity",|doc,_|{let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")};smart.filters_enabled=false;smart.smart_filters[1].params["pins"]=json!([{"x":0.1,"y":0.2,"blur":0},legacy]);Ok(())}).unwrap();
        let mut survivor=legacy.clone();survivor["x"]=json!(0.6);let request=json!({"layer":layer.0,"index":1,"params":{"pins":[survivor]}});
        let preview=render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).unwrap();assert_eq!(preview.result.as_ref().unwrap()["blurEdit"]["stackEnabled"],false);
        super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).unwrap();assert_eq!(camera_raw_edit_smart(&engine.active().unwrap().doc).smart_filters[1].params["pins"],json!([survivor]));
        let source=engine.active().unwrap().doc.clone();let history=engine.active().unwrap().history.entries().to_vec();let journal=engine.journal.clone();
        for inserted in [survivor.clone(),json!({"x":0.1,"y":0.9,"blur":900,"vendor":{"unchanged":[1,2]}}),json!({"x":null,"y":0.2,"blur":0})] {
            let request=json!({"layer":layer.0,"index":1,"params":{"pins":[survivor,inserted]}});assert!(render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).is_err());assert!(super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).is_err());
        }
        // Unknown decorations and a shared invalid blur alone cannot identify a deleted row.
        let request=json!({"layer":layer.0,"index":1,"params":{"pins":[{"x":0.1,"y":0.9,"blur":900,"vendor":{"unchanged":[1,2]}}]}});assert!(super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).is_err());
        assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.entries(),history);assert_eq!(engine.journal,journal);
        let original=json!({"pins":[{"x":0.1,"y":0.2,"blur":900},{"x":0.3,"y":0.2,"blur":900}]});let ambiguous=json!({"pins":[{"x":0.5,"y":0.2,"blur":900}]});assert!(validate_blur_edit("filter.blurGallery.fieldBlur",&original,&ambiguous).is_err());
        let original=json!({"paths":[{"points":[[0.1,0.1],[0.8,1.25],[0.9,0.5]],"speed":2,"vendor":"kept"}]});let edited=json!({"paths":[{"points":[[0.6,1.25],[0.9,0.5]],"speed":2,"vendor":"kept"}]});assert!(validate_blur_edit("filter.blurGallery.pathBlur",&original,&edited).is_ok());
    }

    #[test]
    fn existing_blur_edit_scope_invalid_changes_missing_sources_and_large_preview_refuse_atomically() {
        for id in DETAIL_COMMANDS {
            let (mut engine,_)=existing_blur_edit_fixture(id);let state=engine.active().unwrap();let layer=state.active_layer.unwrap();let source=state.doc.clone();let history=state.history.entries().to_vec();let journal=engine.journal.clone();
            for request in [json!({"index":1,"params":{}}),json!({"layer":layer.0,"params":{}}),json!({"layer":null,"index":1,"params":{}}),json!({"layer":layer.0,"index":99,"params":{}}),json!({"layer":u64::MAX,"index":1,"params":{}}),json!({"layer":layer.0,"index":0,"params":{}})] {assert!(render(state,"layer.smartFilter.setParams",request).is_err());}
            let mut invalid=vec![Value::Null,json!([])];if id.ends_with("pathBlur") {invalid.extend([json!({"speed":null}),json!({"paths":[{"points":[[0,0],[1e300,1]]}]}),json!({"paths":[{"points":[[0,0]]}]}),json!({"paths":vec![json!({});257]})]);}else if id.ends_with("spinBlur"){invalid.extend([json!({"blurAngle":null}),json!({"pins":[{"x":null}]}),json!({"pins":[{"radiusX":0}]}),json!({"pins":vec![json!({});257]})]);}else {invalid.extend([json!({"blur":null}),json!({"blur":1e300}),json!({"blur":500.001})]);if !id.ends_with("tiltShift"){invalid.extend([json!({"pins":[{"x":null}]}),json!({"pins":[{"blur":1e300}]}),json!({"pins":vec![json!({});257]})]);}}
            for draft in invalid {let request=json!({"layer":layer.0,"index":1,"params":draft});assert!(render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).is_err(),"{id}");assert!(super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request).is_err(),"{id}");}
            assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.entries(),history);assert_eq!(engine.journal,journal);
        }
        let (mut engine,_)=existing_blur_edit_fixture("filter.blurGallery.fieldBlur");let original=camera_raw_edit_smart(&engine.active().unwrap().doc).source.clone();let layer=engine.active().unwrap().active_layer.unwrap();
        engine.edit("Unavailable source",|doc,_|{let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")};smart.source=photocraft_engine::doc::SmartSource::Linked{path:"/no/such/orion-existing-blur.png".into()};Ok(())}).unwrap();let source=engine.active().unwrap().doc.clone();let request=json!({"layer":layer.0,"index":1,"params":{"blur":5}});assert!(render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).is_err());assert!(super::super::execute_view_command(&mut engine,"layer.smartFilter.setParams",request.clone()).is_err());assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));
        engine.edit("Restored source",|doc,_|{let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")};smart.source=original.clone();Ok(())}).unwrap();assert!(render(engine.active().unwrap(),"layer.smartFilter.setParams",request.clone()).is_ok());
        engine.edit("Large canvas without pixels",|doc,_|{doc.size=photocraft_engine::doc::Size::new(5000,4000);Ok(())}).unwrap();let source=engine.active().unwrap().doc.clone();assert!(validate_lens_input(&engine,"layer.smartFilter.setParams",&request).is_ok());assert!(render(engine.active().unwrap(),"layer.smartFilter.setParams",request).err().unwrap().contains("image size"));assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));
    }

    fn smart_blur_add_input(raster: &photocraft_engine::doc::Document) -> photocraft_engine::doc::Document {
        existing_blur_edit_direct(raster,"filter.blurGallery.fieldBlur",json!({"blur":0}))
    }

    fn smart_blur_add_raster(doc: &photocraft_engine::doc::Document) -> photocraft_engine::doc::Document {
        let mut input=doc.clone();let cache=camera_raw_edit_smart(doc).cache.clone().unwrap();input.layers[0].content=photocraft_engine::doc::LayerContent::Raster(cache);input
    }

    #[test]
    fn smart_blur_add_all_five_source_bounds_match_direct_stack_apply_undo_and_reopen() {
        for id in DETAIL_COMMANDS {
            let (mut engine,raster)=existing_blur_edit_fixture("filter.blurGallery.fieldBlur");engine.execute("select.rect",json!({"x":7,"y":5,"width":12,"height":11})).unwrap();
            let state=engine.active().unwrap();let source=state.doc.clone();let before=camera_raw_edit_smart(&source).clone();let history=state.history.entries().to_vec();let journal=engine.journal.clone();let targets=(state.active_layer,state.selected_layers.clone(),state.channel_view.clone());let settings=existing_blur_edit_settings(id);let mut request=settings.clone();request["layer"]=json!(state.active_layer.unwrap().0);request["vendor"]=json!({"new":[null,1]});
            let preview=render(state,id,request.clone()).unwrap();let metadata=&preview.result.as_ref().unwrap()["blurEdit"];assert_eq!(metadata["mode"],"source");assert_eq!(metadata["bounds"],json!([0,0,32,24]));assert_eq!(metadata["filterVisible"],true);
            let input=smart_blur_add_input(&raster);smart_lens_edit_assert_png(metadata["input"]["png"].as_str().unwrap(),&render_view_preview(&input,&Default::default()).unwrap().png);
            let mut expected=Session::new();expected.add_document(input,None);expected.execute(id,settings).unwrap();smart_lens_edit_assert_png(&preview.png,&render_view_preview(&expected.active().unwrap().doc,&Default::default()).unwrap().png);
            assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.entries(),history);assert_eq!(engine.journal,journal);assert_eq!((engine.active().unwrap().active_layer,engine.active().unwrap().selected_layers.clone(),engine.active().unwrap().channel_view.clone()),targets);
            super::super::execute_view_command(&mut engine,id,request.clone()).unwrap();let after=camera_raw_edit_smart(&engine.active().unwrap().doc);assert_eq!(after.smart_filters.len(),before.smart_filters.len()+1);assert_eq!(&after.smart_filters[..3],before.smart_filters.as_slice());assert_eq!(after.smart_filters[3].command,id);assert_eq!(after.smart_filters[3].params["vendor"],request["vendor"]);assert_eq!(after.source,before.source);assert_eq!(after.filter_mask,before.filter_mask);assert_eq!(preview.png,render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png);
            engine.execute("edit.undo",json!({})).unwrap();assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));engine.execute("edit.redo",json!({})).unwrap();let bundle=photocraft_format::save_to_bytes(&engine.active().unwrap().doc,&Default::default()).unwrap();let mut reopened=photocraft_format::load_from_bytes(&bundle).unwrap();let layer=reopened.layers[0].id;assert!(photocraft_engine::smart_cmds::refresh(&mut reopened,layer).unwrap());assert_eq!(preview.png,render_view_preview(&reopened,&Default::default()).unwrap().png);assert_eq!(camera_raw_edit_smart(&reopened).source,before.source);
        }
    }

    #[test]
    fn smart_blur_add_all_five_missing_cache_bounds_follow_selection_even_when_stack_disabled() {
        for id in DETAIL_COMMANDS {for enabled in [true,false] {
            let (mut engine,_)=existing_blur_edit_fixture("filter.blurGallery.fieldBlur");engine.execute("select.rect",json!({"x":7,"y":5,"width":12,"height":11})).unwrap();
            engine.edit("Cached missing source",|doc,_|{let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")};smart.source=photocraft_engine::doc::SmartSource::Linked{path:"/no/such/orion-smart-blur-add.pcraft".into()};smart.filters_enabled=enabled;smart.filter_mask=None;Ok(())}).unwrap();
            let state=engine.active().unwrap();let source=state.doc.clone();let before=camera_raw_edit_smart(&source).clone();let cache=smart_blur_add_raster(&source);let settings=existing_blur_edit_settings(id);let mut request=settings.clone();request["layer"]=json!(state.active_layer.unwrap().0);
            let preview=render(state,id,request.clone()).unwrap();let metadata=&preview.result.as_ref().unwrap()["blurEdit"];assert_eq!(metadata["mode"],"cache");assert_eq!(metadata["bounds"],json!([7,5,12,11]));assert_eq!(metadata["stackEnabled"],enabled);smart_lens_edit_assert_png(metadata["input"]["png"].as_str().unwrap(),&render_view_preview(&cache,&Default::default()).unwrap().png);
            let mut expected=Session::new();expected.add_document(cache,None);expected.execute(id,settings).unwrap();assert_eq!(preview.png,render_view_preview(&expected.active().unwrap().doc,&Default::default()).unwrap().png);
            assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));super::super::execute_view_command(&mut engine,id,request).unwrap();let after=camera_raw_edit_smart(&engine.active().unwrap().doc);assert_eq!(after.source,before.source);assert_eq!(after.filters_enabled,enabled);assert_eq!(after.filter_mask,None);assert_eq!(&after.smart_filters[..3],before.smart_filters.as_slice());assert_eq!(after.smart_filters.len(),4);assert_eq!(preview.png,render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png);
            engine.execute("edit.undo",json!({})).unwrap();assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));engine.execute("edit.redo",json!({})).unwrap();let bundle=photocraft_format::save_to_bytes(&engine.active().unwrap().doc,&Default::default()).unwrap();let reopened=photocraft_format::load_from_bytes(&bundle).unwrap();assert_eq!(preview.png,render_view_preview(&reopened,&Default::default()).unwrap().png);assert_eq!(camera_raw_edit_smart(&reopened).source,before.source);
        }}
    }

    #[test]
    fn smart_blur_add_source_coordinates_and_sharp_tiles_use_unmasked_input_not_selection_or_composite() {
        let id="filter.blurGallery.irisBlur";let (mut engine,raster)=existing_blur_edit_fixture("filter.blurGallery.fieldBlur");engine.execute("select.rect",json!({"x":7,"y":5,"width":12,"height":11})).unwrap();
        let state=engine.active().unwrap();let source=state.doc.clone();let color=super::super::color_views::Snapshot::capture(&engine).unwrap();let regions=[PreviewRegion{x:3,y:2,width:17,height:13,scale:1},PreviewRegion{x:8,y:4,width:20,height:18,scale:2}];let settings=json!({"centerX":0.5,"centerY":0.5,"radiusX":0.2,"radiusY":0.2,"blur":5,"feather":0.5});let mut request=settings.clone();request["layer"]=json!(state.active_layer.unwrap().0);
        let result=render_with_color_regions(state,&color,id,request,None,Some(&regions)).unwrap();let metadata=&result.preview.result.as_ref().unwrap()["blurEdit"];assert_eq!(metadata["bounds"],json!([0,0,32,24]));assert_eq!((32.*0.5,24.*0.5),(16.,12.));assert_ne!((16.,12.),(7.+12.*0.5,5.+11.*0.5));
        let input=smart_blur_add_input(&raster);let input_color=super::super::display::View::new(&engine.color,&input).unwrap();let tiles=metadata["inputTiles"].as_array().unwrap();assert_eq!(tiles.len(),2);
        for (tile,region) in tiles.iter().zip(regions) {assert_eq!(tile["x"],region.x);assert_eq!(tile["y"],region.y);assert_eq!(tile["pixelWidth"],region.width.div_ceil(region.scale));assert_eq!(tile["pixelHeight"],region.height.div_ceil(region.scale));let image=photocraft_codecs::decode(&base64::engine::general_purpose::STANDARD.decode(tile["png"].as_str().unwrap()).unwrap()).unwrap();let expected=reference_region_pixels(&input,&Default::default(),&input_color,region);assert_eq!(image.as_u8().unwrap().len(),expected.len());assert!(image.as_u8().unwrap().iter().zip(expected).all(|(a,b)|a.abs_diff(b)<=1));}
        let mut wrong=input.clone();let extent=wrong.bounds().union(&wrong.layers[0].surface().unwrap().content_bounds());let pixels=photocraft_engine::filters::apply_filter_to_surface(id,&settings,wrong.layers[0].surface().unwrap(),photocraft_engine::doc::Rect::from_xywh(7,5,12,11),None,extent).unwrap();wrong.layers[0].content=photocraft_engine::doc::LayerContent::Raster(pixels);assert_ne!(result.preview.png,render_view_preview(&wrong,&Default::default()).unwrap().png);assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));
        assert!(combined_preview_bytes(&result.preview).unwrap()+result.original_tiles.as_ref().unwrap().iter().chain(result.tiles.as_ref().unwrap()).map(|tile|tile.png.len()).sum::<usize>()<=MAX_PREVIEW_TOTAL_BYTES);
    }

    #[test]
    fn smart_blur_add_disabled_source_input_runs_prior_stack_and_selection_mask_is_created_only_for_source() {
        for missing in [false,true] {for has_selection in [false,true] {
            let (mut engine,raster)=existing_blur_edit_fixture("filter.blurGallery.fieldBlur");if has_selection{engine.execute("select.rect",json!({"x":7,"y":5,"width":12,"height":11})).unwrap();}
            engine.edit("Disabled filter context",|doc,_|{let layer=doc.layers[0].id;let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")};smart.filters_enabled=false;smart.filter_mask=None;if missing{smart.source=photocraft_engine::doc::SmartSource::Linked{path:"/no/such/orion-smart-blur-mask.pcraft".into()};}else{photocraft_engine::smart_cmds::refresh(doc,layer)?;}Ok(())}).unwrap();
            let state=engine.active().unwrap();let source=state.doc.clone();let original=render_view_preview(&source,&Default::default()).unwrap().png;let request=json!({"layer":state.active_layer.unwrap().0,"pins":[{"x":0.5,"y":0.5,"blur":5}]});let preview=render(state,"filter.blurGallery.fieldBlur",request.clone()).unwrap();let metadata=&preview.result.as_ref().unwrap()["blurEdit"];assert_eq!(metadata["mode"],if missing{"cache"}else{"source"});assert_eq!(metadata["bounds"],if missing&&has_selection{json!([7,5,12,11])}else{json!([0,0,32,24])});
            let input=if missing{smart_blur_add_raster(&source)}else{smart_blur_add_input(&raster)};smart_lens_edit_assert_png(metadata["input"]["png"].as_str().unwrap(),&render_view_preview(&input,&Default::default()).unwrap().png);if missing{assert_ne!(preview.png,original);}else{assert_eq!(preview.png,original);}
            super::super::execute_view_command(&mut engine,"filter.blurGallery.fieldBlur",request).unwrap();let smart=camera_raw_edit_smart(&engine.active().unwrap().doc);assert_eq!(smart.filter_mask.is_some(),!missing&&has_selection);if !missing&&has_selection{assert_eq!(smart.filter_mask.as_ref().unwrap().surface,*source.selection.as_ref().unwrap());}assert!(!smart.filters_enabled);assert_eq!(preview.png,render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png);
        }}
    }

    #[test]
    fn smart_blur_add_coverage_and_raster_targets_never_read_smart_sources_and_failures_are_atomic() {
        let root=std::env::temp_dir().join(format!("orion-smart-blur-target-{}",ulid::Ulid::new()));std::fs::create_dir_all(&root).unwrap();let path=root.join("large.pcraft");let file=std::fs::File::create(&path).unwrap();file.set_len(super::super::MAX_INPUT_BYTES+1).unwrap();drop(file);
        for route in ["mask","alpha","quickMask"] {
            let (mut engine,_)=existing_blur_edit_fixture("filter.blurGallery.fieldBlur");engine.edit("Oversized unneeded source",|doc,_|{let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")};smart.source=photocraft_engine::doc::SmartSource::Linked{path:path.to_string_lossy().into()};Ok(())}).unwrap();
            match route {"mask"=>{engine.execute("layer.layerMask.revealAll",json!({})).unwrap();engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();},"alpha"=>{engine.execute("channel.new",json!({"name":"Target plane","fill":"white"})).unwrap();engine.execute("channel.target",json!({"channel":0})).unwrap();},_=>{engine.execute("select.rect",json!({"x":7,"y":5,"width":12,"height":11})).unwrap();engine.execute("select.editInQuickMaskMode",json!({})).unwrap();}}
            let state=engine.active().unwrap();let source=state.doc.clone();let history=state.history.entries().to_vec();let journal=engine.journal.clone();let request=json!({"layer":state.active_layer.unwrap().0,"blur":2});let preview=render(state,"filter.blurGallery.fieldBlur",request.clone()).unwrap();assert!(preview.result.as_ref().unwrap().get("blurEdit").is_none());assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.entries(),history);assert_eq!(engine.journal,journal);
            let mut pixels=request.clone();pixels["target"]=json!("pixels");assert!(render(engine.active().unwrap(),"filter.blurGallery.fieldBlur",pixels.clone()).err().unwrap().contains("512MB"));assert!(super::super::execute_view_command(&mut engine,"filter.blurGallery.fieldBlur",pixels).unwrap_err().contains("512MB"));assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));
            super::super::execute_view_command(&mut engine,"filter.blurGallery.fieldBlur",request).unwrap();assert_eq!(preview.png,render_view_preview(&engine.active().unwrap().doc,&engine.active().unwrap().channel_view).unwrap().png);
        }
        let raster=ordinary_filter_fixture(16);assert!(render(raster.active().unwrap(),"filter.blurGallery.fieldBlur",json!({"blur":2})).unwrap().result.as_ref().unwrap().get("blurEdit").is_none());
        let (mut engine,_)=existing_blur_edit_fixture("filter.blurGallery.fieldBlur");let source=engine.active().unwrap().doc.clone();let layer=engine.active().unwrap().active_layer.unwrap();for params in [json!({"layer":u64::MAX,"blur":2}),json!({"layer":layer.0,"target":null,"blur":2})] {assert!(render(engine.active().unwrap(),"filter.blurGallery.fieldBlur",params.clone()).is_err());assert!(super::super::execute_view_command(&mut engine,"filter.blurGallery.fieldBlur",params).is_err());assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));}
        engine.edit("Large document",|doc,_|{doc.size=photocraft_engine::doc::Size::new(5000,4000);Ok(())}).unwrap();let source=engine.active().unwrap().doc.clone();assert!(render(engine.active().unwrap(),"filter.blurGallery.fieldBlur",json!({"layer":layer.0,"blur":2})).err().unwrap().contains("image size"));assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn smart_blur_add_cache_retains_off_canvas_legacy_bounds_and_empty_selection_uses_canvas() {
        for empty in [false,true] {
            let (mut engine,_)=existing_blur_edit_fixture("filter.blurGallery.fieldBlur");
            engine.edit("Legacy cached selection",|doc,_|{let mut selection=photocraft_engine::doc::LayerMask::hide_all().surface;if !empty{selection.fill_rect(photocraft_engine::doc::Rect::from_xywh(-3,-2,20,15),&[1.]);}doc.selection=Some(selection);let photocraft_engine::doc::LayerContent::Smart(smart)=&mut doc.layers[0].content else{panic!("missing Smart Object")};smart.source=photocraft_engine::doc::SmartSource::Linked{path:"/no/such/orion-smart-blur-legacy.pcraft".into()};Ok(())}).unwrap();
            let state=engine.active().unwrap();let source=state.doc.clone();let request=json!({"layer":state.active_layer.unwrap().0,"blur":2,"centerX":0.5,"centerY":0.5});let preview=render(state,"filter.blurGallery.fieldBlur",request.clone()).unwrap();let metadata=&preview.result.as_ref().unwrap()["blurEdit"];assert_eq!(metadata["mode"],"cache");assert_eq!(metadata["bounds"],if empty{json!([0,0,32,24])}else{json!([-3,-2,20,15])});
            let mut expected=Session::new();expected.add_document(smart_blur_add_raster(&source),None);expected.execute("filter.blurGallery.fieldBlur",json!({"blur":2,"centerX":0.5,"centerY":0.5})).unwrap();assert_eq!(preview.png,render_view_preview(&expected.active().unwrap().doc,&Default::default()).unwrap().png);if empty{assert_eq!(preview.png,render_view_preview(&source,&Default::default()).unwrap().png);}
            assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));super::super::execute_view_command(&mut engine,"filter.blurGallery.fieldBlur",request).unwrap();assert_eq!(preview.png,render_view_preview(&engine.active().unwrap().doc,&Default::default()).unwrap().png);assert_eq!(engine.active().unwrap().doc.selection,source.selection);
        }
    }

    #[test]
    fn smart_blur_add_cache_policy_keeps_raster_hits_and_recomputes_smart_input_regions() {
        use super::completed_cache::{Cache,Request};use std::sync::Mutex;
        for smart in [false,true] {
            let engine=if smart{existing_blur_edit_fixture("filter.blurGallery.fieldBlur").0}else{ordinary_filter_fixture(16)};let state=engine.active().unwrap();let color=super::super::color_views::Snapshot::capture(&engine).unwrap();let cache=Mutex::new(Cache::default());let regions=[PreviewRegion{x:2,y:3,width:8,height:7,scale:1},PreviewRegion{x:12,y:5,width:10,height:9,scale:1}];
            for region in regions {let result=render_using_cache(state,Some(&color),"filter.blurGallery.fieldBlur",json!({"layer":state.active_layer.unwrap().0,"blur":2}),None,Some(&[region]),Some(Request{owner:"ordinary-smart",version:"v1",cache:&cache,control:None})).unwrap();if smart{let tile=&result.preview.result.as_ref().unwrap()["blurEdit"]["inputTiles"][0];assert_eq!(tile["x"],region.x);assert_eq!(tile["y"],region.y);assert_eq!(result.preview.result.as_ref().unwrap()["blurEdit"]["mode"],"source");}else{assert!(result.preview.result.as_ref().unwrap().get("blurEdit").is_none());}}
            let counts=cache.lock().unwrap();assert_eq!((counts.hits,counts.misses,counts.executions,counts.base_encodes),if smart{(0,0,2,2)}else{(1,1,1,1)});
        }
    }

    #[test]
    fn geometry_previews_accept_native_pins_planes_strokes_and_bezier_meshes() {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":32,"height":32,"background":"white"}),
            )
            .unwrap();
        let state = engine.active().unwrap();
        let before = state.doc.clone();
        let points: Vec<_> = (0..16)
            .map(|index| json!([(index % 4) * 10, (index / 4) * 10]))
            .collect();
        for (command, params) in [
            (
                "edit.transform.warp",
                json!({"style":"custom","rect":[0,0,30,30],"mesh":{"us":[0,1],"vs":[0,1],"points":points}}),
            ),
            (
                "filter.liquify",
                json!({"strokes":[{"tool":"forwardWarp","size":12,"points":[[8,8],[12,12]]}]}),
            ),
            (
                "edit.puppetWarp",
                json!({"pins":[{"src":[6,6],"dst":[6,6]},{"src":[25,6],"dst":[25,6]},{"src":[6,25],"dst":[7,25]}]}),
            ),
            (
                "edit.perspectiveWarp",
                json!({"planes":[{"src":[[0,0],[32,0],[32,32],[0,32]],"dst":[[2,0],[32,0],[32,32],[2,32]]}]}),
            ),
        ] {
            let result =
                render(state, command, params).unwrap_or_else(|error| panic!("{command}: {error}"));
            assert_eq!((result.width, result.height), (32, 32));
            assert!(std::sync::Arc::ptr_eq(
                &before,
                &engine.active().unwrap().doc
            ));
        }
    }
    #[test]
    fn live_gradient_preview_returns_native_handles_and_does_not_commit() {
        let mut engine = Session::new();
        engine
            .execute("file.new", json!({"width":64,"height":64}))
            .unwrap();
        let id = engine
            .execute(
                "gradient.fill.create",
                json!({"from":[10,32],"to":[54,32],"stops":[[0,"#000000"],[1,"#ffffff"]]}),
            )
            .unwrap()["layer"]
            .clone();
        let state = engine.active().unwrap();
        let source = state.doc.clone();
        let history = state.history.entries().to_vec();
        let preview = render(
            state,
            "gradient.fill.set",
            json!({"layer":id,"angle":90,"stops":[[0,"#ff0000"],[1,"#ff0000"]]}),
        )
        .unwrap();
        assert_eq!(
            preview.result.as_ref().unwrap()["angle"].as_f64(),
            Some(90.0)
        );
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&preview.png)
            .unwrap();
        let image = photocraft_codecs::decode(&bytes).unwrap();
        let pixels = image.as_u8().unwrap();
        assert!(pixels[0] > 240 && pixels[1] < 10);
        assert!(std::sync::Arc::ptr_eq(
            &source,
            &engine.active().unwrap().doc
        ));
        assert_eq!(engine.active().unwrap().history.entries(), history);
    }
    #[test]
    fn solid_color_fill_layer_previews_the_picked_color_without_adding_the_layer() {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":32,"height":32})).unwrap();
        let state = engine.active().unwrap();
        let (source, history) = (state.doc.clone(), state.history.entries().to_vec());
        let preview = render(state, "layer.newFillLayer.solidColor", json!({"color":"#ff0000"})).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD.decode(&preview.png).unwrap();
        let image = photocraft_codecs::decode(&bytes).unwrap();
        let pixels = image.as_u8().unwrap();
        assert!(pixels[0] > 240 && pixels[1] < 10 && pixels[2] < 10);
        assert!(std::sync::Arc::ptr_eq(&source, &engine.active().unwrap().doc));
        assert_eq!(engine.active().unwrap().history.entries(), history);
    }
    #[test]
    fn solid_color_fill_layer_previews_with_the_new_layer_options_it_will_be_made_with() {
        let mut engine = Session::new();
        engine.execute("file.new", json!({"width":32,"height":32})).unwrap();
        let preview = render(engine.active().unwrap(), "layer.newFillLayer.solidColor", json!({"color":"#ff0000","props":{"blend":"Difference","opacity":0.5}})).unwrap();
        let image = photocraft_codecs::decode(&base64::engine::general_purpose::STANDARD.decode(&preview.png).unwrap()).unwrap();
        let pixels = image.as_u8().unwrap();
        // Red in Difference over white is cyan; at 50% opacity, half of it.
        assert!(pixels[0].abs_diff(128) < 4 && pixels[1] > 250 && pixels[2] > 250, "{:?}", &pixels[..4]);
    }
}
