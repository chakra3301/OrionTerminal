use std::{cmp::Reverse, collections::BinaryHeap};

use photocraft_engine::{channel_cmds::ChannelView, doc::{Document, Rect}, Session};
use serde::Serialize;
use serde_json::{json, Value};

const MAX_NODES: u64 = 1_048_576;
const MAX_GUIDE_WORK: u64 = 8_388_608;
const MAX_POINTS: usize = 8192;
pub(super) const COMMAND: &str = "select.xdesignMagneticLasso";

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    pub points: Vec<[f64; 2]>,
    pub snapped: bool,
    pub visited: usize,
}

struct Request {
    guide: Vec<[f64; 2]>,
    radius: f64,
    contrast: f32,
    area: Rect,
    fixed_end: bool,
}

fn points(params: &Value, key: &str, bounds: Rect, min: usize) -> Result<Vec<[f64; 2]>, String> {
    let values = params[key].as_array().filter(|v| (min..=MAX_POINTS).contains(&v.len()))
        .ok_or_else(||format!("Use between {min} and 8192 magnetic lasso points"))?;
    values.iter().map(|value| {
        let xy = value.as_array().filter(|v| v.len() == 2).ok_or("Invalid magnetic lasso coordinates")?;
        let x = xy[0].as_f64().filter(|v| v.is_finite() && *v >= 0.0 && *v <= f64::from(bounds.x1)).ok_or("Keep the magnetic lasso inside the image")?;
        let y = xy[1].as_f64().filter(|v| v.is_finite() && *v >= 0.0 && *v <= f64::from(bounds.y1)).ok_or("Keep the magnetic lasso inside the image")?;
        Ok([x, y])
    }).collect()
}

fn request(params: &Value, bounds: Rect) -> Result<Request, String> {
    let guide = points(params, "guide", bounds, 2)?;
    let width = params["width"].as_f64().filter(|v| v.is_finite() && (1.0..=256.0).contains(v)).ok_or("Choose a magnetic width between 1 and 256 pixels")?;
    let contrast = params["contrast"].as_f64().filter(|v| v.is_finite() && (1.0..=100.0).contains(v)).ok_or("Choose magnetic contrast between 1 and 100 percent")?;
    // Integer boundary nodes need a small corridor even for subpixel pointer input.
    let radius = (width / 2.0).max(1.5);
    let mut area = Rect::new(bounds.x1, bounds.y1, 0, 0);
    let mut work = 0u64;
    for pair in guide.windows(2) {
        let segment = segment_area(pair[0], pair[1], radius, bounds);
        area.x0 = area.x0.min(segment.x0); area.y0 = area.y0.min(segment.y0);
        area.x1 = area.x1.max(segment.x1); area.y1 = area.y1.max(segment.y1);
        work = work.checked_add(nodes(segment)).ok_or("Magnetic lasso corridor is too large")?;
    }
    if nodes(area) > MAX_NODES || work > MAX_GUIDE_WORK {
        return Err("Add a fastening point sooner or reduce magnetic width; this trace exceeds the local corridor limit".into());
    }
    let fixed_end=params.get("fixedEnd").map(|v|v.as_bool().ok_or("Invalid magnetic end point")).transpose()?.unwrap_or(false);
    Ok(Request { guide, radius, contrast: contrast as f32 / 100.0, area, fixed_end })
}

fn nodes(area: Rect) -> u64 { (area.width() as u64 + 1) * (area.height() as u64 + 1) }
fn segment_area(a: [f64; 2], b: [f64; 2], radius: f64, bounds: Rect) -> Rect {
    Rect::new((a[0].min(b[0]) - radius).floor().max(0.0) as i32,
        (a[1].min(b[1]) - radius).floor().max(0.0) as i32,
        (a[0].max(b[0]) + radius).ceil().min(f64::from(bounds.x1)) as i32,
        (a[1].max(b[1]) + radius).ceil().min(f64::from(bounds.y1)) as i32)
}

fn distance(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f32 {
    let dx = b[0] - a[0]; let dy = b[1] - a[1];
    let t = if dx == 0.0 && dy == 0.0 { 0.0 } else { ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy) }.clamp(0.0, 1.0);
    ((p[0]-a[0]-t*dx).hypot(p[1]-a[1]-t*dy)) as f32
}

fn solve(req: Request, pixel: impl Fn(i32, i32) -> [u8; 4]) -> Result<Trace, String> {
    let area = req.area;
    let w = area.width() as usize + 1; let h = area.height() as usize + 1;
    let n = w * h;
    let index = |x: i32, y: i32| (y-area.y0) as usize*w+(x-area.x0) as usize;
    let coordinate = |i: usize| [f64::from(area.x0)+(i%w) as f64, f64::from(area.y0)+(i/w) as f64];
    let mut proximity = vec![f32::INFINITY; n];
    for pair in req.guide.windows(2) {
        let segment = segment_area(pair[0], pair[1], req.radius, area);
        for y in segment.y0..=segment.y1 { for x in segment.x0..=segment.x1 {
            let i = index(x,y); proximity[i] = proximity[i].min(distance([f64::from(x),f64::from(y)],pair[0],pair[1]));
        }}
    }
    let mut edges = vec![[0f32; 3]; n];
    for (i, edge) in edges.iter_mut().enumerate() {
        if proximity[i] > req.radius as f32 { continue; }
        let x = area.x0+(i%w) as i32; let y=area.y0+(i/w) as i32;
        let samples = [pixel(x-1,y-1),pixel(x,y-1),pixel(x-1,y),pixel(x,y)];
        for c in 0..4 {
            let channel = |j: usize| { let p=samples[j]; if c==3 {f32::from(p[3])/255.0} else {f32::from(p[c])*f32::from(p[3])/(255.0*255.0)} };
            let gx=(channel(1)+channel(3)-channel(0)-channel(2))*0.5;
            let gy=(channel(2)+channel(3)-channel(0)-channel(1))*0.5;
            let strength=gx.hypot(gy).min(1.0);
            if strength>edge[0] { *edge=[strength,gx/strength,gy/strength]; }
        }
    }
    if !edges.iter().any(|e|e[0]>=req.contrast&&e[0]>0.0) {return Ok(Trace {points:req.guide,snapped:false,visited:0});}
    let first=req.guide[0]; let last=*req.guide.last().unwrap();
    let start=index(first[0].round() as i32,first[1].round() as i32);
    let mut end=index(last[0].round() as i32,last[1].round() as i32);
    let mut best=0f64; let mut snapped=false;
    for (i,edge) in edges.iter().enumerate() {
        let p=coordinate(i); let d=(p[0]-last[0]).hypot(p[1]-last[1]);
        if !req.fixed_end && d<=req.radius && edge[0]>=req.contrast && edge[0]>0.0 {
            let score=0.5*f64::from(edge[0])*req.radius+0.5*(req.radius-d);
            if score>best { best=score; end=i; snapped=true; }
        }
    }
    proximity[start]=0.0;
    let mut costs=vec![u64::MAX;n]; let mut previous=vec![u32::MAX;n];
    let mut queue=BinaryHeap::new(); costs[start]=0; queue.push(Reverse((0u64,start as u32)));
    let mut visited=0usize; let mut pushed=1usize;
    while let Some(Reverse((cost,node)))=queue.pop() {
        let i=node as usize;
        if costs[i]!=cost {continue;} visited+=1;
        if i==end {break;}
        let x=i%w; let y=i/w;
        for (dx,dy) in [(-1,-1),(0,-1),(1,-1),(-1,0),(1,0),(-1,1),(0,1),(1,1)] {
            let nx=x as i32+dx; let ny=y as i32+dy;
            if nx<0||ny<0||nx>=w as i32||ny>=h as i32 {continue;}
            let j=ny as usize*w+nx as usize;
            if proximity[j]>req.radius as f32 {continue;}
            let edge=edges[j]; let length=if dx!=0&&dy!=0 {std::f32::consts::SQRT_2} else {1.0};
            let quality=if edge[0]>=req.contrast {edge[0]} else {0.0};
            let across=if quality>0.0 {(edge[1]*dx as f32+edge[2]*dy as f32).abs()/length} else {0.0};
            let step=(length*(1.0+160.0*(1.0-quality).powi(2)+80.0*across+8.0*(proximity[j]/req.radius as f32).powi(2))*100.0).ceil() as u64;
            let next=cost+step;
            if next<costs[j] {
                pushed+=1;
                if pushed>n*8 {return Err("Magnetic trace work limit reached; add a fastening point sooner".into());}
                costs[j]=next; previous[j]=i as u32; queue.push(Reverse((next,j as u32)));
            }
        }
    }
    if costs[end]==u64::MAX {return Err("Move closer to the outline or increase magnetic width".into());}
    let mut path=Vec::new(); let mut cursor=end;
    while cursor!=start {
        if path.len()>=MAX_POINTS-1 {return Err("Add a fastening point sooner; this trace is too long".into());}
        path.push(coordinate(cursor)); cursor=previous[cursor] as usize;
    }
    path.push(first); path.reverse();
    if req.fixed_end && path.len()>1 {*path.last_mut().unwrap()=last;}
    if path.len()==1 {path.push(if req.fixed_end {last} else {coordinate(end)});}
    Ok(Trace {points:path,snapped,visited})
}

pub(super) fn trace(doc: &Document, channels: Option<&ChannelView>, color: Option<&super::display::View>, params: &Value) -> Result<Trace, String> {
    let req=request(params,doc.bounds())?;
    let source=Rect::new((req.area.x0-1).max(0),(req.area.y0-1).max(0),(req.area.x1+1).min(doc.size.width as i32),(req.area.y1+1).min(doc.size.height as i32));
    let buffer=if channels.is_none_or(|c|super::view::needs_composite(doc,c)) {photocraft_compose::render(doc,source)} else {photocraft_compose::Buffer::transparent(source)};
    let buffer=match channels {Some(c)=>super::view::present(doc,c,buffer,source,1),None=>buffer};
    let rgba=if channels.is_none_or(|c|c.is_plain(doc)) {match color {Some(c)=>c.rgba(&buffer),None=>super::display::rgba(doc,&buffer)?}} else {buffer.to_rgba8()};
    solve(req,|x,y| {
        // Replicate image borders rather than inventing an edge against transparency.
        let x=x.clamp(source.x0,source.x1-1); let y=y.clamp(source.y0,source.y1-1);
        let offset=((y-source.y0) as usize*source.width() as usize+(x-source.x0) as usize)*4;
        rgba.pixels[offset..offset+4].try_into().unwrap()
    })
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value) -> Option<Result<Value,String>> {
    if command!=COMMAND {return None;}
    Some((|| {
        let bounds=engine.active().ok_or("No image document")?.doc.bounds();
        let points=points(params,"points",bounds,3)?;
        let aa=params.get("antiAlias").map(|v|v.as_bool().ok_or("Invalid magnetic anti-alias setting")).transpose()?.unwrap_or(true);
        let feather=params.get("feather").map(|v|v.as_f64().filter(|v|v.is_finite()&&(0.0..=1000.0).contains(v)).ok_or("Invalid magnetic feather")).transpose()?.unwrap_or(0.0);
        let mode=params.get("mode").map(|v|v.as_str().ok_or("Invalid magnetic selection mode")).transpose()?.unwrap_or("replace");
        if !["replace","add","subtract","intersect"].contains(&mode) {return Err("Invalid magnetic selection mode".into());}
        let pixels=u64::from(bounds.width() as u32)*u64::from(bounds.height() as u32);
        let work=u64::from(bounds.height() as u32)*points.len() as u64*if aa {4} else {1};
        if pixels>16_777_216 || work>67_108_864 {return Err("This magnetic selection exceeds the bounded selection limit; reduce the image size or outline point count".into());}
        let canonical=json!({"points":points,"antiAlias":aa,"feather":feather,"mode":mode});
        let result=engine.execute("select.lasso",canonical.clone()).map_err(|e|e.to_string())?;
        if let Some(last)=engine.journal.last_mut() {if last.0=="select.lasso" {*last=(COMMAND.into(),canonical);}}
        Ok(result)
    })())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(guide: Value, width: f64, contrast: f64, pixel: impl Fn(i32,i32)->[u8;4])->Trace {
        solve(request(&json!({"guide":guide,"width":width,"contrast":contrast}),Rect::from_xywh(0,0,100,100)).unwrap(),pixel).unwrap()
    }
    #[test] fn follows_vertical_boundary_with_manual_start() {
        let path=run(json!([[38.25,10.5],[38.0,50.0],[38.0,80.0]]),10.0,10.0,|x,_|if x<40 {[0,0,0,255]}else{[255,255,255,255]});
        assert!(path.snapped);assert_eq!(path.points[0],[38.25,10.5]);assert_eq!(*path.points.last().unwrap(),[40.0,80.0]);
        assert!(path.points.iter().filter(|p|p[1]>20.0&&p[1]<70.0).all(|p|p[0]==40.0));
    }
    #[test] fn follows_corner_and_transparent_edge_without_hidden_rgb() {
        let a=run(json!([[40,10],[38,40],[60,42],[85,42]]),10.0,10.0,|x,y|if x>=40&&y<40 {[255,0,0,255]}else{[0,255,0,0]});
        let b=run(json!([[40,10],[38,40],[60,42],[85,42]]),10.0,10.0,|x,y|if x>=40&&y<40 {[255,0,0,255]}else{[255,0,255,0]});
        assert_eq!(a.points,b.points);assert_eq!(*a.points.last().unwrap(),[85.0,40.0]);assert!(a.points.contains(&[40.0,40.0]));
    }
    #[test] fn contrast_controls_soft_edge_and_flat_fallback_tracks_guide() {
        let pixels=|x,_|if x<40 {[100,100,100,255]}else{[130,130,130,255]};
        assert!(run(json!([[40,10],[38,80]]),10.0,5.0,pixels).snapped);
        assert!(!run(json!([[40,10],[38,80]]),10.0,20.0,pixels).snapped);
        let flat=run(json!([[10,10],[20,10],[20,20]]),4.0,10.0,|_,_|[128,128,128,255]);
        assert!(!flat.snapped);assert_eq!(*flat.points.last().unwrap(),[20.0,20.0]);assert!(flat.points.iter().all(|p|distance(*p,[10.0,10.0],[20.0,10.0]).min(distance(*p,[20.0,10.0],[20.0,20.0]))<=1.5));
    }
    #[test] fn rejects_malformed_and_oversized_corridors_before_sampling() {
        let bounds=Rect::from_xywh(0,0,100_000,100_000);
        for value in [json!({"guide":[[0,0]],"width":10,"contrast":10}),json!({"guide":[[0,0],[10,10]],"width":0,"contrast":10}),json!({"guide":[[0,0],[10,10]],"width":10,"contrast":101}),json!({"guide":[[0,0],[100_000,100_000]],"width":256,"contrast":10}),json!({"guide":[[-1,0],[2,2]],"width":10,"contrast":10})] {assert!(request(&value,bounds).is_err());}
    }
    #[test] fn native_selection_matches_lasso_and_is_one_reversible_portable_edit() {
        let mut engine=Session::new();engine.execute("file.new",json!({"width":100,"height":100})).unwrap();
        let before=engine.active().unwrap().doc.clone();let mut native=Session::new();native.add_document((*before).clone(),None);let past=engine.active().unwrap().history.past_len();
        let params=json!({"points":[[10.25,10],[80,15],[50,80]],"mode":"add","feather":2,"antiAlias":true});
        execute(&mut engine,COMMAND,&params).unwrap().unwrap();native.execute("select.lasso",params).unwrap();
        assert_eq!(engine.active().unwrap().doc.selection,native.active().unwrap().doc.selection);assert_eq!(engine.active().unwrap().history.past_len(),past+1);
        assert_eq!(engine.journal.last().unwrap().0,COMMAND);let after=engine.active().unwrap().doc.clone();
        engine.execute("edit.undo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,before);engine.execute("edit.redo",json!({})).unwrap();assert_eq!(engine.active().unwrap().doc,after);
        assert!(engine.execute(COMMAND,json!({})).is_err());
    }
    #[test] fn oversized_selection_rejects_without_history_or_journal_changes() {
        let mut engine=Session::new();engine.execute("file.new",json!({"width":5000,"height":5000})).unwrap();let before=engine.active().unwrap().doc.clone();let past=engine.active().unwrap().history.past_len();let journal=engine.journal.clone();
        assert!(execute(&mut engine,COMMAND,&json!({"points":[[0,0],[10,0],[10,10]]})).unwrap().is_err());
        assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.past_len(),past);assert_eq!(engine.journal,journal);
    }
    #[test] fn exact_manual_endpoint_and_border_nodes_remain_inside_image() {
        let req=request(&json!({"guide":[[40.25,10.5],[38.25,80.5]],"width":10,"contrast":10,"fixedEnd":true}),Rect::from_xywh(0,0,100,100)).unwrap();
        let path=solve(req,|x,_|if x<40 {[0,0,0,255]}else{[255,255,255,255]}).unwrap();assert!(!path.snapped);assert_eq!(*path.points.last().unwrap(),[38.25,80.5]);
        let border=run(json!([[0,0],[0,100]]),10.0,10.0,|_,_|[255,255,255,255]);assert!(border.points.iter().all(|p|p[0]>=0.0&&p[0]<=100.0&&p[1]>=0.0&&p[1]<=100.0));
    }
    #[test] fn samples_numeric_channel_view_without_mutating_native_source_or_history() {
        use photocraft_engine::{channel_cmds::ChannelTarget,doc::{LayerContent,PixelFormat,Surface}};
        let mut engine=Session::new();engine.execute("file.new",json!({"width":100,"height":100,"background":"transparent"})).unwrap();
        let doc=std::sync::Arc::make_mut(&mut engine.active_mut().unwrap().doc);let mut surface=Surface::new(PixelFormat::RGBA32F);
        for y in 0..100 {for x in 0..100 {surface.write_pixel(x,y,&[0.5,if x<40 {0.0}else{1.0},0.5,1.0]);}}
        doc.layers[0].content=LayerContent::Raster(surface);
        let before=engine.active().unwrap().doc.clone();let past=engine.active().unwrap().history.past_len();let journal=engine.journal.clone();
        let params=json!({"guide":[[40,10],[38,80]],"width":10,"contrast":10});
        let green=ChannelView{target:ChannelTarget::Color(1),color_hidden:vec![true,false,true],..Default::default()};
        let red=ChannelView{target:ChannelTarget::Color(0),color_hidden:vec![false,true,true],..Default::default()};
        assert_eq!(*trace(&before,Some(&green),None,&params).unwrap().points.last().unwrap(),[40.0,80.0]);
        assert!(!trace(&before,Some(&red),None,&params).unwrap().snapped);
        let color=super::super::color_views::Snapshot::capture(&engine).unwrap().render(&before).unwrap();assert!(trace(&before,Some(&Default::default()),Some(&color),&params).unwrap().snapped);
        assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));assert_eq!(engine.active().unwrap().history.past_len(),past);assert_eq!(engine.journal,journal);
    }
    #[test] fn all_selection_modes_and_native_reopen_keep_exact_history_and_host_recipe() {
        for mode in ["replace","add","subtract","intersect"] {
            let mut engine=Session::new();engine.execute("file.new",json!({"width":40,"height":30})).unwrap();engine.execute("select.rect",json!({"x":5,"y":5,"width":20,"height":20})).unwrap();
            let before=engine.active().unwrap().doc.clone();let mut oracle=Session::new();oracle.add_document((*before).clone(),None);
            let params=json!({"points":[[15.25,10.5],[35,10],[35,25]],"mode":mode,"antiAlias":true,"feather":1.25});
            super::super::execute_view_command(&mut engine,COMMAND,params.clone()).unwrap();oracle.execute("select.lasso",params).unwrap();assert_eq!(engine.active().unwrap().doc.selection,oracle.active().unwrap().doc.selection);
            let after=engine.active().unwrap().doc.clone();let dir=std::env::temp_dir().join(format!("xdesign-magnetic-{}",ulid::Ulid::new()));
            let mut session=super::super::PhotoSession{engine,color_settings:None,version:String::new(),original_path:None,writer:Default::default()};
            super::super::publish(&dir,&ulid::Ulid::new().to_string(),&mut session).unwrap();let mut reopened=super::super::restore(&dir,&session.version,None).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);
            let state=reopened.engine.active().unwrap();let key=super::super::color_views::Snapshot::capture(&reopened.engine).unwrap().key(&state.channel_view).unwrap();
            assert!(super::super::view_snapshot(&dir,"project","photo",&session.version,Some(&key)).is_ok());assert!(super::super::view_snapshot(&dir,"project","photo",&session.version,Some("stale-view")).is_err());
            reopened.engine.execute("edit.undo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,before);reopened.engine.execute("edit.redo",json!({})).unwrap();assert_eq!(reopened.engine.active().unwrap().doc,after);std::fs::remove_dir_all(dir).unwrap();
        }
    }
}
