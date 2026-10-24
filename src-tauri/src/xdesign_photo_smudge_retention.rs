//! Incremental checkpoint payload accounting; pointer metadata holds no float Arcs.
use super::{FloatTiles,Rect,Interrupt,admission};
use std::{collections::BTreeMap,sync::Arc};

#[derive(Default)]
struct Entry { bytes:u64,current:usize,checkpoints:usize }
#[derive(Default)]
pub(super) struct Retention {
    current:BTreeMap<(bool,i32,i32),usize>,refs:BTreeMap<usize,Entry>,extra:u64,
    #[cfg(test)] pub(super) sync_visits:usize,
    #[cfg(test)] pub(super) checkpoint_visits:usize,
}
impl Retention {
    fn alter(&mut self,ptr:usize,bytes:u64,current:isize,checkpoints:isize){
        let entry=self.refs.entry(ptr).or_default();if bytes>0{entry.bytes=bytes;}
        if entry.current==0&&entry.checkpoints>0{self.extra-=entry.bytes;}
        entry.current=entry.current.checked_add_signed(current).expect("current float tile reference");entry.checkpoints=entry.checkpoints.checked_add_signed(checkpoints).expect("checkpoint float tile reference");
        if entry.current==0&&entry.checkpoints>0{self.extra+=entry.bytes;}
        if entry.current==0&&entry.checkpoints==0{self.refs.remove(&ptr);}
    }
    fn current_block(&mut self,key:(bool,i32,i32),block:&Arc<Vec<f32>>){
        let ptr=Arc::as_ptr(block) as usize;
        if self.current.get(&key)==Some(&ptr){return;}
        if let Some(old)=self.current.insert(key,ptr){self.alter(old,0,-1,0);}
        self.alter(ptr,block.len() as u64*4,1,0);
    }
    pub(super) fn sync(&mut self,pixels:&FloatTiles,visible:Option<&FloatTiles>,rect:Rect,ctl:&Interrupt)->Result<(),String>{
        for(role,tiles)in std::iter::once((false,pixels)).chain(visible.map(|v|(true,v))){for((x,y),block)in tiles.entries_in(rect){
            admission::check(ctl)?;
            #[cfg(test)]{self.sync_visits+=1;}
            self.current_block((role,x,y),block);
        }}Ok(())
    }
    pub(super) fn reset(&mut self,pixels:&FloatTiles,visible:Option<&FloatTiles>,ctl:&Interrupt)->Result<(),String>{
        for ptr in std::mem::take(&mut self.current).into_values(){admission::check(ctl)?;self.alter(ptr,0,-1,0);}
        for(role,tiles)in std::iter::once((false,pixels)).chain(visible.map(|v|(true,v))){for((x,y),block)in tiles.entries(){admission::check(ctl)?;self.current_block((role,x,y),block);}}
        Ok(())
    }
    pub(super) fn checkpoint(&mut self,pixels:&FloatTiles,visible:Option<&FloatTiles>,delta:isize,ctl:&Interrupt)->Result<(),String>{
        for tiles in std::iter::once(pixels).chain(visible){for block in tiles.blocks(){
            admission::check(ctl)?;
            #[cfg(test)]{self.checkpoint_visits+=1;}
            self.alter(Arc::as_ptr(block) as usize,block.len() as u64*4,0,delta);
        }}Ok(())
    }
    pub(super) fn extra_bytes(&self)->u64{self.extra}
}
