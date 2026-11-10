//! Dirty native coverage patches for Clone Stamp and History Brush feedback.
use super::{CoverageStroke,clone_sample,admission};
use photocraft_engine::{doc::Rect,paint::{BrushContext,Dab,render::COV_TILE,retouch::{Region,apply_coverage}}};
use photocraft_raster::Interrupt;
use std::{collections::BTreeSet,sync::Arc};

pub(super) type Keys=BTreeSet<(i32,i32)>;
pub(super) fn publication(previous:Rect,bounds:Rect,dirty:&Keys)->Vec<Rect>{
    let mut areas:Vec<Rect>=dirty.iter().map(|&(x,y)|Rect::from_xywh(x*COV_TILE,y*COV_TILE,COV_TILE as u32,COV_TILE as u32)).collect();
    // Native sequential opacity can round unchanged transparent pixels too.
    // Added/removed bounds strips preserve that arithmetic between dab tiles.
    for r in difference(previous,bounds).into_iter().chain(difference(bounds,previous)){
        for y in r.y0.div_euclid(COV_TILE)..=(r.y1-1).div_euclid(COV_TILE){for x in r.x0.div_euclid(COV_TILE)..=(r.x1-1).div_euclid(COV_TILE){
            if !dirty.contains(&(x,y)){areas.push(r.intersect(&Rect::from_xywh(x*COV_TILE,y*COV_TILE,COV_TILE as u32,COV_TILE as u32)));}
        }}
    }
    areas
}
pub(super) fn difference(rect:Rect,cut:Rect)->Vec<Rect>{
    if rect.is_empty(){return Vec::new();}let common=rect.intersect(&cut);if common.is_empty(){return vec![rect];}
    [Rect::new(rect.x0,rect.y0,common.x0,rect.y1),Rect::new(common.x1,rect.y0,rect.x1,rect.y1),Rect::new(common.x0,rect.y0,common.x1,common.y0),Rect::new(common.x0,common.y1,common.x1,rect.y1)].into_iter().filter(|r|!r.is_empty()).collect()
}
pub(super) fn mark(ctx:&BrushContext,dabs:&[Dab],dual:bool,keys:&mut Keys){
    for dab in dabs {
        let r=ctx.dab_rect(dab,dual);if r.is_empty(){continue;}
        for y in r.y0.div_euclid(COV_TILE)..=(r.y1-1).div_euclid(COV_TILE){
            for x in r.x0.div_euclid(COV_TILE)..=(r.x1-1).div_euclid(COV_TILE){keys.insert((x,y));}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::Session;
    use serde_json::{Value,json};
    fn fixture(depth:u64,mode:&str,size:u32)->Session{
        let mut engine=Session::new();engine.execute("file.new",json!({"width":size,"height":size,"depth":depth,"mode":mode,"background":"#905080"})).unwrap();
        engine.execute("paint.stroke",json!({"points":[[5,25],[180,85],[280,180]],"size":23,"color":"#20b0c0","seed":31})).unwrap();engine
    }
    fn twin(engine:&Session)->Session{let mut expected=Session::new();let state=engine.active().unwrap().clone();expected.add_document((*state.doc).clone(),None);*expected.active_mut().unwrap()=state;expected.tools=engine.tools.clone();expected.presets=engine.presets.clone();expected}
    fn check(engine:&Session,live:&CoverageStroke,command:&str,params:&Value){
        let mut expected=twin(engine);expected.execute(command,params.clone()).unwrap();assert_eq!(live.damage,expected.active().unwrap().last_damage.unwrap());
        let rect=engine.active().unwrap().doc.bounds().union(&live.damage).inflate(4);let(mut actual,mut native)=((*live.document).clone(),(*expected.active().unwrap().doc).clone());
        let a=live.target.surface(&mut actual).unwrap().0.read_region(rect);let b=live.target.surface(&mut native).unwrap().0.read_region(rect);
        assert_eq!(a.len(),b.len());assert!(a.iter().zip(&b).all(|(a,b)|a==b),"{command}: first mismatch {:?}",a.iter().zip(&b).enumerate().find(|(_, (a,b))|a!=b));
    }
    #[test]
    fn sparse_multitile_dynamics_match_native_prefixes_at_every_depth_and_mode(){
        let all=json!([[12,16,0.2],[78,35,0.8],[160,46,0.4],[245,145,1.0],[170,210,0.5],[-25,155,0.7]]);
        for command in ["paint.cloneStamp","paint.historyBrush"]{for depth in [8,16,32]{for mode in ["rgb","gray","cmyk","lab"]{
            let mut engine=fixture(depth,mode,320);engine.tools.brush.smoothing.amount=0.55;engine.tools.brush.noise=true;engine.tools.brush.wet_edges=true;
            engine.tools.brush.dual_brush.enabled=true;engine.tools.brush.dual_brush.size=31.0;engine.tools.brush.dual_brush.count=3;
            engine.tools.brush.texture.enabled=true;engine.tools.brush.texture.each_tip=depth==16;engine.tools.brush.texture.scale=0.7;
            engine.tools.brush.scattering.enabled=true;engine.tools.brush.scattering.count=2;
            engine.execute("select.rect",json!({"x":10,"y":15,"width":270,"height":230,"feather":3})).unwrap();
            let before=engine.active().unwrap().doc.clone();let mut params=json!({"points":[all[0]],"source":[65,60],"size":17,"opacity":65,"flow":60,"spacing":25,"mode":"Multiply","seed":811});
            let mut live=CoverageStroke::begin(&engine,command,&params).unwrap();
            for count in 1..=6{params["points"]=json!([all[count-1]]);live.push(&params).unwrap();let mut full=params.clone();full["points"]=json!(all.as_array().unwrap()[..count]);check(&engine,&live,command,&full);}
            assert_eq!(live.samples_pushed,6);assert!(live.patch_peak_pixels<=4096);assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc));
        }}}
    }
    #[test]
    fn sparse_tail_contraction_masks_channels_and_affine_layer_sampling_match_native(){
        let all=json!([[12,16,1.0],[190,16,0.9],[35,16,0.2],[20,80,0.8],[270,80,0.4]]);
        for command in ["paint.cloneStamp","paint.historyBrush"]{for kind in ["pixels","mask","alpha","quickMask","red","locked","below","all"]{
            let mut engine=fixture(16,"rgb",320);let mut params=json!({"points":[all[0]],"source":[65,60],"size":11,"opacity":65,"flow":60,"seed":819});
            match kind{
                "mask"=>{engine.execute("layer.layerMask.revealAll",json!({})).unwrap();engine.execute("paint.stroke",json!({"points":[[5,30],[285,200]],"size":21,"color":"#303030","target":"mask"})).unwrap();params["target"]=json!("mask");params["state"]=json!(engine.active().unwrap().history.past_len());},
                "alpha"=>{engine.execute("channel.new",json!({"name":"Sparse source"})).unwrap();params["target"]=json!({"channel":0});params["state"]=json!(engine.active().unwrap().history.past_len());},
                "quickMask"=>{engine.execute("select.editInQuickMaskMode",json!({})).unwrap();params["target"]=json!("quickMask");params["state"]=json!(engine.active().unwrap().history.past_len());},
                "red"=>{engine.execute("channel.target",json!({"channel":"red"})).unwrap();},
                "locked"=>{let state=engine.active_mut().unwrap();let id=state.active_layer.unwrap();Arc::make_mut(&mut state.doc).layer_mut(id).unwrap().locks.transparency=true;},
                "below"|"all"=>{engine.execute("layer.new.layer",json!({"name":"Sparse target"})).unwrap();engine.execute("paint.stroke",json!({"points":[[8,85],[280,85]],"size":19,"color":"#f08020"})).unwrap();params["state"]=json!(engine.active().unwrap().history.past_len());params["sampleLayer"]=json!(if kind=="below"{"currentAndBelow"}else{"all"});params["scale"]=json!([80,115]);params["rotation"]=json!(23);params["flipH"]=json!(true);},_=>{}
            }
            engine.tools.brush.smoothing.amount=0.8;engine.tools.brush.smoothing.pulled_string=true;engine.tools.brush.smoothing.catch_up_on_end=true;
            let mut live=CoverageStroke::begin(&engine,command,&params).unwrap();let mut prior=Rect::EMPTY;let mut contracted=false;
            for count in 1..=5{params["points"]=json!([all[count-1]]);live.push(&params).unwrap();contracted|=live.damage.x1<prior.x1;prior=live.damage;let mut full=params.clone();full["points"]=json!(all.as_array().unwrap()[..count]);check(&engine,&live,command,&full);}
            assert!(contracted,"{command}/{kind}");assert!(live.patch_peak_pixels<=4096);
        }}
    }
    #[test]
    fn sparse_small_delta_avoids_accumulated_dense_coverage_and_keeps_native_pixels(){
        for command in ["paint.cloneStamp","paint.historyBrush"]{for smoothing in [0.0,0.1]{
            let mut engine=fixture(8,"rgb",1600);engine.tools.brush.smoothing.amount=smoothing;let mut params=json!({"points":[[64,64],[1500,1500]],"source":[32,32],"size":8,"opacity":65,"seed":823});
            let mut live=CoverageStroke::begin(&engine,command,&params).unwrap();live.push(&params).unwrap();let pixels=live.coverage_pixels;let patches=live.patches_applied;
            params["points"]=json!([[1504,1504],[1508,1508]]);live.push(&params).unwrap();let delta=live.coverage_pixels-pixels;let changed=live.patches_applied-patches;let accumulated=u64::from(live.damage.width())*u64::from(live.damage.height());
            let limit=if smoothing==0.0{4}else{12};assert!(delta<=limit*4096);assert!(changed<=limit);assert_eq!(live.patch_peak_pixels,4096);assert!(accumulated>2_000_000);assert!((delta as u64)*32<accumulated);
            params["points"]=json!([[64,64],[1500,1500],[1504,1504],[1508,1508]]);check(&engine,&live,command,&params);
            eprintln!("sparse-retouch-work tool={command} smoothing={smoothing} accumulated_pixels={accumulated} delta_coverage_pixels={delta} delta_patches={changed} peak_coverage_patch_pixels={}",live.patch_peak_pixels);
        }}
    }
    #[test]
    fn cancellation_inside_sparse_patch_processing_keeps_previous_feedback(){
        use std::sync::atomic::{AtomicUsize,Ordering};
        for command in ["paint.cloneStamp","paint.historyBrush"]{
            let engine=fixture(16,"rgb",320);let mut params=json!({"points":[[12,16],[75,80]],"source":[65,60],"size":17,"opacity":65,"seed":831});
            let source=engine.active().unwrap().doc.clone();let mut live=CoverageStroke::begin(&engine,command,&params).unwrap();live.push(&params).unwrap();let previous=live.document.clone();let damage=live.damage;let patches=live.patches_applied;
            params["points"]=json!([[270,245]]);let calls=AtomicUsize::new(0);let stop=||calls.fetch_add(1,Ordering::Relaxed)>=100;let ctl=Interrupt::cancel_only(&stop);
            assert!(live.push_with(&params,&ctl).unwrap_err().contains("canceled"));assert!(calls.load(Ordering::Relaxed)>=101);assert!(live.patches_applied>patches,"must cancel after at least one local patch finishes");
            assert!(Arc::ptr_eq(&previous,&live.document));assert_eq!(live.damage,damage);assert!(Arc::ptr_eq(&source,&engine.active().unwrap().doc));
        }
    }
}
impl CoverageStroke {
    pub(super) fn sparse(&mut self,dirty:Keys,next_tail:Keys,bounds:Rect,ctl:&Interrupt)->Result<(),String>{
        let tail=self.renderer.tail_preview();
        let mut document=(*self.document).clone();let(surface,locked)=self.target.surface(&mut document)?;
        for (tx,ty) in dirty {
            admission::check(ctl)?;
            let rect=Rect::from_xywh(tx*COV_TILE,ty*COV_TILE,COV_TILE as u32,COV_TILE as u32);
            // Rebuild from pre-stroke pixels, including the previous disposable
            // tail's tiles. Appending input can shrink or remove that tail.
            let original=self.original.read_region(rect);surface.write_region(rect,&original);
            let visible=rect.intersect(&bounds);
            if !visible.is_empty(){
                let renderer=if next_tail.contains(&(tx,ty)){tail.as_ref().unwrap_or(&self.renderer)}else{&self.renderer};
                let mut cov=Vec::with_capacity(visible.width() as usize*visible.height() as usize);
                for y in visible.y0..visible.y1{admission::check(ctl)?;for x in visible.x0..visible.x1{cov.push(renderer.coverage_at(x,y));}}
                let paint=if self.command=="paint.historyBrush"{Region::read(self.history_surface.as_ref().ok_or("No History Brush source")?,visible)}else{
                    {let (sample,id,read)=self.sampling();clone_sample(sample,id,read,self.which,visible,self.mapping.as_ref().ok_or("No clone mapping")?)}
                };
                apply_coverage(surface,visible,&cov,self.brush.opacity,self.source.selection.as_ref(),locked,&paint,self.mode);
                #[cfg(test)]{self.coverage_pixels+=cov.len();self.patch_peak_pixels=self.patch_peak_pixels.max(cov.len());}
            }
            if let Some(channel)=self.restriction {
                let n=surface.channels();let mut pixels=surface.read_region(rect);
                for (new,old) in pixels.chunks_exact_mut(n).zip(original.chunks_exact(n)){for c in 0..n{if c!=channel{new[c]=old[c];}}}
                surface.write_region(rect,&pixels);
            }
            #[cfg(test)]{self.patches_applied+=1;}
        }
        if self.restriction.is_some(){surface.prune();}
        admission::check(ctl)?;self.document=Arc::new(document);self.damage=bounds;self.tail_keys=next_tail;Ok(())
    }
}
