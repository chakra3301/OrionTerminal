//! Sequential feedback adapted from PhotoCraft 47f9306f retouch/mixer/replacement formulas.
//! Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors; MIT OR Apache-2.0.
//! Full grants/NOTICE are retained in THIRD_PARTY_LICENSES/native/photocraft-engine-0.3.0.md.
use super::{number, samples, routing, retouch_brush, composite_region, Target, SampleLayers};
use photocraft_engine::{Session, BrushSettings, doc::{Document, PixelFormat, Rect, Surface},
    paint::{BrushContext, dynamics::DabGenerator,
        mixer::{MixerSettings, MixerState, PICKUP_RATE}, replace::{ReplaceMode, Sampling, Limits, ReplaceSettings},
        retouch::{Region, Footprint, alpha_index, mix_premultiplied, over_native}}};
use photocraft_algo::retouch::{ToneRange, dodge_burn, sponge, local_blur, local_sharpen};
use photocraft_raster::{to_rgba, from_rgba, from_rgba_into};
use serde_json::Value;
use super::admission::{self,DabBudget};
use photocraft_raster::Interrupt;
use std::sync::Arc;

pub(super) const TOOLS: [&str; 7] = ["paint.dodge", "paint.burn", "paint.sponge", "paint.blur", "paint.sharpen", "paint.mixerBrush", "paint.colorReplacement"];
#[derive(Clone)]
enum Effect {
    Tone { range: ToneRange, exposure: f32, burn: bool, protect: bool },
    Sponge { saturate: bool, vibrance: bool },
    Focus { sharpen: bool, strength: f32, sigma: f32, protect: bool },
    Mixer(MixerCarry),
    Replacement { settings: ReplaceSettings, once: Option<[f32; 3]> },
}
#[derive(Clone)]
struct MixerCarry {
    settings: MixerSettings, reservoir: Option<Vec<f32>>, amount: f32, pickup: Option<Vec<f32>>,
    sample: Option<Surface>,
}
#[path = "xdesign_photo_retouch_working.rs"]
mod tiled;
use tiled::Working;
pub(in super::super) struct SequentialStroke {
    source: Arc<Document>, target: Target, restriction: Option<usize>, original: Surface, locked: bool,
    brush: BrushSettings, ctx: BrushContext, generator: DabGenerator, budget: DabBudget, work: Working,
    stable_bounds: Rect, halo: i32, mixer: bool,
    pub document: Arc<Document>, pub damage: Rect,
    #[cfg(test)] pub samples_pushed: usize,
    #[cfg(test)] pub stable_dabs_applied: usize,
    stable_count: usize,tail_keys:super::sparse::Keys,
    #[cfg(test)] output_pixels:usize,
    #[cfg(test)] output_peak_pixels:usize,
    pub(super) mixer_after:Option<MixerState>,clean_after:bool,
}
impl SequentialStroke {
    pub fn begin(engine:&Session,command:&str,params:&Value)->Result<Self,String> {
        let state=engine.active().ok_or("No retouch image")?;
        let spec=photocraft_engine::command_specs().iter().find(|spec|spec.id==command).ok_or("Unknown retouch tool")?;(spec.enabled)(engine)?;
        let (target,_,restriction)=routing(engine,params,command=="paint.colorReplacement")?;
        let mut validation=(*state.doc).clone();let (surface,locked)=target.surface(&mut validation)?;let original=surface.clone();let fmt=original.format();
        let mixer=command=="paint.mixerBrush";
        let mut brush=if mixer||command=="paint.colorReplacement" {photocraft_engine::brush_cmds::resolve_brush(engine,params,command).map_err(|error|error.to_string())?}else{retouch_brush(engine,params)};
        let flag=|key:&str,default|params[key].as_bool().unwrap_or(default);
        let pct=|key:&str,default:f32|number(params,key,default).clamp(0.0,100.0)/100.0;
        let mut halo=0;
        let mut mixer_after=None;let clean_after=flag("cleanAfterStroke",true);
        let mut sample_all=matches!(command,"paint.blur"|"paint.sharpen")&&flag("sampleAllLayers",false)&&matches!(target,Target::Pixels(_));
        let effect=match command {
            "paint.dodge"|"paint.burn" => Effect::Tone { range:match params["range"].as_str().unwrap_or("midtones") {"shadows"=>ToneRange::Shadows,"midtones"=>ToneRange::Midtones,"highlights"=>ToneRange::Highlights,_=>return Err("Unknown tone range".into())},exposure:number(params,"exposure",50.0).clamp(1.0,100.0)/100.0,burn:command=="paint.burn",protect:flag("protectTones",true)},
            "paint.sponge"=>Effect::Sponge{saturate:match params["mode"].as_str().unwrap_or("desaturate"){"desaturate"=>false,"saturate"=>true,_=>return Err("Unknown sponge mode".into())},vibrance:flag("vibrance",true)},
            "paint.blur"|"paint.sharpen"=>{let sigma=(brush.size*0.03).clamp(1.0,4.0);halo=(sigma*3.0).ceil() as i32+1;Effect::Focus{sharpen:command=="paint.sharpen",strength:number(params,"strength",50.0).clamp(1.0,100.0)/100.0,sigma,protect:flag("protectDetail",true)}},
            "paint.mixerBrush"=>{
                let bm=&brush.mixer;let settings=MixerSettings{wet:pct("wet",bm.wet*100.0),load:pct("load",bm.load*100.0),mix:pct("mix",bm.mix*100.0),flow:pct("flow",bm.flow*100.0),sample_all_layers:flag("sampleAllLayers",bm.sample_all_layers)};
                let mut state: MixerState=engine.tools.mixer.clone();if flag("loadAfterStroke",true)||state.reservoir.is_none(){state.load(brush.color);}
                let a=alpha_index(&fmt);let native=|color|{let mut value=from_rgba(&fmt,color);if let Some(alpha)=a{value[alpha]=1.0;}value};
                let reservoir=state.reservoir.map(native);let amount=if reservoir.is_some(){state.amount.clamp(0.0,1.0)}else{0.0};let pickup=state.pickup.map(native);let sample=settings.sample_all_layers.then(||Surface::new(PixelFormat::RGBA32F));
                sample_all=false;brush.opacity=1.0;
                let carry=MixerCarry{settings,reservoir,amount,pickup,sample};mixer_after=Some(carry.final_state(&fmt,state,clean_after));Effect::Mixer(carry)
            },
            _=>{
                fn setting<T:serde::de::DeserializeOwned>(params:&Value,key:&str,default:T)->Result<T,String>{params.get(key).cloned().map(serde_json::from_value).transpose().map_err(|error|error.to_string()).map(|value|value.unwrap_or(default))}
                sample_all=false;
                Effect::Replacement{settings:ReplaceSettings{mode:setting(params,"mode",ReplaceMode::Color)?,sampling:setting(params,"sampling",Sampling::Continuous)?,limits:setting(params,"limits",Limits::Contiguous)?,tolerance:pct("tolerance",30.0),anti_alias:flag("antiAlias",true),color:brush.color,background:engine.tools.background},once:None}
            }
        };
        admission::brush(&brush)?;
        Ok(Self{source:state.doc.clone(),target,restriction,original,locked,ctx:BrushContext::new(&brush),generator:DabGenerator::new(&brush,1.0),budget:DabBudget::new(&brush),brush,work:Working::new(fmt,sample_all,effect),stable_bounds:Rect::EMPTY,halo,mixer,mixer_after,clean_after,document:state.doc.clone(),damage:Rect::EMPTY,stable_count:0,tail_keys:Default::default(),#[cfg(test)]output_pixels:0,#[cfg(test)]output_peak_pixels:0,#[cfg(test)]samples_pushed:0,#[cfg(test)]stable_dabs_applied:0})
    }
    #[cfg(test)] pub fn push(&mut self,params:&Value)->Result<(),String>{self.push_with(params,&Interrupt::NONE)}
    pub fn push_with(&mut self,params:&Value,ctl:&Interrupt)->Result<(),String> {
        admission::check(ctl)?;
        let points=if self.mixer||matches!(self.work.effect,Effect::Replacement{..}) {photocraft_engine::brush_cmds::parse_points(params,"retouch feedback").map_err(|error|error.to_string())?}else{samples(params)?};
        self.budget=self.budget.next(&points,&self.brush,ctl)?;
        let (mut stable,mut dual)=(Vec::new(),Vec::new());self.generator.push(&points,&mut stable,&mut dual);
        let mut ending=self.generator.clone();let (mut tail,mut tail_dual)=(Vec::new(),Vec::new());ending.finish(&mut tail,&mut tail_dual);
        #[cfg(test)]{self.samples_pushed+=points.len();}
        self.stable_bounds=admission::bounds(&self.ctx,&stable,false,self.stable_bounds)?;
        let bounds=admission::bounds(&self.ctx,&tail,false,self.stable_bounds)?;
        if bounds.is_empty(){return Ok(());}
        let area=bounds.inflate(self.halo);
        admission::area(area)?;admission::check(ctl)?;
        let mut next_tail=super::sparse::Keys::new();let mut dirty=self.tail_keys.clone();
        super::sparse::mark(&self.ctx,&stable,false,&mut dirty);super::sparse::mark(&self.ctx,&tail,false,&mut next_tail);dirty.extend(next_tail.iter().copied());
        self.work.grow(area)?;
        for dab in &stable {admission::check(ctl)?;let footprint=self.ctx.footprint(dab,self.stable_count);self.work.dab(&self.original,&self.source,&footprint,self.halo,self.brush.spacing,self.locked,ctl)?;self.stable_count+=1;#[cfg(test)]{self.stable_dabs_applied+=1;}}
        // Provisional end dabs use a disposable working state; opacity never
        // feeds back into retained pixels and a later sample cannot repeat the tail.
        let mut preview=self.work.clone();
        for (index,dab) in tail.iter().enumerate(){admission::check(ctl)?;let footprint=self.ctx.footprint(dab,self.stable_count+index);preview.dab(&self.original,&self.source,&footprint,self.halo,self.brush.spacing,self.locked,ctl)?;}
        if let (Effect::Mixer(carry),Some(state))=(&preview.effect,&mut self.mixer_after){*state=carry.final_state(&self.original.format(),state.clone(),self.clean_after);}
        let mut document=(*self.document).clone();let (surface,_)=self.target.surface(&mut document)?;let n=surface.channels();let a=alpha_index(&surface.format());
        for rect in super::sparse::publication(self.damage,bounds,&dirty) {
            admission::check(ctl)?;
            let original=self.original.read_region(rect);surface.write_region(rect,&original);
            let visible=rect.intersect(&bounds);
            if !visible.is_empty(){
                let work=preview.published(visible,&self.original,ctl)?;let mut out=Region::read(&self.original,visible);
                for y in visible.y0..visible.y1 {admission::check(ctl)?;for x in visible.x0..visible.x1 {let k=self.brush.opacity.clamp(0.0,1.0)*self.source.selection.as_ref().map_or(1.0,|selection|selection.sample_channel(x,y,0));if k<=0.0{continue;}let pixels=work.px(x,y);let target=out.px_mut(x,y);match a {Some(a) if !self.locked=>mix_premultiplied(target,pixels,a,k),_=>{for c in 0..n {if self.locked&&Some(c)==a{continue;}target[c]+=(pixels[c]-target[c])*k;}}}}}
                out.write(surface);
                #[cfg(test)]{let count=visible.width() as usize*visible.height() as usize;self.output_pixels+=count;self.output_peak_pixels=self.output_peak_pixels.max(count);}
            }
            if let Some(channel)=self.restriction{let mut pixels=surface.read_region(rect);for(new,old)in pixels.chunks_exact_mut(n).zip(original.chunks_exact(n)){for c in 0..n{if c!=channel{new[c]=old[c];}}}surface.write_region(rect,&pixels);}
        }
        if self.restriction.is_some(){surface.prune();}
        admission::check(ctl)?;self.document=Arc::new(document);self.damage=bounds;self.tail_keys=next_tail;Ok(())
    }
}
impl Effect {
    fn dab(&mut self,pre:&Surface,work:&mut Region,fp:&Footprint,spacing:f32,locked:bool){let fmt=pre.format();match self {
        Self::Tone{range,exposure,burn,protect}=>color_dab(&fmt,work,fp,*exposure,spacing,|color,k|dodge_burn(color,k,*range,*burn,*protect)),
        Self::Sponge{saturate,vibrance}=>color_dab(&fmt,work,fp,0.5,spacing,|color,k|sponge(color,k,*saturate,*vibrance)),
        Self::Focus{sharpen,strength,sigma,protect}=>focus_dab(&fmt,work,fp,spacing,*sharpen,*strength,*sigma,*protect),
        Self::Mixer(mixer)=>mixer.dab(&fmt,work,fp,locked),
        Self::Replacement{settings,once}=>replacement_dab(&fmt,pre,work,fp,settings,once),
    }}
}
fn focus_dab(fmt:&PixelFormat,work:&mut Region,fp:&Footprint,spacing:f32,sharpen:bool,strength:f32,sigma:f32,protect:bool){
    let r=fp.rect.intersect(&work.rect);if r.is_empty(){return;}let (w,h,n)=(work.width(),work.height(),work.ch);let win=((r.x0-work.rect.x0) as usize,(r.y0-work.rect.y0) as usize,(r.x1-work.rect.x0) as usize,(r.y1-work.rect.y0) as usize);let out=if sharpen{local_sharpen(&work.data,w,h,n,alpha_index(fmt),win,1.0,protect)}else{local_blur(&work.data,w,h,n,alpha_index(fmt),win,sigma)};let rw=r.width() as usize;
    for y in r.y0..r.y1 {for x in r.x0..r.x1 {let k=per_dab(fp.at(x,y)*strength,spacing);if k<=0.0{continue;}let index=((y-r.y0) as usize*rw+(x-r.x0) as usize)*n;let pixels=work.px_mut(x,y);for c in 0..n{pixels[c]+=(out[index+c]-pixels[c])*k;}}}
}
fn per_dab(e: f32, spacing: f32) -> f32 {
    1.0 - (1.0 - e.clamp(0.0, 1.0)).powf(spacing.clamp(0.01, 1.0))
}

fn color_dab(fmt: &PixelFormat, work: &mut Region, fp: &Footprint, strength: f32, spacing: f32, f: impl Fn([f32; 3], f32) -> [f32; 3]) {
    let r = fp.rect.intersect(&work.rect);
    let n = fmt.channels();
    let mut enc = [0.0f32; 8];
    for y in r.y0..r.y1 {
        for x in r.x0..r.x1 {
            let k = per_dab(fp.at(x, y) * strength, spacing);
            if k <= 0.0 {
                continue;
            }
            let px = work.px_mut(x, y);
            let rgba = to_rgba(fmt, px);
            let o = f([rgba[0], rgba[1], rgba[2]], k);
            from_rgba_into(fmt, [o[0], o[1], o[2], rgba[3]], &mut enc);
            let a = alpha_index(fmt);
            for c in 0..n {
                if Some(c) != a {
                    px[c] = enc[c];
                }
            }
        }
    }
}

fn lum(c: [f32; 3]) -> f32 {
    0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
}

fn clip_color(c: [f32; 3]) -> [f32; 3] {
    let l = lum(c);
    let n = c[0].min(c[1]).min(c[2]);
    let x = c[0].max(c[1]).max(c[2]);
    let mut out = c;
    if n < 0.0 {
        let d = l - n;
        for v in &mut out {
            *v = if d.abs() < 1e-12 { l } else { l + (*v - l) * l / d };
        }
    }
    if x > 1.0 {
        let d = x - l;
        for v in &mut out {
            *v = if d.abs() < 1e-12 { l } else { l + (*v - l) * (1.0 - l) / d };
        }
    }
    out
}

fn set_lum(c: [f32; 3], l: f32) -> [f32; 3] {
    let d = l - lum(c);
    clip_color([c[0] + d, c[1] + d, c[2] + d])
}

fn sat(c: [f32; 3]) -> f32 {
    c[0].max(c[1]).max(c[2]) - c[0].min(c[1]).min(c[2])
}

fn set_sat(c: [f32; 3], s: f32) -> [f32; 3] {
    let mut idx = [0usize, 1, 2];
    idx.sort_by(|&a, &b| c[a].partial_cmp(&c[b]).unwrap_or(std::cmp::Ordering::Equal));
    let (imin, imid, imax) = (idx[0], idx[1], idx[2]);
    let mut out = [0.0f32; 3];
    if c[imax] > c[imin] {
        out[imid] = (c[imid] - c[imin]) * s / (c[imax] - c[imin]);
        out[imax] = s;
    }
    out[imin] = 0.0;
    out
}
fn blend_replacement(mode:ReplaceMode,cb:[f32;3],cs:[f32;3])->[f32;3]{match mode{ReplaceMode::Hue=>set_lum(set_sat(cs,sat(cb)),lum(cb)),ReplaceMode::Saturation=>set_lum(set_sat(cb,sat(cs)),lum(cb)),ReplaceMode::Color=>set_lum(cs,lum(cb)),ReplaceMode::Luminosity=>set_lum(cb,lum(cs))}}


fn replacement_dab(fmt:&PixelFormat,pre:&Surface,work:&mut Region,fp:&Footprint,rs:&ReplaceSettings,once:&mut Option<[f32;3]>) {
    let n=fmt.channels();let fg=[rs.color[0],rs.color[1],rs.color[2]];let tol=rs.tolerance.clamp(0.0,1.0);let soft=rs.anti_alias&&rs.limits!=Limits::FindEdges;let match_w=|d:f32|if d>tol{0.0}else if soft&&tol>0.0{((tol-d)/(tol*0.25)).clamp(0.0,1.0)}else{1.0};
        let (cx, cy) = (fp.dab.center.x.floor() as i32, fp.dab.center.y.floor() as i32);
        let sampled = match rs.sampling {
            Sampling::Continuous => {
                let c = pre.rgba(cx, cy);
                [c[0], c[1], c[2]]
            }
            Sampling::Once => *once.get_or_insert_with(|| {
                let c = pre.rgba(cx, cy);
                [c[0], c[1], c[2]]
            }),
            Sampling::BackgroundSwatch => [rs.background[0], rs.background[1], rs.background[2]],
        };
        let r = fp.rect.intersect(&work.rect);
        if r.is_empty() {
            return;
        }
        let (w, h) = (r.width() as usize, r.height() as usize);
        // Per-pixel match weight.
        let mut weight = vec![0.0f32; w * h];
        for y in r.y0..r.y1 {
            for x in r.x0..r.x1 {
                if fp.at(x, y) <= 0.0 {
                    continue;
                }
                // Match against the pre-stroke colours, so pixels recoloured by earlier dabs of
                // this stroke still count as the sampled colour.
                let c = pre.rgba(x, y);
                if c[3] <= 0.0 {
                    continue;
                }
                weight[(y - r.y0) as usize * w + (x - r.x0) as usize] = match_w(dist(&c, sampled));
            }
        }
        if rs.limits != Limits::Discontiguous {
            // Keep only the region connected to the centre (4-connected flood fill).
            let mut keep = vec![false; w * h];
            let start = (cx.clamp(r.x0, r.x1 - 1), cy.clamp(r.y0, r.y1 - 1));
            let si = (start.1 - r.y0) as usize * w + (start.0 - r.x0) as usize;
            if weight[si] > 0.0 {
                let mut stack = vec![si];
                keep[si] = true;
                while let Some(i) = stack.pop() {
                    let (x, y) = (i % w, i / w);
                    let mut nb = |j: usize| {
                        if !keep[j] && weight[j] > 0.0 {
                            keep[j] = true;
                            stack.push(j);
                        }
                    };
                    if x > 0 {
                        nb(i - 1);
                    }
                    if x + 1 < w {
                        nb(i + 1);
                    }
                    if y > 0 {
                        nb(i - w);
                    }
                    if y + 1 < h {
                        nb(i + w);
                    }
                }
            }
            for (wv, k) in weight.iter_mut().zip(&keep) {
                if !k {
                    *wv = 0.0;
                }
            }
        }
        let mut enc = [0.0f32; 8];
        for y in r.y0..r.y1 {
            for x in r.x0..r.x1 {
                let k = fp.at(x, y) * weight[(y - r.y0) as usize * w + (x - r.x0) as usize];
                if k <= 0.0 {
                    continue;
                }
                let px = work.px_mut(x, y);
                let c = to_rgba(&fmt, px);
                let b = blend_replacement(rs.mode, [c[0], c[1], c[2]], fg);
                let o = [c[0] + (b[0] - c[0]) * k, c[1] + (b[1] - c[1]) * k, c[2] + (b[2] - c[2]) * k, c[3]];
                from_rgba_into(&fmt, o, &mut enc);
                px.copy_from_slice(&enc[..n]);
            }
        }
}
fn dist(a: &[f32; 4], b: [f32; 3]) -> f32 {
    (a[0] - b[0]).abs().max((a[1] - b[1]).abs()).max((a[2] - b[2]).abs())
}

impl MixerCarry {
    fn final_state(&self,fmt:&PixelFormat,mut state:MixerState,clean:bool)->MixerState{state.amount=self.amount;state.pickup=self.pickup.as_ref().map(|pickup|to_rgba(fmt,pickup));if clean{state.clean();}state}
    fn dab(&mut self,fmt:&PixelFormat,work:&mut Region,fp:&Footprint,lock_transparency:bool) {
        let n=fmt.channels();let a=alpha_index(fmt);let nc=fmt.mode.color_channels();let m=&self.settings;let (wet,mix,flow,load)=(m.wet.clamp(0.0,1.0),m.mix.clamp(0.0,1.0),m.flow.clamp(0.0,1.0),m.load.clamp(0.0,1.0));let res=&self.reservoir;let amount=&mut self.amount;let pickup=&mut self.pickup;let sample=self.sample.as_ref();let mut acc=vec![0.0f32;n];let mut paint=vec![0.0f32;n];
        // Transfer › Wetness / Mix Jitter scale the settings per dab.
        let (wet, mix) = (wet * fp.dab.wet.clamp(0.0, 1.0), mix * fp.dab.mix.clamp(0.0, 1.0));
        // Sample the canvas under the dab.
        acc.iter_mut().for_each(|v| *v = 0.0);
        let (mut wsum, mut asum) = (0.0f32, 0.0f32);
        let r = fp.rect.intersect(&work.rect);
        for y in r.y0..r.y1 {
            for x in r.x0..r.x1 {
                let w = fp.at(x, y);
                if w <= 0.0 {
                    continue;
                }
                let px: Vec<f32> = match sample {
                    Some(s) => {
                        let v = s.pixel(x, y);
                        if s.format() == *fmt { v } else { from_rgba(&fmt, s.rgba(x, y)) }
                    }
                    None => work.px(x, y).to_vec(),
                };
                let al = a.map_or(1.0, |ai| px[ai]);
                for c in 0..nc {
                    acc[c] += px[c] * w * al;
                }
                wsum += w;
                asum += w * al;
            }
        }
        if asum > 1e-6 && wet > 0.0 {
            let ca = asum / wsum.max(1e-6);
            let canvas: Vec<f32> = (0..n).map(|c| if c < nc { acc[c] / asum } else { 1.0 }).collect();
            *pickup = Some(match pickup.take() {
                None => canvas,
                Some(p) => p.iter().zip(&canvas).map(|(p, c)| p + (c - p) * PICKUP_RATE * wet * ca).collect(),
            });
        }
        let wr = if res.is_some() { *amount * (1.0 - mix * wet) } else { 0.0 };
        let wp = if pickup.is_some() { mix * wet } else { 0.0 };
        let total = wr + wp;
        if total > 1e-6 {
            for c in 0..n {
                let rv = res.as_ref().map_or(0.0, |v| v[c]);
                let pv = pickup.as_ref().map_or(0.0, |v| v[c]);
                paint[c] = (rv * wr + pv * wp) / total;
            }
            let dep = total.min(1.0) * flow;
            for y in r.y0..r.y1 {
                for x in r.x0..r.x1 {
                    let k = fp.at(x, y) * dep;
                    if k > 0.0 {
                        over_native(&fmt, work.px_mut(x, y), &paint, k, lock_transparency);
                    }
                }
            }
        }
        *amount *= 1.0 - 0.08 * (1.0 - load);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture(depth:u64,mode:&str)->Session{
        let mut engine=Session::new();engine.execute("file.new",json!({"width":48,"height":48,"depth":depth,"mode":mode,"background":"#805040"})).unwrap();engine.execute("paint.stroke",json!({"points":[[5,8],[39,8],[39,32],[5,32]],"size":8,"color":"#20b0c0","seed":71})).unwrap();engine
    }
    fn params(command:&str)->Value {
        let mut value=json!({"points":[[12,16,0.2]],"size":7,"opacity":65,"hardness":50,"flow":70,"spacing":20,"seed":511,"strength":55});
        if matches!(command,"paint.mixerBrush"|"paint.colorReplacement"){value["opacity"]=json!(0.65);value["hardness"]=json!(0.5);value["spacing"]=json!(0.2);value["flow"]=json!(0.7);value["color"]=json!("#e01080");}
        if command=="paint.mixerBrush"{value["wet"]=json!(60);value["mix"]=json!(70);value["flow"]=json!(80);value["load"]=json!(35);}
        value
    }
    fn isolated(engine:&Session)->Session{let mut result=Session::new();let state=engine.active().unwrap().clone();result.add_document((*state.doc).clone(),None);*result.active_mut().unwrap()=state;result.tools=engine.tools.clone();result.presets=engine.presets.clone();result}
    fn pixels(engine:&Session,doc:&Document,params:&Value,command:&str)->Vec<f32>{let (target,_,_)=routing(engine,params,command=="paint.colorReplacement").unwrap();let mut doc=doc.clone();let (surface,_)=target.surface(&mut doc).unwrap();surface.read_region(Rect::new(-4,-4,52,52))}
    fn wide_fixture(depth:u64,mode:&str,size:u32)->Session{let mut engine=Session::new();engine.execute("file.new",json!({"width":size,"height":size,"depth":depth,"mode":mode,"background":"#805040"})).unwrap();engine.execute("paint.stroke",json!({"points":[[5,25],[180,85],[280,180]],"size":23,"color":"#20b0c0","seed":31})).unwrap();engine}
    fn check_wide(engine:&Session,live:&SequentialStroke,command:&str,p:&Value){let mut expected=isolated(engine);expected.execute(command,p.clone()).unwrap();let rect=engine.active().unwrap().doc.bounds().union(&live.damage).inflate(4);let(target,_,_)=routing(engine,p,command=="paint.colorReplacement").unwrap();let(mut actual,mut native)=((*live.document).clone(),(*expected.active().unwrap().doc).clone());let a=target.surface(&mut actual).unwrap().0.read_region(rect);let b=target.surface(&mut native).unwrap().0.read_region(rect);assert_eq!(live.damage,expected.active().unwrap().last_damage.unwrap());assert_eq!(a.len(),b.len());assert!(a.iter().zip(&b).all(|(a,b)|a==b),"{command}: first mismatch {:?}",a.iter().zip(&b).enumerate().find(|(_, (a,b))|a!=b));if command=="paint.mixerBrush"{assert_eq!(serde_json::to_value(&live.mixer_after).unwrap(),serde_json::to_value(Some(&expected.tools.mixer)).unwrap());}}
    #[test]
    fn tiled_sequential_wide_prefixes_match_native_depths_models_and_source_layers(){
        let all=json!([[12,16,0.2],[78,35,0.8],[150,90,0.4],[100,170,1.0]]);
        for command in TOOLS{for(depth,mode)in [(8,"rgb"),(16,"gray"),(32,"cmyk"),(16,"lab")]{
            let mut engine=wide_fixture(depth,mode,192);engine.tools.brush.noise=true;engine.tools.brush.wet_edges=true;engine.tools.brush.scattering.enabled=true;engine.tools.brush.scattering.count=2;
            if matches!(command,"paint.blur"|"paint.sharpen"|"paint.mixerBrush"){engine.execute("layer.new.layer",json!({"name":"Tiled target"})).unwrap();engine.execute("paint.stroke",json!({"points":[[7,60],[170,60]],"size":15,"color":"#e04090"})).unwrap();}
            engine.execute("select.rect",json!({"x":8,"y":12,"width":160,"height":160,"feather":3})).unwrap();let before=engine.active().unwrap().doc.clone();let mut p=params(command);p["size"]=json!(11);p["sampleAllLayers"]=json!(true);p["cleanAfterStroke"]=json!(false);p["loadAfterStroke"]=json!(false);let mut live=SequentialStroke::begin(&engine,command,&p).unwrap();
            for count in 1..=4{p["points"]=json!([all[count-1]]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);check_wide(&engine,&live,command,&full);}
            assert!(live.output_peak_pixels<=4096);assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc));
        }}
    }
    #[test]
    fn tiled_sequential_contracting_tails_and_channel_targets_match_native(){
        let all=json!([[12,16,1],[190,16,0.9],[35,16,0.2],[20,80,0.8],[270,80,0.4]]);
        for command in TOOLS{for kind in ["pixels","mask","alpha","quickMask","red","locked"]{
            if command=="paint.colorReplacement"&&!matches!(kind,"pixels"|"red"){continue;}
            let mut engine=wide_fixture(16,"rgb",320);let mut p=params(command);
            match kind{"mask"=>{engine.execute("layer.layerMask.revealAll",json!({})).unwrap();p["target"]=json!("mask");},"alpha"=>{engine.execute("channel.new",json!({"name":"Tiled alpha"})).unwrap();p["target"]=json!({"channel":0});},"quickMask"=>{engine.execute("select.editInQuickMaskMode",json!({})).unwrap();p["target"]=json!("quickMask");},"red"=>{engine.execute("channel.target",json!({"channel":"red"})).unwrap();},"locked"=>{let state=engine.active_mut().unwrap();let id=state.active_layer.unwrap();Arc::make_mut(&mut state.doc).layer_mut(id).unwrap().locks.transparency=true;},_=>{}}
            engine.tools.brush.smoothing.amount=0.8;engine.tools.brush.smoothing.pulled_string=true;engine.tools.brush.smoothing.catch_up_on_end=true;let mut live=SequentialStroke::begin(&engine,command,&p).unwrap();let mut prior=Rect::EMPTY;let mut contracted=false;
            for count in 1..=5{p["points"]=json!([all[count-1]]);live.push(&p).unwrap();contracted|=live.damage.x1<prior.x1;prior=live.damage;let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);check_wide(&engine,&live,command,&full);}
            assert!(contracted,"{command}/{kind}");assert!(live.output_peak_pixels<=4096);
        }}
    }
    #[test]
    fn tiled_sequential_small_delta_avoids_accumulated_working_and_output_arrays(){
        for command in TOOLS{
            let mut engine=wide_fixture(8,"rgb",1000);engine.tools.brush.smoothing.amount=0.0;let mut p=params(command);p["points"]=json!([[64,64],[900,900]]);p["sampleAllLayers"]=json!(true);let mut live=SequentialStroke::begin(&engine,command,&p).unwrap();live.push(&p).unwrap();let output=live.output_pixels;let prior_area=u64::from(live.damage.width())*u64::from(live.damage.height());
            p["points"]=json!([[904,904],[908,908]]);live.push(&p).unwrap();let delta=live.output_pixels-output;let accumulated=u64::from(live.damage.width())*u64::from(live.damage.height());
            assert!(live.work.peak_region_pixels<=4096);assert!(live.output_peak_pixels<=4096);assert!(delta as u64<=4*4096+accumulated-prior_area);assert!((delta as u64)*32<accumulated);p["points"]=json!([[64,64],[900,900],[904,904],[908,908]]);check_wide(&engine,&live,command,&p);
            eprintln!("tiled-retouch-work tool={command} accumulated_pixels={accumulated} delta_output_pixels={delta} peak_stable_roi_pixels={} peak_output_patch_pixels={}",live.work.peak_region_pixels,live.output_peak_pixels);
        }
    }
    #[test]
    fn cancellation_inside_tiled_sequential_work_keeps_previous_publication(){
        use std::sync::atomic::{AtomicUsize,Ordering};
        for command in TOOLS{let engine=wide_fixture(16,"rgb",320);let before=engine.active().unwrap().doc.clone();let mut p=params(command);p["points"]=json!([[12,16],[75,80]]);let mut live=SequentialStroke::begin(&engine,command,&p).unwrap();live.push(&p).unwrap();let previous=live.document.clone();let damage=live.damage;let applied=live.stable_dabs_applied;p["points"]=json!([[270,245]]);let calls=AtomicUsize::new(0);let stop=||calls.fetch_add(1,Ordering::Relaxed)>=100;assert!(live.push_with(&p,&Interrupt::cancel_only(&stop)).unwrap_err().contains("canceled"));assert!(live.stable_dabs_applied>applied);assert!(Arc::ptr_eq(&previous,&live.document));assert_eq!(live.damage,damage);assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc));}
    }
    #[test]
    fn every_sequential_tool_matches_native_at_every_prefix_depth_and_color_model(){
        let points=json!([[12,16,0.2],[21,20,0.8],[32,16,0.4],[18,28,0.7]]);
        for command in TOOLS{for depth in [8,16,32]{for mode in ["rgb","gray","cmyk","lab"]{
            let engine=fixture(depth,mode);let before=engine.active().unwrap().doc.clone();let mut p=params(command);let mut live=SequentialStroke::begin(&engine,command,&p).unwrap();
            for count in 1..=4{p["points"]=json!([points[count-1].clone()]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(points.as_array().unwrap()[..count]);let mut expected=isolated(&engine);expected.execute(command,full.clone()).unwrap();assert_eq!(pixels(&engine,&live.document,&full,command),pixels(&expected,&expected.active().unwrap().doc,&full,command),"{command}/{depth}/{mode}/prefix{count}");assert_eq!(live.damage,expected.active().unwrap().last_damage.unwrap());}
            assert_eq!(live.samples_pushed,4);assert_eq!(live.stable_dabs_applied,live.stable_count);assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc));
        }}}
    }
    #[test]
    fn sequential_masks_channels_quick_mask_single_colors_and_selection_match_native(){
        for command in TOOLS{for kind in ["pixels","mask","implicit-mask","alpha","quickMask","red"]{
            if command=="paint.colorReplacement"&&kind!="pixels"&&kind!="red"{continue;}
            let mut engine=fixture(16,"rgb");let mut p=params(command);
            match kind{"mask"|"implicit-mask"=>{engine.execute("layer.layerMask.revealAll",json!({})).unwrap();if kind=="mask"{p["target"]=json!("mask");}else{engine.execute("view.layerMask",json!({"mode":"gray"})).unwrap();}},"alpha"=>{engine.execute("channel.new",json!({"name":"Retouch channel"})).unwrap();engine.execute("channel.target",json!({"channel":0})).unwrap();p["target"]=json!({"channel":0});},"quickMask"=>{engine.execute("select.editInQuickMaskMode",json!({})).unwrap();},"red"=>{engine.execute("channel.target",json!({"channel":"red"})).unwrap();},_=>{}}
            let mut stripe=json!({"points":[[5,8],[39,8]],"size":7,"color":"#202020","seed":72});if let Some(target)=p.get("target"){stripe["target"]=target.clone();}engine.execute("paint.stroke",stripe).unwrap();engine.execute("select.rect",json!({"x":10,"y":12,"width":20,"height":18,"feather":2})).unwrap();
            let before=engine.active().unwrap().doc.clone();let tools=serde_json::to_value(&engine.tools.mixer).unwrap();let mut live=SequentialStroke::begin(&engine,command,&p).unwrap();live.push(&p).unwrap();let mut more=p.clone();more["points"]=json!([[27,23,0.8],[16,29,0.5]]);live.push(&more).unwrap();p["points"]=json!([[12,16,0.2],[27,23,0.8],[16,29,0.5]]);let mut expected=isolated(&engine);expected.execute(command,p.clone()).unwrap();assert_eq!(pixels(&engine,&live.document,&p,command),pixels(&expected,&expected.active().unwrap().doc,&p,command),"{command}/{kind}");assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc));assert_eq!(serde_json::to_value(&engine.tools.mixer).unwrap(),tools);
        }}
    }
    #[test]
    fn focus_and_mixer_sample_all_layers_preserve_working_pixels_as_bounds_expand(){
        for command in ["paint.blur","paint.sharpen","paint.mixerBrush"]{for depth in [8,16,32]{
            let mut engine=fixture(depth,"rgb");engine.execute("layer.new.layer",json!({"name":"Retouch above"})).unwrap();engine.tools.brush.smoothing.amount=0.6;let mut p=params(command);p["sampleAllLayers"]=json!(true);if command=="paint.mixerBrush"{p["loadAfterStroke"]=json!(false);engine.tools.mixer.reservoir=Some([0.8,0.1,0.2,0.6]);engine.tools.mixer.amount=0.35;engine.tools.mixer.pickup=Some([0.1,0.3,0.8,0.7]);}
            let all=json!([[12,16,0.2],[30,18,0.8],[25,32,0.4],[8,24,0.7]]);let mut live=SequentialStroke::begin(&engine,command,&p).unwrap();for count in 1..=4{p["points"]=json!([all[count-1].clone()]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);let mut expected=isolated(&engine);expected.execute(command,full.clone()).unwrap();assert_eq!(pixels(&engine,&live.document,&full,command),pixels(&expected,&expected.active().unwrap().doc,&full,command),"{command}/{depth}/prefix{count}");}
        }}
    }
    #[test]
    fn replacement_sampling_limits_and_modes_keep_pre_stroke_colors_and_once_state(){
        for mode in ["hue","saturation","color","luminosity"]{for sampling in ["continuous","once","backgroundSwatch"]{for limits in ["contiguous","discontiguous","findEdges"]{
            let mut engine=fixture(32,"rgb");engine.tools.background=[0.5,0.3,0.25,1.0];let mut p=params("paint.colorReplacement");p["mode"]=json!(mode);p["sampling"]=json!(sampling);p["limits"]=json!(limits);p["tolerance"]=json!(90);let all=json!([[12,16,0.4],[31,18,0.9],[20,28,0.5]]);let mut live=SequentialStroke::begin(&engine,"paint.colorReplacement",&p).unwrap();for count in 1..=3{p["points"]=json!([all[count-1].clone()]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);let mut expected=isolated(&engine);expected.execute("paint.colorReplacement",full.clone()).unwrap();assert_eq!(pixels(&engine,&live.document,&full,"paint.colorReplacement"),pixels(&expected,&expected.active().unwrap().doc,&full,"paint.colorReplacement"),"{mode}/{sampling}/{limits}/prefix{count}");}
        }}}
    }
    #[test]
    fn stable_dabs_are_applied_once_while_end_tails_are_replaced_and_opacity_stays_isolated(){
        for command in TOOLS {
            let mut engine=fixture(32,"rgb");engine.tools.brush.smoothing.amount=0.7;engine.tools.brush.noise=true;let mut p=params(command);let all=json!([[12,16,0.2],[21,20,0.8],[32,16,0.4],[18,28,0.7]]);let mut live=SequentialStroke::begin(&engine,command,&p).unwrap();
            for count in 1..=4{p["points"]=json!([all[count-1].clone()]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);let mut expected=isolated(&engine);expected.execute(command,full.clone()).unwrap();assert_eq!(pixels(&engine,&live.document,&full,command),pixels(&expected,&expected.active().unwrap().doc,&full,command),"{command}/prefix{count}");}
            let mut parsed=p.clone();parsed["points"]=all;let pts=if command=="paint.mixerBrush"||command=="paint.colorReplacement"{photocraft_engine::brush_cmds::parse_points(&parsed,command).unwrap()}else{samples(&parsed).unwrap()};let mut generator=DabGenerator::new(&live.brush,1.0);let(mut primary,mut dual)=(Vec::new(),Vec::new());generator.push(&pts,&mut primary,&mut dual);assert_eq!(live.stable_dabs_applied,primary.len());assert_eq!(live.stable_dabs_applied,live.stable_count);assert_eq!(live.samples_pushed,4);
        }
    }
    #[test]
    fn transparent_negative_and_zero_pressure_prefixes_match_native_with_transparency_locks(){
        let all=json!([[-2,-1,0],[3,5,0.2],[21,20,0.8],[-3,25,1],[8,-2,0.4]]);
        for command in TOOLS{for depth in [8,16,32]{for locked in [false,true]{
            let mut engine=Session::new();engine.execute("file.new",json!({"width":48,"height":48,"depth":depth,"background":"transparent"})).unwrap();engine.execute("paint.stroke",json!({"points":[[5,8],[39,8],[39,32]],"size":8,"color":"#20b0c0","opacity":0.4,"seed":71})).unwrap();
            let state=engine.active_mut().unwrap();let id=state.active_layer.unwrap();Arc::make_mut(&mut state.doc).layer_mut(id).unwrap().locks.transparency=locked;
            let before=engine.active().unwrap().doc.clone();let mut p=params(command);let mut live=SequentialStroke::begin(&engine,command,&p).unwrap();
            for count in 1..=5{p["points"]=json!([all[count-1].clone()]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);let mut expected=isolated(&engine);expected.execute(command,full.clone()).unwrap();assert_eq!(pixels(&engine,&live.document,&full,command),pixels(&expected,&expected.active().unwrap().doc,&full,command),"{command}/{depth}/locked{locked}/prefix{count}");assert_eq!(live.damage,expected.active().unwrap().last_damage.unwrap());}
            assert!(Arc::ptr_eq(&before,&engine.active().unwrap().doc));
        }}}
    }
    #[test]
    fn timed_pose_scattering_dual_and_tool_options_match_native_across_batches(){
        let all=json!([[12,16,0.2,35,-20,15,0,0.3],[21,20,0.8,10,30,75,320,0.7],[32,16,0.4,-25,15,120,960,0.4],[18,28,0.7,45,20,210,1440,0.8]]);
        for command in TOOLS{for spaced in [false,true]{
            let mut engine=fixture(32,"rgb");let brush=&mut engine.tools.brush;brush.smoothing.amount=0.6;brush.smoothing.catch_up=true;brush.noise=true;brush.wet_edges=true;brush.build_up=true;brush.build_up_rate=20.0;brush.spacing_enabled=spaced;brush.scattering.enabled=true;brush.scattering.count=3;brush.dual_brush.enabled=true;brush.dual_brush.size=3.0;brush.dual_brush.count=2;brush.pose.enabled=true;brush.pose.override_rotation=true;brush.pose.rotation=45.0;brush.shape_dynamics.enabled=true;brush.shape_dynamics.brush_projection=true;brush.shape_dynamics.size.minimum=0.15;brush.shape_dynamics.size.control=photocraft_engine::paint::brush::Control::PenPressure;
            let mut p=params(command);p["range"]=json!("highlights");p["protectTones"]=json!(false);p["protectDetail"]=json!(false);if command=="paint.sponge"{p["mode"]=json!("saturate");p["vibrance"]=json!(false);}let mut live=SequentialStroke::begin(&engine,command,&p).unwrap();
            for count in 1..=4{p["points"]=json!([all[count-1].clone()]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);let mut expected=isolated(&engine);expected.execute(command,full.clone()).unwrap();assert_eq!(pixels(&engine,&live.document,&full,command),pixels(&expected,&expected.active().unwrap().doc,&full,command),"{command}/spaced{spaced}/prefix{count}");assert_eq!(live.damage,expected.active().unwrap().last_damage.unwrap());}
        }}
    }
    #[test]
    fn transparent_float_bounds_between_dabs_match_native_for_every_sequential_tool(){
        let all=json!([[12,16],[160,140],[75,230]]);
        for command in TOOLS{
            let mut engine=Session::new();engine.execute("file.new",json!({"width":256,"height":256,"depth":32,"mode":"rgb","background":"transparent"})).unwrap();
            let state=engine.active_mut().unwrap();let id=state.active_layer.unwrap();let surface=Arc::make_mut(&mut state.doc).layer_mut(id).unwrap().surface_mut().unwrap();let fmt=surface.format();let mut values=Vec::new();
            for y in 0..256{for x in 0..256{values.extend(from_rgba(&fmt,[0.03+(x%7) as f32*0.11,0.08+(y%5) as f32*0.15,0.12+((x+y)%11) as f32*0.06,((x+y)%9) as f32*0.1]));}}surface.write_region(Rect::new(0,0,256,256),&values);
            engine.tools.brush.smoothing.amount=0.0;let mut p=params(command);let mut live=SequentialStroke::begin(&engine,command,&p).unwrap();
            for count in 1..=3{p["points"]=json!([all[count-1]]);live.push(&p).unwrap();let mut full=p.clone();full["points"]=json!(all.as_array().unwrap()[..count]);check_wide(&engine,&live,command,&full);}
        }
    }
    #[test]
    fn excessive_path_and_airbrush_time_are_rejected_before_dab_allocation_or_carry_changes(){
        for timed in [false,true]{
            let mut engine=fixture(32,"rgb");engine.tools.brush.build_up=timed;engine.tools.brush.build_up_rate=1000.0;
            let mut p=params("paint.mixerBrush");let mut live=SequentialStroke::begin(&engine,"paint.mixerBrush",&p).unwrap();let before=live.document.clone();let carry=serde_json::to_value(&engine.tools.mixer).unwrap();
            p["points"]=if timed{json!([[12,16,1,0,0,0,0],[12,16,1,0,0,0,2_000_000]])}else{json!((0..512).map(|index|vec![if index%2==0{0}else{2000},16,1]).collect::<Vec<_>>())};
            assert!(live.push(&p).unwrap_err().contains("dab budget"));assert_eq!(live.samples_pushed,0);assert_eq!(live.stable_count,0);assert!(Arc::ptr_eq(&before,&live.document));assert_eq!(serde_json::to_value(&engine.tools.mixer).unwrap(),carry);
            p["points"]=json!([[12,16,0.5]]);live.push(&p).unwrap();assert_eq!(live.samples_pushed,1);
        }
    }
}
