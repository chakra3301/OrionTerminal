//! Version-pinned cross-image channel operations and publication of new images.
use super::{channel_bands, channels, id, key, publish, reply, root, sessions, PhotoReply, PhotoSession, PhotoViewPreview};
use photocraft_engine::{DocState, Session};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::{AppHandle, Manager};

#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct PhotoReference { pub photo_id: String, pub version: String }

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ChannelReply { pub target: Option<PhotoReply>, pub created: Vec<PhotoReply>, pub result: Value }

fn snapshot(app: &AppHandle, project: &str, source: &PhotoReference) -> Result<DocState,String> {
    id(&source.photo_id)?;id(&source.version)?;
    super::workspace_snapshot(&root(app,project,&source.photo_id)?,project,&source.photo_id,&source.version).map(|(state,_)|state)
}

pub(super) fn prepare(state: &DocState, params: &Value, current: &PhotoReference, mut load: impl FnMut(&PhotoReference)->Result<DocState,String>) -> Result<(Session,Value),String> {
    if !params.is_object() || params.to_string().len()>1024*1024 {return Err("Invalid channel operation parameters".into());}
    let mut engine=Session::new();engine.add_document((*state.doc).clone(),None);*engine.active_mut().ok_or("No channel target")?=state.clone();
    let mut translated=params.clone();let mut indices=HashMap::new();indices.insert((current.photo_id.clone(),current.version.clone()),0);
    let mut convert=|value:&mut Value|->Result<(),String>{
        if value.is_null(){return Ok(());}
        // Public source identities are stable image/version pairs, never engine indices.
        let source:PhotoReference=serde_json::from_value(value.clone()).map_err(|_|"Invalid source image reference")?;
        id(&source.photo_id)?;id(&source.version)?;
        let identity=(source.photo_id.clone(),source.version.clone());
        let index=if let Some(index)=indices.get(&identity){*index} else {
            if indices.len()>=68{return Err("Too many channel source images".into());}
            let source_state=load(&source)?;
            if source_state.doc.size!=state.doc.size {return Err("Source images must match the target dimensions".into());}
            let index=engine.add_document((*source_state.doc).clone(),None);
            *engine.active_mut().ok_or("Missing channel source")?=source_state;indices.insert(identity,index);index
        };
        *value=Value::from(index);Ok(())
    };
    if let Some(v)=translated.get_mut("document"){convert(v)?;}
    for key in ["source","source1","source2","mask"] {if let Some(v)=translated.get_mut(key).and_then(|v|v.get_mut("document")){convert(v)?;}}
    for key in ["sourceDocument","source1Document","source2Document","maskDocument"] {if let Some(v)=translated.get_mut(key){convert(v)?;}}
    if let Some(list)=translated.get_mut("documents") {for v in list.as_array_mut().ok_or("Invalid merge sources")?{convert(v)?;}}
    engine.set_active(0);Ok((engine,translated))
}

fn stable_journal(draft: &Session, command: &str, params: &Value) -> Result<Vec<(String, Value)>, String> {
    let mut journal = Vec::new();
    for (index, (id, executed)) in draft.journal.iter().enumerate() {
        if index == 0 && id == command {
            journal.push((id.clone(), super::mask_filters::stable_parameters(params, executed)?));
        } else if index == 1 && command == "image.calculations" && id == "channel.target" {
            journal.push((id.clone(), executed.clone()));
        } else { return Err("The channel operation returned unexpected command context".into()); }
    }
    if journal.is_empty() { return Err("The channel operation returned no command context".into()); }
    Ok(journal)
}

fn validate_install(engine: &Session, captured: &DocState) -> Result<(), String> {
    let current = engine.active().ok_or("No channel target")?;
    if engine.has_jobs() || !std::sync::Arc::ptr_eq(&current.doc, &captured.doc) || current.revision != captured.revision || current.active_layer != captured.active_layer || current.selected_layers != captured.selected_layers || current.layer_anchor != captured.layer_anchor || current.channel_view != captured.channel_view || current.coalesce != captured.coalesce {
        return Err("The target image or view changed; review the current target".into());
    }
    Ok(())
}

fn install_context(target: &mut Session, mut previous: Session) {
    // Publication and response validation finish before ownership leaves the resident session.
    std::mem::swap(target.active_mut().expect("validated channel result"), previous.active_mut().expect("validated channel target"));
    std::mem::swap(&mut target.color, &mut previous.color);
    previous.journal.append(&mut target.journal);
    previous.edit_state.fade = target.edit_state.fade.take();
    std::mem::swap(target, &mut previous);
}
fn retain_reply_tools(state: &mut Value, engine: &Session) {
    state["brush"]=super::tools::inspect(engine);
    state["tools"]=super::tools::colors(engine);
    state["presets"]=super::tools::presets(engine);
}

pub(super) async fn inspect(app:AppHandle,project_id:String,source:PhotoReference)->Result<Value,String> {
    id(&project_id)?;
    tauri::async_runtime::spawn_blocking(move||{
        let (state,color)=super::workspace_snapshot(&root(&app,&project_id,&source.photo_id)?,&project_id,&source.photo_id,&source.version)?;
        let dir=root(&app,&project_id,&source.photo_id)?;
        let mut engine=Session::new();engine.add_document((*state.doc).clone(),None);*engine.active_mut().ok_or("No source image")?=state;
        color.install(&mut engine)?;
        Ok(reply(&dir,&source.photo_id,&PhotoSession{color_settings:super::color_settings::retain(&engine.color.settings),engine,version:source.version,original_path:None,writer:Default::default()},Vec::new())?.state)
    }).await.map_err(|e|e.to_string())?
}

pub(super) async fn run(app:AppHandle,project_id:String,photo_id:String,version:String,command:String,params:Value,view_key:Option<String>,preview:bool)->Result<Value,String> {
    use std::sync::atomic::{AtomicUsize,Ordering};
    static ACTIVE:AtomicUsize=AtomicUsize::new(0);
    struct Lease;impl Drop for Lease {fn drop(&mut self){ACTIVE.fetch_sub(1,Ordering::SeqCst);}}
    if !["image.applyImage","image.calculations","select.loadSelection","channel.split","channel.merge"].contains(&command.as_str()){return Err("Unsupported workspace channel operation".into());}
    let dir=root(&app,&project_id,&photo_id)?;id(&version)?;
    if ACTIVE.fetch_add(1,Ordering::SeqCst)>=2 {ACTIVE.fetch_sub(1,Ordering::SeqCst);return Err("Wait for the current channel operation to finish".into());}let lease=Lease;
    tauri::async_runtime::spawn_blocking(move||{
        let _lease=lease;
        let current=PhotoReference{photo_id:photo_id.clone(),version:version.clone()};
        let (state,color)=super::workspace_snapshot(&dir,&project_id,&photo_id,&version)?;
        let captured_view=color.key(&state.channel_view)?;
        if let Some(ref view_key)=view_key {if &color.key(&state.channel_view)?!=view_key {return Err("The image view changed; review the current target".into());}}
        let public_params=params;
        let (mut draft,params)=prepare(&state,&public_params,&current,|source|snapshot(&app,&project_id,source))?;
        color.install(&mut draft)?;
        let mut created=Vec::new();
        let result=match command.as_str(){
            "channel.split"=>{created=channel_bands::split(&draft)?;Value::Null},
            "channel.merge"=>{created.push(channel_bands::merge(&draft,&params)?);Value::Null},
            _=>channels::execute_checked(&mut draft,&command,&params,true).ok_or("Unsupported channel operation")??,
        };
        if command=="image.calculations"&&params["result"]=="newDocument" {created.push((*draft.active().ok_or("Missing calculation result")?.doc).clone());}
        if preview {
            let active=draft.active().ok_or("Missing preview image")?;
            let mut rendered:PhotoViewPreview=if command=="select.loadSelection"||command=="image.calculations"&&params["result"]=="selection" {channels::selection_preview(active)?} else {super::render_color_view_preview(&active.doc,&active.channel_view,Some(super::display::View::new(&draft.color,&active.doc)?.as_ref()))?};
            rendered.result=Some(result);return serde_json::to_value(rendered).map_err(|e|e.to_string());
        }
        let mut cache=sessions().lock().map_err(|_|"Image engine needs to be restarted")?;
        let cache_key=key(&project_id,&photo_id);
        if cache.get(&cache_key).is_some_and(|s|s.version!=version){return Err("The target image changed; reopen it before editing".into());}
        if let (Some(view_key),Some(session))=(view_key.as_ref(),cache.get(&cache_key)) {if &super::color_views::key(&session.engine)?!=view_key{return Err("The image view changed; review the current target".into());}}
        if let Some(session)=cache.get(&cache_key) {
            validate_install(&session.engine,&state)?;
            if super::color_views::key(&session.engine)?!=captured_view {return Err("The image view changed; review the current target".into());}
        }
        let context=if ["image.applyImage","image.calculations","select.loadSelection"].contains(&command.as_str()) {stable_journal(&draft,&command,&public_params)?} else {Vec::new()};
        let mut outputs=Vec::new();
        // Finish all files before installing any resident session or response.
        let assets=app.path().app_data_dir().map_err(|e|e.to_string())?.join("assets/xdesign").join(&project_id);
        let tool_dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("xdesign-tools");
        let mut published=Vec::new();
        for document in created {
            let id=ulid::Ulid::new().to_string();let mut engine=Session::new();engine.add_document(document,None);
            engine.color.settings=draft.color.settings.clone();
            super::tools::preview_settings(&tool_dir,&mut engine)?;
            if command=="image.calculations" {engine.journal=context.clone();}
            let mut session=PhotoSession{color_settings:super::color_settings::retain(&engine.color.settings),engine,version:String::new(),original_path:None,writer:Default::default()};
            publish(&assets.join(&id),&id,&mut session)?;
            outputs.push(reply(&assets.join(&id),&id,&session,Vec::new())?);published.push((key(&project_id,&id),session));
        }
        let mut staged_target=None;
        let target=if outputs.is_empty() {
            // Keep the original target history; only draft document/history/view change.
            draft.set_active(0);let edited=draft.active().cloned().ok_or("Missing target result")?;
            let mut target=PhotoSession{engine:Session::new(),color_settings:None,version:version.clone(),original_path:cache.get(&cache_key).and_then(|s|s.original_path.clone()),writer:Default::default()};
            target.color_settings=super::color_settings::retain(&draft.color.settings);
            target.engine.color=std::mem::take(&mut draft.color);
            target.engine.add_document((*edited.doc).clone(),None);*target.engine.active_mut().ok_or("Missing target")?=edited;
            target.engine.journal=context;
            target.engine.edit_state.fade=draft.edit_state.fade.clone();
            if cache.get(&cache_key).is_none() {super::tools::preview_settings(&tool_dir,&mut target.engine)?;}
            if !std::sync::Arc::ptr_eq(&state.doc,&target.engine.active().ok_or("Missing target")?.doc){publish(&dir,&photo_id,&mut target)?;}else{super::save_view(&dir,&target)?;}
            let mut response=reply(&dir,&photo_id,&target,Vec::new())?;response.result=Some(result.clone());
            if let Some(previous)=cache.get(&cache_key) {
                retain_reply_tools(&mut response.state,&previous.engine);
            }
            staged_target=Some(target);Some(response)
        } else {None};
        let response=serde_json::to_value(ChannelReply{target,created:outputs,result}).map_err(|e|e.to_string())?;
        if let Some(mut target)=staged_target {
            if let Some(previous)=cache.remove(&cache_key) {install_context(&mut target.engine,previous.engine);}
            cache.insert(cache_key,target);
        }
        for (key,session) in published {cache.insert(key,session);}
        Ok(response)
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
#[path = "xdesign_photo_channel_transaction_tests.rs"]
mod channel_transaction_tests;

#[cfg(test)]
mod tests {
    use super::*;use serde_json::json;
    fn image(color:&str)->Session {let mut s=Session::new();s.execute("file.new",json!({"width":600,"height":270,"background":color})).unwrap();s}
    #[test]
    fn pinned_cross_document_sources_new_images_split_and_merge_preserve_originals() {
        let target=image("#4080c0");let source=image("#f02050");let before=target.active().unwrap().doc.clone();let other=source.active().unwrap().doc.clone();
        let current=PhotoReference{photo_id:ulid::Ulid::new().to_string(),version:ulid::Ulid::new().to_string()};let foreign=PhotoReference{photo_id:ulid::Ulid::new().to_string(),version:ulid::Ulid::new().to_string()};
        let params=json!({"source1":{"document":{"photoId":foreign.photo_id,"version":foreign.version},"channel":"composite"},"source2":{"channel":"composite"},"result":"newDocument","name":"Result"});
        let (mut draft,translated)=prepare(target.active().unwrap(),&params,&current,|_|Ok(source.active().unwrap().clone())).unwrap();
        channels::execute_checked(&mut draft,"image.calculations",&translated,true).unwrap().unwrap();assert_eq!(draft.active().unwrap().doc.name,"Result");assert_eq!(draft.active().unwrap().doc.mode,photocraft_engine::doc::ColorMode::Grayscale);
        assert!(std::sync::Arc::ptr_eq(&before,&target.active().unwrap().doc));assert!(std::sync::Arc::ptr_eq(&other,&source.active().unwrap().doc));
        let split=channel_bands::split(&target).unwrap();let mut merged=Session::new();let list:Vec<_>=split.into_iter().map(|doc|merged.add_document(doc,None)).collect();
        let restored=channel_bands::merge(&merged,&json!({"documents":list,"mode":"rgb"})).unwrap();
        assert_eq!(photocraft_compose::render(&before,before.bounds()).to_rgba8(),photocraft_compose::render(&restored,restored.bounds()).to_rgba8());
    }
    #[test]
    fn rejects_numeric_external_references_and_wrong_dimensions_before_editing() {
        let target=image("#4080c0");let current=PhotoReference{photo_id:ulid::Ulid::new().to_string(),version:ulid::Ulid::new().to_string()};
        assert!(prepare(target.active().unwrap(),&json!({"source":{"document":1}}),&current,|_|panic!("should reject")).is_err());
        let foreign=json!({"photoId":ulid::Ulid::new().to_string(),"version":ulid::Ulid::new().to_string()});let mut small=Session::new();small.execute("file.new",json!({"width":1,"height":1})).unwrap();
        assert!(prepare(target.active().unwrap(),&json!({"source":{"document":foreign}}),&current,|_|Ok(small.active().unwrap().clone())).is_err());
        assert_eq!(target.active().unwrap().history.entries().len(),1);
    }
}
