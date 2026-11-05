//! Exact native-channel float tiles shared by sequential and Smudge feedback.
use photocraft_engine::{doc::Rect,paint::{render::COV_TILE,retouch::Region}};
use photocraft_raster::Interrupt;
use super::admission;
use std::{collections::BTreeMap,sync::Arc};

type Key=(i32,i32);
#[derive(Clone)]
pub(super) struct FloatTiles { channels:usize,tiles:BTreeMap<Key,Arc<Vec<f32>>> }
impl FloatTiles {
    pub(super) fn new(channels:usize)->Self{Self{channels,tiles:Default::default()}}
    pub(super) fn keys(rect:Rect)->impl Iterator<Item=Key>{
        let (x0,y0)=(rect.x0.div_euclid(COV_TILE),rect.y0.div_euclid(COV_TILE));
        let (x1,y1)=if rect.is_empty(){(x0-1,y0-1)}else{((rect.x1-1).div_euclid(COV_TILE),(rect.y1-1).div_euclid(COV_TILE))};
        (y0..=y1).flat_map(move|y|(x0..=x1).map(move|x|(x,y)))
    }
    pub(super) fn rect((x,y):Key)->Rect{Rect::from_xywh(x*COV_TILE,y*COV_TILE,COV_TILE as u32,COV_TILE as u32)}
    pub(super) fn read(&mut self,rect:Rect,source:impl Fn(Rect)->Region,ctl:&Interrupt)->Result<Region,String>{
        for key in Self::keys(rect){admission::check(ctl)?;self.tiles.entry(key).or_insert_with(||Arc::new(source(Self::rect(key)).data));}
        self.peek(rect,source,ctl)
    }
    pub(super) fn peek(&self,rect:Rect,source:impl Fn(Rect)->Region,ctl:&Interrupt)->Result<Region,String>{
        let mut out=Region::new(rect,self.channels);let n=self.channels;
        for key in Self::keys(rect){
            admission::check(ctl)?;let tile=Self::rect(key);
            let fallback;let data=if let Some(data)=self.tiles.get(&key){data.as_ref()}else{fallback=source(tile);&fallback.data};
            let r=rect.intersect(&tile);
            for y in r.y0..r.y1{let start=((y-tile.y0) as usize*COV_TILE as usize+(r.x0-tile.x0) as usize)*n;let target=out.index(r.x0,y)*n;let len=r.width() as usize*n;out.data[target..target+len].copy_from_slice(&data[start..start+len]);}
        }
        Ok(out)
    }
    pub(super) fn blocks(&self)->impl Iterator<Item=&Arc<Vec<f32>>>{self.tiles.values()}
    pub(super) fn entries(&self)->impl Iterator<Item=((i32,i32),&Arc<Vec<f32>>)>{self.tiles.iter().map(|(&key,block)|(key,block))}
    pub(super) fn entries_in(&self,rect:Rect)->impl Iterator<Item=((i32,i32),&Arc<Vec<f32>>)>{Self::keys(rect).filter_map(move|key|self.tiles.get(&key).map(|block|(key,block)))}
    pub(super) fn write(&mut self,region:&Region,rect:Rect){
        let n=self.channels;let rect=rect.intersect(&region.rect);
        for key in Self::keys(rect){let tile=Self::rect(key);let r=rect.intersect(&tile);let data=Arc::make_mut(self.tiles.get_mut(&key).expect("working write follows its read"));
            for y in r.y0..r.y1{let start=region.index(r.x0,y)*n;let target=((y-tile.y0) as usize*COV_TILE as usize+(r.x0-tile.x0) as usize)*n;let len=r.width() as usize*n;data[target..target+len].copy_from_slice(&region.data[start..start+len]);}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn float_tiles_preserve_bits_negative_coordinates_and_share_untouched_blocks(){
        for channels in [1,2,4,5,8]{
            let source=|rect:Rect|{let mut region=Region::new(rect,channels);for y in rect.y0..rect.y1{for x in rect.x0..rect.x1{for c in 0..channels{region.px_mut(x,y)[c]=match (x+y+c as i32).rem_euclid(5){0=>-0.0,1=>-0.37,2=>0.1234567,3=>2.75,_=>f32::from_bits(1)};}}}region};
            let rect=Rect::new(-70,-70,140,140);let mut stable=FloatTiles::new(channels);let actual=stable.read(rect,source,&Interrupt::NONE).unwrap();let expected=source(rect);
            assert!(actual.data.iter().zip(&expected.data).all(|(a,b)|a.to_bits()==b.to_bits()));
            let empty=FloatTiles::new(channels);let uncached=empty.peek(rect,source,&Interrupt::NONE).unwrap();assert!(empty.tiles.is_empty());assert!(uncached.data.iter().zip(&expected.data).all(|(a,b)|a.to_bits()==b.to_bits()));
            let mut preview=stable.clone();assert!(stable.tiles.iter().all(|(key,tile)|Arc::ptr_eq(tile,&preview.tiles[key])));
            let changed=Rect::new(3,4,6,7);let mut patch=preview.read(changed,|_|panic!("cached region must not resample its source"),&Interrupt::NONE).unwrap();patch.data.fill(-1.234567);preview.write(&patch,changed);
            for(key,tile)in &stable.tiles{assert_eq!(Arc::ptr_eq(tile,&preview.tiles[key]),*key!=(0,0));}
            let unchanged=stable.read(rect,|_|panic!("stable source must remain cached"),&Interrupt::NONE).unwrap();assert!(unchanged.data.iter().zip(&expected.data).all(|(a,b)|a.to_bits()==b.to_bits()));
            let modified=preview.read(changed,|_|panic!("modified tile must remain cached"),&Interrupt::NONE).unwrap();assert!(modified.data.iter().all(|x|x.to_bits()==(-1.234567f32).to_bits()));
        }
    }
}

