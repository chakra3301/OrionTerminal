use photocraft_engine::{Session,EngineError,doc::{Document,Rect},jobs::Started,paint::mixer::MixerState,presets::clone_source::CloneSources};
use serde_json::Value;
use std::sync::Arc;

pub(super) struct Prepared {
    pub document:Arc<Document>,pub damage:Rect,pub label:&'static str,pub result:Value,
    pub clone_sources:Option<CloneSources>,pub mixer:Option<MixerState>,
}

pub(super) fn commit(engine:&mut Session,command:&str,mut params:Value,prepared:Prepared,guard:impl Fn(&Session)->bool+Send+'static)->Result<Value,String>{
    if cfg!(target_arch="wasm32"){return Err("Prepared painting requires native job completion".into());}
    if engine.has_jobs(){return Err("Another native image job is running".into());}
    let spec=photocraft_engine::command_specs().into_iter().find(|spec|spec.id==command).ok_or("Unknown prepared painting command")?;
    if let Some(reason)=engine.disabled_reason(command){return Err(reason);}
    let coverage_fade=super::mask_filters::prepare_paint_fade(engine,command,&mut params);
    let journal=spec.journal;let label=prepared.label;let coalesce=params["coalesce"].as_str().map(str::to_owned);
    // External native jobs run the same completion hooks as commands, but do
    // not inject a coalescing request or append the caller's journal entry.
    let started=engine.start_job(command,params.clone(),label,true,move|ctx|{ctx.check()?;Ok(prepared)},move|engine,prepared|{
        if !guard(engine){return Err(EngineError::Other("The painting source changed before commit".into()));}
        let coalesced=engine.active().filter(|state|coalesce.is_some()&&state.coalesce==coalesce&&state.history.can_undo()).map(|state|state.history.clone());
        engine.edit(label,move|doc,_|{*doc=(*prepared.document).clone();Ok(())})?;
        let state=engine.active_mut().ok_or(EngineError::NoDocument)?;
        if let Some(mut history)=coalesced{
            if let Some((_,mut layers))=history.clone().undo(state.doc.clone()){layers.active=state.active_layer;layers.selected=state.selected_layers.clone();history.set_current_layers(layers);}
            state.history=history;
        }
        state.coalesce=coalesce;state.last_damage=Some(prepared.damage);
        if let Some(sources)=prepared.clone_sources{engine.presets.clone=sources;}
        if let Some(mixer)=prepared.mixer{engine.tools.mixer=mixer;}
        Ok(prepared.result)
    }).map_err(|error|error.to_string())?;
    let finished=match started{Started::Job(id)=>engine.wait_job(id),Started::Done(_)=>return Err("Prepared painting requires native job completion".into())};
    // This transfer is the only job in the session. Consume its terminal event
    // so synchronous editor commits do not accumulate an unread event queue.
    engine.poll_jobs();
    let result=finished.map_err(|error|error.to_string())?;
    if journal{engine.journal.push((command.into(),params));}
    super::mask_filters::finish_paint_fade(engine,coverage_fade);
    Ok(result)
}

#[cfg(test)]
mod tests{
    use super::*;
    use serde_json::json;
    #[test]
    fn native_job_guard_refuses_prepared_pixels_without_undo_or_journal_changes(){
        let mut engine=Session::new();engine.execute("file.new",json!({"width":24,"height":24,"background":"#804020"})).unwrap();let source=engine.active().unwrap().doc.clone();let history=engine.active().unwrap().history.entries();let journal=engine.journal.clone();let revision=engine.active().unwrap().revision;
        let mut document=(*source).clone();document.name="Refused draft".into();let prepared=Prepared{document:Arc::new(document),damage:Rect::from_xywh(2,2,5,5),label:"History Brush",result:json!({"damage":[2,2,5,5]}),clone_sources:None,mixer:None};
        assert!(commit(&mut engine,"paint.historyBrush",json!({"points":[[4,4]]}),prepared,|_|false).unwrap_err().contains("source changed"));assert!(Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.entries(),history);assert_eq!(engine.active().unwrap().revision,revision);assert_eq!(engine.journal,journal);assert!(!engine.has_jobs());assert_eq!(engine.jobs_with_recent().last().unwrap().state,"failed");
    }
}
