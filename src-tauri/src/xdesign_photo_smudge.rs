//! Boundary-sensitive feedback using PhotoCraft 47f9306f's public Smudge/dynamics APIs.
use super::{number,samples,routing,retouch_brush,composite_region,Target,SampleLayers};
use super::admission::{self,DabBudget};
use super::float_tiles::FloatTiles;
use photocraft_engine::{Session,BrushSettings,doc::{Document,Rect,Surface},
    paint::{Dab,BrushContext,dynamics::DabGenerator,retouch::{Region,Footprint,Smudge,alpha_index,mix_premultiplied}}};
use photocraft_raster::{from_rgba,Interrupt};
use serde_json::Value;
use std::{collections::VecDeque,sync::Arc};
#[cfg(test)] use std::collections::BTreeSet;

const CHECKPOINT_INTERVAL:usize=64;
const CHECKPOINT_LIMIT:usize=16;
const RETENTION_BYTES:u64=64*1024*1024;
#[derive(Clone)]
struct Working {
    rect:Rect,pixels:FloatTiles,visible:Option<FloatTiles>,carry:Smudge,
    #[cfg(test)] peak_region_pixels:usize,
}
#[path = "xdesign_photo_smudge_boundary.rs"]
mod boundary;
#[path = "xdesign_photo_smudge_retention.rs"]
mod retention;
struct Checkpoint { index:usize,work:Working }
pub(in super::super) struct SmudgeStroke {
    source:Arc<Document>,original:Surface,target:Target,restriction:Option<usize>,locked:bool,
    brush:BrushSettings,ctx:BrushContext,generator:DabGenerator,budget:DabBudget,initial:Smudge,
    radius:i32,carry_bytes:u64,all:bool,stable_bounds:Rect,dabs:Vec<Dab>,boundaries:boundary::Boundaries,
    work:Option<Working>,checkpoints:VecDeque<Checkpoint>,retention_limit:u64,tail_keys:super::sparse::Keys,retention:retention::Retention,
    pub document:Arc<Document>,pub damage:Rect,
    #[cfg(test)] pub samples_pushed:usize,
    #[cfg(test)] applied:usize,
    #[cfg(test)] rewinds:Vec<(usize,usize)>,
    #[cfg(test)] output_pixels:usize,
    #[cfg(test)] output_peak_pixels:usize,
}
impl SmudgeStroke {
    pub fn begin(engine:&Session,params:&Value)->Result<Self,String>{
        let state=engine.active().ok_or("No Smudge image")?;
        let spec=photocraft_engine::command_specs().iter().find(|spec|spec.id=="paint.smudge").ok_or("Unknown Smudge tool")?;(spec.enabled)(engine)?;
        let(target,_,restriction)=routing(engine,params,false)?;let mut validation=(*state.doc).clone();let(surface,locked)=target.surface(&mut validation)?;let original=surface.clone();let fmt=original.format();
        let brush=retouch_brush(engine,params);admission::brush(&brush)?;let radius=(brush.size/2.0).ceil() as i32+2;
        let side=2*u64::try_from(radius).map_err(|_|"Invalid Smudge radius")?+1;let carry_bytes=side*side*fmt.channels() as u64*4;
        if carry_bytes*2>RETENTION_BYTES{return Err("Smudge feedback carry exceeds 64 MiB; finish the stroke for the full edit".into());}
        let finger=params["fingerPainting"].as_bool().unwrap_or(false).then(||from_rgba(&fmt,engine.tools.foreground));
        let initial=Smudge::new(number(params,"strength",50.0).clamp(1.0,100.0)/100.0,finger,brush.size).with_alpha(alpha_index(&fmt));
        let all=params["sampleAllLayers"].as_bool().unwrap_or(false)&&matches!(target,Target::Pixels(_));
        Ok(Self{source:state.doc.clone(),original,target,restriction,locked,ctx:BrushContext::new(&brush),generator:DabGenerator::new(&brush,1.0),budget:DabBudget::new(&brush),brush,initial,radius,carry_bytes,all,stable_bounds:Rect::EMPTY,dabs:Vec::new(),boundaries:Default::default(),work:None,checkpoints:VecDeque::new(),retention_limit:RETENTION_BYTES,tail_keys:Default::default(),retention:Default::default(),document:state.doc.clone(),damage:Rect::EMPTY,#[cfg(test)]samples_pushed:0,#[cfg(test)]applied:0,#[cfg(test)]rewinds:Vec::new(),#[cfg(test)]output_pixels:0,#[cfg(test)]output_peak_pixels:0})
    }
    #[cfg(test)] pub fn push(&mut self,params:&Value)->Result<(),String>{self.push_with(params,&Interrupt::NONE)}
    pub fn push_with(&mut self,params:&Value,ctl:&Interrupt)->Result<(),String>{
        admission::check(ctl)?;let points=samples(params)?;self.budget=self.budget.next(&points,&self.brush,ctl)?;
        let(mut stable,mut dual)=(Vec::new(),Vec::new());self.generator.push(&points,&mut stable,&mut dual);
        let mut ending=self.generator.clone();let(mut tail,mut tail_dual)=(Vec::new(),Vec::new());ending.finish(&mut tail,&mut tail_dual);
        #[cfg(test)]{self.samples_pushed+=points.len();}
        self.stable_bounds=admission::bounds(&self.ctx,&stable,false,self.stable_bounds)?;
        let bounds=admission::bounds(&self.ctx,&tail,false,self.stable_bounds)?;if bounds.is_empty(){return Ok(());}
        admission::check(ctl)?;
        let changed=self.boundaries.changed(self.work.as_ref().map_or(Rect::EMPTY,|work|work.rect),bounds,ctl)?;
        let start=if let Some(changed)=changed{self.rewind(changed,bounds,ctl)?}else{let start=self.dabs.len();self.resize(bounds);start};
        self.dabs.extend(stable);
        let mut next_tail=super::sparse::Keys::new();let mut dirty=self.tail_keys.clone();
        super::sparse::mark(&self.ctx,&self.dabs[start..],false,&mut dirty);super::sparse::mark(&self.ctx,&tail,false,&mut next_tail);dirty.extend(next_tail.iter().copied());
        for index in start..self.dabs.len(){
            admission::check(ctl)?;let footprint=self.ctx.footprint(&self.dabs[index],index);let work=self.work.as_mut().ok_or("No Smudge working pixels")?;let roi=work.dab(&self.original,&self.source,&footprint,self.radius,ctl)?;
            self.retention.sync(&work.pixels,work.visible.as_ref(),roi,ctl)?;
            self.boundaries.push(window(&footprint,self.radius),bounds);
            #[cfg(test)]{self.applied+=1;}
            if(index+1)%CHECKPOINT_INTERVAL==0{let checkpoint=Checkpoint{index:index+1,work:work.clone()};self.retention.checkpoint(&checkpoint.work.pixels,checkpoint.work.visible.as_ref(),1,ctl)?;self.checkpoints.push_back(checkpoint);}
            self.prune(ctl)?;
        }
        // Carry pickup depends on full-prefix bounds. Local ROIs retain those
        // exact edges; disposable finish state never changes stable carry.
        let mut preview=self.work.as_ref().ok_or("No Smudge preview")?.clone();
        for(index,dab)in tail.iter().enumerate(){admission::check(ctl)?;preview.dab(&self.original,&self.source,&self.ctx.footprint(dab,self.dabs.len()+index),self.radius,ctl)?;}
        let mut document=(*self.document).clone();let(surface,_)=self.target.surface(&mut document)?;let n=surface.channels();let alpha=alpha_index(&surface.format());
        for rect in super::sparse::publication(self.damage,bounds,&dirty){
            admission::check(ctl)?;let original=self.original.read_region(rect);surface.write_region(rect,&original);
            let visible=rect.intersect(&bounds);
            if !visible.is_empty(){
                let work=preview.pixels.peek(visible,|r|Region::read(&self.original,r),ctl)?;let mut out=Region::read(&self.original,visible);
                for y in visible.y0..visible.y1{admission::check(ctl)?;for x in visible.x0..visible.x1{let k=self.brush.opacity.clamp(0.0,1.0)*self.source.selection.as_ref().map_or(1.0,|selection|selection.sample_channel(x,y,0));if k<=0.0{continue;}let pixels=work.px(x,y);let original=out.px_mut(x,y);match alpha{Some(a)if !self.locked=>mix_premultiplied(original,pixels,a,k),_=>{for c in 0..n{if self.locked&&Some(c)==alpha{continue;}original[c]+=(pixels[c]-original[c])*k;}}}}}
                out.write(surface);
                #[cfg(test)]{let count=visible.width() as usize*visible.height() as usize;self.output_pixels+=count;self.output_peak_pixels=self.output_peak_pixels.max(count);}
            }
            if let Some(channel)=self.restriction{let mut pixels=surface.read_region(rect);for(new,old)in pixels.chunks_exact_mut(n).zip(original.chunks_exact(n)){for c in 0..n{if c!=channel{new[c]=old[c];}}}surface.write_region(rect,&pixels);}
        }
        if self.restriction.is_some(){surface.prune();}
        admission::check(ctl)?;self.document=Arc::new(document);self.damage=bounds;self.tail_keys=next_tail;Ok(())
    }
    fn resize(&mut self,bounds:Rect){if let Some(work)=&mut self.work{work.rect=bounds;}else{self.work=Some(Working{rect:bounds,pixels:FloatTiles::new(self.original.channels()),visible:self.all.then(||FloatTiles::new(self.original.channels())),carry:self.initial.clone(),#[cfg(test)]peak_region_pixels:0});}}
    fn rewind(&mut self,changed:usize,bounds:Rect,ctl:&Interrupt)->Result<usize,String>{
        let checkpoint=self.checkpoints.iter().rposition(|checkpoint|checkpoint.index<=changed);
        let keep=checkpoint.map_or(0,|i|i+1);while self.checkpoints.len()>keep{let removed=self.checkpoints.pop_back().unwrap();self.retention.checkpoint(&removed.work.pixels,removed.work.visible.as_ref(),-1,ctl)?;}
        let index=if let Some(checkpoint)=self.checkpoints.back(){self.work=Some(checkpoint.work.clone());checkpoint.index}else{self.work=None;0};
        self.resize(bounds);self.boundaries.truncate(index);
        let work=self.work.as_ref().unwrap();self.retention.reset(&work.pixels,work.visible.as_ref(),ctl)?;
        #[cfg(test)]{self.rewinds.push((changed,index));}
        Ok(index)
    }
    fn retained_bytes(&self)->u64{
        (self.checkpoints.len() as u64+2)*self.carry_bytes+self.retention.extra_bytes()
    }
    #[cfg(test)] fn full_retained_bytes(&self)->u64{
        let mut current=BTreeSet::new();if let Some(work)=&self.work{for block in work.pixels.blocks().chain(work.visible.iter().flat_map(FloatTiles::blocks)){current.insert(Arc::as_ptr(block) as usize);}}
        let mut bytes=(self.checkpoints.len() as u64+2)*self.carry_bytes;
        for checkpoint in &self.checkpoints{for block in checkpoint.work.pixels.blocks().chain(checkpoint.work.visible.iter().flat_map(FloatTiles::blocks)){if current.insert(Arc::as_ptr(block) as usize){bytes+=block.len() as u64*4;}}}
        bytes
    }
    fn prune(&mut self,ctl:&Interrupt)->Result<(),String>{while !self.checkpoints.is_empty()&&(self.checkpoints.len()>CHECKPOINT_LIMIT||self.retained_bytes()>self.retention_limit){let removed=self.checkpoints.pop_front().unwrap();self.retention.checkpoint(&removed.work.pixels,removed.work.visible.as_ref(),-1,ctl)?;}Ok(())}
}
fn window(fp:&Footprint,radius:i32)->Rect{let(cx,cy)=(fp.dab.center.x.floor() as i32,fp.dab.center.y.floor() as i32);Rect::new(cx-radius,cy-radius,cx+radius+1,cy+radius+1)}
impl Working {
    fn dab(&mut self,original:&Surface,source:&Document,fp:&Footprint,radius:i32,ctl:&Interrupt)->Result<Rect,String>{
        let r=fp.rect.intersect(&self.rect);if r.is_empty(){return Ok(Rect::EMPTY);}
        let roi=window(fp,radius).union(&fp.rect).intersect(&self.rect);
        #[cfg(test)]{self.peak_region_pixels=self.peak_region_pixels.max(roi.width() as usize*roi.height() as usize);}
        let mut pixels=self.pixels.read(roi,|tile|Region::read(original,tile),ctl)?;
        if let Some(visible)=&mut self.visible{
            let mut composed=visible.read(roi,|tile|composite_region(source,None,SampleLayers::All,tile,original.format()),ctl)?;
            self.carry.dab(&mut composed,fp);
            for y in r.y0..r.y1{admission::check(ctl)?;for x in r.x0..r.x1{if fp.at(x,y)>0.0{pixels.px_mut(x,y).copy_from_slice(composed.px(x,y));}}}
            visible.write(&composed,r);
        }else{self.carry.dab(&mut pixels,fp);}
        admission::check(ctl)?;self.pixels.write(&pixels,r);Ok(roi)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture(depth:u64,mode:&str,transparent:bool)->Session{
        let mut engine=Session::new();engine.execute("file.new",json!({"width":48,"height":48,"depth":depth,"mode":mode,"background":"transparent"})).unwrap();
        let state=engine.active_mut().unwrap();let id=state.active_layer.unwrap();let surface=Arc::make_mut(&mut state.doc).layer_mut(id).unwrap().surface_mut().unwrap();let fmt=surface.format();let mut pixels=Vec::new();
        for y in 0..48{for x in 0..48{pixels.extend(from_rgba(&fmt,[0.1+(x%7) as f32*0.11,0.08+(y%5) as f32*0.15,0.12+((x+y)%11) as f32*0.06,if transparent{((x+y)%9) as f32*0.1}else{1.0}]));}}
        surface.write_region(Rect::new(0,0,48,48),&pixels);engine.tools.foreground=[0.8,0.1,0.2,0.6];engine
    }
    fn isolated(engine:&Session)->Session{let mut copy=Session::new();let state=engine.active().unwrap().clone();copy.add_document((*state.doc).clone(),None);*copy.active_mut().unwrap()=state;copy.tools=engine.tools.clone();copy.presets=engine.presets.clone();copy}
    fn pixels(engine:&Session,doc:&Document,params:&Value,bounds:Rect)->Vec<f32>{let(target,_,_)=routing(engine,params,false).unwrap();let mut doc=doc.clone();let(surface,_)=target.surface(&mut doc).unwrap();surface.read_region(bounds)}
    fn params()->Value{json!({"points":[[12,16,0.2]],"size":7,"hardness":50,"opacity":65,"flow":70,"spacing":20,"strength":55,"seed":518})}
    fn check(engine:&Session,live:&SmudgeStroke,full:&Value){assert_eq!(live.retained_bytes(),live.full_retained_bytes());let mut expected=isolated(engine);expected.execute("paint.smudge",full.clone()).unwrap();assert_eq!(live.damage,expected.active().unwrap().last_damage.unwrap());let rect=engine.active().unwrap().doc.bounds().union(&live.damage).inflate(4);let a=pixels(engine,&live.document,full,rect);let b=pixels(&expected,&expected.active().unwrap().doc,full,rect);assert_eq!(a.len(),b.len());assert!(a.iter().zip(&b).all(|(a,b)|a==b),"first Smudge mismatch {:?}",a.iter().zip(&b).enumerate().find(|(_, (a,b))|a!=b));}
    #[test]
    fn expanding_pressure_reversal_finger_and_transparency_match_native_at_every_prefix(){
        let all=json!([[12,16,0.2],[21,20,0.8],[32,16,1.0],[-3,28,0.7],[8,-2,0.4]]);
        for depth in [8,16,32]{for mode in ["rgb","gray","cmyk","lab"]{for finger in [false,true]{for transparent in [false,true]{
            let mut engine=fixture(depth,mode,transparent);engine.tools.brush.smoothing.amount=0.6;engine.tools.brush.noise=true;engine.tools.brush.wet_edges=true;let before=engine.active().unwrap().doc.clone();let mut p=params();p["fingerPainting"]=json!(finger);let mut live=SmudgeStroke::begin(&engine,&p).unwrap();
            for count in 1..=5{p["points"]=json!([all[count-1].clone()]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);check(&engine,&live,&full);}
            assert_eq!(live.samples_pushed,5);assert!(!live.rewinds.is_empty());assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc));assert!(live.retained_bytes()<=RETENTION_BYTES);
        }}}}
    }
    #[test]
    fn native_targets_selections_locks_and_all_layers_survive_boundary_rewinds(){
        let all=json!([[12,16,0.2],[28,20,1],[8,32,0.6],[-3,15,0.9]]);
        for kind in ["pixels","mask","implicit-mask","alpha","quickMask","red","allLayers","locked"]{for finger in [false,true]{
            let mut engine=fixture(16,"rgb",true);let mut p=params();p["fingerPainting"]=json!(finger);
            match kind{"mask"|"implicit-mask"=>{engine.execute("layer.layerMask.revealAll",json!({})).unwrap();if kind=="mask"{p["target"]=json!("mask");}else{engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();}},"alpha"=>{engine.execute("channel.new",json!({"name":"Smudge channel"})).unwrap();engine.execute("channel.target",json!({"channel":0})).unwrap();p["target"]=json!({"channel":0});},"quickMask"=>{engine.execute("select.editInQuickMaskMode",json!({})).unwrap();},"red"=>{engine.execute("channel.target",json!({"channel":"red"})).unwrap();},"allLayers"=>{engine.execute("layer.new.layer",json!({"name":"Smudge above"})).unwrap();p["sampleAllLayers"]=json!(true);},"locked"=>{let state=engine.active_mut().unwrap();let id=state.active_layer.unwrap();Arc::make_mut(&mut state.doc).layer_mut(id).unwrap().locks.transparency=true;},_=>{}}
            if matches!(kind,"mask"|"implicit-mask"|"alpha"|"quickMask"){let mut stripe=json!({"points":[[5,8],[39,8]],"size":7,"color":"#202020","seed":72});if let Some(target)=p.get("target"){stripe["target"]=target.clone();}engine.execute("paint.stroke",stripe).unwrap();}
            engine.execute("select.rect",json!({"x":8,"y":10,"width":26,"height":26,"feather":2})).unwrap();let before=engine.active().unwrap().doc.clone();let tools=serde_json::to_value(&engine.tools.mixer).unwrap();let mut live=SmudgeStroke::begin(&engine,&p).unwrap();
            for count in 1..=4{p["points"]=json!([all[count-1].clone()]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);check(&engine,&live,&full);}
            assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc));assert_eq!(serde_json::to_value(&engine.tools.mixer).unwrap(),tools);
        }}
    }
    #[test]
    fn provisional_pulled_string_extents_can_contract_without_retaining_old_carry(){
        let mut engine=fixture(32,"rgb",true);engine.tools.brush.smoothing.amount=0.8;engine.tools.brush.smoothing.pulled_string=true;engine.tools.brush.smoothing.catch_up_on_end=true;let mut p=params();p["sampleAllLayers"]=json!(true);let all=json!([[12,16,1],[180,16,1],[40,16,0.2],[20,60,0.9],[260,60,0.4]]);let mut live=SmudgeStroke::begin(&engine,&p).unwrap();let mut prior=Rect::EMPTY;let mut contracted=false;
        for count in 1..=5{p["points"]=json!([all[count-1].clone()]);live.push(&p).unwrap();contracted|=live.damage.x1<prior.x1;prior=live.damage;let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);check(&engine,&live,&full);assert_eq!(live.work.as_ref().unwrap().rect,live.damage);}
        assert!(contracted);assert!(!live.rewinds.is_empty());assert_eq!(live.samples_pushed,5);
    }
    #[test]
    fn checkpoints_replay_only_affected_suffixes_and_eviction_keeps_exact_native_pixels(){
        let all:Vec<Value>=(0..301).map(|i|json!([12.0+f64::from(i)*1.25,16,1])).collect();
        for evict in [false,true]{let engine=fixture(32,"rgb",false);let mut p=params();p["size"]=json!(6);p["spacing"]=json!(25);let mut live=SmudgeStroke::begin(&engine,&p).unwrap();if evict{live.retention_limit=live.carry_bytes*4;}
            for (start,end)in [(0,181),(181,261),(261,301)]{p["points"]=json!(all[start..end]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(all[..end]);check(&engine,&live,&full);assert!(live.retained_bytes()<=live.retention_limit);}
            assert_eq!(live.samples_pushed,301);assert!(!live.rewinds.is_empty());if evict{assert!(live.checkpoints.is_empty());assert!(live.rewinds.iter().all(|(_,checkpoint)|*checkpoint==0));}else{assert!(live.rewinds.iter().any(|(_,checkpoint)|*checkpoint>0));assert!(live.applied<live.dabs.len()*2);assert!(live.retained_bytes()<=RETENTION_BYTES);assert!(live.checkpoints.len()<=CHECKPOINT_LIMIT);}
        }
    }
    #[test]
    fn native_dynamics_and_hdr_carry_remain_exact_across_prefixes(){
        let all=json!([[12,16,0.1],[20,30,0.8],[35,20,0.3],[8,15,1]]);
        for mode in ["rgb","gray","cmyk","lab"]{for sampled in [false,true]{
            let mut engine=fixture(32,mode,true);let state=engine.active_mut().unwrap();let id=state.active_layer.unwrap();let surface=Arc::make_mut(&mut state.doc).layer_mut(id).unwrap().surface_mut().unwrap();let fmt=surface.format();let mut values=surface.read_region(Rect::new(0,0,48,48));for pixel in values.chunks_exact_mut(fmt.channels()){for(c,value)in pixel.iter_mut().enumerate(){if Some(c)!=alpha_index(&fmt){*value=*value*3.0-0.25;}}}surface.write_region(Rect::new(0,0,48,48),&values);
            if sampled{engine.execute("layer.new.layer",json!({"name":"HDR Smudge above"})).unwrap();}
            let brush=&mut engine.tools.brush;brush.smoothing.amount=0.7;brush.smoothing.catch_up_on_end=true;brush.noise=true;brush.wet_edges=true;brush.scattering.enabled=true;brush.scattering.count=3;brush.dual_brush.enabled=true;brush.dual_brush.count=2;brush.shape_dynamics.enabled=true;brush.shape_dynamics.size.control=photocraft_engine::paint::brush::Control::PenPressure;brush.shape_dynamics.size.minimum=0.1;brush.shape_dynamics.angle.jitter=0.5;brush.shape_dynamics.brush_projection=true;brush.pose.enabled=true;brush.pose.override_tilt=true;brush.pose.tilt_x=35.0;brush.pose.tilt_y=20.0;
            let mut p=params();p["sampleAllLayers"]=json!(sampled);let mut live=SmudgeStroke::begin(&engine,&p).unwrap();for count in 1..=4{p["points"]=json!([all[count-1].clone()]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);check(&engine,&live,&full);}assert_eq!(live.samples_pushed,4);
        }}
    }
    #[test]
    fn invalid_size_carry_and_path_budgets_refuse_before_mutating_retained_state(){
        let engine=fixture(32,"rgb",true);let before=engine.active().unwrap().doc.clone();let mut p=params();p["size"]=json!(1500);assert!(SmudgeStroke::begin(&engine,&p).err().unwrap().contains("carry exceeds"));p["size"]=json!(f64::MAX);assert!(SmudgeStroke::begin(&engine,&p).err().unwrap().contains("size"));
        p=params();let mut live=SmudgeStroke::begin(&engine,&p).unwrap();p["points"]=json!((0..512).map(|i|vec![if i%2==0{0}else{1800},16,1]).collect::<Vec<_>>());assert!(live.push(&p).unwrap_err().contains("dab budget"));assert_eq!(live.samples_pushed,0);assert!(live.dabs.is_empty());assert!(live.checkpoints.is_empty());assert!(Arc::ptr_eq(&before,&live.document));p["points"]=json!([[12,16,0.3],[24,24,0.8]]);live.push(&p).unwrap();check(&engine,&live,&p);assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc));
    }
    fn wide_fixture(depth:u64,mode:&str,size:u32)->Session{
        let mut engine=Session::new();engine.execute("file.new",json!({"width":size,"height":size,"depth":depth,"mode":mode,"background":"transparent"})).unwrap();
        let state=engine.active_mut().unwrap();let id=state.active_layer.unwrap();let surface=Arc::make_mut(&mut state.doc).layer_mut(id).unwrap().surface_mut().unwrap();let fmt=surface.format();let mut values=Vec::new();
        for y in 0..size{for x in 0..size{values.extend(from_rgba(&fmt,[0.03+(x%7) as f32*0.11,0.08+(y%5) as f32*0.15,0.12+((x+y)%11) as f32*0.06,((x+y)%9) as f32*0.1]));}}
        surface.write_region(Rect::from_xywh(0,0,size,size),&values);engine.tools.foreground=[0.8,0.1,0.2,0.6];engine
    }
    #[test]
    fn tiled_wide_transparent_prefixes_and_source_layers_match_native(){
        let all=json!([[16,16,0.1],[90,110,0.8],[220,75,1],[-15,180,0.3]]);
        for(depth,mode)in [(8,"rgb"),(16,"gray"),(32,"rgb"),(32,"cmyk"),(16,"lab")]{for sampled in [false,true]{
            let mut engine=wide_fixture(depth,mode,256);engine.tools.brush.smoothing.amount=0.0;engine.tools.brush.noise=true;engine.tools.brush.wet_edges=true;
            let mut p=params();p["sampleAllLayers"]=json!(sampled);p["fingerPainting"]=json!(sampled);
            if sampled{let id=engine.active().unwrap().active_layer.unwrap();engine.execute("layer.new.layer",json!({"name":"Above Smudge"})).unwrap();engine.execute("paint.stroke",json!({"points":[[4,38],[235,80]],"size":23,"color":"#80b020","seed":631})).unwrap();p["layer"]=json!(id);}
            engine.execute("select.rect",json!({"x":5,"y":8,"width":230,"height":200,"feather":3})).unwrap();let mut live=SmudgeStroke::begin(&engine,&p).unwrap();
            for count in 1..=4{p["points"]=json!([all[count-1]]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);check(&engine,&live,&full);}
            assert!(live.output_peak_pixels<=4096);assert!(live.work.as_ref().unwrap().peak_region_pixels<1024);
        }}
    }
    #[test]
    fn tiled_smudge_small_append_uses_local_regions_and_dirty_output(){
        let mut engine=wide_fixture(16,"rgb",1000);engine.tools.brush.smoothing.amount=0.0;let mut p=params();p["points"]=json!([[64,64,1],[900,900,1]]);p["size"]=json!(8);p["fingerPainting"]=json!(true);
        let mut live=SmudgeStroke::begin(&engine,&p).unwrap();live.push(&p).unwrap();let prior=live.output_pixels;
        p["points"]=json!([[904,904,1],[908,908,1]]);live.push(&p).unwrap();let delta=live.output_pixels-prior;let accumulated=live.damage.width() as usize*live.damage.height() as usize;
        assert!(accumulated>700_000);assert!(delta*8<accumulated);assert!(live.output_peak_pixels<=4096);let roi=live.work.as_ref().unwrap().peak_region_pixels;assert!(roi<1024);
        p["points"]=json!([[64,64,1],[900,900,1],[904,904,1],[908,908,1]]);check(&engine,&live,&p);
        eprintln!("tiled-smudge-work accumulated_pixels={accumulated} delta_output_pixels={delta} peak_stable_roi_pixels={roi} peak_output_patch_pixels={}",live.output_peak_pixels);
    }
    #[test]
    fn checkpoint_accounting_visits_local_tiles_without_owning_float_arcs(){
        let mut engine=fixture(32,"rgb",true);engine.tools.brush.smoothing.amount=0.0;let mut p=params();p["sampleAllLayers"]=json!(true);p["fingerPainting"]=json!(true);p["points"]=json!([[12,16,1],[24,24,1]]);
        let mut short=SmudgeStroke::begin(&engine,&p).unwrap();short.push(&p).unwrap();assert!(short.checkpoints.is_empty());let work=short.work.as_ref().unwrap();assert!(work.pixels.blocks().chain(work.visible.iter().flat_map(FloatTiles::blocks)).all(|block|Arc::strong_count(block)==1));check(&engine,&short,&p);
        p["points"]=json!([[12,16,1],[1500,16,1]]);p["size"]=json!(8);let mut live=SmudgeStroke::begin(&engine,&p).unwrap();live.push(&p).unwrap();let work=live.work.as_ref().unwrap();let blocks=work.pixels.blocks().count()+work.visible.as_ref().unwrap().blocks().count();
        assert!(blocks>40);assert!(live.applied>800);assert!(live.retention.sync_visits<=live.applied*8);assert_eq!(live.retained_bytes(),live.full_retained_bytes());assert!(live.retained_bytes()<=RETENTION_BYTES);check(&engine,&live,&p);
        eprintln!("smudge-retention-work applied_dabs={} current_blocks={blocks} sync_visits={} checkpoint_visits={} extra_payload_bytes={}",live.applied,live.retention.sync_visits,live.retention.checkpoint_visits,live.retention.extra_bytes());
    }
    #[test]
    fn cancellation_inside_tiled_smudge_retains_last_published_feedback(){
        use std::sync::atomic::{AtomicUsize,Ordering};
        let mut engine=wide_fixture(32,"rgb",256);engine.tools.brush.smoothing.amount=0.0;let mut p=params();p["sampleAllLayers"]=json!(true);p["points"]=json!([[16,16,1],[70,70,1]]);let source=engine.active().unwrap().doc.clone();let mut live=SmudgeStroke::begin(&engine,&p).unwrap();live.push(&p).unwrap();
        let before=live.document.clone();let damage=live.damage;let applied=live.applied;let calls=AtomicUsize::new(0);let interrupted=||calls.fetch_add(1,Ordering::Relaxed)>=100;let ctl=Interrupt::cancel_only(&interrupted);
        p["points"]=json!([[200,150,1],[240,240,1]]);assert!(live.push_with(&p,&ctl).is_err());assert!(live.applied>applied);assert!(Arc::ptr_eq(&before,&live.document));assert_eq!(live.damage,damage);assert!(Arc::ptr_eq(&source,&engine.active().unwrap().doc));
    }
}
