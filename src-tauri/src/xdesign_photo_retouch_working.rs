//! Copy-on-write float working tiles; native effects retain their dab/halo math.
use super::{Effect,Region,Footprint,Surface,Document,Rect,PixelFormat,SampleLayers,composite_region,admission,Interrupt};
use super::super::float_tiles::FloatTiles;
use std::collections::BTreeSet;

type Key=(i32,i32);
#[derive(Clone)]
pub(super) struct Working {
    pub(super) rect:Rect,pixels:FloatTiles,visible:Option<FloatTiles>,sample_keys:BTreeSet<Key>,pub(super) effect:Effect,
    #[cfg(test)] pub(super) peak_region_pixels:usize,
}
impl Working {
    pub(super) fn new(fmt:PixelFormat,all:bool,effect:Effect)->Self{Self{rect:Rect::EMPTY,pixels:FloatTiles::new(fmt.channels()),visible:all.then(||FloatTiles::new(fmt.channels())),sample_keys:Default::default(),effect,#[cfg(test)]peak_region_pixels:0}}
    pub(super) fn grow(&mut self,area:Rect)->Result<(),String>{let rect=self.rect.union(&area);admission::area(rect)?;self.rect=rect;Ok(())}
    pub(super) fn read(&mut self,rect:Rect,original:&Surface,ctl:&Interrupt)->Result<Region,String>{
        #[cfg(test)]{self.peak_region_pixels=self.peak_region_pixels.max(rect.width() as usize*rect.height() as usize);}
        self.pixels.read(rect,|tile|Region::read(original,tile),ctl)
    }
    pub(super) fn published(&self,rect:Rect,original:&Surface,ctl:&Interrupt)->Result<Region,String>{self.pixels.peek(rect,|tile|Region::read(original,tile),ctl)}
    pub(super) fn dab(&mut self,original:&Surface,source:&Document,fp:&Footprint,halo:i32,spacing:f32,locked:bool,ctl:&Interrupt)->Result<(),String>{
        let r=fp.rect.intersect(&self.rect);if r.is_empty(){return Ok(());}
        let roi=r.inflate(halo).intersect(&self.rect);let mut work=self.read(roi,original,ctl)?;
        if let Effect::Mixer(mixer)=&mut self.effect{if let Some(sample)=&mut mixer.sample{
            for key in FloatTiles::keys(r){if !self.sample_keys.contains(&key){admission::check(ctl)?;let rect=FloatTiles::rect(key);let buffer=photocraft_compose::render(source,rect);let pixels:Vec<f32>=buffer.px.iter().flatten().copied().collect();sample.write_region(rect,&pixels);self.sample_keys.insert(key);}}
        }}
        if let Some(visible)=&mut self.visible{
            let mut composed=visible.read(roi,|tile|composite_region(source,None,SampleLayers::All,tile,original.format()),ctl)?;
            self.effect.dab(original,&mut composed,fp,spacing,locked);
            for y in r.y0..r.y1{admission::check(ctl)?;for x in r.x0..r.x1{if fp.at(x,y)>0.0{work.px_mut(x,y).copy_from_slice(composed.px(x,y));}}}
            visible.write(&composed,r);
        }else{self.effect.dab(original,&mut work,fp,spacing,locked);}
        admission::check(ctl)?;self.pixels.write(&work,r);Ok(())
    }
}
