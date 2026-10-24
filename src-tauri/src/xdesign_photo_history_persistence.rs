//! Native history is rebuilt through public History APIs from immutable bundles.
//! Weak identities and re-shared tiles preserve source identity without a second pixel owner.
use super::*;
use photocraft_engine::{DocState, doc::{Surface, LayerContent}};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{collections::HashSet,path::Path};

const KEY:&str="orionNativeHistory";
const MAX_STATES:usize=4096;
const MAX_VIEW:u64=32*1024*1024;
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Snapshot {id:String,version:String,label:String,active:Option<u64>,selected:Vec<u64>}
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Saved {schema_version:u32,document_id:u64,current:usize,states:Vec<Snapshot>,max_states:usize,max_bytes:usize,coalesce:Option<String>}

fn parsed(view:&Value,version:&str)->Result<Option<Saved>,String>{
    let Some(value)=view.get(KEY)else{return Ok(None);};
    let saved:Saved=serde_json::from_value(value.clone()).map_err(|error|format!("Invalid saved native history: {error}"))?;
    if saved.schema_version!=1||saved.states.is_empty()||saved.states.len()>MAX_STATES||saved.current>=saved.states.len()||saved.max_states==0||saved.max_states>MAX_STATES||saved.states[saved.current].version!=version||saved.coalesce.as_ref().is_some_and(|key|key.len()>4096){return Err("Invalid saved native history limits or current version".into());}
    let mut ids=HashSet::new();let mut versions=HashSet::new();
    for snapshot in &saved.states {
        super::super::id(&snapshot.id)?;super::super::id(&snapshot.version)?;
        if !ids.insert(&snapshot.id)||!versions.insert(&snapshot.version)||snapshot.label.len()>16_384||snapshot.selected.len()>100_000{return Err("Invalid or repeated native history snapshot".into());}
    }
    Ok(Some(saved))
}
pub(crate) fn references(view:&Value,version:&str)->Result<Vec<String>,String>{Ok(parsed(view,version)?.map_or_else(Vec::new,|saved|saved.states.into_iter().map(|snapshot|snapshot.version).collect()))}
pub(crate) fn read_view(path:&Path)->Result<Value,String>{
    use std::io::Read;
    let metadata=std::fs::symlink_metadata(path).map_err(|error|error.to_string())?;
    if !metadata.is_file()||metadata.file_type().is_symlink()||metadata.len()>MAX_VIEW{return Err("Invalid or oversized saved image view".into());}
    let mut bytes=Vec::new();std::fs::File::open(path).map_err(|error|error.to_string())?.take(MAX_VIEW+1).read_to_end(&mut bytes).map_err(|error|error.to_string())?;
    if bytes.len() as u64>MAX_VIEW{return Err("Saved image view exceeds 32MB".into());}
    serde_json::from_slice(&bytes).map_err(|error|error.to_string())
}
fn bind(doc:&Arc<Document>,id:String,dir:&Path,version:String){
    let mut ids=identities().lock().unwrap_or_else(|error|error.into_inner());
    let entry=ids.entry(Arc::as_ptr(doc) as usize).or_insert_with(||Identity{doc:Arc::downgrade(doc),id:id.clone(),versions:Default::default()});
    if !entry.doc.upgrade().is_some_and(|old|Arc::ptr_eq(&old,doc)){*entry=Identity{doc:Arc::downgrade(doc),id:id.clone(),versions:Default::default()};}
    entry.id=id;entry.versions.insert(dir.into(),version);
}
fn stored(doc:&Arc<Document>,dir:&Path)->Option<String>{identities().lock().ok()?.get(&(Arc::as_ptr(doc) as usize)).filter(|entry|entry.doc.upgrade().is_some_and(|old|Arc::ptr_eq(&old,doc)))?.versions.get(dir).cloned()}

fn admit_history<'a>(past:usize,max_states:usize,coalesce:Option<&str>,redo:impl Iterator<Item=&'a str>)->Result<(),String>{
    if max_states==0||max_states>MAX_STATES||coalesce.is_some_and(|key|key.len()>4096){return Err("Invalid saved native history limits or current version".into());}
    let current_and_past=past.checked_add(1).filter(|count|*count<=MAX_STATES).ok_or("Saved native history exceeds 4096 states")?;
    let remaining=MAX_STATES-current_and_past;
    if redo.take(remaining+1).count()>remaining{return Err("Saved native history exceeds 4096 states".into());}
    Ok(())
}
fn with_admitted_history<T>(state:&DocState,work:impl FnOnce()->Result<T,String>)->Result<T,String>{
    // Cloning history duplicates private labels and target vectors before traversal can refuse it.
    admit_history(state.history.past_len(),state.history.max_states,state.coalesce.as_deref(),state.history.redo_labels())?;
    work()
}
fn default_for<T:Default>(_:&T)->T{T::default()}
pub(crate) fn save(dir:&Path,version:&str,state:&DocState,view:&mut Value)->Result<(),String>{
    with_admitted_history(state,||{
    let source_id=snapshot_id(&state.doc);bind(&state.doc,source_id.clone(),dir,version.into());
    let mut probe=state.history.clone();probe.record("history target probe",state.doc.clone(),Default::default());
    let (_,layers)=probe.undo(state.doc.clone()).ok_or("Native history target unavailable")?;
    let row=|doc:Arc<Document>,label:String,active:Option<LayerId>,selected:Vec<LayerId>|(doc,label,active,selected);
    let mut states=vec![row(state.doc.clone(),state.history.entries().last().cloned().unwrap_or_else(||"Open".into()),layers.active,layers.selected)];
    let mut history=state.history.clone();let mut doc=state.doc.clone();
    while let Some((previous,layers))=history.undo(doc){doc=previous.clone();states.push(row(previous,history.entries().last().cloned().ok_or("Native history label unavailable")?,layers.active,layers.selected));if states.len()>MAX_STATES{return Err("Saved native history exceeds 4096 states".into());}}
    states.reverse();let current=states.len()-1;
    let mut history=state.history.clone();let mut doc=state.doc.clone();
    while let Some((next,layers))=history.redo(doc){doc=next.clone();states.push(row(next,history.entries().last().cloned().ok_or("Native redo label unavailable")?,layers.active,layers.selected));if states.len()>MAX_STATES{return Err("Saved native history exceeds 4096 states".into());}}
    let mut writer=super::super::bundle::IncrementalWriter::default();let mut saved=Vec::with_capacity(states.len());
    for (doc,label,active,selected) in states {
        let id=snapshot_id(&doc);
        let version=match stored(&doc,dir){Some(version) if dir.join(format!("{version}.pcraft")).exists()=>version,_=>{let version=ulid::Ulid::new().to_string();super::super::bundle::write_document(dir,&version,&doc,&mut writer)?;bind(&doc,id.clone(),dir,version.clone());version}};
        saved.push(Snapshot{id,version,label,active:active.map(|id|id.0),selected:selected.into_iter().map(|id|id.0).collect()});
    }
    let saved=Saved{schema_version:1,document_id:state.doc.id.0,current,states:saved,max_states:state.history.max_states,max_bytes:state.history.max_bytes,coalesce:state.coalesce.clone()};
    view[KEY]=serde_json::to_value(saved).map_err(|error|error.to_string())?;
    parsed(view,version)?;
    if serde_json::to_vec(view).map_err(|error|error.to_string())?.len() as u64>MAX_VIEW{return Err("Saved image view exceeds 32MB".into());}
    Ok(())
    })
}

#[derive(Default)]
struct Tiles {tiles:HashMap<[u8;32],Weak<photocraft_raster::Tile>>}
impl Tiles {
    fn surface(&mut self,surface:&mut Surface){
        let mut shared=Vec::new();
        for (coord,tile) in surface.tiles(){let hash: [u8;32]=Sha256::digest(tile.bytes()).into();if let Some(previous)=self.tiles.get(&hash).and_then(Weak::upgrade).filter(|previous|previous.bytes()==tile.bytes()){shared.push((*coord,previous));}else{self.tiles.insert(hash,Arc::downgrade(tile));}}
        surface.put_tiles(shared);
    }
    fn document(&mut self,doc:&mut Document){
        let ids:Vec<_>=doc.walk().into_iter().map(|(_,_,layer)|layer.id).collect();
        for id in ids {if let Some(layer)=doc.layer_mut(id){if let Some(surface)=layer.surface_mut(){self.surface(surface);}if let Some(mask)=&mut layer.mask{self.surface(&mut mask.surface);}if let LayerContent::Smart(smart)=&mut layer.content{if let Some(mask)=&mut smart.filter_mask{self.surface(&mut mask.surface);}}}}
        if let Some(selection)=&mut doc.selection{self.surface(selection);}if let Some(mask)=&mut doc.quick_mask{self.surface(&mut mask.surface);}for channel in &mut doc.channels{self.surface(&mut channel.surface);}for pattern in &mut doc.patterns{self.surface(&mut pattern.surface);}
    }
}
fn checked_layers(snapshot:&Snapshot,doc:&Document)->Result<(),String>{
    if snapshot.active.is_some_and(|id|doc.layer(LayerId(id)).is_none())||snapshot.selected.iter().any(|id|doc.layer(LayerId(*id)).is_none())||snapshot.selected.iter().collect::<HashSet<_>>().len()!=snapshot.selected.len(){return Err("Saved history targets a missing or repeated layer".into());}Ok(())
}
pub(crate) fn restore_current(version:&str,state:&mut DocState,view:&Value)->Result<(),String>{
    let Some(saved)=parsed(view,version)?else{return Ok(());};
    if saved.document_id!=state.doc.id.0{return Err("Saved history belongs to another image document".into());}
    checked_layers(&saved.states[saved.current],&state.doc)?;
    state.coalesce=saved.coalesce;
    Ok(())
}
pub(crate) fn restore(dir:&Path,version:&str,state:&mut DocState,view:&Value)->Result<(),String>{
    let Some(saved)=parsed(view,version)?else{return Ok(());};
    if saved.document_id!=state.doc.id.0{return Err("Saved history belongs to another image document".into());}
    let mut tiles=Tiles::default();let mut current_doc=state.doc.clone();tiles.document(Arc::make_mut(&mut current_doc));
    let mut documents=Vec::with_capacity(saved.states.len());
    for (index,snapshot) in saved.states.iter().enumerate(){
        let doc=if index==saved.current{current_doc.clone()}else{
            let mut doc=photocraft_format::load_path_with(&dir.join(format!("{}.pcraft",snapshot.version)),&photocraft_format::LoadOptions{max_total_bytes:2*1024*1024*1024,max_blob_bytes:512*1024*1024,max_manifest_bytes:32*1024*1024,preserve_ids:true}).map_err(|error|error.to_string())?;
            if doc.id.0!=saved.document_id||doc.size.width==0||doc.size.height==0||u64::from(doc.size.width)*u64::from(doc.size.height)>super::super::MAX_PIXELS{return Err("Invalid native history image identity or dimensions".into());}
            tiles.document(&mut doc);Arc::new(doc)
        };
        checked_layers(snapshot,&doc)?;documents.push(doc);
    }
    let mut history=default_for(&state.history);history.max_states=saved.states.len();history.max_bytes=0;history.set_current_label(saved.states[0].label.clone());
    let mut probe=history.clone();probe.record("history target probe",documents[0].clone(),Default::default());let (_,mut layers)=probe.undo(documents[0].clone()).ok_or("Native history target unavailable")?;
    layers.active=saved.states[0].active.map(LayerId);layers.selected=saved.states[0].selected.iter().copied().map(LayerId).collect();history.set_current_layers(layers.clone());
    for index in 1..saved.states.len(){layers.active=saved.states[index].active.map(LayerId);layers.selected=saved.states[index].selected.iter().copied().map(LayerId).collect();history.record(saved.states[index].label.clone(),documents[index-1].clone(),layers.clone());}
    let mut doc=documents.last().ok_or("Missing saved history")?.clone();
    for _ in saved.current+1..saved.states.len(){doc=history.undo(doc).ok_or("Missing native redo history")?.0;}
    history.max_states=saved.max_states;history.max_bytes=saved.max_bytes;
    for (snapshot,doc) in saved.states.iter().zip(&documents){bind(doc,snapshot.id.clone(),dir,snapshot.version.clone());}
    state.history=history;state.coalesce=saved.coalesce;state.doc=doc;
    Ok(())
}

#[cfg(test)]
#[path = "xdesign_photo_history_admission_tests.rs"]
mod admission_tests;

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(std::path::PathBuf);
    impl Drop for Temp{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
    fn temp()->Temp{Temp(std::env::temp_dir().join(format!("xdesign-native-history-{}",ulid::Ulid::new())))}
    fn fixture(depth:u64,mode:&str)->super::super::super::PhotoSession{
        let mut engine=Session::new();engine.execute("file.new",json!({"width":64,"height":48,"depth":depth,"mode":mode,"background":"#905080"})).unwrap();
        super::super::super::PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()}
    }
    fn publish(dir:&Path,session:&mut super::super::super::PhotoSession)->super::super::super::PhotoDocument{super::super::super::publish(dir,&ulid::Ulid::new().to_string(),session).unwrap()}
    fn restored(dir:&Path,version:&str)->super::super::super::PhotoSession{super::super::super::restore(dir,version,None).unwrap()}
    fn same(actual:&Session,expected:&Session){
        let a=actual.active().unwrap();let b=expected.active().unwrap();
        assert_eq!(photocraft_compose::render(&a.doc,a.doc.bounds()).px,photocraft_compose::render(&b.doc,b.doc.bounds()).px);assert_eq!(a.history.entries(),b.history.entries());assert_eq!(a.history.redo_labels().collect::<Vec<_>>(),b.history.redo_labels().collect::<Vec<_>>());assert_eq!(a.active_layer,b.active_layer);assert_eq!(a.selected_layers,b.selected_layers);assert_eq!(a.history.max_states,b.history.max_states);assert_eq!(a.history.max_bytes,b.history.max_bytes);assert_eq!(a.coalesce,b.coalesce);
        assert_eq!(super::super::describe(actual),super::super::describe(expected));
    }
    #[test]
    fn discard_restore_skips_historical_bundles_but_requires_current_bundle(){
        let dir=temp();let mut session=fixture(16,"rgb");publish(&dir.0,&mut session);
        session.engine.execute("paint.stroke",json!({"points":[[8,8]],"size":7,"seed":3})).unwrap();publish(&dir.0,&mut session);
        let path=dir.0.join(format!("{}.view.json",session.version));let view=read_view(&path).unwrap();let saved=parsed(&view,&session.version).unwrap().unwrap();
        let historical=saved.states.iter().find(|row|row.version!=session.version).unwrap();let historical_path=dir.0.join(format!("{}.pcraft",historical.version));
        let discard=||super::super::super::workspace_snapshot_with_history(&dir.0,"nonresident-project","nonresident-photo",&session.version,super::super::super::snapshot::HistoryPolicy::Discard);
        let expected=discard().unwrap();
        std::fs::write(historical_path.join("manifest.json"),b"corrupt historical bundle").unwrap();assert!(super::super::super::restore(&dir.0,&session.version,None).is_err());
        let actual=discard().unwrap();assert_eq!(photocraft_compose::render(&actual.0.doc,actual.0.doc.bounds()).px,photocraft_compose::render(&expected.0.doc,expected.0.doc.bounds()).px);assert_eq!(actual.0.history.past_len(),0);
        std::fs::remove_dir_all(&historical_path).unwrap();assert!(discard().is_ok());assert!(super::super::super::restore(&dir.0,&session.version,None).is_err());
        let current=dir.0.join(format!("{}.pcraft",session.version));let manifest=current.join("manifest.json");let bytes=std::fs::read(&manifest).unwrap();std::fs::write(&manifest,b"corrupt current bundle").unwrap();assert!(discard().is_err());std::fs::write(&manifest,bytes).unwrap();std::fs::remove_dir_all(&current).unwrap();assert!(discard().is_err());
    }
    #[test]
    fn discard_restore_preserves_current_targets_channels_color_and_coalesce(){
        let dir=temp();let mut session=fixture(32,"rgb");
        session.engine.execute("layer.new.layer",json!({"name":"Second"})).unwrap();session.engine.execute("channel.new",json!({"name":"Alpha"})).unwrap();session.engine.execute("channel.target",json!({"channel":0})).unwrap();
        session.engine.active_mut().unwrap().channel_view.set_color_visible(1,false);
        session.engine.execute("view.proofColors",json!({"on":true})).unwrap();session.engine.execute("view.thirtyTwoBitPreviewOptions",json!({"method":"exposureGamma","exposure":1.5,"gamma":1.2})).unwrap();
        session.engine.active_mut().unwrap().coalesce=Some("saved-preview-stroke".into());publish(&dir.0,&mut session);
        let kept=restored(&dir.0,&session.version);assert!(kept.engine.active().unwrap().history.can_undo());
        let (actual,color)=super::super::super::workspace_snapshot_with_history(&dir.0,"nonresident-project","nonresident-photo",&session.version,super::super::super::snapshot::HistoryPolicy::Discard).unwrap();let expected=kept.engine.active().unwrap();
        assert_eq!(actual.active_layer,expected.active_layer);assert_eq!(actual.selected_layers,expected.selected_layers);assert_eq!(actual.layer_anchor,expected.layer_anchor);assert_eq!(actual.coalesce,expected.coalesce);assert_eq!(serde_json::to_value(&actual.channel_view).unwrap(),serde_json::to_value(&expected.channel_view).unwrap());
        assert_eq!(color.preview_cache_key().unwrap(),super::super::super::color_views::Snapshot::capture(&kept.engine).unwrap().preview_cache_key().unwrap());
        assert_eq!(photocraft_compose::render(&actual.doc,actual.doc.bounds()).px,photocraft_compose::render(&expected.doc,expected.doc.bounds()).px);assert!(!actual.history.can_undo());assert!(!actual.history.can_redo());
    }
    #[test]
    fn discard_restore_validates_full_envelope_and_current_history_targets(){
        let dir=temp();let mut session=fixture(8,"rgb");session.engine.execute("paint.stroke",json!({"points":[[10,10]],"size":5,"seed":3})).unwrap();publish(&dir.0,&mut session);
        let path=dir.0.join(format!("{}.view.json",session.version));let original=read_view(&path).unwrap();let current=original[KEY]["current"].as_u64().unwrap() as usize;
        for change in ["schema","current","identity","duplicate","version","layer","selected","unknown","limit","coalesce"]{
            let mut view=original.clone();match change{"schema"=>view[KEY]["schemaVersion"]=json!(2),"current"=>view[KEY]["current"]=json!(999),"identity"=>view[KEY]["documentId"]=json!(0),"duplicate"=>view[KEY]["states"][0]["id"]=view[KEY]["states"][1]["id"].clone(),"version"=>view[KEY]["states"][0]["version"]=json!("invalid"),"layer"=>view[KEY]["states"][current]["active"]=json!(9_999_999),"selected"=>view[KEY]["states"][current]["selected"]=json!([9_999_999]),"limit"=>view[KEY]["maxStates"]=json!(0),"coalesce"=>view[KEY]["coalesce"]=json!("x".repeat(4097)),_=>view[KEY]["unknown"]=json!(true)}
            photocraft_format::atomic_write(&path,&serde_json::to_vec(&view).unwrap()).unwrap();assert!(super::super::super::workspace_snapshot_with_history(&dir.0,"nonresident-project","nonresident-photo",&session.version,super::super::super::snapshot::HistoryPolicy::Discard).is_err(),"{change}");
        }
        let mut legacy=original;legacy.as_object_mut().unwrap().remove(KEY);photocraft_format::atomic_write(&path,&serde_json::to_vec(&legacy).unwrap()).unwrap();assert!(super::super::super::workspace_snapshot_with_history(&dir.0,"nonresident-project","nonresident-photo",&session.version,super::super::super::snapshot::HistoryPolicy::Discard).is_ok());
    }
    #[test]
    fn native_history_portable_export_keeps_sources_redo_and_duplicate_snapshot_roots(){
        let temp=temp();let source=temp.0.join("source");let photo=ulid::Ulid::new().to_string();let dir=source.join(&photo);let mut session=fixture(16,"rgb");
        let first=super::super::super::publish(&dir,&photo,&mut session).unwrap();
        session.engine.execute("paint.stroke",json!({"points":[[8,8]],"size":7,"seed":3})).unwrap();session.engine.execute("paint.stroke",json!({"points":[[18,18]],"size":7,"seed":4})).unwrap();session.engine.execute("edit.undo",json!({})).unwrap();
        let current=super::super::super::publish(&dir,&photo,&mut session).unwrap();let sources=super::super::describe(&session.engine);
        let parent_id=ulid::Ulid::new().to_string();let mut parent_session=fixture(8,"rgb");let parent=super::super::super::publish(&source.join(&parent_id),&parent_id,&mut parent_session).unwrap();
        let draft=json!({"id":photo,"shapeId":ulid::Ulid::new().to_string(),"source":"legacy","updatedAt":1,"trail":[{"parent":parent,"childId":photo,"layer":1,"past":[first],"future":[]}]});
        let mut registry=serde_json::Map::new();registry.insert(photo.clone(),serde_json::to_value(&current).unwrap());registry.insert(parent_id,serde_json::to_value(&parent).unwrap());
        let document=json!({"pages":[{"shapes":[]}],"photoDocuments":registry,"photoDrafts":[draft]});
        let bytes=crate::xdesign_archive::build_archive(&source,"History".into(),document).unwrap();let zip=photocraft_format::zip::ZipReader::new(&bytes).unwrap();assert!(zip.find(&format!("photos/{photo}/{}.png",first.version)).is_some());
        let imported=temp.0.join("imported");crate::xdesign_archive::unpack_archive(&bytes,&imported).unwrap();let reopened=restored(&imported.join(&photo),&current.version);assert_eq!(super::super::describe(&reopened.engine),sources);assert!(reopened.engine.active().unwrap().history.can_redo());
    }
    #[test]
    fn room_image_archive_preserves_editable_history_sources_undo_redo_and_originals(){
        let temp=temp();let source=temp.0.join("source");let target=temp.0.join("target");std::fs::create_dir_all(&target).unwrap();
        let photo=ulid::Ulid::new().to_string();let dir=source.join(&photo);let mut session=fixture(32,"rgb");
        super::super::super::publish(&dir,&photo,&mut session).unwrap();
        session.engine.execute("paint.stroke",json!({"points":[[8,8]],"size":7,"seed":3})).unwrap();
        session.engine.execute("paint.stroke",json!({"points":[[18,18]],"size":7,"seed":4})).unwrap();session.engine.execute("edit.undo",json!({})).unwrap();
        let current=super::super::super::publish(&dir,&photo,&mut session).unwrap();let original=super::super::describe(&session.engine);
        let prepared=crate::xdesign_archive::room_image::build(&source,&serde_json::to_value(&current).unwrap()).unwrap();
        let local=ulid::Ulid::new().to_string();let imported=crate::xdesign_archive::room_image::import(&prepared.bytes,&target,&local,&prepared.info).unwrap();
        assert_eq!(imported.photo["id"],local);let mut reopened=restored(&target.join(&local),&current.version);same(&reopened.engine,&session.engine);
        assert_eq!(super::super::describe(&reopened.engine),original);assert!(reopened.engine.active().unwrap().history.can_redo());
        for command in ["edit.redo","edit.undo","edit.undo","edit.redo"]{
            session.engine.execute(command,json!({})).unwrap();reopened.engine.execute(command,json!({})).unwrap();same(&reopened.engine,&session.engine);
        }
        let unchanged=restored(&dir,&current.version);assert_eq!(super::super::describe(&unchanged.engine),original);
    }
    #[test]
    fn native_history_past_redo_labels_targets_and_source_ids_survive_version_reopen(){
        for depth in [8,16,32]{for mode in ["rgb","gray","cmyk","lab"]{
            let dir=temp();let mut session=fixture(depth,mode);publish(&dir.0,&mut session);
            for step in 0..3{session.engine.execute("layer.new.layer",json!({"name":format!("Layer {step}")})).unwrap();session.engine.execute("paint.stroke",json!({"points":[[8+step*10,12],[28,28]],"size":9,"color":"#20b0c0","seed":step+3})).unwrap();publish(&dir.0,&mut session);}
            session.engine.execute("edit.undo",json!({})).unwrap();session.engine.execute("edit.undo",json!({})).unwrap();publish(&dir.0,&mut session);
            let mut actual=restored(&dir.0,&session.version);same(&actual.engine,&session.engine);
            while session.engine.active().unwrap().history.can_undo(){actual.engine.execute("edit.undo",json!({})).unwrap();session.engine.execute("edit.undo",json!({})).unwrap();same(&actual.engine,&session.engine);}
            while session.engine.active().unwrap().history.can_redo(){actual.engine.execute("edit.redo",json!({})).unwrap();session.engine.execute("edit.redo",json!({})).unwrap();same(&actual.engine,&session.engine);}
        }}
    }
    #[test]
    fn native_history_saved_sources_support_history_brush_after_project_undo_redo_reopen(){
        for target in ["pixels","mask","alpha","quickMask"]{
            let dir=temp();let mut session=fixture(16,"rgb");
            match target{"mask"=>{session.engine.execute("layer.layerMask.revealAll",json!({})).unwrap();session.engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();},"alpha"=>{session.engine.execute("channel.new",json!({"name":"Source"})).unwrap();session.engine.execute("channel.target",json!({"channel":0})).unwrap();},"quickMask"=>{session.engine.execute("select.editInQuickMaskMode",json!({})).unwrap();},_=>{}}
            let first=publish(&dir.0,&mut session);let source=super::super::describe(&session.engine).as_array().unwrap().iter().find(|source|source["available"]==true).unwrap()["id"].clone();
            session.engine.execute("paint.stroke",json!({"points":[[8,8],[35,25]],"size":12,"color":"#10b0c0","seed":5})).unwrap();let second=publish(&dir.0,&mut session);
            assert!(super::super::resolve(&restored(&dir.0,&first.version).engine,&json!({"historySource":source})).is_ok());
            let mut actual=restored(&dir.0,&second.version);let params=json!({"historySource":source,"points":[[10,9,0.4],[20,16,0.8],[33,24,0.6]],"size":9,"opacity":70,"flow":55,"hardness":45,"seed":2882});
            let mut expected=restored(&dir.0,&second.version);let mut native_params=super::super::normalize(&expected.engine,"paint.historyBrush",params.clone()).unwrap();
            let coverage_fade=super::super::super::mask_filters::prepare_paint_fade(&expected.engine,"paint.historyBrush",&mut native_params);
            expected.engine.execute("paint.historyBrush",native_params).unwrap();
            // Native pixels/history remain the oracle; only layer-only Fade metadata needs the host adapter.
            super::super::super::mask_filters::finish_paint_fade(&mut expected.engine,coverage_fade);
            let identity=format!("persisted-history-{}",ulid::Ulid::new());let mut prefix=params.clone();prefix["points"]=json!([[10,9,0.4],[20,16,0.8]]);
            super::super::super::stroke::render_with_identity(&actual.engine,Some(&identity),"paint.historyBrush",&prefix,0,0,0,0,1).unwrap();
            super::super::super::stroke::commit_feedback(&mut actual.engine,&identity,"paint.historyBrush",&params).unwrap().unwrap();
            assert_eq!(photocraft_compose::render(&actual.engine.active().unwrap().doc,actual.engine.active().unwrap().doc.bounds()).px,photocraft_compose::render(&expected.engine.active().unwrap().doc,expected.engine.active().unwrap().doc.bounds()).px);
            assert_eq!(actual.engine.active().unwrap().doc,expected.engine.active().unwrap().doc);
            assert_eq!(actual.engine.active().unwrap().history.entries(),expected.engine.active().unwrap().history.entries());assert_eq!(actual.engine.journal,expected.engine.journal);assert_eq!(actual.engine.edit_state.fade,expected.engine.edit_state.fade);
            if matches!(target,"alpha"|"quickMask"){assert!(super::super::super::mask_filters::can_fade(&actual.engine));assert!(actual.engine.edit_state.fade.is_none());}else{assert!(actual.engine.edit_state.fade.is_some());}
            publish(&dir.0,&mut actual);assert!(super::super::resolve(&restored(&dir.0,&actual.version).engine,&json!({"historySource":source})).is_ok());super::super::super::stroke::release(&identity,2882).unwrap();
        }
    }
    #[test]
    fn native_history_reopen_reshared_tiles_retain_copy_on_write_and_bounded_limits(){
        let dir=temp();let mut session=fixture(32,"rgb");session.engine=Session::new();session.engine.execute("file.new",json!({"width":600,"height":260,"depth":32,"background":"#905080"})).unwrap();session.engine.execute("paint.stroke",json!({"points":[[400,30]],"size":5,"seed":2})).unwrap();session.engine.active_mut().unwrap().history.max_states=2;session.engine.active_mut().unwrap().history.max_bytes=8*1024*1024;
        for index in 0..5{session.engine.execute("paint.stroke",json!({"points":[[5+index*8,10]],"size":4,"seed":index+1})).unwrap();publish(&dir.0,&mut session);}
        let original=super::super::describe(&session.engine);let mut actual=restored(&dir.0,&session.version);same(&actual.engine,&session.engine);let state=actual.engine.active().unwrap();let layer=state.active_layer.unwrap();let history=state.history.state(0).unwrap();let source=history.layer(layer).unwrap().surface().unwrap();let current=state.doc.layer(layer).unwrap().surface().unwrap();let mut shared=0;
        for (coord,tile) in source.tiles(){if let Some(other)=current.tile(*coord){if tile.bytes()==other.bytes(){assert!(Arc::ptr_eq(tile,other));shared+=1;}}}
        assert!(state.history.pixel_bytes(&state.doc)<=session.engine.active().unwrap().history.pixel_bytes(&session.engine.active().unwrap().doc));
        assert!(shared>0);
        eprintln!("native-history-sharing states={} shared_unchanged_tiles={shared} restored_pixel_bytes={} original_pixel_bytes={}",state.history.past_len()+1,state.history.pixel_bytes(&state.doc),session.engine.active().unwrap().history.pixel_bytes(&session.engine.active().unwrap().doc));
        let before=source.read_region(history.bounds());actual.engine.execute("paint.stroke",json!({"points":[[50,35]],"size":4,"seed":8})).unwrap();assert_eq!(history.layer(layer).unwrap().surface().unwrap().read_region(history.bounds()),before);assert_eq!(super::super::describe(&session.engine),original);
    }
    #[test]
    fn native_history_invalid_records_refuse_without_changing_live_state_and_legacy_views_open(){
        let dir=temp();let mut session=fixture(8,"rgb");session.engine.execute("paint.stroke",json!({"points":[[10,10]],"size":5,"seed":3})).unwrap();publish(&dir.0,&mut session);
        let path=dir.0.join(format!("{}.view.json",session.version));let original=read_view(&path).unwrap();
        for change in ["schema","current","identity","missing","duplicate","layer","unknown"]{
            let mut view=original.clone();match change{"schema"=>view[KEY]["schemaVersion"]=json!(2),"current"=>view[KEY]["current"]=json!(999),"identity"=>view[KEY]["documentId"]=json!(0),"missing"=>view[KEY]["states"][0]["version"]=json!(ulid::Ulid::new().to_string()),"duplicate"=>view[KEY]["states"][0]["id"]=view[KEY]["states"][1]["id"].clone(),"layer"=>view[KEY]["states"][0]["active"]=json!(9_999_999),_=>view[KEY]["unknown"]=json!(true)}
            let state=session.engine.active_mut().unwrap();let before=state.doc.clone();let entries=state.history.entries();assert!(restore(&dir.0,&session.version,state,&view).is_err(),"{change}");assert!(Arc::ptr_eq(&before,&state.doc));assert_eq!(entries,state.history.entries());
        }
        let mut legacy=original;legacy.as_object_mut().unwrap().remove(KEY);photocraft_format::atomic_write(&path,&serde_json::to_vec(&legacy).unwrap()).unwrap();assert_eq!(restored(&dir.0,&session.version).engine.active().unwrap().history.past_len(),0);
    }
}
