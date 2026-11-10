//! Resolve against the live journal while the owner holds the session lock.
use photocraft_engine::Session;
use serde_json::Value;

pub(super) struct Invocation { pub command:String, pub params:Value, pub journal:Vec<(String,Value)>, pub outer:Value }
pub(super) fn resolve(engine:&Session,outer:&Value)->Result<Invocation,String>{
    if !outer.is_object()||outer.to_string().len()>1024*1024{return Err("Invalid filter parameters".into());}
    let (command,mut params)=if let Some((command,params))=super::mask_filters::repeat_invocation(engine)? {
        (command,params)
    }else{
        let (command,params)=engine.journal.iter().rev().find(|(id,_)|id.starts_with("filter.")&&photocraft_engine::filters::params_for(id,&Value::Null).is_some()).cloned().ok_or("No previous filter is available for preview")?;
        (command,params)
    };
    // Repeat dispatch takes coalescing from the current invocation, not its journal entry.
    let settings=params.as_object_mut().ok_or("Invalid saved filter parameters")?;
    settings.remove("coalesce");
    if let Some(value)=outer.get("coalesce"){settings.insert("coalesce".into(),value.clone());}
    let mut journal=Vec::new();
    if let Some(entry)=engine.journal.iter().rev().find(|(id,_)|id.starts_with("filter.")&&photocraft_engine::filters::params_for(id,&Value::Null).is_some()){journal.push(entry.clone());}
    if let Some(entry)=engine.journal.iter().rev().find(|(id,_)|id.starts_with("filter.")&&(super::mask_filters::separate(id)||photocraft_engine::filters::params_for(id,&Value::Null).is_some())){
        if journal.last()!=Some(entry){journal.push(entry.clone());}
    }
    Ok(Invocation{command,params,journal,outer:outer.clone()})
}

pub(super) fn snapshot(cache:&super::cache::PhotoCache,project:&str,photo:&str,version:&str,params:&Value)->Result<(photocraft_engine::DocState,super::color_views::Snapshot,Invocation),String>{
    let session=cache.get(&super::key(project,photo)).filter(|session|session.version==version).ok_or("Last Filter preview requires the current image session; apply a filter first")?;
    let invocation=resolve(&session.engine,params)?;
    Ok((super::snapshot::capture(session.engine.active().ok_or("No image document")?,super::snapshot::HistoryPolicy::Discard),super::color_views::Snapshot::capture(&session.engine)?,invocation))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn repeat_resolution_uses_raw_journal_survives_undo_and_retains_only_candidates(){
        let mut engine=Session::new();engine.execute("file.new",json!({"width":16,"height":16})).unwrap();
        assert!(resolve(&engine,&json!({})).is_err());
        engine.execute("filter.blur.gaussianBlur",json!({"radius":2,"coalesce":"saved"})).unwrap();
        engine.execute("select.all",json!({})).unwrap();engine.execute("edit.undo",json!({})).unwrap();
        let source=engine.active().unwrap().doc.clone();let history=engine.active().unwrap().history.entries().to_vec();let journal=engine.journal.clone();
        let invocation=resolve(&engine,&json!({"coalesce":"outer"})).unwrap();
        assert_eq!(invocation.command,"filter.blur.gaussianBlur");assert_eq!(invocation.params["radius"],2);assert_eq!(invocation.params["coalesce"],"outer");assert_eq!(invocation.journal.len(),1);
        assert!(resolve(&engine,&json!({})).unwrap().params.get("coalesce").is_none());
        assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries());assert_eq!(journal,engine.journal);
        let mut reopened=Session::new();reopened.add_document((*source).clone(),None);assert!(resolve(&reopened,&json!({})).is_err());
    }
    #[test]
    fn repeat_rejects_malformed_and_oversized_outer_before_copying_context(){
        let mut engine=Session::new();engine.execute("file.new",json!({"width":16,"height":16})).unwrap();engine.execute("filter.blur.gaussianBlur",json!({"radius":2})).unwrap();
        let source=engine.active().unwrap().doc.clone();let history=engine.active().unwrap().history.entries().to_vec();let journal=engine.journal.clone();
        for outer in [Value::Null,json!([]),json!({"unknown":"x".repeat(1024*1024)})]{assert!(resolve(&engine,&outer).is_err());assert!(std::sync::Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries());assert_eq!(journal,engine.journal);}
    }
    #[test]
    fn repeat_snapshot_requires_exact_resident_owner_and_version(){
        let mut cache=super::super::cache::PhotoCache::default();
        let mut engine=Session::new();engine.execute("file.new",json!({"width":16,"height":16})).unwrap();engine.execute("filter.blur.gaussianBlur",json!({"radius":2})).unwrap();
        let source=engine.active().unwrap().doc.clone();
        cache.insert(super::super::key("project","photo"),super::super::PhotoSession{engine,color_settings:None,version:"v1".into(),original_path:None,writer:Default::default()});
        for (project,photo,version) in [("project","photo","v0"),("other","photo","v1"),("project","other","v1")] {assert!(snapshot(&cache,project,photo,version,&json!({})).is_err());}
        let (state,_,invocation)=snapshot(&cache,"project","photo","v1",&json!({})).unwrap();assert!(std::sync::Arc::ptr_eq(&source,&state.doc));assert_eq!(state.history.past_len(),0);assert_eq!(invocation.command,"filter.blur.gaussianBlur");
        assert!(snapshot(&super::super::cache::PhotoCache::default(),"project","photo","v1",&json!({})).is_err());
        let mut reopened=Session::new();reopened.add_document((*source).clone(),None);cache.insert(super::super::key("project","photo"),super::super::PhotoSession{engine:reopened,color_settings:None,version:"v1".into(),original_path:None,writer:Default::default()});assert!(snapshot(&cache,"project","photo","v1",&json!({})).is_err());
    }

}
