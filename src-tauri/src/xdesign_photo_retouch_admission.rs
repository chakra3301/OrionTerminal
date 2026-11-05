//! Admission before native retouch dab, coverage and region allocations.
use photocraft_engine::{BrushSettings, doc::Rect, paint::{BrushContext, Dab, StrokePoint, dynamics::Smoother}};
use photocraft_raster::Interrupt;

pub(super) fn check(ctl:&Interrupt)->Result<(),String>{ctl.check().map_err(|_|"The retouch feedback was canceled".into())}
pub(super) fn brush(brush:&BrushSettings)->Result<(),String>{
    if !brush.size.is_finite()||!(1.0..=4096.0).contains(&brush.size)
        ||brush.dual_brush.enabled&&(!brush.dual_brush.size.is_finite()||!(1.0..=4096.0).contains(&brush.dual_brush.size)){
        return Err("Retouch feedback size exceeds the preview bounds; finish the stroke for the full edit".into());
    }
    Ok(())
}
pub(super) fn area(rect:Rect)->Result<(),String>{
    let width=(i64::from(rect.x1)-i64::from(rect.x0)).max(0) as u64;
    let height=(i64::from(rect.y1)-i64::from(rect.y0)).max(0) as u64;
    if width.checked_mul(height).is_none_or(|pixels|pixels>16_777_216){return Err("Retouch working area exceeds 16 megapixels; finish the stroke for the full edit".into());}
    Ok(())
}
pub(super) fn bounds(ctx:&BrushContext,dabs:&[Dab],dual:bool,mut bounds:Rect)->Result<Rect,String>{
    for dab in dabs {
        if !dab.radius.is_finite()||dab.radius<0.0||dab.radius>4096.0
            ||!dab.center.x.is_finite()||!dab.center.y.is_finite()
            ||dab.center.x.abs()>100_000_000.0||dab.center.y.abs()>100_000_000.0{
            return Err("Retouch dab exceeds the preview bounds; finish the stroke for the full edit".into());
        }
        let rect=ctx.dab_rect(dab,dual);area(rect)?;bounds=bounds.union(&rect);
    }
    area(bounds)?;Ok(bounds)
}

#[derive(Clone)]
pub(super) struct DabBudget { smoother:Smoother,last:Option<StrokePoint>,steps:u64 }
impl DabBudget {
    pub(super) fn new(brush:&BrushSettings)->Self{Self{smoother:Smoother::new(&brush.smoothing,1.0),last:None,steps:0}}
    fn consume(&mut self,points:&[StrokePoint],brush:&BrushSettings){
        for point in points {
            let steps=self.last.map_or(1,|last|{
                let distance=(point.x-last.x).hypot(point.y-last.y);
                let path=if distance>1e-9{((distance/0.25).ceil() as u64).saturating_add(1)}else{0};
                let timed=if brush.build_up{(point.time-last.time).max(0.0)*f64::from(brush.build_up_rate.clamp(0.1,1000.0))/1000.0}else{0.0};
                path.saturating_add(timed.ceil() as u64)
            });
            self.steps=self.steps.saturating_add(steps);self.last=Some(*point);
        }
    }
    fn admit(&self,brush:&BrushSettings)->Result<(),String>{
        let tips=if brush.scattering.enabled{brush.scattering.count.clamp(1,16)}else{1}+if brush.dual_brush.enabled{brush.dual_brush.count.clamp(1,16)}else{0};
        // The native walker has a 0.25px minimum step. Include both tips and
        // disposable smoothing tails before asking it to allocate any dabs.
        if self.steps.saturating_mul(u64::from(tips))>1_048_576{return Err("Retouch feedback exceeds the dab budget; finish the stroke for the full edit".into());}
        Ok(())
    }
    pub(super) fn next(&self,points:&[StrokePoint],brush:&BrushSettings,ctl:&Interrupt)->Result<Self,String>{
        let mut next=self.clone();let mut output=Vec::new();
        for point in points {
            check(ctl)?;
            if !point.x.is_finite()||!point.y.is_finite()||point.x.abs()>1_000_000.0||point.y.abs()>1_000_000.0||!point.time.is_finite(){return Err("Invalid retouch position or timestamp".into());}
            output.clear();next.smoother.push(*point,&mut output);next.consume(&output,brush);next.admit(brush)?;
        }
        let mut ending=next.clone();output.clear();ending.smoother.finish(&mut output);ending.consume(&output,brush);ending.admit(brush)?;
        Ok(next)
    }
}
