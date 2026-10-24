use super::{profiles, display};
use base64::Engine;
use photocraft_engine::{color_cmds::{ColorState, ProofView}, doc::Document, proof_sim::{HdrPreview, ProofKind}, Session};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::hash_map::DefaultHasher, hash::{Hash, Hasher}, sync::Arc};

pub(super) const COMMANDS: [&str; 12] = [
    "view.proofSetup", "view.proofColors", "view.gamutWarning", "view.thirtyTwoBitPreviewOptions",
    "view.proofSetup.workingCyanPlate", "view.proofSetup.workingMagentaPlate", "view.proofSetup.workingYellowPlate", "view.proofSetup.workingBlackPlate", "view.proofSetup.workingCmyPlate",
    "view.proofSetup.legacyMacintoshRgb", "view.proofSetup.colorBlindnessProtanopia", "view.proofSetup.colorBlindnessDeuteranopia",
];

#[derive(Clone)]
pub(super) struct Snapshot { proof: ProofView, hdr: HdrPreview, settings: photocraft_engine::color_cmds::ColorSettings, _working: Option<Arc<super::color_settings::Context>> }
#[derive(Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct Saved {
    schema_version: u32, profile: String, profile_data: Option<String>, kind: ProofKind,
    intent: String, bpc: bool, simulate_paper: bool, on: bool, gamut_warning: bool,
    threshold: f32, hdr: HdrPreview,
}
impl Snapshot {
    pub(super) fn preview_cache_key(&self) -> Result<String, String> {
        use sha2::{Digest, Sha256};
        let setup = &self.proof.setup;
        let profile=Sha256::digest(setup.profile.to_bytes().as_slice());
        serde_json::to_string(&json!({
            "settings": self.settings,
            "retainedSettings": super::color_settings::signature(&self.settings),
            "profile": format!("{profile:x}"), "intent": setup.intent.id(),
            "bpc": setup.bpc, "paper": setup.simulate_paper, "kind": setup.kind,
            "enabled": self.proof.enabled, "gamut": self.proof.gamut_warning,
            "thresholdBits": self.proof.gamut_threshold.to_bits(),
            "hdr": [self.hdr.exposure.to_bits(), self.hdr.gamma.to_bits()],
            "compression": self.hdr.highlight_compression,
        })).map_err(|error| error.to_string())
    }
    pub(super) fn capture(engine: &Session) -> Result<Self,String> {
        let id=engine.active().ok_or("No image document")?.doc.id;
        Ok(Self{proof:engine.color.proof(id),hdr:engine.color.hdr.get(&id).copied().unwrap_or_default(),settings:engine.color.settings.clone(),_working:super::color_settings::retain(&engine.color.settings)})
    }
    pub(super) fn key(&self, channels: &photocraft_engine::channel_cmds::ChannelView) -> Result<String,String> {
        let mut channel=super::channel_view_key(channels)?;
        if let Some(signature)=super::color_settings::signature(&self.settings){channel.push_str(&format!("/settings:{}",&signature[..16]));}
        let default=ColorState::default().proof(photocraft_engine::doc::DocId(0));
        if self.proof.setup.profile.content_hash()==default.setup.profile.content_hash() && self.proof.setup.intent==default.setup.intent && self.proof.setup.bpc==default.setup.bpc && !self.proof.setup.simulate_paper && self.proof.setup.kind==ProofKind::Profile && !self.proof.enabled && !self.proof.gamut_warning && self.proof.gamut_threshold==default.gamut_threshold && self.hdr==HdrPreview::default() { return Ok(channel); }
        let setup=&self.proof.setup; let mut hash=DefaultHasher::new();
        (setup.profile.content_hash(),setup.intent,setup.bpc,setup.simulate_paper,setup.kind,self.proof.enabled,self.proof.gamut_warning,self.proof.gamut_threshold.to_bits(),self.hdr.highlight_compression,self.hdr.exposure.to_bits(),self.hdr.gamma.to_bits()).hash(&mut hash);
        Ok(format!("{channel}/color:{:016x}",hash.finish()))
    }
    fn saved(&self)->Saved {
        let setup=&self.proof.setup;
        let builtin=["srgb","display-p3","adobe-rgb-compat","prophoto-compat","linear-srgb","rec2020","gray-gamma-2.2","sgray","lab-d50","coated-cmyk"].into_iter().find(|id|photocraft_engine::color_cmds::resolve_profile(id,None,None).is_ok_and(|profile|profile.content_hash()==setup.profile.content_hash()));
        Saved{schema_version:1,profile:builtin.unwrap_or("retained-proof.icc").into(),profile_data:builtin.is_none().then(||base64::engine::general_purpose::STANDARD.encode(setup.profile.to_bytes().as_slice())),kind:setup.kind,intent:setup.intent.id().into(),bpc:setup.bpc,simulate_paper:setup.simulate_paper,on:self.proof.enabled,gamut_warning:self.proof.gamut_warning,threshold:self.proof.gamut_threshold,hdr:self.hdr}
    }
    pub(super) fn describe(&self,doc:&Document)->Value {
        json!({"profile":if self.proof.setup.name.contains('/')||self.proof.setup.name.contains('\\'){"current"}else{self.proof.setup.name.as_str()},"description":self.proof.setup.profile.description,"kind":self.proof.setup.kind.id(),"intent":self.proof.setup.intent.id(),"bpc":self.proof.setup.bpc,"simulatePaper":self.proof.setup.simulate_paper,"on":self.proof.enabled,"gamutWarning":self.proof.gamut_warning,"threshold":self.proof.gamut_threshold,"hdr":self.hdr,"active":self.proof.enabled||self.proof.gamut_warning||(doc.depth==photocraft_engine::doc::SampleType::F32&&!self.hdr.is_identity())})
    }
    pub(super) fn native(&self,doc:&Document)->Result<ColorState,String>{restore_native(doc,&self.saved(),Some(&self.settings))}
    pub(super) fn install(&self,engine:&mut Session)->Result<(),String>{engine.color=self.native(&engine.active().ok_or("No image document")?.doc)?;Ok(())}
    pub(super) fn render(&self,doc:&Document)->Result<Arc<display::View>,String>{
        use std::{collections::VecDeque,sync::{Mutex,OnceLock}};
        static CACHE:OnceLock<Mutex<VecDeque<(u64,Arc<display::View>)>>>=OnceLock::new();
        let mut hash=DefaultHasher::new();(self.key(&Default::default())?,format!("{:?}",doc.mode),format!("{:?}",doc.depth),photocraft_engine::color_cmds::document_profile(doc).content_hash()).hash(&mut hash);let signature=hash.finish();
        let cache=CACHE.get_or_init(||Mutex::new(VecDeque::new()));
        if let Some((_,view))=cache.lock().map_err(|_|"Color view cache needs to be restarted")?.iter().find(|(key,_)|*key==signature){return Ok(view.clone());}
        let view=display::View::new(&self.native(doc)?,doc)?;let mut cache=cache.lock().map_err(|_|"Color view cache needs to be restarted")?;cache.push_back((signature,view.clone()));while cache.len()>16{cache.pop_front();}Ok(view)
    }
}

fn restore_native(doc:&Document,saved:&Saved,settings:Option<&photocraft_engine::color_cmds::ColorSettings>)->Result<ColorState,String>{
    if saved.schema_version!=1 || saved.profile.len()>4096 || !saved.threshold.is_finite() || !(0.0..=100.0).contains(&saved.threshold) || !saved.hdr.exposure.is_finite() || !(-20.0..=20.0).contains(&saved.hdr.exposure) || !saved.hdr.gamma.is_finite() || !(0.1..=9.99).contains(&saved.hdr.gamma) || matches!(saved.kind,ProofKind::Plate(p) if p>3) {return Err("Invalid saved color view".into());}
    // Restoring private native viewing state must not scan the full image for
    // gamut statistics. The one-pixel proxy retains its ID/mode/profile only.
    let mut proxy=doc.clone();proxy.size.width=1;proxy.size.height=1;proxy.layers.clear();proxy.channels.clear();proxy.selection=None;proxy.quick_mask=None;
    let mut engine=Session::new();if let Some(settings)=settings{engine.color.settings=settings.clone();}engine.add_document(proxy,None);
    let mut params=json!({"profile":saved.profile,"intent":saved.intent,"bpc":saved.bpc,"simulatePaper":saved.simulate_paper});
    if let Some(data)=&saved.profile_data {params["profileData"]=json!(data);}
    profiles::run(&mut engine,"view.proofSetup",&params)?;
    let original_settings=engine.color.settings.clone();
    let plate_lease=if matches!(saved.kind,ProofKind::Plate(_)|ProofKind::CmyPlate){
        if saved.profile_data.is_some(){let profile=engine.color.proof(doc.id).setup.profile;Some(profiles::Snapshot::new(profile.to_bytes().as_slice())?)}else{None}
    }else{None};
    if matches!(saved.kind,ProofKind::Plate(_)|ProofKind::CmyPlate){engine.color.settings.working_cmyk=plate_lease.as_ref().map_or_else(||saved.profile.clone(),profiles::Snapshot::path);}
    photocraft_engine::proof_sim::set_kind(&mut engine,saved.kind).map_err(|e|e.to_string())?;
    engine.color.settings=original_settings;
    engine.execute("view.proofColors",json!({"on":saved.on})).map_err(|e|e.to_string())?;
    engine.execute("view.gamutWarning",json!({"on":saved.gamut_warning,"threshold":saved.threshold})).map_err(|e|e.to_string())?;
    engine.color.hdr.insert(doc.id,saved.hdr);
    engine.color.settings.monitor_profile="srgb".into();
    Ok(engine.color)
}
pub(super) fn persist(engine:&Session,view:&mut Value)->Result<(),String>{
    let saved=Snapshot::capture(engine)?.saved();
    if saved.profile_data.as_ref().is_some_and(|data|data.len()>22_369_624){return Err("Saved proof profile exceeds 16MB".into());}
    view["colorView"]=serde_json::to_value(saved).map_err(|e|e.to_string())?;Ok(())
}
pub(super) fn restore(engine:&mut Session,view:&Value)->Result<(),String>{
    let Some(value)=view.get("colorView") else{return Ok(());};
    let saved:Saved=serde_json::from_value(value.clone()).map_err(|_|"Invalid saved color view")?;
    if saved.profile_data.as_ref().is_some_and(|data|data.len()>22_369_624){return Err("Saved proof profile exceeds 16MB".into());}
    engine.color=restore_native(&engine.active().ok_or("No image document")?.doc,&saved,Some(&engine.color.settings))?;Ok(())
}
pub(super) fn key(engine:&Session)->Result<String,String>{Snapshot::capture(engine)?.key(&engine.active().ok_or("No image document")?.channel_view)}

fn validate(command:&str,p:&Value)->Result<(),String>{
    if !p.is_object() || p.to_string().len()>profiles::PARAMETER_BYTES{return Err("Invalid color view parameters".into());}
    for name in ["on","bpc","simulatePaper","gamutWarning"] {if p.get(name).is_some_and(|v|!v.is_boolean()){return Err(format!("Invalid color view {name}"));}}
    for (name,min,max) in [("threshold",0.0,100.0),("exposure",-20.0,20.0),("gamma",0.1,9.99)] {if let Some(v)=p.get(name){if v.as_f64().is_none_or(|v|!v.is_finite()||v<min||v>max){return Err(format!("Invalid color view {name}"));}}}
    if p.get("kind").is_some_and(|v|v.as_str().and_then(ProofKind::from_id).is_none()){return Err("Invalid proof simulation".into());}
    if command=="view.gamutWarning" && p.get("profile").is_some(){return Err("Choose the proof profile with Proof Setup before checking its gamut".into());}
    Ok(())
}
pub(super) fn execute(engine:&mut Session,command:&str,params:&Value)->Option<Result<Value,String>>{
    if !COMMANDS.contains(&command){return None;}
    Some((||{
        validate(command,params)?;
        let snapshot=Snapshot::capture(engine)?;
        let doc=engine.active().ok_or("No image document")?.doc.clone();
        let mut draft=Session::new();draft.add_document((*doc).clone(),None);
        snapshot.install(&mut draft)?;
        let mut params=params.clone();
        if command=="view.proofSetup" && params["profile"]=="current" {
            let saved=snapshot.saved();params["profile"]=json!(saved.profile);if let Some(data)=saved.profile_data{params["profileData"]=json!(data);}
        }
        let mut result=if command=="view.proofSetup"{profiles::run(&mut draft,command,&params)?}else{draft.execute(command,params.clone()).map_err(|e|e.to_string())?};
        if command=="view.proofSetup" {
            if let Some(kind)=params["kind"].as_str().and_then(ProofKind::from_id){photocraft_engine::proof_sim::set_kind(&mut draft,kind).map_err(|e|e.to_string())?;}
            if let Some(on)=params.get("on"){draft.execute("view.proofColors",json!({"on":on})).map_err(|e|e.to_string())?;}
            if params.get("gamutWarning").is_some() || params.get("threshold").is_some(){draft.execute("view.gamutWarning",json!({"on":params.get("gamutWarning").cloned().unwrap_or(json!(snapshot.proof.gamut_warning)),"threshold":params.get("threshold").cloned().unwrap_or(json!(snapshot.proof.gamut_threshold))})).map_err(|e|e.to_string())?;}
        }
        display::View::new(&draft.color,&draft.active().ok_or("No image document")?.doc)?;
        let color=Snapshot::capture(&draft)?;result["colorView"]=color.describe(&draft.active().unwrap().doc);
        engine.color=draft.color;Ok(result)
    })())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super as host;
    fn fixture(depth:u32)->Session{let mut s=Session::new();s.execute("file.new",json!({"width":24,"height":16,"depth":depth,"background":"#00ff8080"})).unwrap();s.execute("paint.stroke",json!({"points":[[4,4],[16,10]],"color":"#d04080","size":5,"seed":3})).unwrap();s}
    fn command(s:&mut Session,id:&str,p:Value)->Value{host::execute_view_command(s,id,p).unwrap()}
    #[test]
    fn color_views_native_simulations_lut_gamut_and_alpha_preserve_image_and_history(){
        for depth in [8,16,32]{let mut s=fixture(depth);let doc=s.active().unwrap().doc.clone();let history=s.active().unwrap().history.entries().to_vec();let original=photocraft_compose::render(&doc,doc.bounds());let plain=display::rgba(&doc,&original).unwrap().pixels;
            for id in COMMANDS.iter().filter(|id|id.starts_with("view.proofSetup.")){
                assert!(host::command_supported(id));command(&mut s,id,json!({}));
                let shown=Snapshot::capture(&s).unwrap().render(&doc).unwrap().rgba(&original);assert_ne!(shown.pixels,plain,"{depth} {id}");
                let lut=s.color.gpu_canvas_lut_for(&doc,33,None).unwrap().unwrap();let mut corner=photocraft_compose::Buffer::transparent(photocraft_engine::doc::Rect::from_xywh(0,0,1,1));corner.px[0]=[0.0,1.0,0.5,0.25];let output=display::View::new(&s.color,&doc).unwrap().rgba(&corner);let index=(0+33*(32+33*16))*4;assert_eq!(&output.pixels[..3],&lut[index..index+3]);assert_eq!(output.pixels[3],64);
            }
            command(&mut s,"view.proofSetup",json!({"profile":"coated-cmyk","intent":"absolute","bpc":false,"simulatePaper":true,"kind":"profile","on":true,"gamutWarning":true,"threshold":0.01}));
            let shown=Snapshot::capture(&s).unwrap().render(&doc).unwrap().rgba(&original);assert!(shown.pixels.chunks_exact(4).any(|p|p[..3]==[128;3]));
            command(&mut s,"view.gamutWarning",json!({"on":false}));command(&mut s,"view.proofColors",json!({"on":false}));assert_eq!(Snapshot::capture(&s).unwrap().render(&doc).unwrap().rgba(&original).pixels,plain);
            assert!(Arc::ptr_eq(&doc,&s.active().unwrap().doc));assert_eq!(s.active().unwrap().history.entries(),history);assert_eq!(photocraft_compose::render(&doc,doc.bounds()).px,original.px);
        }
    }
    #[test]
    fn color_views_hdr_recovers_above_white_and_keeps_alpha_source_and_exports(){
        let mut s=fixture(32);s.execute("edit.assignProfile",json!({"profile":"linear-srgb"})).unwrap();s.edit("HDR fixture",|doc,_|{let data=[4.0,0.5,2.0,0.5].repeat(24*16);let bounds=doc.bounds();doc.layers[0].surface_mut().unwrap().write_region(bounds,&data);Ok(())}).unwrap();
        let doc=s.active().unwrap().doc.clone();let original=photocraft_compose::render(&doc,doc.bounds());let exported=photocraft_io::export(&doc,"png",&Default::default()).unwrap().bytes;
        command(&mut s,"view.thirtyTwoBitPreviewOptions",json!({"method":"exposureGamma","exposure":-2.0,"gamma":1.0}));
        let shown=Snapshot::capture(&s).unwrap().render(&doc).unwrap().rgba(&original);assert_eq!(&shown.pixels[..4],&[255,99,188,128]);
        command(&mut s,"view.thirtyTwoBitPreviewOptions",json!({"method":"highlightCompression"}));assert_eq!(Snapshot::capture(&s).unwrap().render(&doc).unwrap().rgba(&original).pixels,display::rgba(&doc,&original).unwrap().pixels);
        assert!(Arc::ptr_eq(&doc,&s.active().unwrap().doc));assert_eq!(photocraft_io::export(&doc,"png",&Default::default()).unwrap().bytes,exported);
        let mut eight=fixture(8);let before_key=key(&eight).unwrap();assert!(execute(&mut eight,"view.thirtyTwoBitPreviewOptions",&json!({"exposure":2})).unwrap().is_err());assert_eq!(key(&eight).unwrap(),before_key);
    }
    #[test]
    fn color_views_custom_proof_reopen_preview_tiles_and_unproofed_exports(){
        let root=std::env::temp_dir().join(format!("xdesign-color-view-{}",ulid::Ulid::new()));std::fs::create_dir(&root).unwrap();
        let mut s=fixture(16);s.execute("edit.assignProfile",json!({"profile":"display-p3"})).unwrap();let profile=s.active().unwrap().doc.icc_profile.as_ref().unwrap().as_ref().clone();let path=root.join("chosen.icc");std::fs::write(&path,&profile).unwrap();
        let source=s.active().unwrap().doc.clone();let history=s.active().unwrap().history.entries().to_vec();let plain=host::render_view_preview(&source,&Default::default()).unwrap().png;
        command(&mut s,"view.proofSetup",json!({"profile":path,"kind":"profile","intent":"absolute","simulatePaper":true,"on":true,"gamutWarning":false,"threshold":0}));std::fs::remove_file(&path).unwrap();
        let initial_key=key(&s).unwrap();assert!(initial_key.len()<4096);let color=Snapshot::capture(&s).unwrap();let plan=color.render(&source).unwrap();let proof=host::render_color_view_preview(&source,&Default::default(),Some(&plan)).unwrap().png;
        assert_ne!(proof,plain);let mut session=host::PhotoSession{engine:s,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};host::publish(&root,"fixture",&mut session).unwrap();
        let reopened=host::restore(&root,&session.version,None).unwrap();assert_eq!(key(&reopened.engine).unwrap(),initial_key);assert_eq!(reopened.engine.active().unwrap().history.entries(),history);assert_eq!(reopened.engine.active().unwrap().doc.icc_profile,source.icc_profile);
        let (doc,channels,color)=host::view_snapshot(&root,"project","image",&session.version,Some(&initial_key)).unwrap();assert_eq!(host::render_color_view_preview(&doc,&channels.unwrap(),color.as_deref()).unwrap().png,proof);
        let normal=host::view_snapshot(&root,"project","image",&session.version,None).unwrap();assert!(normal.1.is_none()&&normal.2.is_none());assert!(host::view_snapshot(&root,"project","image",&session.version,Some("stale")).is_err());
        let tile=host::tiles::render_with_color(&doc,Some(&Default::default()),color.as_deref(),0,0,24,16,1,false,false).unwrap();assert_eq!(tile.png,proof);
        let saved=std::fs::read(root.join(format!("{}.png",session.version))).unwrap();assert_eq!(base64::engine::general_purpose::STANDARD.encode(saved),plain);
        for format in ["png","psd","psb"]{let actual=photocraft_io::export(&doc,format,&Default::default()).unwrap().bytes;assert_eq!(actual,photocraft_io::export(&source,format,&Default::default()).unwrap().bytes,"{format}");}
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn color_views_failed_parameters_and_saved_states_are_transactional(){
        let mut s=fixture(16);command(&mut s,"view.proofSetup.colorBlindnessProtanopia",json!({}));let before=key(&s).unwrap();let source=s.active().unwrap().doc.clone();
        for (id,p) in [("view.proofSetup",json!({"profile":"missing.icc"})),("view.proofSetup",json!({"kind":"unknown"})),("view.proofColors",json!({"on":"yes"})),("view.gamutWarning",json!({"threshold":-1})),("view.gamutWarning",json!({"profile":"coated-cmyk"})),("view.thirtyTwoBitPreviewOptions",json!({"gamma":0.01}))]{assert!(execute(&mut s,id,&p).unwrap().is_err());assert_eq!(key(&s).unwrap(),before);assert!(Arc::ptr_eq(&source,&s.active().unwrap().doc));}
        let mut view=json!({});persist(&s,&mut view).unwrap();view["colorView"]["schemaVersion"]=json!(2);assert!(restore(&mut s,&view).is_err());assert_eq!(key(&s).unwrap(),before);
        view["colorView"]["schemaVersion"]=json!(1);view["colorView"]["threshold"]=json!(-1);assert!(restore(&mut s,&view).is_err());assert_eq!(key(&s).unwrap(),before);
        let plain=fixture(8);assert_eq!(key(&plain).unwrap(),host::channel_view_key(&plain.active().unwrap().channel_view).unwrap());
        let mut expanded=plain.active().unwrap().channel_view.clone();expanded.color_hidden=vec![false;3];expanded.alpha_visible=vec![false;4];assert_eq!(Snapshot::capture(&plain).unwrap().key(&expanded).unwrap(),key(&plain).unwrap());
    }
    #[test]
    fn color_views_color_range_uses_saved_proof_profile_in_isolated_preview(){
        let mut s=fixture(16);s.execute("edit.assignProfile",json!({"profile":"display-p3"})).unwrap();command(&mut s,"view.proofSetup",json!({"profile":"display-p3","on":false}));
        let state=s.active().unwrap();let source=state.doc.clone();let color=Snapshot::capture(&s).unwrap();let original_key=key(&s).unwrap();
        let params=json!({"select":"outOfGamut","sampleAllLayers":true,"mode":"replace"});let mut expected=host::stroke_preview_session(state.clone(),"select.colorRange").unwrap();color.install(&mut expected).unwrap();let result=expected.execute("select.colorRange",params.clone()).unwrap();
        let preview=host::preview::render_with_color(state,&color,"select.colorRange",params.clone(),Some("mask")).unwrap();assert_eq!(preview.png,host::selection_preview::render(expected.active().unwrap(),"mask").unwrap().png);assert_eq!(preview.result,Some(result));
        assert_ne!(preview.png,host::preview::render(state,"select.colorRange",params).unwrap().png,"The same-profile proof must not silently use the default CMYK gamut");
        assert!(Arc::ptr_eq(&source,&s.active().unwrap().doc));assert_eq!(key(&s).unwrap(),original_key);
    }
    #[test]
    fn color_views_adjustment_selection_and_stroke_previews_share_proofs(){
        let mut s=fixture(16);command(&mut s,"view.proofSetup.colorBlindnessDeuteranopia",json!({}));let before=key(&s).unwrap();let color=Snapshot::capture(&s).unwrap();let state=s.active().unwrap();let doc=state.doc.clone();
        let parameters=json!({"brightness":15,"contrast":20});let mut expected=Session::new();expected.add_document((*doc).clone(),None);*expected.active_mut().unwrap()=state.clone();color.install(&mut expected).unwrap();expected.execute("image.adjustments.brightnessContrast",parameters.clone()).unwrap();
        let preview=host::preview::render_with_color(state,&color,"image.adjustments.brightnessContrast",parameters,None).unwrap();let active=expected.active().unwrap();let plan=display::View::new(&expected.color,&active.doc).unwrap();assert_eq!(preview.png,host::render_color_view_preview(&active.doc,&active.channel_view,Some(&plan)).unwrap().png);
        let parameters=json!({"points":[[4,4],[16,10]],"color":"#ff2080","size":5,"seed":890});let mut expected=host::stroke_preview_session(state.clone(),"paint.stroke").unwrap();color.install(&mut expected).unwrap();expected.execute("paint.stroke",parameters.clone()).unwrap();
        let feedback=host::stroke::render_with_identity(&s,None,"paint.stroke",&parameters,0,0,24,16,1).unwrap();let active=expected.active().unwrap();let plan=display::View::new(&expected.color,&active.doc).unwrap();assert_eq!(feedback[0].png,host::tiles::render_with_color(&active.doc,Some(&active.channel_view),Some(&plan),0,0,24,16,1,false,true).unwrap().png);
        let normal=host::tiles::render(&doc,Some(&state.channel_view),0,0,24,16,1,false,false).unwrap();assert_ne!(normal.png,host::tiles::render_with_color(&doc,Some(&state.channel_view),Some(&color.render(&doc).unwrap()),0,0,24,16,1,false,false).unwrap().png);
        let mut channels=state.channel_view.clone();channels.set_color_visible(1,false);assert_eq!(host::tiles::render(&doc,Some(&channels),0,0,24,16,1,false,false).unwrap().png,host::tiles::render_with_color(&doc,Some(&channels),Some(&color.render(&doc).unwrap()),0,0,24,16,1,false,false).unwrap().png);
        assert_eq!(key(&s).unwrap(),before);assert!(Arc::ptr_eq(&doc,&s.active().unwrap().doc));
    }
}
