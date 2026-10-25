//! Native brush and retouch feedback in an isolated copy-on-write document.
//! Bounded gesture drafts never change source pixels, history, or presets.
use super::{tiles, PhotoTile};
use photocraft_engine::{doc::Rect, Session};
use serde_json::Value;
#[path = "xdesign_photo_retouch.rs"]
mod continuous_retouch;
#[path = "xdesign_photo_brush_feedback.rs"]
mod brush_feedback;
use brush_feedback::BrushDraft;
#[cfg(test)]
#[path = "xdesign_photo_brush_completion_tests.rs"]
mod brush_completion_tests;
use std::{collections::HashMap, sync::{Mutex, OnceLock}, time::{Duration, Instant}};
use std::sync::{Arc,atomic::{AtomicBool,Ordering}};

struct IncrementalStroke { live:BrushDraft, points:Vec<Value>, touched:Instant, view:Option<[u32;5]> }
struct RetouchDraft {
    source:std::sync::Arc<photocraft_engine::doc::Document>,document:std::sync::Arc<photocraft_engine::doc::Document>,
    before:photocraft_engine::ToolState,
    clone_before:photocraft_engine::presets::clone_source::CloneSources,
    preset_revision:u64,damage:Rect,seed:u64,touched:Instant,
    active_layer:Option<photocraft_engine::doc::LayerId>, channel_view:photocraft_engine::channel_cmds::ChannelView,
    live:Option<continuous_retouch::RetouchStroke>,points:Vec<Value>,lease:u64,
    history_source:Option<(Value,std::sync::Arc<photocraft_engine::doc::Document>)>,
    cancel:Arc<AtomicBool>,
}
impl Drop for RetouchDraft{fn drop(&mut self){self.cancel.store(true,Ordering::Relaxed);}}
fn retouch_cache()->&'static Mutex<HashMap<String,RetouchDraft>>{static CACHE:OnceLock<Mutex<HashMap<String,RetouchDraft>>>=OnceLock::new();CACHE.get_or_init(Default::default)}
fn retouch_key(identity:&str,command:&str,params:&Value)->String{format!("{identity}/{command}/{params}")}
fn feedback_tools(source:&photocraft_engine::ToolState)->photocraft_engine::ToolState {
    photocraft_engine::ToolState{foreground:source.foreground,background:source.background,brush:source.brush.clone(),mixer:source.mixer.clone(),presets_rev:source.presets_rev,presets:Vec::new(),brush_gesture:None}
}
impl RetouchDraft {
    fn matches(&self,engine:&Session)->bool {
        !self.cancel.load(Ordering::Relaxed)&&self.touched.elapsed()<Duration::from_secs(30)&&engine.active().is_some_and(|state|std::sync::Arc::ptr_eq(&self.source,&state.doc))
        &&engine.active().is_some_and(|state|state.active_layer==self.active_layer&&state.channel_view==self.channel_view)
        &&self.before.brush==engine.tools.brush&&self.before.mixer==engine.tools.mixer
        &&self.before.foreground==engine.tools.foreground&&self.before.background==engine.tools.background
        &&self.before.presets_rev==engine.tools.presets_rev&&self.preset_revision==engine.presets.rev&&self.clone_before==engine.presets.clone
        &&self.history_source.as_ref().is_none_or(|(params,doc)|super::history::resolve(engine,params).is_ok_and(|source|std::sync::Arc::ptr_eq(doc,&source.doc)))
    }
}
fn stroke_key(identity:&str,command:&str,params:&Value)->Result<String,String>{let mut settings=params.clone();let settings=settings.as_object_mut().ok_or("Invalid stroke settings")?;settings.remove("points");settings.remove("_orionOffset");Ok(format!("{identity}/{command}/{}",Value::Object(settings.clone())))}
fn incremental_cache()->&'static Mutex<HashMap<String,IncrementalStroke>> {static CACHE:OnceLock<Mutex<HashMap<String,IncrementalStroke>>>=OnceLock::new();CACHE.get_or_init(Default::default)}
pub(super) fn release(identity:&str,seed:u64)->Result<(),String>{incremental_cache().lock().map_err(|_|"Stroke feedback needs to be restarted")?.retain(|key,entry|!key.starts_with(&format!("{identity}/"))||entry.live.seed()!=seed);retouch_cache().lock().map_err(|_|"Retouch feedback needs to be restarted")?.retain(|key,entry|!key.starts_with(&format!("{identity}/"))||entry.seed!=seed);Ok(())}
fn incremental(engine:&Session, identity:&str, command:&str, params:&Value)->Result<(std::sync::Arc<photocraft_engine::doc::Document>,Rect),String> {
    incremental_step(engine,identity,command,params,None).map(|(doc,bounds,_)|(doc,bounds))
}
/// Like `incremental`, plus the area this call changed. `None` means the caller must redraw
/// the whole stroke: the first batch, a repeated batch, or a different viewport/scale whose
/// tiles have not seen the earlier samples yet.
fn incremental_step(engine:&Session, identity:&str, command:&str, params:&Value, view:Option<[u32;5]>)->Result<(std::sync::Arc<photocraft_engine::doc::Document>,Rect,Option<Rect>),String> {
    let key=stroke_key(identity,command,params)?;
    let points=params["points"].as_array().ok_or("Missing stroke points")?;
    if points.len()>65_536{return Err("Native brush feedback supports up to 65536 samples".into());}
    let offset=params.get("_orionOffset").map(|offset|offset.as_u64().and_then(|value|usize::try_from(value).ok()).ok_or("Invalid stroke offset")).transpose()?;
    if offset.is_some_and(|offset|offset.checked_add(points.len()).is_none_or(|count|count>65_536)){return Err("Native brush feedback supports up to 65536 samples".into());}
    let mut cache=incremental_cache().lock().map_err(|_|"Stroke feedback needs to be restarted")?;
    cache.retain(|_,entry|entry.touched.elapsed()<Duration::from_secs(30));
    if cache.get(&key).is_some_and(|entry|!entry.live.matches(engine)){return Err("The brush context changed; start another gesture".into());}
    if offset.is_none()&&cache.get(&key).is_some_and(|entry|points.len()<entry.points.len()||points[..entry.points.len()]!=entry.points){return Err("The stroke samples changed; start another gesture".into());}
    if let Some(entry)=cache.get_mut(&key) {
        let delta=if let Some(offset)=offset {
            if offset>entry.points.len(){return Err("Stroke feedback missed a sample batch; start another gesture".into());}
            let overlap=(entry.points.len()-offset).min(points.len());
            if entry.points[offset..offset+overlap]!=points[..overlap]{return Err("The stroke samples changed; start another gesture".into());}
            &points[overlap..]
        }else{&points[entry.points.len()..]};
        let same_view=view.is_some()&&entry.view==view;entry.view=view;
        let mut step=None;
        if !delta.is_empty() {let mut patch=params.clone();patch["points"]=Value::Array(delta.to_vec());let samples=photocraft_engine::brush_cmds::parse_points(&patch,command).map_err(|e|e.to_string())?;step=Some(entry.live.push(&samples)?);entry.points.extend_from_slice(delta);}
        entry.touched=Instant::now();return Ok((entry.live.document(),entry.live.bounds(),step.filter(|_|same_view)));
    }
    if offset.is_some_and(|offset|offset!=0){return Err("The stroke feedback expired; finish the stroke to render the edit".into());}
    // Bound retained drafts, including their original copy-on-write surfaces.
    if cache.len()>=2 {let oldest=cache.iter().min_by_key(|(_,entry)|entry.touched).map(|(key,_)|key.clone());if let Some(oldest)=oldest{cache.remove(&oldest);}}
    let live=BrushDraft::begin(engine,command,params)?;
    let result=(live.document(),live.bounds(),None);cache.insert(key,IncrementalStroke{live,points:points.clone(),touched:Instant::now(),view});Ok(result)
}
pub(super) fn commit_feedback(engine:&mut Session,identity:&str,command:&str,params:&Value)->Option<Result<Value,String>>{
    if continuous_retouch::TOOLS.contains(&command)&&!cfg!(target_arch="wasm32"){
        if engine.has_jobs(){return None;}
        let key=stroke_key(identity,command,params).ok()?;
        let ready=retouch_cache().lock().ok()?.get(&key).is_some_and(|entry|entry.live.is_some()&&entry.matches(engine));
        if !ready||params.get("_orionOffset").is_some(){return None;}
        if continuous_retouch_document(engine,identity,command,params).is_err(){return None;}
        let mut entry=retouch_cache().lock().ok()?.remove(&key)?;
        let prepared=entry.live.take()?.prepared(command,params).ok()?;
        entry.document=entry.source.clone();entry.points.clear();
        let params=match super::history::normalize(engine,command,params.clone()){Ok(params)=>params,Err(error)=>return Some(Err(error))};
        return Some(super::prepared::commit(engine,command,params,prepared,move|engine|entry.matches(engine)));
    }
    if !["paint.stroke","paint.pencil"].contains(&command)||cfg!(target_arch="wasm32")||engine.has_jobs()||params.get("_orionOffset").is_some(){return None;}
    let key=match stroke_key(identity,command,params){Ok(key)=>key,Err(error)=>return Some(Err(error))};
    let ready=incremental_cache().lock().ok()?.get(&key).is_some_and(|entry|entry.touched.elapsed()<Duration::from_secs(30)&&entry.live.matches(engine));
    if !ready||incremental(engine,identity,command,params).is_err(){return None;}
    let entry=incremental_cache().lock().ok()?.remove(&key)?;
    let prepared=entry.live.prepared();
    Some(super::prepared::commit(engine,command,params.clone(),prepared,move|engine|entry.touched.elapsed()<Duration::from_secs(30)&&entry.live.matches(engine)))
}

fn continuous_retouch_document(engine:&Session,identity:&str,command:&str,params:&Value)->Result<(std::sync::Arc<photocraft_engine::doc::Document>,Rect),String> {
    let key=stroke_key(identity,command,params)?;
    let points=params["points"].as_array().ok_or("Missing retouch points")?;
    let offset=params.get("_orionOffset").map(|value|value.as_u64().and_then(|value|usize::try_from(value).ok()).ok_or("Invalid retouch sample offset")).transpose()?;
    let mut cache=retouch_cache().lock().map_err(|_|"Retouch feedback needs to be restarted")?;
    cache.retain(|_,entry|entry.touched.elapsed()<Duration::from_secs(30));
    if cache.get(&key).is_some_and(|entry|entry.live.is_none()&&entry.matches(engine)){return Err("Retouch feedback is already preparing this gesture".into());}
    let valid=cache.get(&key).is_some_and(|entry|entry.live.is_some()&&entry.matches(engine));
    if !valid&&offset.is_some_and(|offset|offset!=0){return Err("The retouch context changed or expired; start another gesture".into());}
    let start=if valid {
        let old=&cache[&key].points;
        if let Some(offset)=offset {
            if offset>old.len(){return Err("Retouch feedback missed a sample batch; start another gesture".into());}
            let overlap=(old.len()-offset).min(points.len());
            if old[offset..offset+overlap]!=points[..overlap]{return Err("The retouch samples changed; start another gesture".into());}
            overlap
        }else{
            if points.len()<old.len()||points[..old.len()]!=old[..]{return Err("The retouch samples changed; start another gesture".into());}
            old.len()
        }
    }else{0};
    let delta=&points[start..];
    let retained=if valid {cache[&key].points.len()}else{0};
    if retained.checked_add(delta.len()).is_none_or(|count|count>65_536){return Err("Continuous retouch feedback supports up to 65536 samples".into());}
    if valid&&delta.is_empty(){let entry=cache.get_mut(&key).unwrap();entry.touched=Instant::now();return Ok((entry.document.clone(),entry.damage));}
    if !valid {
        let state=engine.active().ok_or("No retouch image")?;
        static NEXT_LEASE:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(1);
        if cache.len()>=2&&!cache.contains_key(&key){let oldest=cache.iter().filter(|(_,entry)|entry.live.is_some()).min_by_key(|(_,entry)|entry.touched).map(|(key,_)|key.clone()).ok_or("Wait for the current retouch feedback")?;cache.remove(&oldest);}
        let history_source=if command=="paint.historyBrush"{Some((super::history::parameters(params),super::history::resolve(engine,params)?.doc))}else{None};
        cache.insert(key.clone(),RetouchDraft{source:state.doc.clone(),document:state.doc.clone(),before:feedback_tools(&engine.tools),clone_before:engine.presets.clone.clone(),preset_revision:engine.presets.rev,damage:Rect::EMPTY,seed:params["seed"].as_u64().unwrap_or(0),touched:Instant::now(),active_layer:state.active_layer,channel_view:state.channel_view.clone(),live:Some(continuous_retouch::RetouchStroke::begin(engine,command,params)?),points:Vec::new(),lease:NEXT_LEASE.fetch_add(1,std::sync::atomic::Ordering::Relaxed),history_source,cancel:Arc::new(AtomicBool::new(false))});
    }
    let entry=cache.get_mut(&key).ok_or("No retouch draft")?;
    let lease=entry.lease;let cancel=entry.cancel.clone();let mut live=entry.live.take().ok_or("No continuous retouch draft")?;let delta=delta.to_vec();
    drop(cache);
    // A lease placeholder makes cancellation observable while the coverage/solve
    // runs outside the shared cache lock. Canceled work cannot reinsert itself.
    let stopped=||cancel.load(Ordering::Relaxed);let ctl=photocraft_raster::Interrupt::cancel_only(&stopped);
    let mut patch=params.clone();patch["points"]=Value::Array(delta.clone());let prepared=live.push_with(&patch,&ctl);
    finish_coverage(&key,lease,live,delta,prepared)
}

fn finish_coverage(key:&str,lease:u64,live:continuous_retouch::RetouchStroke,delta:Vec<Value>,prepared:Result<(),String>)->Result<(std::sync::Arc<photocraft_engine::doc::Document>,Rect),String>{
    let mut cache=retouch_cache().lock().map_err(|_|"Retouch feedback needs to be restarted")?;
    if cache.get(key).is_none_or(|entry|entry.lease!=lease){return Err("The retouch feedback was canceled".into());}
    if let Err(error)=prepared{cache.remove(key);return Err(error);}
    let entry=cache.get_mut(key).ok_or("No retouch draft")?;
    entry.document=live.document();entry.damage=live.damage();entry.points.extend(delta);entry.touched=Instant::now();entry.live=Some(live);
    Ok((entry.document.clone(),entry.damage))
}

fn retouch_document(engine:&Session,identity:Option<&str>,command:&str,params:&Value)->Result<(std::sync::Arc<photocraft_engine::doc::Document>,Rect),String> {
    if continuous_retouch::TOOLS.contains(&command){if let Some(identity)=identity{return continuous_retouch_document(engine,identity,command,params);}}
    let key=identity.map(|identity|retouch_key(identity,command,params));
    if let Some(key)=&key {let mut cache=retouch_cache().lock().map_err(|_|"Retouch feedback needs to be restarted")?;
        cache.retain(|_,entry|entry.touched.elapsed()<Duration::from_secs(30));
        if let Some(entry)=cache.get_mut(key).filter(|entry|entry.matches(engine)){entry.touched=Instant::now();return Ok((entry.document.clone(),entry.damage));}
    }
    // Identity-less callers have no retained context. Final commits stay native
    // for journaling, Fade, scripts and tool state.
    let state=engine.active().ok_or("No retouch preview")?;
    let mut draft=Session::new();draft.add_document((*state.doc).clone(),None);
    let mut source=state.clone();if command!="paint.historyBrush"{source.history=Default::default();}*draft.active_mut().ok_or("No retouch preview")?=source;
    draft.tools=engine.tools.clone();draft.presets=engine.presets.clone();draft.patterns=engine.patterns.clone();
    let result=draft.execute(command,super::history::normalize(engine,command,params.clone())?).map_err(|error|error.to_string())?;
    let edited=draft.active().ok_or("No retouch preview")?;
    let damage=result["damage"].as_array().filter(|values|values.len()==4).and_then(|values|Some(Rect::from_xywh(values[0].as_i64()? as i32,values[1].as_i64()? as i32,u32::try_from(values[2].as_u64()?).ok()?,u32::try_from(values[3].as_u64()?).ok()?))).or(edited.last_damage).ok_or("Retouch preview returned no damaged region")?;
    let document=edited.doc.clone();
    if let Some(key)=key {let mut cache=retouch_cache().lock().map_err(|_|"Retouch feedback needs to be restarted")?;
        // Retain only the latest retouch draft: its touched surface is bounded
        // to 16MP, and the original document is shared through copy-on-write.
        cache.clear();cache.insert(key,RetouchDraft{source:state.doc.clone(),document:document.clone(),before:feedback_tools(&engine.tools),clone_before:engine.presets.clone.clone(),preset_revision:engine.presets.rev,damage,seed:params["seed"].as_u64().unwrap_or(0),touched:Instant::now(),active_layer:state.active_layer,channel_view:state.channel_view.clone(),live:None,points:Vec::new(),lease:0,history_source:None,cancel:Arc::new(AtomicBool::new(false))});
    }
    Ok((document,damage))
}

const RETOUCH: [&str; 12] = [
    "paint.mixerBrush",
    "paint.colorReplacement",
    "paint.cloneStamp",
    "paint.healingBrush",
    "paint.spotHealing",
    "paint.dodge",
    "paint.burn",
    "paint.sponge",
    "paint.blur",
    "paint.sharpen",
    "paint.smudge",
    "paint.historyBrush",
];

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn render(
    engine: &Session,
    command: &str,
    params: &Value,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    scale: u32,
) -> Result<Vec<PhotoTile>, String> {
    render_with_identity(engine,None,command,params,x,y,width,height,scale)
}

fn patch_preview_tiles(engine:&Session,params:&Value,x:u32,y:u32,width:u32,height:u32,scale:u32)->Result<Vec<PhotoTile>,String>{
    if !params.is_object()||params.to_string().len()>1024*1024{return Err("Invalid Patch preview parameters".into());}
    tiles::validate_dimensions(1,1,scale)?;
    let state=engine.active().ok_or("No Patch preview image")?;
    if width==0||height==0||x>=state.doc.size.width||y>=state.doc.size.height{
        let _=photocraft_engine::retouch_cmds::patch_preview(engine,params,262_144,scale).map_err(|error|error.to_string())?;
        return Ok(Vec::new());
    }
    let (doc,damage)=photocraft_engine::retouch_cmds::patch_preview(engine,params,262_144,scale).map_err(|error|error.to_string())?;
    let viewport=Rect::from_xywh(x as i32,y as i32,width.min(doc.size.width-x),height.min(doc.size.height-y));
    let visible=viewport.intersect(&damage);
    if visible.is_empty(){return Ok(Vec::new());}
    let edge=512*scale;
    let axis=|start:i32,end:i32|{let first=start/edge as i32;let last=(end-1)/edge as i32;(first..=last).map(|index|index as u32*edge).collect::<Vec<_>>()};
    let xs=axis(visible.x0,visible.x1);let ys=axis(visible.y0,visible.y1);
    if xs.len().saturating_mul(ys.len())>8{return Err("Patch preview scale must increase to cover the full visible area".into());}
    let color=super::display::View::new(&engine.color,&doc)?;
    ys.into_iter().flat_map(|ty|xs.iter().copied().map(move|tx|(tx,ty))).map(|(tx,ty)|tiles::render_with_color(&doc,Some(&state.channel_view),Some(&color),tx,ty,edge.min(doc.size.width-tx),edge.min(doc.size.height-ty),scale,false,true)).collect()
}

fn isolated_eraser_result(engine:&Session,command:&str,params:&Value)->Result<(std::sync::Arc<photocraft_engine::doc::Document>,Rect),String>{
    let source=engine.active().ok_or("No eraser preview image")?.clone();
    let mut scratch=Session::new();scratch.add_document((*source.doc).clone(),None);
    *scratch.active_mut().ok_or("No isolated eraser document")?=source;
    scratch.tools=engine.tools.clone();
    scratch.presets=engine.presets.clone();scratch.patterns=engine.patterns.clone();scratch.quick_mask_options=engine.quick_mask_options.clone();
    super::color_views::Snapshot::capture(engine)?.install(&mut scratch)?;
    if let Some(state)=scratch.active_mut(){state.last_damage=None;}
    let mut command_params=params.clone();if let Some(object)=command_params.as_object_mut(){object.remove("_orionTargetLayer");object.remove("_orionTargetMode");}
    let command_params=super::history::normalize(engine,command,command_params)?;
    scratch.execute(command,command_params).map_err(|error|error.to_string())?;
    let state=scratch.active().ok_or("No isolated eraser result")?;
    Ok((state.doc.clone(),state.last_damage.unwrap_or(Rect::EMPTY)))
}

fn eraser_limits(engine:&Session,command:&str,params:&Value)->Result<(),String>{
    if !matches!(command,"paint.magicEraser"|"paint.backgroundEraser")||!params.is_object()||params.to_string().len()>1024*1024{return Err("Invalid eraser preview parameters".into());}
    let source=engine.active().ok_or("No eraser preview image")?;
    let target_layer=source.active_layer.map(|layer|layer.0).ok_or("Erasers require an active pixel layer")?;
    if params["_orionTargetLayer"].as_u64()!=Some(target_layer)||params["_orionTargetMode"].as_str()!=Some("compositePixels")||source.channel_view.target!=photocraft_engine::channel_cmds::ChannelTarget::Composite||photocraft_engine::mask_view_cmds::current(source).is_some()||source.doc.quick_mask.is_some(){return Err("Eraser target changed; restart the gesture on composite layer pixels".into());}
    if u64::from(source.doc.size.width)*u64::from(source.doc.size.height)>16_777_216{return Err("Eraser feedback supports images up to 16 megapixels".into());}
    if command=="paint.backgroundEraser"&&params["points"].as_array().is_none_or(|points|points.is_empty()||points.len()>4096){return Err("Background Eraser feedback supports up to 4096 complete samples; the edit itself will use the full stroke".into());}
    Ok(())
}
fn eraser_preview_tiles(engine:&Session,command:&str,params:&Value,x:u32,y:u32,width:u32,height:u32,scale:u32)->Result<Vec<PhotoTile>,String>{
    tiles::validate_dimensions(1,1,scale)?;
    eraser_limits(engine,command,params)?;
    let (doc,damage)=isolated_eraser_result(engine,command,params)?;
    if width==0||height==0||x>=doc.size.width||y>=doc.size.height{return Ok(Vec::new());}
    let viewport=Rect::from_xywh(x as i32,y as i32,width.min(doc.size.width-x),height.min(doc.size.height-y));
    if damage.is_empty(){return Ok(Vec::new());}
    let visible=viewport;
    let edge=512*scale;
    let axis=|start:i32,end:i32|{let first=start/edge as i32;let last=(end-1)/edge as i32;(first..=last).map(|index|index as u32*edge).collect::<Vec<_>>()};
    let xs=axis(visible.x0,visible.x1);let ys=axis(visible.y0,visible.y1);
    if xs.len().saturating_mul(ys.len())>8{return Err("Eraser preview scale must increase to cover the full visible area".into());}
    let state=engine.active().ok_or("No eraser preview image")?;let color=super::display::View::new(&engine.color,&doc)?;
    ys.into_iter().flat_map(|ty|xs.iter().copied().map(move|tx|(tx,ty))).map(|(tx,ty)|tiles::render_with_color(&doc,Some(&state.channel_view),Some(&color),tx,ty,edge.min(doc.size.width-tx),edge.min(doc.size.height-ty),scale,false,true)).collect()
}

fn retouch_limits(engine:&Session,identity:Option<&str>,command:&str,params:&Value,points:&[Value])->Result<(),String>{
    let state = engine.active().ok_or("No preview image")?;
    if u64::from(state.doc.size.width) * u64::from(state.doc.size.height) > 16_777_216
        || command=="paint.smudge"&&identity.is_none()&&points.len() > 2048
    {
        return Err("Retouch feedback supports images up to 16 megapixels; identity-less Smudge supports up to 2048 samples".into());
    }
    let size = params["size"]
        .as_f64()
        .unwrap_or(f64::from(engine.tools.brush.size));
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for point in points {
        let (px, py) = (
            point[0].as_f64().ok_or("Invalid retouch point")?,
            point[1].as_f64().ok_or("Invalid retouch point")?,
        );
        if !px.is_finite()
            || !py.is_finite()
            || px.abs() > 1_000_000.0
            || py.abs() > 1_000_000.0
        {
            return Err("Retouch feedback coordinates exceed the preview bounds".into());
        }
        bounds[0] = bounds[0].min(px);
        bounds[1] = bounds[1].min(py);
        bounds[2] = bounds[2].max(px);
        bounds[3] = bounds[3].max(py);
    }
    if !size.is_finite()
        || !(1.0..=4096.0).contains(&size)
        || (bounds[2] - bounds[0] + 2.0 * size + 512.0)
            * (bounds[3] - bounds[1] + 2.0 * size + 512.0)
            > 16_777_216.0
    {
        return Err("Retouch feedback footprint exceeds 16 megapixels; finish the stroke for the full edit".into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn render_with_identity(engine:&Session,identity:Option<&str>,command:&str,params:&Value,x:u32,y:u32,width:u32,height:u32,scale:u32)->Result<Vec<PhotoTile>,String> {
    if command=="paint.patch"{return patch_preview_tiles(engine,params,x,y,width,height,scale);}
    if matches!(command,"paint.magicEraser"|"paint.backgroundEraser"){return eraser_preview_tiles(engine,command,params,x,y,width,height,scale);}
    let retouch = RETOUCH.contains(&command);
    if (!retouch && !["paint.stroke", "paint.pencil"].contains(&command))
        || !params.is_object()
        || params.to_string().len() > 1024 * 1024
        || params["seed"].as_u64().is_none()
    {
        return Err("Invalid native stroke preview parameters".into());
    }
    let points = params["points"]
        .as_array()
        .ok_or("Stroke preview needs points")?;
    if params.get("_orionOffset").is_some()&&(identity.is_none()||retouch&&!continuous_retouch::TOOLS.contains(&command)){return Err("This tool does not support incremental sample batches".into());}
    if points.is_empty() || points.len() > 8192 {
        return Err("Native feedback supports up to 8192 stroke samples; finish the stroke to render all samples".into());
    }
    tiles::validate_dimensions(1, 1, scale)?;
    let state = engine.active().ok_or("No preview image")?;
    if retouch {
        retouch_limits(engine, identity, command, params, points)?;
    }
    if width == 0 || height == 0 {
        if let Some(identity)=identity {if retouch&&continuous_retouch::TOOLS.contains(&command){retouch_document(engine,Some(identity),command,params)?;}else if !retouch{incremental(engine,identity,command,params)?;}}
        return Ok(Vec::new());
    }
    if x >= state.doc.size.width || y >= state.doc.size.height {
        if let Some(identity)=identity {if retouch&&continuous_retouch::TOOLS.contains(&command){retouch_document(engine,Some(identity),command,params)?;}else if !retouch{incremental(engine,identity,command,params)?;}}
        return Ok(Vec::new());
    }
    let viewport = Rect::from_xywh(
        x as i32,
        y as i32,
        width.min(state.doc.size.width - x),
        height.min(state.doc.size.height - y),
    );
    let (doc, damage) = if retouch {
        retouch_document(engine,identity,command,params)?
    } else {
        // Streamed strokes re-render only what the newest samples touched; the client keeps
        // the earlier tiles. Re-rendering the whole stroke every step made feedback trail.
        if let Some(identity)=identity {let (doc,bounds,step)=incremental_step(engine,identity,command,params,Some([x,y,width,height,scale]))?;(doc,step.unwrap_or(bounds))}
        else {let live = BrushDraft::begin(engine, command, params)?;(live.document(), live.bounds())}
    };
    let visible = viewport.intersect(&damage.inflate(if retouch {256} else {2}));
    if visible.is_empty() {
        return Ok(Vec::new());
    }
    let edge = 512 * scale;
    let last = points.last().unwrap();
    let cx = last[0]
        .as_f64()
        .unwrap_or(f64::from(x))
        .clamp(f64::from(visible.x0), f64::from(visible.x1 - 1));
    let cy = last[1]
        .as_f64()
        .unwrap_or(f64::from(y))
        .clamp(f64::from(visible.y0), f64::from(visible.y1 - 1));
    let axis = |start: i32, end: i32, center: f64| {
        let first = start / edge as i32;
        let last = (end - 1) / edge as i32;
        let middle = (center / f64::from(edge)) as i32;
        let mut indices = Vec::new();
        for distance in 0..8 {
            for index in if distance == 0 {
                vec![middle]
            } else {
                vec![middle - distance, middle + distance]
            } {
                if index >= first && index <= last {
                    indices.push(index as u32 * edge);
                }
            }
        }
        indices
    };
    let mut positions: Vec<_> = axis(visible.y0, visible.y1, cy)
        .into_iter()
        .flat_map(|ty| {
            axis(visible.x0, visible.x1, cx)
                .into_iter()
                .map(move |tx| (tx, ty))
        })
        .collect();
    positions.sort_by(|(ax, ay), (bx, by)| {
        let distance = |tx: u32, ty: u32| {
            (f64::from(tx) + f64::from(edge) / 2.0 - cx).powi(2)
                + (f64::from(ty) + f64::from(edge) / 2.0 - cy).powi(2)
        };
        distance(*ax, *ay).total_cmp(&distance(*bx, *by))
    });
    let color=super::display::View::new(&engine.color,&doc)?;
    positions
        .into_iter()
        .take(8)
        .map(|(tx, ty)| {
            tiles::render_with_color(
                &doc,
                Some(&state.channel_view),
                Some(&color),
                tx,
                ty,
                edge.min(doc.size.width - tx),
                edge.min(doc.size.height - ty),
                scale,
                false,
                true,
            )
        })
        .collect()
}

/// Pixels beyond a changed area that layer effects (shadows, glows, strokes) can redraw.
fn effect_reach(layers:&[photocraft_engine::doc::Layer])->i32{
    layers.iter().filter(|layer|layer.visible).map(|layer|{
        let own=if photocraft_compose::effects::has_effects(layer){photocraft_compose::effects::margin(layer)}else{0};
        own+match &layer.content{photocraft_engine::doc::LayerContent::Group(group)=>effect_reach(&group.children),_=>0}
    }).max().unwrap_or(0)
}
fn redrawn(draft:&PixelDraft)->Rect{if draft.damage.is_empty(){Rect::EMPTY}else{draft.damage.inflate(effect_reach(&draft.doc.layers)+2)}}
/// A feedback request's draft and the document area it changed. `replace` drafts stand for the
/// whole preview: Patch and the erasers re-render their complete result on every request.
struct PixelDraft{doc:std::sync::Arc<photocraft_engine::doc::Document>,damage:Rect,replace:bool}
/// `view` names the tiles the result is drawn into; `None` (nothing visible) makes the next
/// visible brush request redraw the whole stroke. `patch_step` floors Patch's solve coarseness.
fn pixel_draft(engine:&Session,identity:&str,command:&str,params:&Value,view:Option<[u32;5]>,patch_step:u32)->Result<PixelDraft,String>{
    if !params.is_object()||params.to_string().len()>1024*1024{return Err("Invalid native stroke preview parameters".into());}
    if command=="paint.patch"{let (doc,damage)=photocraft_engine::retouch_cmds::patch_preview(engine,params,262_144,patch_step).map_err(|error|error.to_string())?;return Ok(PixelDraft{doc:Arc::new(doc),damage,replace:true});}
    if matches!(command,"paint.magicEraser"|"paint.backgroundEraser"){eraser_limits(engine,command,params)?;let (doc,damage)=isolated_eraser_result(engine,command,params)?;return Ok(PixelDraft{doc,damage,replace:true});}
    let retouch=continuous_retouch::TOOLS.contains(&command);
    if !retouch&&!["paint.stroke","paint.pencil"].contains(&command)||params["seed"].as_u64().is_none(){return Err("Invalid native stroke preview parameters".into());}
    let points=params["points"].as_array().ok_or("Stroke preview needs points")?;
    if points.is_empty()||points.len()>8192{return Err("Native feedback supports up to 8192 stroke samples; finish the stroke to render all samples".into());}
    if retouch{retouch_limits(engine,Some(identity),command,params,points)?;let (doc,damage)=retouch_document(engine,Some(identity),command,params)?;return Ok(PixelDraft{doc,damage,replace:false});}
    let (doc,bounds,step)=incremental_step(engine,identity,command,params,view)?;
    Ok(PixelDraft{doc,damage:step.unwrap_or(bounds),replace:false})
}
/// Display RGBA for the visible part of what a feedback request changed: a little-endian u32
/// chunk count, `x y width height pixelWidth pixelHeight` (u32 each) per chunk, then each
/// chunk's straight RGBA in order. Chunks start on the reduction grid and stay inside one
/// 512-output-pixel tile, so they match document tiles pixel for pixel.
#[allow(clippy::too_many_arguments)]
pub(super) fn render_pixels(engine:&Session,identity:&str,command:&str,params:&Value,x:u32,y:u32,width:u32,height:u32,scale:u32)->Result<Vec<u8>,String>{
    tiles::validate_dimensions(1,1,scale)?;
    let size=engine.active().ok_or("No preview image")?.doc.size;
    let offscreen=width==0||height==0||x>=size.width||y>=size.height;
    let draft=pixel_draft(engine,identity,command,params,(!offscreen).then_some([x,y,width,height,scale]),scale)?;
    if offscreen{return Ok(0u32.to_le_bytes().to_vec());}
    let visible=Rect::from_xywh(x as i32,y as i32,width.min(size.width-x),height.min(size.height-y)).intersect(&redrawn(&draft));
    if visible.is_empty(){return Ok(0u32.to_le_bytes().to_vec());}
    let s=scale as i32;
    let up=|value:i32,limit:u32|((value+s-1).div_euclid(s)*s).min(limit as i32);
    let visible=Rect::new(visible.x0.div_euclid(s)*s,visible.y0.div_euclid(s)*s,up(visible.x1,size.width),up(visible.y1,size.height));
    let edge=512*s;
    let mut chunks=Vec::new();
    for ty in (visible.y0.div_euclid(edge)*edge..visible.y1).step_by(edge as usize){for tx in (visible.x0.div_euclid(edge)*edge..visible.x1).step_by(edge as usize){chunks.push(Rect::new(tx,ty,tx+edge,ty+edge).intersect(&visible));}}
    let last=params["points"].as_array().and_then(|points|points.last());
    let center=|axis:usize,low:i32,high:i32|last.and_then(|point|point[axis].as_f64()).unwrap_or(f64::from(low+high)/2.0);
    let (cx,cy)=(center(0,visible.x0,visible.x1),center(1,visible.y0,visible.y1));
    let distance=|rect:&Rect|(f64::from(rect.x0+rect.x1)/2.0-cx).powi(2)+(f64::from(rect.y0+rect.y1)/2.0-cy).powi(2);
    chunks.sort_by(|a,b|distance(a).total_cmp(&distance(b)));
    let state=engine.active().ok_or("No preview image")?;
    let color=super::display::View::new(&engine.color,&draft.doc)?;
    // A replacement must cover everything visible it changed; anything left out shows the image without the edit.
    let (mut header,mut body,mut count,mut budget)=(Vec::new(),Vec::new(),0u32,if draft.replace{u32::MAX}else{8*512*512u32});
    for rect in chunks {
        let (pixel_width,pixel_height)=(rect.width().div_ceil(scale),rect.height().div_ceil(scale));
        if count==64||(count>0&&pixel_width*pixel_height>budget){break;}
        budget=budget.saturating_sub(pixel_width*pixel_height);
        body.extend(tiles::rgba(&draft.doc,Some(&state.channel_view),Some(&color),rect,scale)?);
        for value in [rect.x0 as u32,rect.y0 as u32,rect.width(),rect.height(),pixel_width,pixel_height]{header.extend(value.to_le_bytes());}
        count+=1;
    }
    let mut out=Vec::with_capacity(4+header.len()+body.len());
    out.extend(count.to_le_bytes());out.extend(header);out.extend(body);
    Ok(out)
}

/// `render_pixels` output for a whole-image preview instead of tiles: at most one chunk, in
/// preview pixels (`width == pixelWidth`), rendered exactly like that preview so the client can
/// patch it in and the commit changes nothing on screen. `view` selects the channel, mask and
/// proof preview (`xdesign_photo_view_preview`) instead of the published image preview.
pub(super) fn render_preview_pixels(engine:&Session,identity:&str,command:&str,params:&Value,view:bool)->Result<Vec<u8>,String>{
    let state=engine.active().ok_or("No preview image")?;let size=state.doc.size;
    let factor=size.width.max(size.height).div_ceil(2048).max(1);
    let (width,height)=if view{(size.width.div_ceil(factor),size.height.div_ceil(factor))}else{super::preview_size(size.width,size.height)};
    // Tile views always use a power-of-two scale, so scale 0 keeps these views distinct from them.
    let draft=pixel_draft(engine,identity,command,params,Some([0,0,width,height,0]),factor)?;
    let damage=redrawn(&draft);
    let (rect,image)=if view {
        let channels=&state.channel_view;let f=factor as i32;
        let composite=if super::view::needs_composite(&draft.doc,channels){
            // Overlays show document pixel t·factor for output pixel t, which can lie up to
            // `factor` pixels outside the composite area that output pixel averages.
            photocraft_compose::render_reduced_damage(&draft.doc,width,height,damage.inflate(f))
        }else{
            let d=damage.intersect(&draft.doc.bounds());
            let first=|start:i32,limit:u32|((start.max(0) as u32).div_ceil(factor)).min(limit) as i32;
            photocraft_compose::Buffer::transparent(if d.is_empty(){Rect::EMPTY}else{Rect::new(first(d.x0,width),first(d.y0,height),first(d.x1,width),first(d.y1,height)).intersect(&Rect::from_xywh(0,0,width,height))})
        };
        let rect=composite.rect;if rect.is_empty(){return Ok(0u32.to_le_bytes().to_vec());}
        let (x0,y0)=(rect.x0 as u32*factor,rect.y0 as u32*factor);
        let buffer=super::view::present(&draft.doc,channels,composite,Rect::from_xywh(x0 as i32,y0 as i32,(rect.width()*factor).min(size.width-x0),(rect.height()*factor).min(size.height-y0)),factor);
        (rect,if channels.is_plain(&draft.doc){super::display::View::new(&engine.color,&draft.doc)?.rgba(&buffer)}else{buffer.to_rgba8()})
    }else{
        let buffer=photocraft_compose::render_reduced_damage(&draft.doc,width,height,damage);
        if buffer.rect.is_empty(){return Ok(0u32.to_le_bytes().to_vec());}
        (buffer.rect,super::display::rgba(&draft.doc,&buffer)?)
    };
    let mut out=Vec::with_capacity(28+image.pixels.len());
    out.extend(1u32.to_le_bytes());
    for value in [rect.x0 as u32,rect.y0 as u32,image.width,image.height,image.width,image.height]{out.extend(value.to_le_bytes());}
    out.extend(image.pixels);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn prepared_fixture(depth:u64,mode:&str)->Session{let mut engine=Session::new();engine.execute("file.new",serde_json::json!({"width":40,"height":40,"depth":depth,"mode":mode,"background":"#804020"})).unwrap();engine.execute("paint.stroke",serde_json::json!({"points":[[4,8],[34,8],[34,30]],"size":8,"color":"#20b0c0","seed":21})).unwrap();engine.execute("select.rect",serde_json::json!({"x":8,"y":12,"width":26,"height":19,"feather":2})).unwrap();engine.tools.brush.smoothing.amount=0.6;engine}
    fn prepared_params(command:&str)->Value{let mut params=serde_json::json!({"points":[[10,14,0.4],[19,21,0.8],[29,25,0.5]],"source":[7,7],"size":7,"opacity":65,"hardness":50,"flow":55,"type":"proximityMatch","seed":933,"cleanAfterStroke":false,"loadAfterStroke":false});if matches!(command,"paint.mixerBrush"|"paint.colorReplacement"){params["opacity"]=serde_json::json!(0.65);params["hardness"]=serde_json::json!(0.5);params["color"]=serde_json::json!("#e01080");}params}
    fn twin(engine:&Session)->Session{let mut expected=Session::new();expected.add_document((*engine.active().unwrap().doc).clone(),None);*expected.active_mut().unwrap()=engine.active().unwrap().clone();expected.tools=engine.tools.clone();expected.presets=engine.presets.clone();expected.patterns=engine.patterns.clone();expected.journal=engine.journal.clone();expected.edit_state=engine.edit_state.clone();expected}
    fn marked_eraser_params(engine:&Session,params:&Value)->Value{let mut params=params.clone();params["_orionTargetLayer"]=serde_json::json!(engine.active().unwrap().active_layer.unwrap().0);params["_orionTargetMode"]=serde_json::json!("compositePixels");params}
    pub(super) fn native_pixels(doc:&photocraft_engine::doc::Document)->Vec<f32>{let mut pixels:Vec<_>=photocraft_compose::render(doc,doc.bounds()).px.into_iter().flatten().collect();for (_,_,layer) in doc.walk(){for surface in [layer.surface(),layer.mask.as_ref().map(|mask|&mask.surface)].into_iter().flatten(){pixels.extend(surface.read_region(surface.content_bounds().union(&doc.bounds())));}}for channel in &doc.channels{pixels.extend(channel.surface.read_region(channel.surface.content_bounds().union(&doc.bounds())));}if let Some(mask)=&doc.quick_mask{pixels.extend(mask.surface.read_region(mask.surface.content_bounds().union(&doc.bounds())));}pixels}
    pub(super) fn assert_prepared_state(engine:&Session,expected:&Session,context:&str){let state=engine.active().unwrap();let native=expected.active().unwrap();let pixels=native_pixels(&state.doc);let reference=native_pixels(&native.doc);assert_eq!(pixels.len(),reference.len(),"pixel count/{context}");let mismatch=pixels.iter().zip(&reference).enumerate().find(|(_, (actual,expected))|actual!=expected);assert!(mismatch.is_none(),"pixels/{context}: first mismatch {mismatch:?}");assert_eq!(state.history.entries(),native.history.entries(),"history/{context}");assert_eq!(state.revision,native.revision,"revision/{context}");assert_eq!(state.saved_revision,native.saved_revision);assert_eq!(state.coalesce,native.coalesce);assert_eq!(state.last_damage,native.last_damage);assert_eq!(state.active_layer,native.active_layer);assert_eq!(state.selected_layers,native.selected_layers);assert_eq!(state.channel_view,native.channel_view);assert_eq!(engine.edit_state.fade,expected.edit_state.fade,"Fade/{context}");assert_eq!(engine.journal,expected.journal,"journal/{context}");assert_eq!(engine.presets.clone,expected.presets.clone,"clone/{context}");assert_eq!(serde_json::to_value(&engine.tools.mixer).unwrap(),serde_json::to_value(&expected.tools.mixer).unwrap(),"mixer/{context}");assert!(!engine.has_jobs());}
    fn assert_color_eraser_preview_matches_commit(command:&str,params:Value){
        for depth in [8,16,32]{for mode in ["rgb","gray","cmyk","lab"]{
            let mut engine=prepared_fixture(depth,mode);engine.tools.foreground=[1.0,1.0,1.0,1.0];engine.tools.background=[0.91,0.13,0.37,1.0];let before=engine.active().unwrap().doc.clone();let selection=before.selection.clone();let revision=engine.active().unwrap().revision;let history=engine.active().unwrap().history.entries();let journal=engine.journal.clone();
            let preview_params=marked_eraser_params(&engine,&params);let preview=render(&engine,command,&preview_params,0,0,40,40,1).unwrap();assert_eq!(preview.len(),1,"{command}/{mode}/{depth}");
            assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc),"preview must keep the source document shared/{command}/{mode}/{depth}");assert_eq!(engine.active().unwrap().revision,revision);assert_eq!(engine.active().unwrap().history.entries(),history);assert_eq!(engine.active().unwrap().doc.selection,selection);assert_eq!(engine.journal,journal);
            let state=engine.active().unwrap();let color=super::super::display::View::new(&engine.color,&state.doc).unwrap();let before_tile=tiles::render_with_color(&state.doc,Some(&state.channel_view),Some(&color),0,0,40,40,1,false,true).unwrap();assert_ne!(preview[0].png,before_tile.png,"preview must show the actual edit/{command}/{mode}/{depth}");assert_eq!(preview[0].selection_png,before_tile.selection_png);
            engine.execute(command,params.clone()).unwrap();let state=engine.active().unwrap();let color=super::super::display::View::new(&engine.color,&state.doc).unwrap();let committed=tiles::render_with_color(&state.doc,Some(&state.channel_view),Some(&color),0,0,40,40,1,false,true).unwrap();assert_eq!(preview[0].png,committed.png,"preview matches pinned command/{command}/{mode}/{depth}");assert_eq!(state.doc.selection,selection);assert_eq!(state.doc.layer(state.active_layer.unwrap()).unwrap().name,"Layer 0","native Background unlock semantics/{command}/{mode}/{depth}");
            engine.execute("edit.undo",serde_json::json!({})).unwrap();assert_eq!(native_pixels(&engine.active().unwrap().doc),native_pixels(&before),"one undo restores source pixels/{command}/{mode}/{depth}");assert_eq!(engine.active().unwrap().doc.selection,selection);
        }}
    }
    #[test]
    fn color_eraser_magic_preview_matches_real_command_across_modes_depths_selection_palette_and_undo(){
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut params=serde_json::json!({"x":10,"y":15,"tolerance":0,"opacity":72,"antiAlias":false,"contiguous":true,"sampleAllLayers":false});
        assert_color_eraser_preview_matches_commit("paint.magicEraser",params.clone());params["contiguous"]=serde_json::json!(false);params["sampleAllLayers"]=serde_json::json!(true);assert_color_eraser_preview_matches_commit("paint.magicEraser",params);
    }
    #[test]
    fn color_eraser_background_preview_matches_pressured_command_across_modes_depths_selection_and_options(){
        let _guard = crate::xdesign_photo::feedback_serial();
        let params=serde_json::json!({"points":[[10,15,0.35,8,-4,12,1],[16,21,0.85,-3,6,25,2],[24,24,0.55,2,3,7,3]],"size":9,"hardness":0.63,"flow":0.74,"sampling":"continuous","limits":"findEdges","tolerance":20,"protectForegroundColor":true,"seed":913});
        assert_color_eraser_preview_matches_commit("paint.backgroundEraser",params);
    }
    #[test]
    fn color_eraser_preview_renders_the_full_multitile_viewport_when_damage_is_visible(){
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=Session::new();engine.execute("file.new",serde_json::json!({"width":2000,"height":1500,"depth":8,"mode":"rgb","background":"#804020"})).unwrap();
        engine.execute("paint.stroke",serde_json::json!({"points":[[900,780],[1020,820],[1100,860]],"size":48,"color":"#20b0c0","seed":21})).unwrap();
        let params=serde_json::json!({"points":[[1000,820,0.7,0,0,0,1],[1050,840,0.8,0,0,0,2]],"size":36,"hardness":0.7,"flow":0.8,"sampling":"continuous","limits":"contiguous","tolerance":50,"seed":913});
        let marked=marked_eraser_params(&engine,&params);let before=engine.active().unwrap().doc.clone();let preview=render(&engine,"paint.backgroundEraser",&marked,511,511,1200,900,2).unwrap();
        let positions:std::collections::BTreeSet<_>=preview.iter().map(|tile|(tile.x,tile.y)).collect();assert_eq!(positions,[(0,0),(1024,0),(0,1024),(1024,1024)].into_iter().collect());
        assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc),"preview leaves the committed document untouched");
        engine.execute("paint.backgroundEraser",params).unwrap();let state=engine.active().unwrap();let color=super::super::display::View::new(&engine.color,&state.doc).unwrap();
        for tile in &preview{let expected=tiles::render_with_color(&state.doc,Some(&state.channel_view),Some(&color),tile.x,tile.y,tile.width,tile.height,2,false,true).unwrap();assert_eq!(tile.png,expected.png,"viewport tile ({},{}) matches the committed visible result",tile.x,tile.y);}
    }
    #[test]
    fn color_eraser_preview_keeps_far_layer_shadow_visible_when_pixel_damage_is_offscreen(){
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=Session::new();engine.execute("file.new",serde_json::json!({"width":800,"height":400,"background":"transparent"})).unwrap();
        engine.execute("paint.stroke",serde_json::json!({"points":[[500,200],[505,200]],"size":80,"color":"#ffffff","seed":21})).unwrap();
        engine.execute("layer.layerStyle.dropShadow",serde_json::json!({"color":"#000000","opacity":100,"angle":0,"useGlobalLight":false,"distance":400,"size":20,"add":false})).unwrap();
        let params=serde_json::json!({"points":[[500,200,1],[503,200,1]],"size":100,"hardness":1,"sampling":"once","limits":"contiguous","tolerance":0,"seed":913});
        let marked=marked_eraser_params(&engine,&params);let before=engine.active().unwrap().doc.clone();let (_,damage)=isolated_eraser_result(&engine,"paint.backgroundEraser",&marked).unwrap();let viewport=Rect::from_xywh(50,150,200,100);assert!(viewport.intersect(&damage).is_empty(),"the direct pixel damage lies outside the displayed viewport: {damage:?}");
        let preview=render(&engine,"paint.backgroundEraser",&marked,50,150,200,100,1).unwrap();assert_eq!(preview.len(),1,"visible shadow tile is still returned when direct pixel damage is offscreen");assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc),"preview does not mutate the source document");
        let before_state=engine.active().unwrap();let before_color=super::super::display::View::new(&engine.color,&before_state.doc).unwrap();let before_visible=tiles::render_with_color(&before_state.doc,Some(&before_state.channel_view),Some(&before_color),50,150,200,100,1,false,true).unwrap();let mut empty=Session::new();empty.execute("file.new",serde_json::json!({"width":800,"height":400,"background":"transparent"})).unwrap();let empty_state=empty.active().unwrap();let empty_color=super::super::display::View::new(&empty.color,&empty_state.doc).unwrap();let no_shadow_visible=tiles::render_with_color(&empty_state.doc,Some(&empty_state.channel_view),Some(&empty_color),50,150,200,100,1,false,true).unwrap();assert_ne!(before_visible.png,no_shadow_visible.png,"the pre-erase cropped viewport visibly contains the far shadow");
        engine.execute("paint.backgroundEraser",params).unwrap();let state=engine.active().unwrap();let color=super::super::display::View::new(&engine.color,&state.doc).unwrap();let committed=tiles::render_with_color(&state.doc,Some(&state.channel_view),Some(&color),0,0,512,400,1,false,true).unwrap();let committed_visible=tiles::render_with_color(&state.doc,Some(&state.channel_view),Some(&color),50,150,200,100,1,false,true).unwrap();assert_ne!(before_visible.png,committed_visible.png,"the far shadow changes inside the requested viewport although erased pixels are offscreen");assert_eq!(preview[0].png,committed.png,"full visible tile matches the committed shadow/effect output");
    }
    #[test]
    fn color_eraser_preview_preserves_magic_transparency_lock_palette_and_background_refusal(){
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=prepared_fixture(8,"rgb");engine.execute("layer.new.layer",serde_json::json!({})).unwrap();engine.execute("edit.fill",serde_json::json!({"color":"#e02060"})).unwrap();engine.execute("layer.lockLayers",serde_json::json!({"transparency":true})).unwrap();engine.execute("tools.setColors",serde_json::json!({"background":"#00ff00"})).unwrap();
        let layer=engine.active().unwrap().active_layer.unwrap();let before=engine.active().unwrap().doc.clone();let alpha_before=before.layer(layer).unwrap().surface().unwrap().rgba(20,20)[3];let params=serde_json::json!({"x":20,"y":20,"tolerance":0,"antiAlias":false,"opacity":100});
        let preview=render(&engine,"paint.magicEraser",&marked_eraser_params(&engine,&params),0,0,40,40,1).unwrap();assert_eq!(preview.len(),1);assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));let before_state=engine.active().unwrap();let before_color=super::super::display::View::new(&engine.color,&before_state.doc).unwrap();let before_tile=tiles::render_with_color(&before_state.doc,Some(&before_state.channel_view),Some(&before_color),0,0,40,40,1,false,true).unwrap();assert_ne!(preview[0].png,before_tile.png);
        engine.execute("paint.magicEraser",params.clone()).unwrap();let changed=engine.active().unwrap().doc.layer(layer).unwrap().surface().unwrap();assert_eq!(changed.rgba(20,20)[3],alpha_before,"locked transparency remains opaque");assert!(changed.rgba(20,20)[1]>0.9,"Magic Eraser paints the active background swatch when transparency is locked");
        let committed_state=engine.active().unwrap();let committed_color=super::super::display::View::new(&engine.color,&committed_state.doc).unwrap();let committed_tile=tiles::render_with_color(&committed_state.doc,Some(&committed_state.channel_view),Some(&committed_color),0,0,40,40,1,false,true).unwrap();assert_eq!(preview[0].png,committed_tile.png,"scratch preview retains the background swatch and transparency lock");
        let mut locked=prepared_fixture(8,"rgb");locked.execute("layer.lockLayers",serde_json::json!({"pixels":true})).unwrap();let locked_before=locked.active().unwrap().doc.clone();assert!(render(&locked,"paint.magicEraser",&marked_eraser_params(&locked,&params),0,0,40,40,1).is_err());assert!(std::sync::Arc::ptr_eq(&locked_before,&locked.active().unwrap().doc));
        let mut transparency_locked=prepared_fixture(8,"rgb");transparency_locked.execute("layer.new.layer",serde_json::json!({})).unwrap();transparency_locked.execute("layer.lockLayers",serde_json::json!({"transparency":true})).unwrap();let locked_before=transparency_locked.active().unwrap().doc.clone();let stroke=serde_json::json!({"points":[[10,15,1],[20,20,1]],"size":8,"hardness":1,"sampling":"once","limits":"contiguous","tolerance":50});assert!(render(&transparency_locked,"paint.backgroundEraser",&marked_eraser_params(&transparency_locked,&stroke),0,0,40,40,1).is_err());assert!(std::sync::Arc::ptr_eq(&locked_before,&transparency_locked.active().unwrap().doc));
    }
    #[test]
    fn patch_native_feedback_matches_commit_and_preserves_selection_and_undo(){
        let _guard = crate::xdesign_photo::feedback_serial();
        for mode in ["source","destination"]{
            let mut engine=prepared_fixture(16,"rgb");if mode=="destination"{engine.execute("select.rect",serde_json::json!({"x":2,"y":4,"width":8,"height":8})).unwrap();}
            let offset=if mode=="destination"{serde_json::json!([16,12])}else{serde_json::json!([3,-2])};
            let params=serde_json::json!({"offset":offset,"mode":mode,"layer":engine.active().unwrap().active_layer.unwrap().0,"target":"pixels"});
            let before=engine.active().unwrap().doc.clone();let selection=before.selection.clone();let revision=engine.active().unwrap().revision;let history=engine.active().unwrap().history.entries();
            let source=if mode=="destination"{Some(before.layer(engine.active().unwrap().active_layer.unwrap()).unwrap().surface().unwrap().read_region(Rect::new(2,4,10,12)))}else{None};
            let preview=render(&engine,"paint.patch",&params,0,0,40,40,1).unwrap();assert_eq!(preview.len(),1,"{mode}");
            assert_eq!(engine.active().unwrap().revision,revision,"preview cannot commit");assert_eq!(engine.active().unwrap().history.entries(),history);assert_eq!(engine.active().unwrap().doc.selection,selection);assert_eq!(native_pixels(&engine.active().unwrap().doc),native_pixels(&before));
            let state=engine.active().unwrap();let color=super::super::display::View::new(&engine.color,&state.doc).unwrap();let before_tile=tiles::render_with_color(&state.doc,Some(&state.channel_view),Some(&color),0,0,40,40,1,false,true).unwrap();assert_eq!(preview[0].selection_png,before_tile.selection_png,"the active selection stays visible while dragging");assert_ne!(preview[0].png,before_tile.png,"{mode} preview visibly contains provisional patch pixels");
            engine.execute("paint.patch",params).unwrap();let state=engine.active().unwrap();let color=super::super::display::View::new(&engine.color,&state.doc).unwrap();let committed=tiles::render_with_color(&state.doc,Some(&state.channel_view),Some(&color),0,0,40,40,1,false,true).unwrap();assert_eq!(preview[0].png,committed.png,"step-one feedback matches committed pixels/{mode}");
            if let Some(source)=source{assert_eq!(state.doc.layer(state.active_layer.unwrap()).unwrap().surface().unwrap().read_region(Rect::new(2,4,10,12)),source,"destination mode preserves the selected source pixels");}
            engine.execute("edit.undo",serde_json::json!({})).unwrap();assert_eq!(native_pixels(&engine.active().unwrap().doc),native_pixels(&before),"one undo restores pixels/{mode}");assert_eq!(engine.active().unwrap().doc.selection,selection,"undo retains selection/{mode}");
        }
    }
    #[test]
    fn patch_preview_covers_every_visible_tile_after_scale_is_raised(){
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=Session::new();engine.execute("file.new",serde_json::json!({"width":2000,"height":1500,"depth":8,"mode":"rgb","background":"#804020"})).unwrap();
        engine.execute("select.rect",serde_json::json!({"x":400,"y":300,"width":1200,"height":900})).unwrap();
        let params=serde_json::json!({"offset":[10,10],"mode":"source"});
        assert!(render(&engine,"paint.patch",&params,511,511,1200,900,1).is_err(),"the native cap refuses to omit visible tiles at an insufficient scale");
        let tiles=render(&engine,"paint.patch",&params,511,511,1200,900,2).unwrap();
        let positions:std::collections::BTreeSet<_>=tiles.iter().map(|tile|(tile.x,tile.y)).collect();
        assert_eq!(positions,[(0,0),(1024,0),(0,1024),(1024,1024)].into_iter().collect());
    }
    #[test]
    fn patch_preview_and_commit_write_only_the_explicit_mask_or_alpha_target(){
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=prepared_fixture(8,"rgb");let layer=engine.active().unwrap().active_layer.unwrap();
        engine.execute("layer.layerMask.revealAll",serde_json::json!({})).unwrap();
        engine.execute("paint.stroke",serde_json::json!({"points":[[10,20],[15,20]],"size":7,"color":"#000000","target":"mask","seed":7})).unwrap();
        let mask_before=engine.active().unwrap().doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds());
        let pixels_before=engine.active().unwrap().doc.layer(layer).unwrap().surface().unwrap().read_region(engine.active().unwrap().doc.bounds());
        let params=serde_json::json!({"offset":[-4,0],"target":"mask","layer":layer.0});
        let _=render(&engine,"paint.patch",&params,0,0,40,40,1).unwrap();engine.execute("paint.patch",params).unwrap();
        let state=engine.active().unwrap();let mask_after=state.doc.layer(layer).unwrap().mask.as_ref().unwrap().surface.read_region(state.doc.bounds());let pixels_after=state.doc.layer(layer).unwrap().surface().unwrap().read_region(state.doc.bounds());
        assert_ne!(mask_after,mask_before,"the requested layer mask is patched");assert_eq!(pixels_after,pixels_before,"layer pixels are left alone");

        let mut engine=prepared_fixture(8,"rgb");let layer=engine.active().unwrap().active_layer.unwrap();engine.execute("channel.new",serde_json::json!({"name":"Patch alpha"})).unwrap();engine.execute("channel.target",serde_json::json!({"channel":0})).unwrap();
        engine.execute("paint.stroke",serde_json::json!({"points":[[8,20],[13,20]],"size":8,"color":"#ffffff","seed":8})).unwrap();
        let alpha_before=engine.active().unwrap().doc.channels[0].surface.read_region(engine.active().unwrap().doc.bounds());let pixels_before=engine.active().unwrap().doc.layer(layer).unwrap().surface().unwrap().read_region(engine.active().unwrap().doc.bounds());
        let params=serde_json::json!({"offset":[-4,0],"target":{"channel":0}});let _=render(&engine,"paint.patch",&params,0,0,40,40,1).unwrap();engine.execute("paint.patch",params).unwrap();
        let state=engine.active().unwrap();assert_ne!(state.doc.channels[0].surface.read_region(state.doc.bounds()),alpha_before,"the requested alpha channel is patched");assert_eq!(state.doc.layer(layer).unwrap().surface().unwrap().read_region(state.doc.bounds()),pixels_before,"layer pixels are left alone");

        let mut engine=prepared_fixture(8,"rgb");let layer=engine.active().unwrap().active_layer.unwrap();engine.execute("select.editInQuickMaskMode",serde_json::json!({})).unwrap();engine.execute("select.rect",serde_json::json!({"x":8,"y":12,"width":26,"height":19})).unwrap();
        engine.execute("paint.stroke",serde_json::json!({"points":[[8,20],[13,20]],"size":8,"color":"#ffffff","seed":9,"target":"quickMask"})).unwrap();
        let mask_before=engine.active().unwrap().doc.quick_mask.as_ref().unwrap().surface.read_region(engine.active().unwrap().doc.bounds());let pixels_before=engine.active().unwrap().doc.layer(layer).unwrap().surface().unwrap().read_region(engine.active().unwrap().doc.bounds());
        let params=serde_json::json!({"offset":[-4,0],"target":"quickMask"});let (preview,_) = photocraft_engine::retouch_cmds::patch_preview(&engine,&params,262_144,1).unwrap();let mut expected=twin(&engine);expected.execute("paint.patch",params.clone()).unwrap();assert_eq!(preview.quick_mask,expected.active().unwrap().doc.quick_mask,"preview samples and paints the explicit Quick Mask surface");
        engine.execute("paint.patch",params).unwrap();let state=engine.active().unwrap();assert_ne!(state.doc.quick_mask.as_ref().unwrap().surface.read_region(state.doc.bounds()),mask_before,"the Quick Mask is patched");assert_eq!(state.doc.layer(layer).unwrap().surface().unwrap().read_region(state.doc.bounds()),pixels_before,"Quick Mask patch leaves image pixels unchanged");
    }
    fn compare_prepared(engine:&mut Session,expected:&mut Session,command:&str,params:&Value){let identity=format!("prepared-{}",ulid::Ulid::new());let mut prefix=params.clone();prefix["points"]=serde_json::json!(params["points"].as_array().unwrap()[..2]);retouch_document(engine,Some(&identity),command,&prefix).unwrap();let before=engine.active().unwrap().doc.clone();let key=stroke_key(&identity,command,params).unwrap();assert_eq!(retouch_cache().lock().unwrap()[&key].live.as_ref().unwrap().samples_pushed(),2);assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));let mut native_params=super::super::history::normalize(expected,command,params.clone()).unwrap();let coverage_fade=super::super::mask_filters::prepare_paint_fade(expected,command,&mut native_params);let native=expected.execute(command,native_params).unwrap();super::super::mask_filters::finish_paint_fade(expected,coverage_fade);let result=commit_feedback(engine,&identity,command,params).unwrap().unwrap();assert_eq!(result,native,"result/{command}");assert!(!retouch_cache().lock().unwrap().contains_key(&key));assert_eq!(engine.jobs_with_recent().last().unwrap().state,"done");assert_prepared_state(engine,expected,command);release(&identity,933).unwrap();}
    #[test]
    fn prepared_retouch_final_tail_matches_native_depth_color_and_tool_state(){
        let _guard = crate::xdesign_photo::feedback_serial();
        for command in RETOUCH{for depth in [8,16,32]{for mode in ["rgb","gray","cmyk","lab"]{let mut engine=prepared_fixture(depth,mode);engine.tools.mixer.reservoir=Some([0.8,0.3,0.1,0.9]);engine.tools.mixer.amount=0.35;engine.tools.mixer.pickup=Some([0.1,0.6,0.8,0.7]);let mut expected=twin(&engine);compare_prepared(&mut engine,&mut expected,command,&prepared_params(command));}}}
    }
    #[test]
    fn prepared_masks_channels_color_restriction_clone_slots_and_fade_match_native(){
        let _guard = crate::xdesign_photo::feedback_serial();
        for command in RETOUCH{for kind in ["mask","implicit-mask","alpha","quickMask","red"]{let mut engine=prepared_fixture(16,"rgb");let mut params=prepared_params(command);match kind{"mask"|"implicit-mask"=>{engine.execute("layer.layerMask.revealAll",json!({})).unwrap();if kind=="mask"{params["target"]=json!("mask");}else{engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();}},"alpha"=>{engine.execute("channel.new",json!({"name":"Prepared alpha"})).unwrap();engine.execute("channel.target",json!({"channel":0})).unwrap();},"quickMask"=>{engine.execute("select.editInQuickMaskMode",json!({})).unwrap();},_=>{engine.execute("channel.target",json!({"channel":"red"})).unwrap();}}
            if command=="paint.historyBrush"{params["historySource"]=super::super::history::describe(&engine).as_array().unwrap().last().unwrap()["id"].clone();}
            let mut paint=json!({"points":[[10,14],[29,25]],"size":8,"color":"#303030","seed":29});if let Some(target)=params.get("target"){paint["target"]=target.clone();}engine.execute("paint.stroke",paint).unwrap();
            if matches!(command,"paint.cloneStamp"|"paint.healingBrush"){params.as_object_mut().unwrap().remove("source");let slot=engine.presets.clone.active_mut();slot.source=Some([8.0,8.0]);slot.scale=[80.0,135.0];slot.rotation=27.0;slot.flip_h=true;}
            let mut expected=twin(&engine);compare_prepared(&mut engine,&mut expected,command,&params);super::super::execute_view_command(&mut engine,"edit.fade",json!({"opacity":45,"mode":"Multiply"})).unwrap();super::super::execute_view_command(&mut expected,"edit.fade",json!({"opacity":45,"mode":"Multiply"})).unwrap();assert_prepared_state(&engine,&expected,&format!("{command}/{kind}/Fade"));
        }}
    }
    #[test]
    fn prepared_coalescing_keeps_bounded_history_layer_targets_undo_and_redo(){
        let _guard = crate::xdesign_photo::feedback_serial();
        for command in RETOUCH{let mut engine=prepared_fixture(8,"rgb");engine.execute("layer.new.layer",json!({"name":"Second layer"})).unwrap();engine.active_mut().unwrap().history.max_states=1;let mut expected=twin(&engine);for step in 0..3{let mut params=prepared_params(command);params["coalesce"]=json!(if step<2{"one gesture"}else{"next gesture"});if command=="paint.historyBrush"{params["state"]=json!(engine.active().unwrap().history.past_len());}if step==1{let selected:Vec<_>=engine.active().unwrap().doc.walk().into_iter().map(|(_,_,layer)|layer.id).collect();engine.active_mut().unwrap().selected_layers=selected.clone();expected.active_mut().unwrap().selected_layers=selected;}compare_prepared(&mut engine,&mut expected,command,&params);}
            for command in ["edit.undo","edit.redo"]{engine.execute(command,json!({})).unwrap();expected.execute(command,json!({})).unwrap();assert_prepared_state(&engine,&expected,command);}
        }
    }
    #[test]
    fn prepared_feedback_falls_back_for_cancel_expiry_context_and_rewritten_samples(){
        let _guard = crate::xdesign_photo::feedback_serial();
        for command in ["paint.cloneStamp","paint.mixerBrush","paint.historyBrush"]{for change in ["cancel","expired","tools","pixels","rewritten"]{let mut engine=prepared_fixture(8,"rgb");let mut params=prepared_params(command);let identity=format!("prepared-fallback-{}",ulid::Ulid::new());retouch_document(&engine,Some(&identity),command,&params).unwrap();let key=stroke_key(&identity,command,&params).unwrap();match change{"cancel"=>release(&identity,933).unwrap(),"expired"=>{retouch_cache().lock().unwrap().get_mut(&key).unwrap().touched=Instant::now()-Duration::from_secs(31);},"tools"=>{engine.tools.foreground=[0.1,0.3,0.8,1.0];},"pixels"=>{engine.execute("paint.stroke",json!({"points":[[20,20]],"size":4,"color":"#ffffff"})).unwrap();},_=>{params["points"][0][0]=json!(12);}}
            let before=engine.active().unwrap().doc.clone();assert!(commit_feedback(&mut engine,&identity,command,&params).is_none(),"{command}/{change}");assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));let mut expected=twin(&engine);let actual=super::super::execute_view_command(&mut engine,command,params.clone()).unwrap();let native=expected.execute(command,super::super::history::normalize(&expected,command,params.clone()).unwrap()).unwrap();assert_eq!(actual,native);assert_prepared_state(&engine,&expected,&format!("fallback/{command}/{change}"));release(&identity,933).unwrap();
        }}
    }
    #[test]
    fn prepared_native_completion_refreshes_slices_and_keeps_journal_script_replay(){
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=prepared_fixture(8,"rgb");engine.execute("select.deselect",json!({})).unwrap();engine.execute("layer.new.layer",json!({"name":"Slice target"})).unwrap();engine.execute("paint.stroke",json!({"points":[[7,7],[12,12]],"size":7,"color":"#50c030"})).unwrap();engine.execute("layer.newLayerBasedSlice",json!({"name":"Prepared layer"})).unwrap();let before=engine.active().unwrap().doc.slices.list[0].rect;
        let mut params=prepared_params("paint.cloneStamp");params["points"]=json!([[35,35,0.5],[43,45,0.8],[51,49,0.6]]);let mut replay=twin(&engine);let mut expected=twin(&engine);compare_prepared(&mut engine,&mut expected,"paint.cloneStamp",&params);assert_ne!(engine.active().unwrap().doc.slices.list[0].rect,before);assert_eq!(serde_json::to_value(&engine.active().unwrap().doc.slices).unwrap(),serde_json::to_value(&expected.active().unwrap().doc.slices).unwrap());
        let (command,params)=engine.journal.last().unwrap();let script=replay.execute("file.scripts.browse",json!({"steps":[[command,params]]})).unwrap();assert_eq!(script["ok"],true);assert_eq!(native_pixels(&replay.active().unwrap().doc),native_pixels(&engine.active().unwrap().doc));assert_eq!(serde_json::to_value(&replay.active().unwrap().doc.slices).unwrap(),serde_json::to_value(&engine.active().unwrap().doc.slices).unwrap());
    }
    #[test]
    fn prepared_explicit_layers_keep_native_single_color_and_target_semantics(){
        let _guard = crate::xdesign_photo::feedback_serial();
        for command in RETOUCH{let mut engine=prepared_fixture(16,"rgb");let layer=engine.active().unwrap().active_layer.unwrap();engine.execute("layer.new.layer",json!({"name":"Active other layer"})).unwrap();engine.execute("channel.target",json!({"channel":"red"})).unwrap();let mut params=prepared_params(command);params["layer"]=json!(layer.0);let mut expected=twin(&engine);compare_prepared(&mut engine,&mut expected,command,&params);}
    }
    #[test]
    fn prepared_journal_and_native_save_event_actions_remain_equivalent(){
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=prepared_fixture(8,"rgb");engine.execute("file.scripts.scriptEventsManager",json!({"enabled":true,"add":{"event":"saveDocument","name":"After save","steps":[["layer.setProps",{"opacity":0.5}]]}})).unwrap();let mut expected=twin(&engine);expected.prefs=engine.prefs.clone();expected.file_menu=engine.file_menu.clone();compare_prepared(&mut engine,&mut expected,"paint.dodge",&prepared_params("paint.dodge"));assert!(engine.file_menu.event_log.is_empty());assert!(expected.file_menu.event_log.is_empty());photocraft_engine::automate_cmds::document_saved(&mut engine,0);photocraft_engine::automate_cmds::document_saved(&mut expected,0);assert!(!engine.file_menu.event_log.is_empty());assert_eq!(engine.file_menu.event_log,expected.file_menu.event_log);assert_prepared_state(&engine,&expected,"save event");
    }
    #[test]
    fn continuous_retouch_batches_retry_viewport_cancel_and_context_changes_are_safe() {
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=Session::new();engine.execute("file.new",serde_json::json!({"width":64,"height":64,"background":"#804020"})).unwrap();let source=engine.active().unwrap().doc.clone();
        let identity=format!("coverage-batches-{}",ulid::Ulid::new());let mut params=serde_json::json!({"points":[[15,16,0.5],[23,23,0.8]],"source":[7,7],"size":8,"opacity":65,"seed":231,"_orionOffset":0});
        let first=retouch_document(&engine,Some(&identity),"paint.cloneStamp",&params).unwrap();let repeated=retouch_document(&engine,Some(&identity),"paint.cloneStamp",&params).unwrap();assert!(std::sync::Arc::ptr_eq(&first.0,&repeated.0));
        params["points"]=serde_json::json!([[30,28,0.4]]);params["_orionOffset"]=serde_json::json!(2);assert!(render_with_identity(&engine,Some(&identity),"paint.cloneStamp",&params,0,0,0,0,1).unwrap().is_empty());
        let current=retouch_document(&engine,Some(&identity),"paint.cloneStamp",&params).unwrap();let mut final_params=params.clone();final_params.as_object_mut().unwrap().remove("_orionOffset");final_params["points"]=serde_json::json!([[15,16,0.5],[23,23,0.8],[30,28,0.4]]);
        let mut expected=Session::new();expected.add_document((*source).clone(),None);expected.execute("paint.cloneStamp",final_params.clone()).unwrap();assert_eq!(photocraft_compose::render(&current.0,current.0.bounds()).px,photocraft_compose::render(&expected.active().unwrap().doc,current.0.bounds()).px);
        let key=stroke_key(&identity,"paint.cloneStamp",&params).unwrap();assert_eq!(retouch_cache().lock().unwrap()[&key].live.as_ref().unwrap().samples_pushed(),3);
        params["points"][0][0]=serde_json::json!(31);assert!(retouch_document(&engine,Some(&identity),"paint.cloneStamp",&params).is_err());params["points"][0][0]=serde_json::json!(30);
        params["_orionOffset"]=serde_json::json!(4);assert!(retouch_document(&engine,Some(&identity),"paint.cloneStamp",&params).is_err());params["_orionOffset"]=serde_json::json!(3);params["points"]=serde_json::json!([[35,32,0.5]]);
        engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Color(0);assert!(retouch_document(&engine,Some(&identity),"paint.cloneStamp",&params).is_err());engine.active_mut().unwrap().channel_view.target=photocraft_engine::channel_cmds::ChannelTarget::Composite;
        release(&identity,231).unwrap();assert!(retouch_document(&engine,Some(&identity),"paint.cloneStamp",&params).is_err());assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));
        let history=engine.active().unwrap().history.entries().len();engine.execute("paint.cloneStamp",final_params.clone()).unwrap();assert_eq!(engine.active().unwrap().history.entries().len(),history+1);assert_eq!(engine.journal.last(),Some(&("paint.cloneStamp".into(),final_params)));assert!(engine.edit_state.fade.is_some());engine.execute("edit.undo",serde_json::json!({})).unwrap();assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,source.bounds()).px,photocraft_compose::render(&source,source.bounds()).px);
    }

    #[test]
    fn canceled_work_cannot_retain_pixels_and_offscreen_batches_keep_guards() {
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=Session::new();engine.execute("file.new",serde_json::json!({"width":64,"height":64,"background":"#804020"})).unwrap();let source=engine.active().unwrap().doc.clone();let identity=format!("coverage-cancel-{}",ulid::Ulid::new());
        let params=serde_json::json!({"points":[[15,16]],"source":[7,7],"size":8,"seed":2231});retouch_document(&engine,Some(&identity),"paint.cloneStamp",&params).unwrap();let key=stroke_key(&identity,"paint.cloneStamp",&params).unwrap();
        let (lease,cancel,mut live)={let mut cache=retouch_cache().lock().unwrap();let entry=cache.get_mut(&key).unwrap();(entry.lease,entry.cancel.clone(),entry.live.take().unwrap())};
        release(&identity,2231).unwrap();assert!(cancel.load(Ordering::Relaxed));let stopped=||cancel.load(Ordering::Relaxed);let prepared=live.push_with(&params,&photocraft_raster::Interrupt::cancel_only(&stopped));assert!(prepared.as_ref().unwrap_err().contains("canceled"));assert!(finish_coverage(&key,lease,live,params["points"].as_array().unwrap().clone(),prepared).unwrap_err().contains("canceled"));assert!(!retouch_cache().lock().unwrap().contains_key(&key));
        for viewport in [(0,0,0,0),(100,100,64,64)] {let mut invalid=params.clone();invalid["size"]=serde_json::json!(100000);assert!(render_with_identity(&engine,Some(&identity),"paint.cloneStamp",&invalid,viewport.0,viewport.1,viewport.2,viewport.3,1).is_err());}
        assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));
    }
    #[test]
    fn retouch_expiry_replacement_and_eviction_signal_retained_work(){
        let _guard = crate::xdesign_photo::feedback_serial();
        for change in ["expiry","replacement","eviction"]{
            let mut engine=prepared_fixture(8,"rgb");let params=prepared_params("paint.cloneStamp");let identity=format!("admission-cleanup-{}",ulid::Ulid::new());
            retouch_document(&engine,Some(&identity),"paint.cloneStamp",&params).unwrap();let key=stroke_key(&identity,"paint.cloneStamp",&params).unwrap();let cancel=retouch_cache().lock().unwrap()[&key].cancel.clone();
            let second=format!("admission-second-{}",ulid::Ulid::new());let third=format!("admission-third-{}",ulid::Ulid::new());
            match change{
                "expiry"=>{retouch_cache().lock().unwrap().get_mut(&key).unwrap().touched=Instant::now()-Duration::from_secs(31);retouch_document(&engine,Some(&identity),"paint.cloneStamp",&params).unwrap();},
                "replacement"=>{engine.tools.foreground=[0.1,0.3,0.8,1.0];retouch_document(&engine,Some(&identity),"paint.cloneStamp",&params).unwrap();},
                _=>{retouch_document(&engine,Some(&second),"paint.cloneStamp",&params).unwrap();retouch_document(&engine,Some(&third),"paint.cloneStamp",&params).unwrap();}
            }
            assert!(cancel.load(Ordering::Relaxed),"{change}");for id in [&identity,&second,&third]{release(id,933).unwrap();}
        }
    }
    #[test]
    fn final_retouch_delta_is_admitted_before_prepared_completion(){
        let _guard = crate::xdesign_photo::feedback_serial();
        for command in continuous_retouch::TOOLS{
            let mut engine=prepared_fixture(8,"rgb");let mut params=prepared_params(command);let identity=format!("admission-final-{}",ulid::Ulid::new());
            let old=params["points"].as_array().unwrap().clone();retouch_document(&engine,Some(&identity),command,&params).unwrap();let source=engine.active().unwrap().doc.clone();let journal=engine.journal.clone();let key=stroke_key(&identity,command,&params).unwrap();let cancel=retouch_cache().lock().unwrap()[&key].cancel.clone();
            params["points"].as_array_mut().unwrap().push(json!([300000,300000]));assert!(commit_feedback(&mut engine,&identity,command,&params).is_none(),"{command}");
            assert!(cancel.load(Ordering::Relaxed));assert!(!retouch_cache().lock().unwrap().contains_key(&key));assert!(Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(journal,engine.journal);assert!(!engine.has_jobs());
            params["points"]=json!(old);let mut expected=twin(&engine);compare_prepared(&mut engine,&mut expected,command,&params);release(&identity,933).unwrap();
        }
    }

    #[test]
    fn each_coverage_tool_streams_beyond_the_old_prefix_limit_without_replaying_samples() {
        let _guard = crate::xdesign_photo::feedback_serial();
        for command in ["paint.cloneStamp","paint.healingBrush","paint.spotHealing","paint.historyBrush"] {
            let mut engine=Session::new();engine.execute("file.new",serde_json::json!({"width":64,"height":64,"background":"#804020"})).unwrap();engine.execute("paint.stroke",serde_json::json!({"points":[[5,8],[52,8]],"size":8,"color":"#20b0c0","seed":21})).unwrap();let before=engine.active().unwrap().doc.clone();
            let identity=format!("coverage-long-{}",ulid::Ulid::new());let all:Vec<Value>=(0..4097).map(|index|serde_json::json!([12.0+f64::from(index%96)*0.3,16+index/96%8*3,0.2+f64::from(index%7)*0.1])).collect();
            let mut params=serde_json::json!({"points":all[..2048],"_orionOffset":0,"source":[7,7],"size":6,"hardness":50,"opacity":65,"flow":55,"type":"proximityMatch","seed":993});
            render_with_identity(&engine,Some(&identity),command,&params,0,0,0,0,1).unwrap();params["points"]=serde_json::json!(all[2048..4096]);params["_orionOffset"]=serde_json::json!(2048);render_with_identity(&engine,Some(&identity),command,&params,100,100,64,64,1).unwrap();params["points"]=serde_json::json!(all[4096..]);params["_orionOffset"]=serde_json::json!(4096);let preview=retouch_document(&engine,Some(&identity),command,&params).unwrap();
            let key=stroke_key(&identity,command,&params).unwrap();assert_eq!(retouch_cache().lock().unwrap()[&key].live.as_ref().unwrap().samples_pushed(),4097);
            params.as_object_mut().unwrap().remove("_orionOffset");params["points"]=serde_json::json!(all);let mut expected=twin(&engine);let native_start=Instant::now();let result=expected.execute(command,super::super::history::normalize(&expected,command,params.clone()).unwrap()).unwrap();let native_elapsed=native_start.elapsed();assert_eq!(photocraft_compose::render(&preview.0,before.bounds()).px,photocraft_compose::render(&expected.active().unwrap().doc,before.bounds()).px,"{command}");assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));let prepared_start=Instant::now();assert_eq!(commit_feedback(&mut engine,&identity,command,&params).unwrap().unwrap(),result);let prepared_elapsed=prepared_start.elapsed();assert_prepared_state(&engine,&expected,command);eprintln!("prepared-retouch-timing tool={command} points=4097 native_ms={:.3} prepared_ms={:.3}",native_elapsed.as_secs_f64()*1000.0,prepared_elapsed.as_secs_f64()*1000.0);engine.execute("edit.undo",serde_json::json!({})).unwrap();assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,before.bounds()).px,photocraft_compose::render(&before,before.bounds()).px);release(&identity,993).unwrap();
        }
    }

    #[test]
    fn history_feedback_streams_long_native_source_and_invalidates_after_purge(){
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=Session::new();engine.execute("file.new",json!({"width":64,"height":64,"background":"#804020"})).unwrap();engine.execute("paint.stroke",json!({"points":[[5,16],[52,16]],"size":14,"color":"#20b0c0","seed":21})).unwrap();let before=engine.active().unwrap().doc.clone();let history=engine.active().unwrap().history.past_len();let journal=engine.journal.clone();let identity=format!("history-long-{}",ulid::Ulid::new());
        let all:Vec<Value>=(0..4097).map(|index|json!([12.0+f64::from(index%96)*0.3,16+index/96%8*3,0.2+f64::from(index%7)*0.1])).collect();let mut params=json!({"points":all[..2048],"_orionOffset":0,"historySource":super::super::history::describe(&engine)[0]["id"],"size":6,"hardness":50,"opacity":65,"flow":55,"seed":993});
        render_with_identity(&engine,Some(&identity),"paint.historyBrush",&params,0,0,0,0,1).unwrap();params["points"]=json!(all[2048..4096]);params["_orionOffset"]=json!(2048);render_with_identity(&engine,Some(&identity),"paint.historyBrush",&params,100,100,64,64,1).unwrap();params["points"]=json!(all[4096..]);params["_orionOffset"]=json!(4096);let preview=retouch_document(&engine,Some(&identity),"paint.historyBrush",&params).unwrap();let key=stroke_key(&identity,"paint.historyBrush",&params).unwrap();assert_eq!(retouch_cache().lock().unwrap()[&key].live.as_ref().unwrap().samples_pushed(),4097);assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));assert_eq!(engine.journal,journal);assert_eq!(engine.active().unwrap().history.past_len(),history);
        params.as_object_mut().unwrap().remove("_orionOffset");params["points"]=json!(all);let mut expected=Session::new();expected.add_document((*before).clone(),None);*expected.active_mut().unwrap()=engine.active().unwrap().clone();expected.execute("paint.historyBrush",super::super::history::normalize(&engine,"paint.historyBrush",params.clone()).unwrap()).unwrap();let native=photocraft_compose::render(&expected.active().unwrap().doc,before.bounds()).px;assert_eq!(photocraft_compose::render(&preview.0,before.bounds()).px,native);let fallback=retouch_document(&engine,None,"paint.historyBrush",&params).unwrap();assert_eq!(photocraft_compose::render(&fallback.0,before.bounds()).px,native);
        assert!(engine.active_mut().unwrap().history.purge_last());assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));params["points"]=json!([[40,40]]);params["_orionOffset"]=json!(4097);assert!(retouch_document(&engine,Some(&identity),"paint.historyBrush",&params).is_err());release(&identity,993).unwrap();
    }

    #[test]
    fn sequential_tools_stream_long_strokes_and_final_native_commands_keep_undo_fade_and_journal(){
        let _guard = crate::xdesign_photo::feedback_serial();
        for command in ["paint.dodge","paint.burn","paint.sponge","paint.blur","paint.sharpen","paint.mixerBrush","paint.colorReplacement","paint.smudge"] {
            let mut engine=Session::new();engine.execute("file.new",json!({"width":64,"height":64,"background":"#804020"})).unwrap();engine.execute("paint.stroke",json!({"points":[[5,8],[52,8]],"size":8,"color":"#20b0c0","seed":21})).unwrap();let before=engine.active().unwrap().doc.clone();let history=engine.active().unwrap().history.entries().len();let journal=engine.journal.clone();let carry=serde_json::to_value(&engine.tools.mixer).unwrap();
            let identity=format!("sequential-long-{}",ulid::Ulid::new());let all:Vec<Value>=(0..4097).map(|index|json!([12.0+f64::from(index%96)*0.3,16+index/96%8*3,0.2+f64::from(index%7)*0.1])).collect();
            let mut params=json!({"points":all[..2048],"_orionOffset":0,"size":6,"hardness":50,"opacity":65,"flow":55,"seed":993,"strength":55});
            if matches!(command,"paint.mixerBrush"|"paint.colorReplacement"){params["hardness"]=json!(0.5);params["opacity"]=json!(0.65);params["flow"]=json!(0.55);params["color"]=json!("#e01080");}
            render_with_identity(&engine,Some(&identity),command,&params,0,0,0,0,1).unwrap();params["points"]=json!(all[2048..4096]);params["_orionOffset"]=json!(2048);render_with_identity(&engine,Some(&identity),command,&params,100,100,64,64,1).unwrap();params["points"]=json!(all[4096..]);params["_orionOffset"]=json!(4096);let preview=retouch_document(&engine,Some(&identity),command,&params).unwrap();let key=stroke_key(&identity,command,&params).unwrap();assert_eq!(retouch_cache().lock().unwrap()[&key].live.as_ref().unwrap().samples_pushed(),4097);
            assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries().len());assert_eq!(journal,engine.journal);assert_eq!(carry,serde_json::to_value(&engine.tools.mixer).unwrap());
            params.as_object_mut().unwrap().remove("_orionOffset");params["points"]=json!(all);let mut expected=Session::new();expected.add_document((*before).clone(),None);expected.tools=engine.tools.clone();let native_start=Instant::now();expected.execute(command,params.clone()).unwrap();let native_elapsed=native_start.elapsed();let native=photocraft_compose::render(&expected.active().unwrap().doc,before.bounds()).px;assert_eq!(photocraft_compose::render(&preview.0,before.bounds()).px,native,"{command}");
            let prepared_start=Instant::now();commit_feedback(&mut engine,&identity,command,&params).unwrap().unwrap();let prepared_elapsed=prepared_start.elapsed();assert_eq!(serde_json::to_value(&engine.tools.mixer).unwrap(),serde_json::to_value(&expected.tools.mixer).unwrap());eprintln!("prepared-retouch-timing tool={command} points=4097 native_ms={:.3} prepared_ms={:.3}",native_elapsed.as_secs_f64()*1000.0,prepared_elapsed.as_secs_f64()*1000.0);assert_eq!(engine.active().unwrap().history.entries().len(),history+1);assert!(engine.edit_state.fade.is_some());assert_eq!(engine.journal.last(),Some(&(command.to_owned(),params)));assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,before.bounds()).px,native);engine.execute("edit.undo",json!({})).unwrap();assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,before.bounds()).px,photocraft_compose::render(&before,before.bounds()).px);release(&identity,993).unwrap();
        }
    }

    #[test]
    fn identical_retouch_prefixes_reuse_pixels_but_tool_changes_and_cancel_invalidate_them() {
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=Session::new();engine.execute("file.new",serde_json::json!({"width":64,"height":64,"background":"#804020"})).unwrap();
        let identity=format!("retouch-reuse-{}",ulid::Ulid::new());let params=serde_json::json!({"points":[[16,16,0.4],[23,23,0.8],[32,32,0.6]],"size":10,"opacity":0.65,"hardness":0.5,"source":[10,10],"color":"#e01080","seed":4242,"strength":65,"type":"proximityMatch"});
        let original=engine.active().unwrap().doc.clone();let history=engine.active().unwrap().history.entries().len();let journal=engine.journal.clone();
        for command in RETOUCH {
            let first=retouch_document(&engine,Some(&identity),command,&params).unwrap();let repeated=retouch_document(&engine,Some(&identity),command,&params).unwrap();assert!(std::sync::Arc::ptr_eq(&first.0,&repeated.0));
            engine.tools.foreground[0]=1.0-engine.tools.foreground[0];let changed=retouch_document(&engine,Some(&identity),command,&params).unwrap();assert!(!std::sync::Arc::ptr_eq(&first.0,&changed.0));
            release(&identity,4242).unwrap();let restarted=retouch_document(&engine,Some(&identity),command,&params).unwrap();assert!(!std::sync::Arc::ptr_eq(&changed.0,&restarted.0));release(&identity,4242).unwrap();
        }
        assert!(std::sync::Arc::ptr_eq(&original,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries().len());assert_eq!(journal,engine.journal);
    }
    #[test]
    fn streamed_batches_retries_and_commit_match_native_pixels_with_one_undo() {
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=Session::new();engine.execute("file.new",serde_json::json!({"width":64,"height":64,"background":"transparent"})).unwrap();
        let mut params=serde_json::json!({"points":[[10,10,0.4],[25,20,0.7]],"size":12,"color":"#f02040","seed":99871,"smoothing":0.5});
        let identity=format!("stream-test-{}",ulid::Ulid::new());let before=engine.active().unwrap().doc.clone();
        params["_orionOffset"]=serde_json::json!(0);let first=incremental(&engine,&identity,"paint.stroke",&params).unwrap();assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));
        let retry=incremental(&engine,&identity,"paint.stroke",&params).unwrap();assert_eq!(photocraft_compose::render(&first.0,first.0.bounds()).to_rgba8(),photocraft_compose::render(&retry.0,retry.0.bounds()).to_rgba8());
        params["_orionOffset"]=serde_json::json!(2);params["points"]=serde_json::json!([[40,35,0.8],[50,50,0.6]]);incremental(&engine,&identity,"paint.stroke",&params).unwrap();
        params.as_object_mut().unwrap().remove("_orionOffset");params["points"]=serde_json::json!([[10,10,0.4],[25,20,0.7],[40,35,0.8],[50,50,0.6],[53,54,0.3]]);
        let mut expected=Session::new();expected.add_document((*before).clone(),None);expected.execute("paint.stroke",params.clone()).unwrap();
        let history=engine.active().unwrap().history.entries().len();commit_feedback(&mut engine,&identity,"paint.stroke",&params).unwrap().unwrap();assert_eq!(engine.active().unwrap().history.entries().len(),history+1);
        assert_eq!(engine.journal.last(),Some(&("paint.stroke".to_owned(),params.clone())));
        assert_eq!(engine.active().unwrap().history.undo_label(),expected.active().unwrap().history.undo_label());
        assert_eq!(engine.active().unwrap().last_damage,expected.active().unwrap().last_damage);
        assert!(engine.edit_state.fade.is_some());
        let actual=&engine.active().unwrap().doc;assert_eq!(photocraft_compose::render(actual,actual.bounds()).to_rgba8(),photocraft_compose::render(&expected.active().unwrap().doc,actual.bounds()).to_rgba8());
        engine.execute("edit.fade",serde_json::json!({"opacity":50})).unwrap();expected.execute("edit.fade",serde_json::json!({"opacity":50})).unwrap();
        assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,before.bounds()).to_rgba8(),photocraft_compose::render(&expected.active().unwrap().doc,before.bounds()).to_rgba8());
        engine.execute("edit.undo",serde_json::json!({})).unwrap();
        engine.execute("edit.undo",serde_json::json!({})).unwrap();assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,before.bounds()).to_rgba8(),photocraft_compose::render(&before,before.bounds()).to_rgba8());
        assert!(commit_feedback(&mut engine,&identity,"paint.stroke",&params).is_none());
    }
    use serde_json::json;
    #[test]
    fn incremental_feedback_matches_committed_pressure_smoothed_stroke_and_rejects_rewritten_prefixes() {
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=Session::new();engine.execute("file.new",json!({"width":300,"height":60})).unwrap();
        let mut params=json!({"points":[[10,20,0.4],[30,25,0.8]],"size":12,"color":"#a02080","seed":711,"smoothing":35});
        let identity=ulid::Ulid::new().to_string();incremental(&engine,&identity,"paint.stroke",&params).unwrap();
        for x in (40..280).step_by(4){params["points"].as_array_mut().unwrap().push(json!([x,20,0.5]));incremental(&engine,&identity,"paint.stroke",&params).unwrap();}
        let (draft,_)=incremental(&engine,&identity,"paint.stroke",&params).unwrap();engine.execute("paint.stroke",params.clone()).unwrap();
        assert_eq!(photocraft_compose::render(&draft,draft.bounds()).to_rgba8().pixels,photocraft_compose::render(&engine.active().unwrap().doc,draft.bounds()).to_rgba8().pixels);
        params["points"][0]=json!([12,20,0.4]);assert!(incremental(&engine,&identity,"paint.stroke",&params).is_err());
    }
    #[test]
    fn every_retouch_feedback_path_matches_final_pixels_and_keeps_source_and_tool_state() {
        let _guard = crate::xdesign_photo::feedback_serial();
        for command in RETOUCH {
            for target in ["pixels", "mask", "channel"] {
                if command == "paint.colorReplacement" && target != "pixels" {
                    continue;
                }
                let mut engine = Session::new();
                engine
                    .execute(
                        "file.new",
                        json!({"width":48,"height":48,"background":"#804020"}),
                    )
                    .unwrap();
                engine.execute("paint.stroke", json!({"points":[[10,10,1],[35,10,1]],"size":12,"color":"#10a0c0","seed":17})).unwrap();
                let mut params = json!({"points":[[16,16,0.4],[23,23,0.8],[32,32,0.6]],"size":10,"opacity":65,"hardness":50,"source":[10,10],"color":"#e01080","seed":42,"strength":65,"type":"proximityMatch"});
                if matches!(command, "paint.mixerBrush" | "paint.colorReplacement") {
                    params["opacity"] = json!(0.65);
                    params["hardness"] = json!(0.5);
                }
                if target == "mask" {
                    engine
                        .execute("layer.layerMask.revealAll", json!({}))
                        .unwrap();
                    engine
                        .execute("view.layerMask", json!({"mode":"gray"}))
                        .unwrap();
                    params["target"] = json!("mask");
                } else if target == "channel" {
                    engine
                        .execute("channel.new", json!({"name":"Retouch alpha"}))
                        .unwrap();
                    engine
                        .execute("channel.target", json!({"channel":0}))
                        .unwrap();
                }
                if command=="paint.historyBrush"{params["state"]=json!(engine.active().unwrap().history.past_len());let mut paint=json!({"points":[[16,16],[32,32]],"size":10,"color":"#303030","seed":27});if let Some(target)=params.get("target"){paint["target"]=target.clone();}engine.execute("paint.stroke",paint).unwrap();}
                let source = engine.active().unwrap().doc.clone();
                let history = engine.active().unwrap().history.entries().to_vec();
                let mixer = serde_json::to_value(&engine.tools.mixer).unwrap();
                let preview = render(&engine, command, &params, 0, 0, 48, 48, 1)
                    .unwrap_or_else(|error| panic!("{command}/{target}: {error}"));
                assert_eq!(preview.len(), 1);
                if command=="paint.historyBrush"{assert_ne!(preview[0].png,tiles::render(&source,Some(&engine.active().unwrap().channel_view),0,0,48,48,1,false,true).unwrap().png,"History Brush must restore different {target} pixels");}
                assert!(std::sync::Arc::ptr_eq(
                    &source,
                    &engine.active().unwrap().doc
                ));
                assert_eq!(engine.active().unwrap().history.entries(), history);
                assert_eq!(serde_json::to_value(&engine.tools.mixer).unwrap(), mixer);
                engine.execute(command, params).unwrap();
                let state = engine.active().unwrap();
                assert_eq!(
                    preview[0].png,
                    tiles::render(
                        &state.doc,
                        Some(&state.channel_view),
                        0,
                        0,
                        48,
                        48,
                        1,
                        false,
                        true
                    )
                    .unwrap()
                    .png,
                    "{command}/{target}"
                );
            }
        }
    }
    #[test]
    fn retouch_feedback_rejects_large_prefixes_and_extreme_footprints_before_editing() {
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine = Session::new();
        engine
            .execute("file.new", json!({"width":64,"height":64}))
            .unwrap();
        let before = engine.active().unwrap().doc.clone();
        for params in [
            json!({"points":vec![[1,1];2049],"size":10,"seed":1}),
            json!({"points":[[0,0],[1000000,1000000]],"size":10,"seed":1}),
            json!({"points":[[1,1]],"size":100000,"seed":1}),
        ] {
            assert!(render(&engine, "paint.smudge", &params, 0, 0, 64, 64, 1).is_err());
        }
        assert!(std::sync::Arc::ptr_eq(
            &before,
            &engine.active().unwrap().doc
        ));
    }
    #[test]
    fn native_stroke_feedback_matches_commit_with_pressure_jitter_masks_and_eraser() {
        let _guard = crate::xdesign_photo::feedback_serial();
        for (command, erase, target) in [
            ("paint.stroke", false, None),
            ("paint.stroke", true, None),
            ("paint.pencil", false, None),
            ("paint.stroke", false, Some("mask")),
        ] {
            let mut engine = Session::new();
            engine
                .execute(
                    "file.new",
                    json!({"width":64,"height":64,"background":"#804020"}),
                )
                .unwrap();
            if target.is_some() {
                engine
                    .execute("layer.layerMask.revealAll", json!({}))
                    .unwrap();
                engine
                    .execute("view.layerMask", json!({"mode":"gray"}))
                    .unwrap();
            }
            engine.execute("tools.setBrush",json!({"size":11,"spacing":0.2,"pressureSize":true,"scattering":{"enabled":true,"scatter":{"jitter":0.3},"bothAxes":true}})).unwrap();
            let params = json!({"points":[[12,12,0.4],[26,28,0.9],[45,48,0.2]],"size":11,"color":"#d01060","opacity":0.6,"hardness":0.5,"erase":erase,"seed":42,"target":target});
            let original = engine.active().unwrap().doc.clone();
            let history = engine.active().unwrap().history.entries().to_vec();
            let preview = render(&engine, command, &params, 0, 0, 64, 64, 1).unwrap();
            assert_eq!(preview.len(), 1);
            assert!(std::sync::Arc::ptr_eq(
                &original,
                &engine.active().unwrap().doc
            ));
            assert_eq!(engine.active().unwrap().history.entries(), history);
            engine.execute(command, params).unwrap();
            let state = engine.active().unwrap();
            assert_eq!(
                preview[0].png,
                tiles::render(
                    &state.doc,
                    Some(&state.channel_view),
                    0,
                    0,
                    64,
                    64,
                    1,
                    false,
                    false
                )
                .unwrap()
                .png
            );
        }
    }
    fn decoded(tile:&PhotoTile)->Vec<u8>{use base64::Engine;photocraft_codecs::decode(&base64::engine::general_purpose::STANDARD.decode(&tile.png).unwrap()).unwrap().as_u8().unwrap().to_vec()}
    fn chunks(bytes:&[u8])->Vec<([u32;6],Vec<u8>)>{
        let word=|i:usize|u32::from_le_bytes(bytes[i*4..i*4+4].try_into().unwrap());let count=word(0) as usize;let mut offset=4+count*24;
        let chunks=(0..count).map(|i|{let header:[u32;6]=std::array::from_fn(|k|word(1+i*6+k));let length=(header[4]*header[5]*4) as usize;offset+=length;(header,bytes[offset-length..offset].to_vec())}).collect();
        assert_eq!(offset,bytes.len());chunks
    }
    fn blit(view:&mut [u8],stride:u32,x:u32,y:u32,width:u32,pixels:&[u8]){for (row,line) in pixels.chunks_exact(width as usize*4).enumerate(){let start=((y as usize+row)*stride as usize+x as usize)*4;view[start..start+line.len()].copy_from_slice(line);}}
    fn tiled_view(engine:&Session,doc:&photocraft_engine::doc::Document,scale:u32)->Vec<u8>{
        let (width,height,edge)=(doc.size.width,doc.size.height,512*scale);let stride=width.div_ceil(scale);let mut view=vec![0;(stride*height.div_ceil(scale)*4) as usize];
        let color=super::super::display::View::new(&engine.color,doc).unwrap();
        for ty in (0..height).step_by(edge as usize){for tx in (0..width).step_by(edge as usize){let tile=tiles::render_with_color(doc,Some(&engine.active().unwrap().channel_view),Some(&color),tx,ty,edge.min(width-tx),edge.min(height-ty),scale,false,false).unwrap();blit(&mut view,stride,tx/scale,ty/scale,tile.pixel_width,&decoded(&tile));}}
        view
    }
    #[test]
    fn streamed_stroke_pixels_patch_the_tiled_view_into_the_committed_result() {
        let _guard = crate::xdesign_photo::feedback_serial();
        for (command,erase,scale) in [("paint.stroke",false,1),("paint.stroke",true,2),("paint.pencil",false,4)] {
            let mut engine=Session::new();engine.execute("file.new",json!({"width":1101,"height":601,"background":"#804020"})).unwrap();
            engine.execute("paint.stroke",json!({"points":[[0,300],[1100,320]],"size":90,"color":"#20b0c0","seed":5})).unwrap();
            let points:Vec<Value>=(0..38).map(|i|json!([100+i*25,90+i*12,0.3+f64::from(i%5)/10.0])).collect();
            let mut params=json!({"size":41,"color":"#d01060","opacity":0.8,"hardness":0.6,"erase":erase,"seed":77});
            let identity=format!("pixels-test-{}",ulid::Ulid::new());let stride=1101u32.div_ceil(scale);
            let mut view=tiled_view(&engine,&engine.active().unwrap().doc,scale);let before=view.clone();
            for (batch,slice) in points.chunks(2).enumerate() {
                params["points"]=Value::Array(slice.to_vec());params["_orionOffset"]=json!(batch*2);
                for ([x,y,width,height,pixel_width,pixel_height],pixels) in chunks(&render_pixels(&engine,&identity,command,&params,0,0,1101,601,scale).unwrap()) {
                    assert!(x%scale==0&&y%scale==0&&x/(512*scale)==(x+width-1)/(512*scale)&&y/(512*scale)==(y+height-1)/(512*scale),"{command}/{scale}: chunk {x},{y} {width}x{height} crosses the grid");
                    assert_eq!((pixel_width,pixel_height),(width.div_ceil(scale),height.div_ceil(scale)));
                    blit(&mut view,stride,x/scale,y/scale,pixel_width,&pixels);
                }
            }
            params.as_object_mut().unwrap().remove("_orionOffset");params["points"]=Value::Array(points);engine.execute(command,params).unwrap();
            let committed=tiled_view(&engine,&engine.active().unwrap().doc,scale);assert!(committed!=before);
            assert!(view==committed,"{command}/erase={erase}/scale={scale}: streamed pixels differ from the committed tiles");
            release(&identity,77).unwrap();
        }
    }
    #[test]
    fn streamed_preview_pixels_patch_the_published_preview_into_the_committed_preview() {
        let _guard = crate::xdesign_photo::feedback_serial();
        let preview=|doc:&photocraft_engine::doc::Document|{let (width,height)=super::super::preview_size(doc.size.width,doc.size.height);(width,super::super::display::rgba(doc,&photocraft_compose::render_reduced(doc,width,height)).unwrap().pixels)};
        for (command,erase,width,height) in [("paint.stroke",false,1101,601),("paint.stroke",true,3001,1203),("paint.pencil",false,2600,2600)] {
            let mut engine=Session::new();engine.execute("file.new",json!({"width":width,"height":height,"background":"#804020"})).unwrap();
            engine.execute("paint.stroke",json!({"points":[[0,height/2],[width-1,height/2+20]],"size":90,"color":"#20b0c0","seed":5})).unwrap();
            let points:Vec<Value>=(0..38).map(|i|json!([100+i*25*width/1101,90+i*12*height/601,0.3+f64::from(i%5)/10.0])).collect();
            let mut params=json!({"size":41,"color":"#d01060","opacity":0.8,"hardness":0.6,"erase":erase,"seed":77});
            let identity=format!("preview-pixels-test-{}",ulid::Ulid::new());
            let (stride,mut view)=preview(&engine.active().unwrap().doc);let before=view.clone();
            for (batch,slice) in points.chunks(2).enumerate() {
                params["points"]=Value::Array(slice.to_vec());params["_orionOffset"]=json!(batch*2);
                let parsed=chunks(&render_preview_pixels(&engine,&identity,command,&params,false).unwrap());assert!(parsed.len()<=1);
                for ([x,y,width,height,pixel_width,pixel_height],pixels) in parsed {assert_eq!((pixel_width,pixel_height),(width,height));blit(&mut view,stride,x,y,width,&pixels);}
            }
            params.as_object_mut().unwrap().remove("_orionOffset");params["points"]=Value::Array(points);engine.execute(command,params).unwrap();
            let (_,committed)=preview(&engine.active().unwrap().doc);assert!(committed!=before);
            assert!(view==committed,"{command}/erase={erase}/{width}x{height}: streamed preview pixels differ from the committed preview");
            release(&identity,77).unwrap();
        }
        let mut engine=Session::new();engine.execute("file.new",json!({"width":8,"height":8})).unwrap();assert!(render_preview_pixels(&engine,"preview-pixels-refused","paint.bucket",&json!({"points":[[1,1]],"seed":1}),false).is_err());
    }
    #[test]
    fn streamed_retouch_pixels_patch_the_tiled_view_into_the_committed_result() {
        let _guard = crate::xdesign_photo::feedback_serial();
        for (index,command) in continuous_retouch::TOOLS.into_iter().enumerate() {
            let mut engine=Session::new();engine.execute("file.new",json!({"width":700,"height":160,"background":"#804020"})).unwrap();
            engine.execute("paint.stroke",json!({"points":[[400,60],[640,100]],"size":30,"color":"#20b0c0","seed":5})).unwrap();
            let points:Vec<Value>=(0..12).map(|i|json!([470+i*8,70+i*3,0.4+f64::from(i%4)/10.0])).collect();
            let mut params=prepared_params(command);params["source"]=json!([440,40]);
            let identity=format!("retouch-pixels-test-{}",ulid::Ulid::new());let scale=1<<(index%2);let stride=700u32.div_ceil(scale);
            let mut view=tiled_view(&engine,&engine.active().unwrap().doc,scale);let before=view.clone();
            for (batch,slice) in points.chunks(3).enumerate() {
                params["points"]=Value::Array(slice.to_vec());params["_orionOffset"]=json!(batch*3);
                for ([x,y,_,_,pixel_width,_],pixels) in chunks(&render_pixels(&engine,&identity,command,&params,0,0,700,160,scale).unwrap()){blit(&mut view,stride,x/scale,y/scale,pixel_width,&pixels);}
            }
            params.as_object_mut().unwrap().remove("_orionOffset");params["points"]=Value::Array(points);
            let mut expected=twin(&engine);let native=super::super::history::normalize(&expected,command,params).unwrap();expected.execute(command,native).unwrap();
            let committed=tiled_view(&expected,&expected.active().unwrap().doc,scale);assert!(committed!=before,"{command} changed nothing");
            assert!(view==committed,"{command}/scale={scale}: streamed retouch pixels differ from the committed tiles");
            release(&identity,933).unwrap();
        }
    }
    #[test]
    fn patch_and_eraser_pixels_replace_the_tiled_view_with_the_committed_result() {
        let _guard = crate::xdesign_photo::feedback_serial();
        let check=|engine:&Session,command:&str,preview:&Value,commit:&Value,scale:u32,context:&str|{
            let doc=engine.active().unwrap().doc.clone();let (width,height)=(doc.size.width,doc.size.height);let identity=format!("replace-pixels-test-{}",ulid::Ulid::new());
            let mut view=tiled_view(engine,&doc,scale);let before=view.clone();
            for ([x,y,_,_,pixel_width,_],pixels) in chunks(&render_pixels(engine,&identity,command,preview,0,0,width,height,scale).unwrap()){blit(&mut view,width.div_ceil(scale),x/scale,y/scale,pixel_width,&pixels);}
            assert!(std::sync::Arc::ptr_eq(&doc,&engine.active().unwrap().doc),"{context}: feedback leaves the document untouched");
            let mut expected=twin(engine);expected.execute(command,commit.clone()).unwrap();let committed=tiled_view(&expected,&expected.active().unwrap().doc,scale);
            assert!(committed!=before,"{context} changed nothing");assert!(view==committed,"{context}: replacement pixels differ from the committed tiles");
        };
        let mut engine=Session::new();engine.execute("file.new",json!({"width":1101,"height":601,"background":"#804020"})).unwrap();
        engine.execute("paint.stroke",json!({"points":[[300,250],[700,320]],"size":60,"color":"#20b0c0","seed":5})).unwrap();
        engine.execute("select.rect",json!({"x":470,"y":250,"width":100,"height":80,"feather":2})).unwrap();
        for offset in [[-60,-90],[45,40]]{let params=json!({"offset":offset});check(&engine,"paint.patch",&params,&params,1,&format!("patch {offset:?}"));}
        let mut engine=Session::new();engine.execute("file.new",json!({"width":2000,"height":1500,"depth":8,"mode":"rgb","background":"#804020"})).unwrap();
        engine.execute("paint.stroke",json!({"points":[[900,780],[1020,820],[1100,860]],"size":48,"color":"#20b0c0","seed":21})).unwrap();
        let params=json!({"points":[[1000,820,0.7,0,0,0,1],[1050,840,0.8,0,0,0,2]],"size":36,"hardness":0.7,"flow":0.8,"sampling":"continuous","limits":"contiguous","tolerance":50,"seed":913});
        check(&engine,"paint.backgroundEraser",&marked_eraser_params(&engine,&params),&params,2,"background eraser");
        let engine=prepared_fixture(8,"rgb");let params=json!({"x":10,"y":15,"tolerance":0,"opacity":72,"antiAlias":false,"contiguous":true,"sampleAllLayers":false});
        check(&engine,"paint.magicEraser",&marked_eraser_params(&engine,&params),&params,1,"magic eraser");
    }
    #[test]
    fn streamed_view_pixels_patch_the_channel_and_mask_preview_into_the_committed_view() {
        let _guard = crate::xdesign_photo::feedback_serial();
        let preview=|engine:&Session|{let state=engine.active().unwrap();let color=super::super::display::View::new(&engine.color,&state.doc).unwrap();let preview=super::super::render_color_view_preview(&state.doc,&state.channel_view,Some(&color)).unwrap();use base64::Engine;(preview.width,photocraft_codecs::decode(&base64::engine::general_purpose::STANDARD.decode(&preview.png).unwrap()).unwrap().as_u8().unwrap().to_vec())};
        for (case,width,height) in [("hidden green",2601,900),("alpha overlay",1500,700),("gray mask",2601,900)] {
            let mut engine=Session::new();engine.execute("file.new",json!({"width":width,"height":height,"background":"#804020"})).unwrap();
            engine.execute("paint.stroke",json!({"points":[[0,height/2],[width-1,height/2+20]],"size":90,"color":"#20b0c0","seed":5})).unwrap();
            match case {
                "hidden green"=>{engine.execute("channel.setVisible",json!({"channel":"green","visible":false})).unwrap();}
                "alpha overlay"=>{engine.execute("channel.new",json!({"name":"Shown alpha"})).unwrap();engine.execute("channel.target",json!({"channel":0})).unwrap();engine.execute("channel.setVisible",json!({"channel":"composite","visible":true})).unwrap();engine.execute("channel.setVisible",json!({"channel":0,"visible":true})).unwrap();}
                _=>{engine.execute("layer.layerMask.revealAll",json!({})).unwrap();engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();}
            }
            let state=engine.active().unwrap();assert!(!state.channel_view.is_plain(&state.doc),"{case}");
            let points:Vec<Value>=(0..38).map(|i|json!([100+i*25*width/1101,90+i*12*height/601,0.3+f64::from(i%5)/10.0])).collect();
            let mut params=json!({"size":41,"color":"#d01060","opacity":0.8,"hardness":0.6,"seed":77});
            let identity=format!("view-pixels-test-{}",ulid::Ulid::new());
            let (stride,mut view)=preview(&engine);let before=view.clone();
            for (batch,slice) in points.chunks(2).enumerate() {
                params["points"]=Value::Array(slice.to_vec());params["_orionOffset"]=json!(batch*2);
                let parsed=chunks(&render_preview_pixels(&engine,&identity,"paint.stroke",&params,true).unwrap());assert!(parsed.len()<=1);
                for ([x,y,width,height,pixel_width,pixel_height],pixels) in parsed {assert_eq!((pixel_width,pixel_height),(width,height));blit(&mut view,stride,x,y,width,&pixels);}
            }
            params.as_object_mut().unwrap().remove("_orionOffset");params["points"]=Value::Array(points);engine.execute("paint.stroke",params).unwrap();
            let (_,committed)=preview(&engine);assert!(committed!=before,"{case} changed nothing");
            assert!(view==committed,"{case} {width}x{height}: streamed view pixels differ from the committed view preview");
            release(&identity,77).unwrap();
        }
    }
    #[test]
    fn stroke_pixels_clip_to_the_viewport_and_refuse_other_tools() {
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine=Session::new();engine.execute("file.new",json!({"width":8192,"height":8192,"background":"transparent"})).unwrap();
        let params=json!({"points":[[4000,4000,1]],"size":200,"seed":9});let identity=format!("pixels-bounds-{}",ulid::Ulid::new());
        let parsed=chunks(&render_pixels(&engine,&identity,"paint.stroke",&params,3990,3950,300,300,4).unwrap());
        assert!(!parsed.is_empty()&&parsed.iter().all(|([x,y,width,height,..],_)|*x>=3988&&*y>=3948&&x+width<=4292&&y+height<=4252));
        assert_eq!(chunks(&render_pixels(&engine,&identity,"paint.stroke",&params,8192,0,32,32,1).unwrap()).len(),0);
        for command in ["paint.bucket","paint.gradient","select.rect"]{assert!(render_pixels(&engine,&identity,command,&params,0,0,64,64,1).is_err());}
        assert!(render_pixels(&engine,&identity,"paint.stroke",&json!({"points":[[1,1]]}),0,0,32,32,1).is_err());
        assert!(render_pixels(&engine,&identity,"paint.stroke",&params,0,0,32,32,3).is_err());
        release(&identity,9).unwrap();
    }
    #[test]
    fn stroke_feedback_is_bounded_and_rejects_unsupported_tools_and_unseeded_requests() {
        let _guard = crate::xdesign_photo::feedback_serial();
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":8192,"height":8192,"background":"transparent"}),
            )
            .unwrap();
        let params = json!({"points":[[4000,4000,1]],"size":200,"seed":9});
        let tiles = render(&engine, "paint.stroke", &params, 0, 0, 8192, 8192, 4).unwrap();
        assert!(!tiles.is_empty() && tiles.len() <= 8);
        assert!(tiles
            .iter()
            .all(|tile| tile.pixel_width <= 512 && tile.pixel_height <= 512));
        assert!(render(&engine, "paint.cloneStamp", &params, 0, 0, 8192, 8192, 4).is_err());
        assert!(render(&engine, "paint.historyBrush", &params, 0, 0, 8192, 8192, 4).is_err());
        assert!(render(
            &engine,
            "paint.stroke",
            &json!({"points":[[1,1]]}),
            0,
            0,
            32,
            32,
            1
        )
        .is_err());
        assert!(render(&engine, "paint.stroke", &params, 0, 0, 32, 32, 3).is_err());
        assert!(render(&engine, "paint.stroke", &params, 8192, 0, 32, 32, 1)
            .unwrap()
            .is_empty());
    }
}
