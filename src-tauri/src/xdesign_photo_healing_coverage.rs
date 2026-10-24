//! Native stable/tail coverage staged once over the complete solve region.
use super::{StrokeRenderer,Rect,sparse,admission,Interrupt};
use photocraft_engine::paint::render::COV_TILE;

pub(super) struct Coverage<'a> {
    stable:&'a StrokeRenderer,tail:Option<StrokeRenderer>,keys:&'a sparse::Keys,
    pub(super) bounds:Rect,
    #[cfg(test)] pub(super) dense_pixels:usize,
}
impl<'a> Coverage<'a> {
    pub(super) fn new(stable:&'a StrokeRenderer,keys:&'a sparse::Keys,ctl:&Interrupt)->Result<Self,String>{
        admission::check(ctl)?;let tail=stable.tail_preview();let bounds=tail.as_ref().map_or_else(||stable.bounds(),StrokeRenderer::bounds);admission::area(bounds)?;
        Ok(Self{stable,tail,keys,bounds,#[cfg(test)]dense_pixels:0})
    }
    pub(super) fn dense(&mut self,rect:Rect,ctl:&Interrupt)->Result<Vec<f32>,String>{
        admission::area(rect)?;admission::check(ctl)?;let mut out=Vec::with_capacity(rect.width() as usize*rect.height() as usize);
        for y in rect.y0..rect.y1{
            admission::check(ctl)?;
            for x in rect.x0..rect.x1{
                let value=if self.bounds.contains(x,y){let renderer=if self.keys.contains(&(x.div_euclid(COV_TILE),y.div_euclid(COV_TILE))){self.tail.as_ref().unwrap_or(self.stable)}else{self.stable};renderer.coverage_at(x,y)}else{0.0};out.push(value);
            }
        }
        #[cfg(test)]{self.dense_pixels+=out.len();}
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::{BrushSettings,paint::{StrokePoint,dynamics::DabGenerator}};
    #[test]
    fn native_coverage_bits_match_full_finish_with_dual_textures_and_contracting_tails(){
        for smooth in [false,true]{for per_tip in [false,true]{
            let mut brush=BrushSettings::default();brush.size=17.0;brush.seed=836;brush.noise=true;brush.wet_edges=true;brush.smoothing.amount=if smooth{0.8}else{0.0};brush.smoothing.pulled_string=smooth;brush.smoothing.catch_up_on_end=true;
            brush.dual_brush.enabled=true;brush.dual_brush.size=31.0;brush.dual_brush.count=3;brush.scattering.enabled=true;brush.scattering.count=2;brush.texture.enabled=true;brush.texture.each_tip=per_tip;brush.texture.scale=0.7;
            let mut renderer=StrokeRenderer::new(&brush,None,1.0);let mut generator=DabGenerator::new(&brush,1.0);
            for point in [StrokePoint::new(-15.0,16.0,0.2),StrokePoint::new(200.0,90.0,1.0),StrokePoint::new(40.0,16.0,0.4),StrokePoint::new(260.0,170.0,0.8)]{
                let(mut stable,mut dual)=(Vec::new(),Vec::new());generator.push(&[point],&mut stable,&mut dual);renderer.push(&[point]);let mut end=generator.clone();let(mut tail,mut tail_dual)=(Vec::new(),Vec::new());end.finish(&mut tail,&mut tail_dual);let mut keys=sparse::Keys::new();sparse::mark(&renderer.ctx,&tail,false,&mut keys);sparse::mark(&renderer.ctx,&tail_dual,true,&mut keys);
                let mut native=renderer.clone();native.finish();let(bounds,dense)=native.dense_coverage();let mut view=Coverage::new(&renderer,&keys,&Interrupt::NONE).unwrap();assert_eq!(view.bounds,bounds);let rect=bounds.inflate(2);let actual=view.dense(rect,&Interrupt::NONE).unwrap();
                for y in rect.y0..rect.y1{for x in rect.x0..rect.x1{let expected=if bounds.contains(x,y){dense[(y-bounds.y0) as usize*bounds.width() as usize+(x-bounds.x0) as usize]}else{0.0};let value=actual[(y-rect.y0) as usize*rect.width() as usize+(x-rect.x0) as usize];assert_eq!(value.to_bits(),expected.to_bits(),"{smooth}/{per_tip}/{x}/{y}");}}
            }
        }}
    }
    #[test]
    fn coverage_staging_observes_cancellation_inside_rows(){
        use std::sync::atomic::{AtomicUsize,Ordering};
        let mut brush=BrushSettings::default();brush.size=8.0;let mut renderer=StrokeRenderer::new(&brush,None,1.0);renderer.push(&[StrokePoint::new(4.0,4.0,1.0),StrokePoint::new(190.0,190.0,1.0)]);let keys=sparse::Keys::new();let mut coverage=Coverage::new(&renderer,&keys,&Interrupt::NONE).unwrap();let calls=AtomicUsize::new(0);let stop=||calls.fetch_add(1,Ordering::Relaxed)>=10;assert!(coverage.dense(coverage.bounds,&Interrupt::cancel_only(&stop)).is_err());assert!(calls.load(Ordering::Relaxed)>10);
    }
}
