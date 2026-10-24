use photocraft_engine::{Session,doc::{Document,LayerId,Surface}};
use serde_json::{Value,json};
use std::{collections::HashMap,sync::{Arc,Weak,Mutex,OnceLock}};

#[path = "xdesign_photo_history_persistence.rs"]
pub(super) mod persisted;
struct Identity {doc:Weak<Document>,id:String,versions:HashMap<std::path::PathBuf,String>}
type Ids=HashMap<usize,Identity>;
fn identities()->&'static Mutex<Ids>{static IDS:OnceLock<Mutex<Ids>>=OnceLock::new();IDS.get_or_init(Default::default)}
fn snapshot_id(doc:&Arc<Document>)->String{
    let mut ids=identities().lock().unwrap_or_else(|error|error.into_inner());
    ids.retain(|_,entry|entry.doc.strong_count()>0);let key=Arc::as_ptr(doc) as usize;
    if let Some(entry)=ids.get(&key){if entry.doc.upgrade().is_some_and(|old|Arc::ptr_eq(&old,doc)){return entry.id.clone();}}
    let id=ulid::Ulid::new().to_string();ids.insert(key,Identity{doc:Arc::downgrade(doc),id:id.clone(),versions:Default::default()});id
}
pub(super) struct Source {pub doc:Arc<Document>,pub index:usize}
pub(super) fn resolve(engine:&Session,params:&Value)->Result<Source,String>{
    let state=engine.active().ok_or("No History Brush image")?;let count=state.history.past_len();
    let document=|index|if index==count{Some(state.doc.clone())}else{state.history.state(index)};
    if let Some(id)=params.get("historySource").filter(|value|!value.is_null()){
        let id=id.as_str().and_then(|id|id.parse::<ulid::Ulid>().ok()).ok_or("Invalid History Brush source")?.to_string();
        for index in 0..=count{if let Some(doc)=document(index){if snapshot_id(&doc)==id{return Ok(Source{doc,index});}}}
        return Err("The selected History Brush source is no longer available; choose another history state".into());
    }
    let index=if let Some(index)=params.get("state").filter(|value|!value.is_null()){index.as_u64().and_then(|index|usize::try_from(index).ok()).ok_or("History Brush state must be a nonnegative integer")?}else{0};
    document(index).map(|doc|Source{doc,index}).ok_or_else(||format!("History Brush state {index} is no longer available"))
}
pub(super) fn parameters(params:&Value)->Value{json!({"state":params.get("state"),"historySource":params.get("historySource")})}
pub(super) fn normalize(engine:&Session,command:&str,mut params:Value)->Result<Value,String>{
    if command=="paint.historyBrush"{let source=resolve(engine,&params)?;let object=params.as_object_mut().ok_or("Invalid History Brush parameters")?;object.remove("historySource");object.insert("state".into(),json!(source.index));}
    Ok(params)
}
pub(super) fn surface(doc:&Document,layer:Option<LayerId>,target:&Value)->Result<Surface,String>{
    if target.as_str()!=Some("mask")&&target.as_str()!=Some("quickMask")&&target["channel"].as_u64().is_none(){if layer.and_then(|id|doc.layer(id)).is_some_and(|layer|layer.locks.pixels||layer.locks.all){return Err("The layer was locked in this history state".into());}}
    let source=match target.as_str(){Some("mask")=>layer.and_then(|id|doc.layer(id)).and_then(|layer|layer.mask.as_ref()).map(|mask|&mask.surface),Some("quickMask")=>doc.quick_mask.as_ref().map(|mask|&mask.surface),_=>if let Some(channel)=target["channel"].as_u64(){usize::try_from(channel).ok().and_then(|channel|doc.channels.get(channel)).map(|channel|&channel.surface)}else{layer.and_then(|id|doc.layer(id)).and_then(|layer|layer.surface())}};
    source.cloned().ok_or_else(||"The paint target did not exist in this history state".into())
}
pub(super) fn describe(engine:&Session)->Value{
    let Some(state)=engine.active()else{return json!([]);};let target=effective_target(state);
    let labels=state.history.entries();let count=state.history.past_len();
    json!(labels.into_iter().enumerate().filter_map(|(index,label)|{let doc=if index==count{state.doc.clone()}else{state.history.state(index)?};let reason=surface(&doc,state.active_layer,&target).err();Some(json!({"id":snapshot_id(&doc),"index":index,"label":label,"current":index==count,"available":reason.is_none(),"reason":reason}))}).collect::<Vec<_>>())
}
pub(super) fn redo_labels(engine:&Session)->Value{json!(engine.active().map(|state|state.history.redo_labels().map(str::to_owned).collect::<Vec<_>>()).unwrap_or_default())}
// History panel rows index past states, then the current state, then redo states (next first).
pub(super) fn select(engine:&mut Session,params:&Value)->Result<Value,String>{
    let target=params["index"].as_u64().and_then(|index|usize::try_from(index).ok()).ok_or("History state must be a nonnegative integer")?;
    let state=engine.active().ok_or("No image document")?;let current=state.history.past_len();
    if target>current+state.history.redo_labels().count(){return Err(format!("History state {target} is no longer available"));}
    for _ in target..current{if !engine.undo(){return Err("Wait for the current image operation to finish".into());}}
    for _ in current..target{if !engine.redo(){return Err("Wait for the current image operation to finish".into());}}
    Ok(json!(target!=current))
}
pub(super) fn effective_target(state:&photocraft_engine::DocState)->Value{
    use photocraft_engine::channel_cmds::ChannelTarget;
    match state.channel_view.target{ChannelTarget::Alpha(index)=>json!({"channel":index}),ChannelTarget::Composite if state.doc.quick_mask.is_some()=>json!("quickMask"),ChannelTarget::Composite if photocraft_engine::mask_view_cmds::current(state).is_some()=>json!("mask"),_=>Value::Null}
}

#[cfg(test)]
mod tests{
    use super::*;
    fn fixture()->Session{let mut engine=Session::new();engine.execute("file.new",json!({"width":32,"height":32,"background":"#905080"})).unwrap();for (y,color) in [(8,"#20b0c0"),(20,"#f05010")]{engine.execute("paint.stroke",json!({"points":[[4,y],[27,y]],"size":9,"color":color,"seed":31})).unwrap();}engine}
    fn params()->Value{json!({"points":[[8,8,0.4],[22,19,0.8]],"size":9,"opacity":70,"flow":55,"hardness":45,"seed":882})}
    #[test]
    fn metadata_labels_and_ids_follow_snapshots_without_owning_pixels(){
        let engine=fixture();let doc=engine.active().unwrap().doc.clone();let refs=Arc::strong_count(&doc);let sources=describe(&engine);assert_eq!(sources.as_array().unwrap().len(),3);assert_eq!(sources[0]["label"],"Open");assert_eq!(sources[2]["current"],true);assert_eq!(sources,describe(&engine));assert_eq!(Arc::strong_count(&doc),refs);
        for source in sources.as_array().unwrap(){assert!(source["id"].as_str().unwrap().parse::<ulid::Ulid>().is_ok());assert_eq!(source["available"],true);let selected=resolve(&engine,&json!({"historySource":source["id"]})).unwrap();assert_eq!(selected.index,source["index"].as_u64().unwrap() as usize);}
        let weak={let temporary=Arc::new((*doc).clone());let weak=Arc::downgrade(&temporary);snapshot_id(&temporary);weak};assert!(weak.upgrade().is_none());
    }
    #[test]
    fn source_identity_survives_index_shift_and_refuses_eviction_or_reopen(){
        let mut engine=fixture();engine.active_mut().unwrap().history.max_states=2;let source=describe(&engine)[1]["id"].clone();let params=json!({"historySource":source,"state":999});let selected=resolve(&engine,&params).unwrap().doc;
        engine.execute("paint.stroke",json!({"points":[[10,25]],"size":4,"color":"#40f020"})).unwrap();let normalized=normalize(&engine,"paint.historyBrush",params.clone()).unwrap();assert_eq!(normalized["state"],0);assert!(normalized.get("historySource").is_none());assert!(Arc::ptr_eq(&resolve(&engine,&params).unwrap().doc,&selected));
        engine.execute("paint.stroke",json!({"points":[[20,25]],"size":4})).unwrap();assert!(resolve(&engine,&params).err().unwrap().contains("no longer available"));let mut reopened=Session::new();reopened.add_document((*selected).clone(),None);assert!(resolve(&reopened,&params).is_err());
    }
    #[test]
    fn default_current_and_numeric_sources_validate_without_silent_fallback(){
        let mut engine=fixture();assert_eq!(resolve(&engine,&json!({})).unwrap().index,0);let index=engine.active().unwrap().history.past_len();assert!(Arc::ptr_eq(&resolve(&engine,&json!({"state":index})).unwrap().doc,&engine.active().unwrap().doc));
        for params in [json!({"state":-1}),json!({"state":1.5}),json!({"state":"1"}),json!({"state":index+1}),json!({"historySource":"invalid","state":0})]{assert!(resolve(&engine,&params).is_err());}
        let id=describe(&engine)[0]["id"].clone();engine.active_mut().unwrap().history.clear();assert!(resolve(&engine,&json!({"historySource":id})).is_err());assert!(Arc::ptr_eq(&resolve(&engine,&json!({})).unwrap().doc,&engine.active().unwrap().doc));
    }
    #[test]
    fn source_availability_tracks_active_masks_alpha_and_quick_mask(){
        for (create,params,view) in [("layer.layerMask.revealAll",json!({}),Some(("view.layerMask",json!({"mode":"gray"})))),("channel.new",json!({"name":"Alpha"}),Some(("channel.target",json!({"channel":0})))),("select.editInQuickMaskMode",json!({}),None)]{
            let mut engine=fixture();engine.execute(create,params).unwrap();if let Some((command,params))=view{engine.execute(command,params).unwrap();}let sources=describe(&engine);assert_eq!(sources[0]["available"],false,"{create}");assert_eq!(sources.as_array().unwrap().last().unwrap()["available"],true,"{create}");assert!(sources[0]["reason"].as_str().unwrap().contains("did not exist"));
        }
        let mut engine=fixture();engine.execute("layer.new.layer",json!({})).unwrap();assert_eq!(describe(&engine)[0]["available"],false);
    }
    #[test]
    fn native_commit_resolves_token_preserves_journal_fade_and_one_undo(){
        let mut engine=fixture();let before=engine.active().unwrap().doc.clone();let history=engine.active().unwrap().history.past_len();let mut selected=params();selected["historySource"]=describe(&engine)[0]["id"].clone();let mut expected=fixture();expected.execute("paint.historyBrush",params()).unwrap();
        super::super::execute_view_command(&mut engine,"paint.historyBrush",selected).unwrap();assert_eq!(engine.active().unwrap().history.past_len(),history+1);assert!(engine.edit_state.fade.is_some());let last=engine.journal.last().unwrap();assert_eq!(last.0,"paint.historyBrush");assert_eq!(last.1["state"],0);assert!(last.1.get("historySource").is_none());assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,before.bounds()).px,photocraft_compose::render(&expected.active().unwrap().doc,before.bounds()).px);
        engine.execute("edit.undo",json!({})).unwrap();assert_eq!(photocraft_compose::render(&engine.active().unwrap().doc,before.bounds()).px,photocraft_compose::render(&before,before.bounds()).px);
    }
    #[test]
    fn historical_pixel_locks_match_native_source_refusal_and_masks_remain_readable(){
        let mut engine=fixture();let layer=engine.active().unwrap().active_layer.unwrap();Arc::make_mut(&mut engine.active_mut().unwrap().doc).layer_mut(layer).unwrap().locks.pixels=true;let id=describe(&engine).as_array().unwrap().last().unwrap()["id"].clone();assert_eq!(describe(&engine).as_array().unwrap().last().unwrap()["available"],false);
        engine.execute("layer.layerMask.revealAll",json!({})).unwrap();let count=engine.active().unwrap().history.past_len();assert!(surface(&resolve(&engine,&json!({"historySource":id})).unwrap().doc,Some(layer),&Value::Null).is_err());assert!(surface(&engine.active().unwrap().doc,Some(layer),&json!("mask")).is_ok());
        Arc::make_mut(&mut engine.active_mut().unwrap().doc).layer_mut(layer).unwrap().locks.pixels=false;let mut params=params();params["state"]=json!(count-1);assert!(engine.execute("paint.historyBrush",params).is_err());
    }
}
