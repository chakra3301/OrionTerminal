//! Incremental coverage feedback using PhotoCraft's pinned native retouch formulas.
//! Adapted from PhotoCraft 47f9306f retouch_cmds.rs; distribution retains its licenses.
use photocraft_engine::{Session, BrushSettings, channel_cmds::ChannelTarget,
    doc::{BlendMode, Document, LayerId, PixelFormat, Rect, Surface},
    paint::{StrokePoint, StrokeRenderer, dynamics::DabGenerator, retouch::{Region, alpha_index}},
    presets::clone_source::{Mapping, mapping}};
use photocraft_algo::{inpaint::{self, CompleteParams}, poisson};
use photocraft_raster::{from_rgba_into,Interrupt};
use serde_json::Value;
use std::sync::Arc;
use super::super::history;

const COVERAGE_TOOLS: [&str; 4] = ["paint.cloneStamp", "paint.healingBrush", "paint.spotHealing", "paint.historyBrush"];
#[path = "xdesign_photo_retouch_admission.rs"]
mod admission;
#[path = "xdesign_photo_retouch_sparse.rs"]
mod sparse;
#[path = "xdesign_photo_healing_coverage.rs"]
mod healing_coverage;
#[path = "xdesign_photo_healing_publish.rs"]
mod healing_publish;
#[path = "xdesign_photo_healing_solve.rs"]
mod healing_solve;
use healing_solve::heal_region;
#[path = "xdesign_photo_healing_sources.rs"]
mod healing_sources;
#[path = "xdesign_photo_spot_inpaint.rs"]
mod spot_inpaint;
#[path = "xdesign_photo_float_tiles.rs"]
mod float_tiles;
#[path = "xdesign_photo_retouch_dabs.rs"]
mod sequential;
#[path = "xdesign_photo_smudge.rs"]
mod smudge;
pub(super) const TOOLS:[&str;12]=["paint.cloneStamp","paint.healingBrush","paint.spotHealing","paint.dodge","paint.burn","paint.sponge","paint.blur","paint.sharpen","paint.mixerBrush","paint.colorReplacement","paint.smudge","paint.historyBrush"];
pub(super) enum RetouchStroke { Coverage(CoverageStroke), Sequential(sequential::SequentialStroke), Smudge(smudge::SmudgeStroke) }
impl RetouchStroke {
    pub fn begin(engine:&Session,command:&str,params:&Value)->Result<Self,String>{if command=="paint.smudge"{smudge::SmudgeStroke::begin(engine,params).map(Self::Smudge)}else if COVERAGE_TOOLS.contains(&command){CoverageStroke::begin(engine,command,params).map(Self::Coverage)}else{sequential::SequentialStroke::begin(engine,command,params).map(Self::Sequential)}}
    #[cfg(test)] pub fn push(&mut self,params:&Value)->Result<(),String>{self.push_with(params,&Interrupt::NONE)}
    pub fn push_with(&mut self,params:&Value,ctl:&Interrupt)->Result<(),String>{match self{Self::Coverage(stroke)=>stroke.push_with(params,ctl),Self::Sequential(stroke)=>stroke.push_with(params,ctl),Self::Smudge(stroke)=>stroke.push_with(params,ctl)}}
    pub fn document(&self)->Arc<Document>{match self{Self::Coverage(stroke)=>stroke.document.clone(),Self::Sequential(stroke)=>stroke.document.clone(),Self::Smudge(stroke)=>stroke.document.clone()}}
    pub fn damage(&self)->Rect{match self{Self::Coverage(stroke)=>stroke.damage,Self::Sequential(stroke)=>stroke.damage,Self::Smudge(stroke)=>stroke.damage}}
    pub fn prepared(self,command:&str,params:&Value)->Result<super::super::prepared::Prepared,String>{
        let label=match command{"paint.dodge"=>"Dodge Tool","paint.burn"=>"Burn Tool","paint.sponge"=>"Sponge Tool","paint.blur"=>"Blur Tool","paint.sharpen"=>"Sharpen Tool","paint.smudge"=>"Smudge Tool",_=>photocraft_engine::command_specs().into_iter().find(|spec|spec.id==command).ok_or("Unknown retouch command")?.label};
        let mut result=serde_json::json!({"damage":[self.damage().x0,self.damage().y0,self.damage().width(),self.damage().height()]});
        let (clone_sources,mixer)=match &self{
            Self::Coverage(stroke)=>{if let Some(map)=stroke.mapping{let (x,y)=map.offset();let aligned=params["aligned"].as_bool().unwrap_or(true);let source=params["source"].as_array().filter(|point|point.len()>=2).and_then(|point|Some((point[0].as_f64()?,point[1].as_f64()?))).unwrap_or_else(||(params["points"][0][0].as_f64().unwrap_or(0.0)+f64::from(x),params["points"][0][1].as_f64().unwrap_or(0.0)+f64::from(y)));result["offset"]=serde_json::json!([x,y]);result["aligned"]=serde_json::json!(aligned);result["nextSource"]=if aligned{Value::Null}else{serde_json::json!([source.0,source.1])};}(stroke.clone_sources.clone(),None)},
            Self::Sequential(stroke)=>(None,stroke.mixer_after.clone()),Self::Smudge(_)=>(None,None),
        };
        Ok(super::super::prepared::Prepared{document:self.document(),damage:self.damage(),label,result,clone_sources,mixer})
    }
    #[cfg(test)] pub fn samples_pushed(&self)->usize{match self{Self::Coverage(stroke)=>stroke.samples_pushed,Self::Sequential(stroke)=>stroke.samples_pushed,Self::Smudge(stroke)=>stroke.samples_pushed}}
}
fn routing(engine:&Session,params:&Value,force_pixels:bool)->Result<(Target,Option<LayerId>,Option<usize>),String>{
        let state=engine.active().ok_or("No retouch image")?;
        let mut effective = params.clone();
        if effective.get("target").is_none() {
            match state.channel_view.target {
                ChannelTarget::Alpha(index) if index < state.doc.channels.len() => effective["target"] = serde_json::json!({"channel":index}),
                ChannelTarget::Composite if state.doc.quick_mask.is_some() => effective["target"] = serde_json::json!("quickMask"),
                ChannelTarget::Composite if photocraft_engine::mask_view_cmds::current(state).is_some() => effective["target"] = serde_json::json!("mask"),
                _ => {}
            }
        }
        if force_pixels { effective["target"]=Value::Null; }
        let layer = params["layer"].as_u64().map(LayerId).or(state.active_layer);
        let target = match effective["target"].as_str() {
            Some("mask") => Target::Mask(layer.ok_or("No active retouch layer")?),
            Some("quickMask") => Target::QuickMask,
            _ => match effective["target"]["channel"].as_u64() {
                Some(index) => Target::Alpha(usize::try_from(index).map_err(|_| "Invalid channel")?),
                None => Target::Pixels(layer.ok_or("No active retouch layer")?)
            }
        };
        let layer = match target { Target::Pixels(id) | Target::Mask(id) => Some(id), _ => None };
        let restriction = if force_pixels { None } else { match (state.channel_view.target, target) { (ChannelTarget::Color(index), Target::Pixels(id)) if Some(id)==state.active_layer => Some(index), _ => None } };
        Ok((target,layer,restriction))
}
fn retouch_brush(engine:&Session,params:&Value)->BrushSettings{
        let base = engine.tools.brush.clone();
        let pct = |key: &str, default: f32, low: f32, high: f32| number(params, key, default).clamp(low, high) / 100.0;
        BrushSettings { size: number(params, "size", base.size).max(1.0), hardness: pct("hardness", base.hardness * 100.0, 0.0, 100.0), opacity: pct("opacity", 100.0, 1.0, 100.0), flow: pct("flow", 100.0, 1.0, 100.0), spacing: pct("spacing", 25.0, 1.0, 1000.0), erase: false, ..base }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SampleLayers { Current, CurrentAndBelow, All }
#[derive(Clone, Copy)]
enum SpotType { ContentAware, CreateTexture, ProximityMatch }
#[derive(Clone, Copy)]
enum Target { Pixels(LayerId), Mask(LayerId), Alpha(usize), QuickMask }
impl Target {
    fn surface(self, doc: &mut Document) -> Result<(&mut Surface, bool), String> {
        match self {
            Self::Alpha(index) => doc.channels.get_mut(index).map(|channel| (&mut channel.surface, false)).ok_or_else(|| "No alpha channel".into()),
            Self::QuickMask => doc.quick_mask.as_mut().map(|channel| (&mut channel.surface, false)).ok_or_else(|| "Not in Quick Mask mode".into()),
            Self::Mask(id) => doc.layer_mut(id).and_then(|layer| layer.mask.as_mut()).map(|mask| (&mut mask.surface, false)).ok_or_else(|| "Layer has no mask".into()),
            Self::Pixels(id) => {
                let layer = doc.layer_mut(id).ok_or("No retouch layer")?;
                if layer.locks.pixels || layer.locks.all { return Err("The retouch layer is locked".into()); }
                let locked = layer.locks.transparency;
                layer.surface_mut().map(|surface| (surface, locked)).ok_or_else(|| "Not a pixel layer".into())
            }
        }
    }
}
fn number(params: &Value, key: &str, default: f32) -> f32 {
    params[key].as_f64().map_or(default, |value| value as f32)
}
fn samples(params: &Value) -> Result<Vec<StrokePoint>, String> {
    let points = params["points"].as_array().ok_or("Missing retouch points")?;
    let points: Vec<_> = points.iter().filter_map(|point| {
        let values = point.as_array()?;
        Some(StrokePoint::new(values.first()?.as_f64()?, values.get(1)?.as_f64()?, values.get(2).and_then(Value::as_f64).unwrap_or(1.0) as f32))
    }).collect();
    if points.is_empty() || points.iter().any(|point| !point.x.is_finite() || !point.y.is_finite() || point.x.abs() > 1_000_000.0 || point.y.abs() > 1_000_000.0) { return Err("Invalid retouch points".into()); }
    Ok(points)
}

pub(super) struct CoverageStroke {
    source: Arc<Document>, original:Surface,target: Target, layer: Option<LayerId>, restriction: Option<usize>,
    brush: BrushSettings, renderer: StrokeRenderer, command: String, which: SampleLayers,
    generator:DabGenerator,budget:admission::DabBudget,stable_bounds:Rect,dual_bounds:Rect,
    mapping: Option<Mapping>, mode: BlendMode, spot: SpotType,
    history_surface:Option<Surface>,
    clone_sources:Option<photocraft_engine::presets::clone_source::CloneSources>,
    tail_keys:sparse::Keys,
    pub document: Arc<Document>, pub damage: Rect,
    #[cfg(test)] pub samples_pushed: usize,
    #[cfg(test)] patches_applied:usize,
    #[cfg(test)] coverage_pixels:usize,
    #[cfg(test)] patch_peak_pixels:usize,
    #[cfg(test)] staged_coverage_pixels:usize,
}
impl CoverageStroke {
    pub fn begin(engine: &Session, command: &str, params: &Value) -> Result<Self, String> {
        let state = engine.active().ok_or("No retouch image")?;
        let spec = photocraft_engine::command_specs().into_iter().find(|spec| spec.id == command).ok_or("Unknown retouch tool")?;
        (spec.enabled)(engine)?;
        let (target,layer,restriction)=routing(engine,params,false)?;
        let brush=retouch_brush(engine,params);
        admission::brush(&brush)?;
        let which = if matches!(command,"paint.spotHealing"|"paint.historyBrush") { SampleLayers::Current } else { match params["sampleLayer"].as_str().unwrap_or("current") {
            "current" => SampleLayers::Current, "currentAndBelow" => SampleLayers::CurrentAndBelow, "all" => SampleLayers::All, _ => return Err("Unknown retouch sample layer".into())
        }};
        let mode = if command == "paint.spotHealing" { BlendMode::Normal } else {
            params["mode"].as_str().map(photocraft_engine::commands::blend_from_str).unwrap_or(Some(BlendMode::Normal)).ok_or("Unknown retouch blend mode")?
        };
        let spot = if command != "paint.spotHealing" { SpotType::ContentAware } else { match params["type"].as_str().unwrap_or("contentAware") {
            "contentAware" => SpotType::ContentAware, "createTexture" => SpotType::CreateTexture, "proximityMatch" => SpotType::ProximityMatch, _ => return Err("Unknown spot healing type".into())
        }};
        let points = samples(params)?;
        let mut clone_sources=None;
        let map = if matches!(command,"paint.spotHealing"|"paint.historyBrush") { None } else {
            let mut isolated = Session::new(); isolated.presets = engine.presets.clone();
            let map=mapping(&mut isolated, params, (points[0].x, points[0].y), command).map_err(|error| error.to_string())?;clone_sources=Some(isolated.presets.clone.clone());Some(map)
        };
        let mut validation = (*state.doc).clone();let original=target.surface(&mut validation)?.0.clone();let fmt=original.format();
        let history_surface=if command=="paint.historyBrush"{let selected=history::resolve(engine,params)?;let effective=params.get("target").cloned().unwrap_or_else(||history::effective_target(state));let source=history::surface(&selected.doc,layer,&effective)?;Some(if source.format()==fmt{source}else{source.convert(fmt)})}else{None};
        Ok(Self { source: state.doc.clone(),original, target, layer, restriction, renderer: StrokeRenderer::new(&brush, None, 1.0),generator:DabGenerator::new(&brush,1.0),budget:admission::DabBudget::new(&brush),stable_bounds:Rect::EMPTY,dual_bounds:Rect::EMPTY, brush, command: command.into(), which, mapping: map, mode, spot,history_surface,clone_sources,tail_keys:Default::default(), document: state.doc.clone(), damage: Rect::EMPTY, #[cfg(test)] samples_pushed: 0,#[cfg(test)]patches_applied:0,#[cfg(test)]coverage_pixels:0,#[cfg(test)]patch_peak_pixels:0,#[cfg(test)]staged_coverage_pixels:0 })
    }
    #[cfg(test)] pub fn push(&mut self,params:&Value)->Result<(),String>{self.push_with(params,&Interrupt::NONE)}
    pub fn push_with(&mut self, params: &Value,ctl:&Interrupt) -> Result<(), String> {
        admission::check(ctl)?;
        let points = samples(params)?;
        let budget=self.budget.next(&points,&self.brush,ctl)?;
        // The public renderer rasterizes immediately. A matching disposable
        // generator admits primary/dual/tail geometry before those allocations.
        let mut generator=self.generator.clone();let(mut stable,mut dual)=(Vec::new(),Vec::new());generator.push(&points,&mut stable,&mut dual);
        let mut ending=generator.clone();let(mut tail,mut tail_dual)=(Vec::new(),Vec::new());ending.finish(&mut tail,&mut tail_dual);
        let stable_bounds=admission::bounds(&self.renderer.ctx,&stable,false,self.stable_bounds)?;
        let dual_bounds=admission::bounds(&self.renderer.ctx,&dual,true,self.dual_bounds)?;
        let bounds=admission::bounds(&self.renderer.ctx,&tail,false,stable_bounds)?;
        let dual_finished=admission::bounds(&self.renderer.ctx,&tail_dual,true,dual_bounds)?;
        admission::area(bounds.union(&dual_finished))?;
        let working=if self.command=="paint.healingBrush"{bounds.inflate(2)}else if self.command=="paint.spotHealing"{bounds.inflate(self.brush.size.max(8.0).ceil() as i32+8).intersect(&self.source.bounds())}else{bounds};
        admission::area(working)?;
        if let Some(map)=self.mapping{admit_source(working,&map)?;}
        let sparse=matches!(self.command.as_str(),"paint.cloneStamp"|"paint.historyBrush");
        let mut next_tail=sparse::Keys::new();let mut dirty=self.tail_keys.clone();
        sparse::mark(&self.renderer.ctx,&tail,false,&mut next_tail);sparse::mark(&self.renderer.ctx,&tail_dual,true,&mut next_tail);
        if sparse {
            sparse::mark(&self.renderer.ctx,&stable,false,&mut dirty);sparse::mark(&self.renderer.ctx,&dual,true,&mut dirty);
            dirty.extend(next_tail.iter().copied());
        }
        admission::check(ctl)?;
        self.generator=generator;self.budget=budget;self.stable_bounds=stable_bounds;self.dual_bounds=dual_bounds;
        drop((stable,dual,tail,tail_dual));
        for chunk in points.chunks(32){admission::check(ctl)?;self.renderer.push(chunk);}
        #[cfg(test)] { self.samples_pushed += points.len(); }
        if sparse{return self.sparse(dirty,next_tail,bounds,ctl);}
        let mut coverage=healing_coverage::Coverage::new(&self.renderer,&next_tail,ctl)?;
        let bounds=coverage.bounds;
        let mut document = (*self.source).clone();
        let (surface, locked) = self.target.surface(&mut document)?;
        let mut sources=healing_sources::Sources::default();
        let published = match self.command.as_str() {
            "paint.healingBrush" => {
                let area=bounds.inflate(2);let cov=coverage.dense(area,ctl)?;let fmt=surface.format();
                let source = sources.clone_sample(&self.source, self.layer, surface, self.which, area, self.mapping.as_ref().ok_or("No clone mapping")?,ctl)?;
                let destination = if self.which == SampleLayers::Current { sources.read(surface,area,ctl)? } else { sources.compose(&self.source,self.layer,self.which,area,fmt,ctl)? };
                let mask: Vec<_> = cov.iter().map(|value| *value > 0.0).collect();
                let healed = heal_region(&fmt, &source, &destination, &mask,ctl)?;
                drop((source,mask));
                healing_publish::apply(surface, area, &cov, area, self.brush.opacity, self.source.selection.as_ref(), locked, &healed, self.mode,ctl)?
            }
            _ => spot_heal_surface(surface, self.source.bounds(), &mut coverage, self.brush.size, self.brush.opacity, self.spot, self.source.selection.as_ref(), locked,&mut sources,ctl)?
        };
        let damage=published.damage;
        #[cfg(test)]{self.patch_peak_pixels=self.patch_peak_pixels.max(published.peak_pixels);self.patches_applied+=published.patches;}
        #[cfg(test)]{self.staged_coverage_pixels+=coverage.dense_pixels;}
        if let Some(channel) = self.restriction {
            let _restored=healing_publish::restore_channels(surface,&self.original,damage,channel,ctl)?;
            #[cfg(test)]{self.patch_peak_pixels=self.patch_peak_pixels.max(_restored.peak_pixels);self.patches_applied+=_restored.patches;}
            surface.prune();
        }
        admission::check(ctl)?;self.document = Arc::new(document);self.damage=damage;Ok(())
    }
}

fn admit_source(rect:Rect,map:&Mapping)->Result<(),String>{
    let invalid=||"Retouch source exceeds the preview bounds; finish the stroke for the full edit".to_string();
    if map.is_translation(){
        let(dx,dy)=map.offset();
        for(value,offset)in [(rect.x0,dx),(rect.x1,dx),(rect.y0,dy),(rect.y1,dy)]{i32::try_from(i64::from(value)+i64::from(offset)).map_err(|_|invalid())?;}
        admission::area(rect)?;
    }else{
        for(x,y)in [(rect.x0,rect.y0),(rect.x0,rect.y1),(rect.x1,rect.y0),(rect.x1,rect.y1)]{
            let(x,y)=map.map(f64::from(x),f64::from(y));
            if !x.is_finite()||!y.is_finite()||x<=f64::from(i32::MIN)+3.0||y<=f64::from(i32::MIN)+3.0||x>=f64::from(i32::MAX)-3.0||y>=f64::from(i32::MAX)-3.0{return Err(invalid());}
        }
        admission::area(map.source_rect(rect))?;
    }
    Ok(())
}

fn composite_region(pre: &Document, id: Option<LayerId>, which: SampleLayers, rect: Rect, fmt: PixelFormat) -> Region {
    let mut doc = pre.clone();
    if which == SampleLayers::CurrentAndBelow {
      if let Some(id) = id {
        // Hide everything composited after (above) the target in the bottom-to-top walk.
        let walk: Vec<(Vec<usize>, LayerId)> = pre.walk().into_iter().map(|(p, _, l)| (p, l.id)).collect();
        if let Some(pos) = walk.iter().position(|(_, l)| *l == id) {
            for (path, _) in &walk[pos + 1..] {
                if let Some(l) = doc.layer_at_mut(path) {
                    l.visible = false;
                }
            }
        }
    }
    }
    let buf = photocraft_compose::render(&doc, rect);
    let n = fmt.channels();
    let mut out = Region::new(rect, n);
    let mut enc = [0.0f32; 8];
    for (i, px) in buf.px.iter().enumerate() {
        from_rgba_into(&fmt, *px, &mut enc);
        out.data[i * n..(i + 1) * n].copy_from_slice(&enc[..n]);
    }
    out
}

fn sample(pre: &Document, id: Option<LayerId>, surf: &Surface, which: SampleLayers, rect: Rect) -> Region {
    match which {
        SampleLayers::Current => Region::read(surf, rect),
        _ => composite_region(pre, id, which, rect, surf.format()),
    }
}

fn clone_sample(pre: &Document, id: Option<LayerId>, surf: &Surface, which: SampleLayers, rect: Rect, map: &Mapping) -> Region {
    if map.is_translation() {
        let off = map.offset();
        let mut r = sample(pre, id, surf, which, rect.translate(off.0, off.1));
        r.rect = rect;
        return r;
    }
    let src = sample(pre, id, surf, which, map.source_rect(rect));
    photocraft_engine::presets::clone_source::resample(&src, rect, map, alpha_index(&surf.format()))
}

#[cfg(test)]
fn clamp_samples(fmt: &PixelFormat, data: &mut [f32]) {
    let n = fmt.channels();
    let a = alpha_index(fmt);
    let float = fmt.sample == photocraft_engine::doc::SampleType::F32;
    for px in data.chunks_exact_mut(n) {
        for (c, v) in px.iter_mut().enumerate() {
            *v = if Some(c) == a || !float { v.clamp(0.0, 1.0) } else { v.max(0.0) };
        }
    }
}

#[cfg(test)]
fn seamless_with(w:usize,h:usize,ch:usize,src:&[f32],dst:&[f32],mask:&[bool],ctl:&Interrupt)->Result<Vec<f32>,String>{
    admission::check(ctl)?;
    // Native seamless_clone solves a membrane on dst - src. The public
    // interruptible fill uses the identical per-channel solver and boundary data.
    let delta:Vec<f32>=dst.iter().zip(src).map(|(d,s)|d-s).collect();
    let mut correction=poisson::membrane_fill_with(w,h,ch,&delta,mask,ctl).map_err(|_|"The retouch feedback was canceled".to_string())?;
    for y in 0..h{admission::check(ctl)?;for x in 0..w{let i=y*w+x;for c in 0..ch{let j=i*ch+c;correction[j]=if mask[i]{src[j]+correction[j]}else{dst[j]};}}}
    Ok(correction)
}

fn dilate(w: usize, h: usize, m: &[bool], r: usize,ctl:&Interrupt) -> Result<Vec<bool>,String> {
    let mut tmp = vec![false; w * h];
    for y in 0..h {
        admission::check(ctl)?;
        for x in 0..w {
            if m[y * w + x] {
                for xx in x.saturating_sub(r)..(x + r + 1).min(w) {
                    tmp[y * w + xx] = true;
                }
            }
        }
    }
    let mut out = vec![false; w * h];
    for y in 0..h {
        admission::check(ctl)?;
        for x in 0..w {
            if tmp[y * w + x] {
                for yy in y.saturating_sub(r)..(y + r + 1).min(h) {
                    out[yy * w + x] = true;
                }
            }
        }
    }
    Ok(out)
}

fn spot_heal_surface(surf: &mut Surface, area: Rect, coverage:&mut healing_coverage::Coverage<'_>, size: f32, opacity: f32, kind: SpotType, sel: Option<&Surface>, lock: bool,sources:&mut healing_sources::Sources,ctl:&Interrupt) -> Result<healing_publish::Published,String> {
    admission::check(ctl)?;
    let bounds=coverage.bounds;
    let margin = (size.max(8.0) * 1.0).ceil() as i32 + 8;
    let region_rect = bounds.inflate(margin).intersect(&area);
    if region_rect.is_empty() {
        return Ok(healing_publish::Published::empty());
    }
    let fmt = surf.format();
    let img = sources.read(surf,region_rect,ctl)?;
    let (w, h, ch) = (img.width(), img.height(), img.ch);
    let stroke_cov=coverage.dense(region_rect,ctl)?;
    let hole: Vec<bool> = stroke_cov.iter().map(|c| *c > 0.0).collect();
    if !hole.iter().any(|h| *h) {
        return Ok(healing_publish::Published::empty());
    }
    // Synthesise over a slightly larger domain than the Poisson region, so the solve's boundary pixels
    // carry synthesised values that differ from the untouched surroundings: that mismatch is what the
    // membrane corrects (otherwise the Dirichlet data would be all zero and the blend a no-op).
    let domain = dilate(w, h, &hole, 2,ctl)?;
    let heal_mask = dilate(w, h, &hole, 1,ctl)?;
    let content_aware = |img: &[f32]| -> Result<Vec<f32>,String>{
        admission::check(ctl)?;
        match inpaint::complete_with(w,h,ch,img,&domain,&CompleteParams::default(),ctl).map_err(|_|"The retouch feedback was canceled".to_string())?{
            Some(pixels)=>Ok(pixels),None=>poisson::membrane_fill_with(w,h,ch,img,&domain,ctl).map_err(|_|"The retouch feedback was canceled".into())
        }
    };
    let filled = match kind {
        SpotType::ContentAware => content_aware(&img.data)?,
        SpotType::CreateTexture => spot_inpaint::synthesize(w, h, ch, &img.data, &domain, (size / 4.0).clamp(6.0, 32.0) as usize, 0x5eed,ctl)?,
        SpotType::ProximityMatch => {
            let ring = (size / 8.0).clamp(3.0, 16.0) as usize;
            match spot_inpaint::best_offset(w, h, ch, &img.data, &domain, ring, margin,ctl)? {
                Some((dx, dy)) => {
                    let mut out = spot_inpaint::copy_rows(&img.data,w*ch,ctl)?;
                    for y in 0..h {
                        admission::check(ctl)?;
                        for x in 0..w {
                            if domain[y * w + x] {
                                let (i, j) = ((y * w + x) * ch, (((y as i32 + dy) as usize) * w + (x as i32 + dx) as usize) * ch);
                                out.copy_within(j..j + ch, i);
                            }
                        }
                    }
                    out
                }
                None => content_aware(&img.data)?,
            }
        }
    };
    admission::check(ctl)?;
    let src = Region { rect: region_rect, ch, data: filled };
    let healed = heal_region(&fmt, &src, &img, &heal_mask,ctl)?;
    drop((src,heal_mask,domain,hole));
    let dmg = bounds.intersect(&region_rect);
    healing_publish::apply(surf,dmg,&stroke_cov,region_rect,opacity,sel,lock,&healed,BlendMode::Normal,ctl)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture(depth:u64, mode:&str)->Session {
        let mut engine=Session::new();
        engine.execute("file.new",json!({"width":48,"height":48,"depth":depth,"mode":mode,"background":"#905080"})).unwrap();
        engine.execute("paint.stroke",json!({"points":[[4,8],[42,8],[42,36],[5,36]],"size":9,"color":"#20b0c0","seed":31})).unwrap();engine
    }
    fn isolated(engine:&Session)->Session {
        let mut result=Session::new();let state=engine.active().unwrap().clone();result.add_document((*state.doc).clone(),None);*result.active_mut().unwrap()=state;result.tools=engine.tools.clone();result.presets=engine.presets.clone();result
    }
    fn target_pixels(engine:&Session, doc:&Document, params:&Value)->Vec<f32> {
        if let Some(index)=params["target"]["channel"].as_u64(){return doc.channels[index as usize].surface.read_region(doc.bounds());}
        if params["target"]=="quickMask"||params.get("target").is_none()&&doc.quick_mask.is_some(){return doc.quick_mask.as_ref().unwrap().surface.read_region(doc.bounds());}
        let layer=doc.layer(engine.active().unwrap().active_layer.unwrap()).unwrap();
        if params["target"]=="mask"||params.get("target").is_none()&&photocraft_engine::mask_view_cmds::current(engine.active().unwrap()).is_some(){layer.mask.as_ref().unwrap().surface.read_region(doc.bounds())}else{layer.surface().unwrap().read_region(doc.bounds())}
    }
    #[test]
    fn coverage_admission_refuses_dabs_extents_dual_and_transformed_sources_before_raster(){
        for command in COVERAGE_TOOLS{for kind in ["dabs","extent","dual","source"]{
            if kind=="source"&&!matches!(command,"paint.cloneStamp"|"paint.healingBrush"){continue;}
            let mut engine=fixture(8,"rgb");
            if kind=="dual"{engine.tools.brush.dual_brush.enabled=true;engine.tools.brush.dual_brush.size=4096.0;}
            let mut params=json!({"points":[[8,16]],"source":[7,7],"size":8,"seed":73});
            match kind{"dabs"=>params["points"]=json!([[0,0],[300000,0]]),"extent"=>params["points"]=json!([[0,0],[5000,5000]]),"source"=>params["scale"]=json!([0.1,0.1]),_=>{}}
            let source=engine.active().unwrap().doc.clone();let mut live=CoverageStroke::begin(&engine,command,&params).unwrap();
            let error=live.push(&params).unwrap_err();assert!(error.contains("budget")||error.contains("megapixels"),"{command}/{kind}/{error}");
            assert_eq!(live.renderer.dab_count(),0,"{command}/{kind}");assert_eq!(live.renderer.bounds(),Rect::EMPTY);assert_eq!(live.samples_pushed,0);
            assert!(Arc::ptr_eq(&source,&live.document));assert!(Arc::ptr_eq(&source,&engine.active().unwrap().doc));
        }}
        for command in TOOLS{let engine=fixture(8,"rgb");let params=json!({"points":[[8,16]],"source":[7,7],"size":1e100,"seed":73});assert!(RetouchStroke::begin(&engine,command,&params).is_err(),"{command}");}
    }
    #[test]
    fn interruptible_seamless_clone_matches_native_channels_hdr_edges_and_empty_masks(){
        let(w,h)=(64,48);
        for ch in [1,2,3,4,5,8]{for kind in ["disc","edge","empty"]{
            let src:Vec<f32>=(0..w*h*ch).map(|i|((i%23) as f32*0.17)-0.2).collect();
            let dst:Vec<f32>=(0..w*h*ch).map(|i|((i%31) as f32*0.09)+0.15).collect();
            let mask:Vec<bool>=(0..w*h).map(|i|match kind{"disc"=>((i%w) as f32-32.0).hypot((i/w) as f32-24.0)<15.0,"edge"=>i%w<20&&i/w<30,_=>false}).collect();
            let actual=seamless_with(w,h,ch,&src,&dst,&mask,&Interrupt::NONE).unwrap();let expected=poisson::seamless_clone(w,h,ch,&src,&dst,&mask);
            assert_eq!(actual,expected,"{ch}/{kind}");
        }}
    }
    #[test]
    fn poisson_and_patchmatch_observe_cancellation_inside_native_work(){
        use std::sync::atomic::{AtomicUsize,Ordering};
        let(w,h,ch)=(96,96,4);let src:Vec<f32>=(0..w*h*ch).map(|i|(i%23) as f32*0.037).collect();let dst:Vec<f32>=(0..w*h*ch).map(|i|(i%31) as f32*0.021).collect();
        let mask:Vec<bool>=(0..w*h).map(|i|((i%w) as f32-48.0).hypot((i/w) as f32-48.0)<26.0).collect();
        for algorithm in ["poisson","patchmatch"]{
            let calls=AtomicUsize::new(0);let stop=||calls.fetch_add(1,Ordering::Relaxed)>=24;let ctl=Interrupt::cancel_only(&stop);
            let canceled=if algorithm=="poisson"{seamless_with(w,h,ch,&src,&dst,&mask,&ctl).is_err()}else{inpaint::complete_with(w,h,ch,&src,&mask,&CompleteParams::default(),&ctl).is_err()};
            assert!(canceled,"{algorithm}");assert!(calls.load(Ordering::Relaxed)>=25,"cancellation must be observed after work starts");
        }
    }
    #[test]
    fn global_healing_publication_is_bounded_and_matches_native_multitile_strokes(){
        for(command,kind)in [("paint.healingBrush","contentAware"),("paint.spotHealing","contentAware"),("paint.spotHealing","createTexture"),("paint.spotHealing","proximityMatch")]{
            let mut engine=Session::new();engine.execute("file.new",json!({"width":240,"height":220,"depth":32,"mode":"rgb","background":"#905080"})).unwrap();engine.execute("paint.stroke",json!({"points":[[5,20],[210,20],[210,185],[5,185]],"size":19,"color":"#20b0c0","seed":31})).unwrap();let source=engine.active().unwrap().doc.clone();let history=engine.active().unwrap().history.entries().to_vec();
            let all=json!([[16,40],[95,160],[190,95]]);let mut params=json!({"points":all.as_array().unwrap()[..2],"source":[8,8],"size":8,"opacity":67,"type":kind,"seed":73});let mut live=CoverageStroke::begin(&engine,command,&params).unwrap();
            for count in [2,3]{if count==3{params["points"]=json!([all[2].clone()]);}live.push(&params).unwrap();let mut whole=params.clone();whole["points"]=json!(all.as_array().unwrap()[..count]);let mut expected=isolated(&engine);expected.execute(command,whole.clone()).unwrap();assert_eq!(target_pixels(&engine,&live.document,&whole),target_pixels(&expected,&expected.active().unwrap().doc,&whole),"{command}/{kind}/prefix{count}");assert_eq!(live.damage,expected.active().unwrap().last_damage.unwrap());assert!(live.patch_peak_pixels<=4096);assert!(live.patches_applied>1);}
            assert_eq!(live.patch_peak_pixels,4096);assert!(Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries());
            eprintln!("healing-publication-work tool={command} kind={kind} damage_pixels={} peak_publication_pixels={} published_patches={}",live.damage.width() as usize*live.damage.height() as usize,live.patch_peak_pixels,live.patches_applied);
        }
    }
    #[test]
    fn healing_stages_one_global_coverage_buffer_per_prefix_with_native_pixels(){
        for(command,kind)in [("paint.healingBrush","contentAware"),("paint.spotHealing","contentAware"),("paint.spotHealing","createTexture"),("paint.spotHealing","proximityMatch")]{
            let mut engine=fixture(32,"rgb");engine.tools.brush.noise=true;engine.tools.brush.wet_edges=true;
            engine.tools.brush.dual_brush.enabled=true;engine.tools.brush.dual_brush.size=11.0;
            let source=engine.active().unwrap().doc.clone();let history=engine.active().unwrap().history.entries().to_vec();let journal=engine.journal.clone();
            let points=json!([[8,16,0.4],[16,21,0.8],[32,28,0.6]]);
            let mut params=json!({"points":points.as_array().unwrap()[..2],"source":[7,7],"size":8,"opacity":67,"type":kind,"seed":73});
            let mut live=CoverageStroke::begin(&engine,command,&params).unwrap();
            for count in [2,3]{
                if count==3{params["points"]=json!([points[2].clone()]);}
                let prior=live.staged_coverage_pixels;live.push(&params).unwrap();
                let mut native=live.renderer.clone();native.finish();let bounds=native.bounds();
                let region=if command=="paint.healingBrush"{bounds.inflate(2)}else{bounds.inflate(live.brush.size.max(8.0).ceil() as i32+8).intersect(&source.bounds())};
                let staged=live.staged_coverage_pixels-prior;let pixels=region.width() as usize*region.height() as usize;
                assert_eq!(staged,pixels,"{command}/{kind}/prefix{count}");
                assert!(live.patch_peak_pixels<=4096);
                let old_pixels=pixels+bounds.width() as usize*bounds.height() as usize;assert!(staged<old_pixels);
                let mut whole=params.clone();whole["points"]=json!(points.as_array().unwrap()[..count]);let mut expected=isolated(&engine);expected.execute(command,whole.clone()).unwrap();
                assert_eq!(target_pixels(&engine,&live.document,&whole),target_pixels(&expected,&expected.active().unwrap().doc,&whole),"{command}/{kind}/prefix{count}");assert_eq!(live.damage,expected.active().unwrap().last_damage.unwrap());
                eprintln!("healing-staging-work tool={command} kind={kind} prefix={count} staged_coverage_pixels={staged} previous_dense_coverage_pixels={old_pixels} peak_publication_pixels={}",live.patch_peak_pixels);
            }
            assert!(Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries());assert_eq!(journal,engine.journal);
        }
    }
    #[test]
    fn final_phase_healing_cancellation_retains_previous_document_and_damage(){
        use std::sync::atomic::{AtomicUsize,Ordering};
        for(command,kind)in [("paint.healingBrush","contentAware"),("paint.spotHealing","contentAware"),("paint.spotHealing","createTexture"),("paint.spotHealing","proximityMatch")]{for restricted in [false,true]{
            let mut engine=fixture(16,"rgb");if restricted{engine.execute("channel.target",json!({"channel":"red"})).unwrap();}
            let first=json!({"points":[[8,16],[16,21]],"source":[7,7],"size":8,"type":kind,"seed":73});let mut more=first.clone();more["points"]=json!([[29,23]]);
            let mut reference=CoverageStroke::begin(&engine,command,&first).unwrap();reference.push(&first).unwrap();let calls=AtomicUsize::new(0);let observe=||{calls.fetch_add(1,Ordering::Relaxed);false};reference.push_with(&more,&Interrupt::cancel_only(&observe)).unwrap();let total=calls.load(Ordering::Relaxed);assert!(total>1);
            let source=engine.active().unwrap().doc.clone();let mut live=CoverageStroke::begin(&engine,command,&first).unwrap();live.push(&first).unwrap();let previous=live.document.clone();let damage=live.damage;let calls=AtomicUsize::new(0);let stop=||calls.fetch_add(1,Ordering::Relaxed)+1>=total;
            assert!(live.push_with(&more,&Interrupt::cancel_only(&stop)).unwrap_err().contains("canceled"));assert_eq!(calls.load(Ordering::Relaxed),total);assert!(Arc::ptr_eq(&previous,&live.document));assert_eq!(live.damage,damage,"{command}/{kind}/restricted{restricted}");assert!(Arc::ptr_eq(&source,&engine.active().unwrap().doc));
        }}
    }
    #[test]
    fn canceled_retouch_deltas_preserve_last_published_feedback_and_source(){
        for command in TOOLS{
            let engine=fixture(16,"rgb");let mut params=json!({"points":[[8,16],[16,21]],"source":[7,7],"size":8,"seed":73});
            let source=engine.active().unwrap().doc.clone();let journal=engine.journal.clone();let tools=serde_json::to_value(&engine.tools.mixer).unwrap();
            let mut live=RetouchStroke::begin(&engine,command,&params).unwrap();live.push(&params).unwrap();let previous=live.document();let damage=live.damage();params["points"]=json!([[29,23]]);
            let stop=||true;let ctl=Interrupt::cancel_only(&stop);assert!(live.push_with(&params,&ctl).unwrap_err().contains("canceled"),"{command}");
            assert!(Arc::ptr_eq(&previous,&live.document()));assert_eq!(damage,live.damage());assert!(Arc::ptr_eq(&source,&engine.active().unwrap().doc));assert_eq!(journal,engine.journal);assert_eq!(tools,serde_json::to_value(&engine.tools.mixer).unwrap());
        }
    }
    #[test]
    fn growing_coverage_matches_native_full_strokes_at_every_prefix_and_depth() {
        for command in COVERAGE_TOOLS {for depth in [8,16,32] {for mode in ["rgb","gray","cmyk","lab"] {
            let engine=fixture(depth,mode);let before=engine.active().unwrap().doc.clone();
            let points=json!([[8,15,0.25],[19,17,0.75],[30,22,0.6],[37,28,0.4]]);
            let mut params=json!({"points":points.as_array().unwrap()[..1],"source":[7,7],"size":7,"hardness":45,"flow":57,"opacity":61,"spacing":19,"type":"proximityMatch","seed":42});
            let mut live=CoverageStroke::begin(&engine,command,&params).unwrap();
            for count in 1..=4 {
                params["points"]=json!([points[count-1].clone()]);live.push(&params).unwrap();
                let mut whole=params.clone();whole["points"]=json!(points.as_array().unwrap()[..count]);
                let mut expected=isolated(&engine);expected.execute(command,whole.clone()).unwrap();
                assert_eq!(target_pixels(&engine,&live.document,&whole),target_pixels(&expected,&expected.active().unwrap().doc,&whole),"{command}/{depth}/{mode}/prefix{count}");
                assert_eq!(live.damage,expected.active().unwrap().last_damage.unwrap());
            }
            assert_eq!(live.samples_pushed,4);assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc));
        }}}
    }
    #[test]
    fn explicit_and_implicit_mask_channel_quick_mask_and_color_restriction_match_native() {
        for command in COVERAGE_TOOLS {for kind in ["mask","implicit-mask","alpha","quickMask","red"] {
            let mut engine=fixture(16,"rgb");let mut params=json!({"points":[[10,16,0.5]],"source":[7,7],"size":8,"opacity":65,"flow":70,"type":"proximityMatch","seed":71});
            match kind {
                "mask"|"implicit-mask"=>{engine.execute("layer.layerMask.revealAll",json!({})).unwrap();if kind=="mask"{params["target"]=json!("mask");}else{engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();}},
                "alpha"=>{engine.execute("channel.new",json!({"name":"Retouch alpha"})).unwrap();engine.execute("channel.target",json!({"channel":0})).unwrap();params["target"]=json!({"channel":0});},
                "quickMask"=>{engine.execute("select.editInQuickMaskMode",json!({})).unwrap();},
                _=>{engine.execute("channel.target",json!({"channel":"red"})).unwrap();}
            }
            let mut pattern=json!({"points":[[4,7],[40,7],[40,11]],"size":7,"color":"#202020","seed":37});
            if let Some(target)=params.get("target"){pattern["target"]=target.clone();}
            engine.execute("paint.stroke",pattern).unwrap();
            if command=="paint.historyBrush"{params["state"]=json!(engine.active().unwrap().history.past_len()-1);}
            let before=engine.active().unwrap().doc.clone();let history=engine.active().unwrap().history.entries().to_vec();let mut live=CoverageStroke::begin(&engine,command,&params).unwrap();live.push(&params).unwrap();
            let mut second=params.clone();second["points"]=json!([[24,24,0.8],[32,30,0.4]]);live.push(&second).unwrap();params["points"]=json!([[10,16,0.5],[24,24,0.8],[32,30,0.4]]);
            let mut expected=isolated(&engine);expected.execute(command,params.clone()).unwrap();assert_eq!(target_pixels(&engine,&live.document,&params),target_pixels(&expected,&expected.active().unwrap().doc,&params),"{command}/{kind}");
            assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc));assert_eq!(history,engine.active().unwrap().history.entries());
        }}
    }
    #[test]
    fn transformed_clone_sampling_blends_selection_and_whole_heal_solve_match_native() {
        for command in ["paint.cloneStamp","paint.healingBrush"] {for sample in ["current","currentAndBelow","all"] {
            let mut engine=fixture(32,"rgb");engine.execute("layer.new.layer",json!({"name":"Retouch above"})).unwrap();
            engine.execute("select.rect",json!({"x":8,"y":12,"width":25,"height":20,"feather":2})).unwrap();
            let mut params=json!({"points":[[12,18,0.5]],"source":[20,7],"scale":[80,135],"rotation":27,"flipH":true,"size":8,"mode":"multiply","sampleLayer":sample,"hardness":40,"flow":70,"opacity":60,"seed":91});
            let mut live=CoverageStroke::begin(&engine,command,&params).unwrap();live.push(&params).unwrap();let mut second=params.clone();second["points"]=json!([[22,24,0.8],[31,28,0.5]]);live.push(&second).unwrap();params["points"]=json!([[12,18,0.5],[22,24,0.8],[31,28,0.5]]);
            let mut expected=isolated(&engine);expected.execute(command,params.clone()).unwrap();assert_eq!(target_pixels(&engine,&live.document,&params),target_pixels(&expected,&expected.active().unwrap().doc,&params),"{command}/{sample}");
        }}
    }
    #[test]
    fn all_spot_healing_solvers_reuse_coverage_without_changing_native_result() {
        for kind in ["contentAware","createTexture","proximityMatch"] {
            let engine=fixture(8,"rgb");let mut params=json!({"points":[[15,18,0.5]],"size":5,"flow":50,"opacity":70,"type":kind,"seed":122});let mut live=CoverageStroke::begin(&engine,"paint.spotHealing",&params).unwrap();live.push(&params).unwrap();let mut more=params.clone();more["points"]=json!([[23,21,0.7]]);live.push(&more).unwrap();params["points"]=json!([[15,18,0.5],[23,21,0.7]]);
            let mut expected=isolated(&engine);expected.execute("paint.spotHealing",params.clone()).unwrap();assert_eq!(target_pixels(&engine,&live.document,&params),target_pixels(&expected,&expected.active().unwrap().doc,&params),"{kind}");assert_eq!(live.samples_pushed,2);
        }
    }
    #[test]
    fn provisional_smoothed_tail_is_replaced_and_dynamics_are_chunk_independent() {
        let mut engine=fixture(16,"rgb");engine.tools.brush.smoothing.amount=0.6;engine.tools.brush.noise=true;engine.tools.brush.wet_edges=true;
        let mut params=json!({"points":[[8,14,0.2]],"source":[7,7],"size":9,"opacity":60,"seed":818});let mut live=CoverageStroke::begin(&engine,"paint.cloneStamp",&params).unwrap();
        let all=json!([[8,14,0.2],[17,23,0.8],[28,16,0.4],[36,30,0.7]]);
        for count in 1..=4 {params["points"]=json!([all[count-1].clone()]);live.push(&params).unwrap();let mut whole=params.clone();whole["points"]=json!(all.as_array().unwrap()[..count]);let mut expected=isolated(&engine);expected.execute("paint.cloneStamp",whole.clone()).unwrap();assert_eq!(target_pixels(&engine,&live.document,&whole),target_pixels(&expected,&expected.active().unwrap().doc,&whole));}
        assert_eq!(live.samples_pushed,4);
    }
    #[test]
    fn history_sources_blends_selections_locks_and_smoothing_match_native_prefixes(){
        for source in 0..=2{for mode in ["Normal","Multiply","Color","Linear Dodge (Add)"]{
            let mut engine=fixture(32,"rgb");engine.execute("paint.stroke",json!({"points":[[12,18],[35,28]],"size":10,"color":"#f04010","seed":28})).unwrap();engine.execute("select.rect",json!({"x":7,"y":12,"width":29,"height":20,"feather":2})).unwrap();let layer=engine.active().unwrap().active_layer.unwrap();Arc::make_mut(&mut engine.active_mut().unwrap().doc).layer_mut(layer).unwrap().locks.transparency=true;engine.tools.brush.smoothing.amount=0.6;engine.tools.brush.noise=true;engine.tools.brush.wet_edges=true;
            let all=json!([[8,14,0.2],[17,23,0.8],[28,16,0.4],[36,30,0.7]]);let mut params=json!({"points":[all[0]],"state":source,"size":9,"opacity":60,"flow":55,"hardness":42,"mode":mode,"seed":819});let mut live=CoverageStroke::begin(&engine,"paint.historyBrush",&params).unwrap();
            for count in 1..=4{params["points"]=json!([all[count-1]]);live.push(&params).unwrap();let mut whole=params.clone();whole["points"]=json!(all.as_array().unwrap()[..count]);let mut expected=isolated(&engine);expected.execute("paint.historyBrush",whole.clone()).unwrap();assert_eq!(target_pixels(&engine,&live.document,&whole),target_pixels(&expected,&expected.active().unwrap().doc,&whole),"source{source}/{mode}/prefix{count}");}assert_eq!(live.samples_pushed,4);
        }}
    }
    #[test]
    fn history_source_format_conversion_and_explicit_null_target_match_native(){
        for mode in ["image.mode.cmyk","image.mode.lab","image.mode.grayscale"]{let mut engine=fixture(16,"rgb");engine.execute(mode,json!({})).unwrap();let params=json!({"points":[[8,16],[20,25]],"state":0,"size":8,"opacity":70,"seed":85});let mut live=CoverageStroke::begin(&engine,"paint.historyBrush",&params).unwrap();live.push(&params).unwrap();let mut expected=isolated(&engine);expected.execute("paint.historyBrush",params.clone()).unwrap();assert_eq!(target_pixels(&engine,&live.document,&params),target_pixels(&expected,&expected.active().unwrap().doc,&params),"{mode}");}
        let mut engine=fixture(8,"rgb");engine.execute("layer.layerMask.revealAll",json!({})).unwrap();engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();let params=json!({"points":[[8,16]],"state":0,"target":null,"size":8,"seed":85});let mut live=CoverageStroke::begin(&engine,"paint.historyBrush",&params).unwrap();live.push(&params).unwrap();let mut expected=isolated(&engine);expected.execute("paint.historyBrush",params.clone()).unwrap();let layer=engine.active().unwrap().active_layer.unwrap();assert_eq!(live.document.layer(layer).unwrap().surface().unwrap().read_region(live.document.bounds()),expected.active().unwrap().doc.layer(layer).unwrap().surface().unwrap().read_region(live.document.bounds()));
    }
}
