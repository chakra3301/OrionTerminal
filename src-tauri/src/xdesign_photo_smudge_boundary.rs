//! Chronological carry-window lookup; native clipping determines replay.
use super::{Rect,Interrupt,admission};

const BLOCK:usize=64;
struct Boundary { window:Rect,bounds:Rect }
#[derive(Default)]
pub(super) struct Boundaries {
    records:Vec<Boundary>,levels:Vec<Vec<Rect>>,
    #[cfg(test)] pub(super) visited_nodes:usize,
    #[cfg(test)] pub(super) visited_records:usize,
}
impl Boundaries {
    pub(super) fn push(&mut self,window:Rect,bounds:Rect){
        self.records.push(Boundary{window,bounds});let block=(self.records.len()-1)/BLOCK;
        if self.levels.is_empty(){self.levels.push(Vec::new());}
        if self.levels[0].len()==block{self.levels[0].push(window);}else{self.levels[0][block]=self.levels[0][block].union(&window);}
        self.update(block);
    }
    fn update(&mut self,mut index:usize){
        let mut level=0;
        while self.levels[level].len()>1||level+1<self.levels.len(){
            let lower=&self.levels[level];let parent=index/2;let left=lower[parent*2];let value=lower.get(parent*2+1).map_or(left,|right|left.union(right));let count=lower.len().div_ceil(2);
            if level+1==self.levels.len(){self.levels.push(Vec::new());}
            self.levels[level+1].truncate(count);
            if self.levels[level+1].len()==parent{self.levels[level+1].push(value);}else{self.levels[level+1][parent]=value;}
            index=parent;level+=1;
        }
    }
    pub(super) fn truncate(&mut self,len:usize){
        self.records.truncate(len);
        if self.records.is_empty(){self.levels.clear();return;}
        let count=self.records.len().div_ceil(BLOCK);self.levels[0].truncate(count);let block=count-1;
        self.levels[0][block]=self.records[block*BLOCK..].iter().fold(Rect::EMPTY,|r,b|r.union(&b.window));self.update(block);
    }
    pub(super) fn changed(&mut self,previous:Rect,bounds:Rect,ctl:&Interrupt)->Result<Option<usize>,String>{
        admission::check(ctl)?;
        if previous==bounds||self.records.is_empty(){return Ok(None);}
        // Accepted prefixes leave every retained window equivalent to the
        // previous bounds. Only windows intersecting changed strips can differ.
        let strips:Vec<Rect>=super::super::sparse::difference(previous,bounds).into_iter().chain(super::super::sparse::difference(bounds,previous)).collect();
        self.find(self.levels.len()-1,0,&strips,bounds,ctl)
    }
    fn find(&mut self,level:usize,index:usize,strips:&[Rect],bounds:Rect,ctl:&Interrupt)->Result<Option<usize>,String>{
        admission::check(ctl)?;
        #[cfg(test)]{self.visited_nodes+=1;}
        let Some(window)=self.levels[level].get(index)else{return Ok(None)};
        if !strips.iter().any(|strip|!window.intersect(strip).is_empty()){return Ok(None);}
        if level==0{
            for i in index*BLOCK..((index+1)*BLOCK).min(self.records.len()){
                admission::check(ctl)?;
                #[cfg(test)]{self.visited_records+=1;}
                let b=&self.records[i];if b.window.intersect(&b.bounds)!=b.window.intersect(&bounds){return Ok(Some(i));}
            }
            Ok(None)
        }else{if let Some(i)=self.find(level-1,index*2,strips,bounds,ctl)?{return Ok(Some(i));}self.find(level-1,index*2+1,strips,bounds,ctl)}
    }
    #[cfg(test)] pub(super) fn linear(&self,bounds:Rect)->Option<usize>{self.records.iter().position(|b|b.window.intersect(&b.bounds)!=b.window.intersect(&bounds))}
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chronological_lookup_matches_clipping_through_growth_contraction_and_replay(){
        let mut index=Boundaries::default();let mut bounds=Rect::new(-50,-50,50,50);let mut state=6389u32;
        for step in 0..600{
            state=state.wrapping_mul(1664525).wrapping_add(1013904223);let x=(state%300) as i32-150;state=state.wrapping_mul(1664525).wrapping_add(1013904223);let y=(state%300) as i32-150;
            let window=Rect::new(x-7,y-7,x+8,y+8);let next=if step%7==0{Rect::new(-40,-40,40,40)}else{bounds.union(&window)};
            let expected=index.linear(next);assert_eq!(index.changed(bounds,next,&Interrupt::NONE).unwrap(),expected);
            if let Some(first)=expected{let replay:Vec<Rect>=index.records[first..].iter().map(|b|b.window).collect();index.truncate(first);for window in replay{index.push(window,next);}}
            bounds=next;index.push(window,bounds);assert_eq!(index.linear(bounds),None);
        }
    }
    #[test]
    fn late_edge_change_skips_the_long_unaffected_prefix_and_is_interruptible(){
        use std::sync::atomic::{AtomicUsize,Ordering};
        let mut index=Boundaries::default();let bounds=Rect::new(-8,-8,16380,8);
        for x in 0..16384{index.push(Rect::new(x-6,-6,x+7,7),bounds);}
        let next=Rect::new(-8,-8,16388,8);let expected=index.linear(next);assert_eq!(index.changed(bounds,next,&Interrupt::NONE).unwrap(),expected);assert!(index.visited_records<=BLOCK);assert!(index.visited_nodes<40);
        eprintln!("smudge-boundary-work retained_records={} visited_records={} visited_nodes={}",index.records.len(),index.visited_records,index.visited_nodes);
        let calls=AtomicUsize::new(0);let stop=||calls.fetch_add(1,Ordering::Relaxed)>=5;assert!(index.changed(bounds,Rect::new(-2,-2,16380,2),&Interrupt::cancel_only(&stop)).is_err());
    }
}
