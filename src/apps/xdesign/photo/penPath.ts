export type XY=[number,number];
export type PenKnot=XY|{anchor:XY;in:XY;out:XY;smooth:true};

// Catmull-Rom tangents as Bézier handles: each anchor's outgoing handle; the incoming one mirrors it.
export function smoothHandles(points:readonly XY[],closed:boolean):(XY|null)[] {
  return points.map((point,index)=>{
    const previous=points[index-1]??(closed?points.at(-1)!:point),next=points[index+1]??(closed?points[0]!:point);
    const out:XY=[point[0]+(next[0]-previous[0])/6,point[1]+(next[1]-previous[1])/6];
    return out[0]===point[0]&&out[1]===point[1]?null:out;
  });
}
export function penKnots(anchors:readonly XY[],handles:readonly (XY|null|undefined)[]):PenKnot[] {
  return anchors.map((anchor,index)=>{const out=handles[index];return out?{anchor,in:[2*anchor[0]-out[0],2*anchor[1]-out[1]],out,smooth:true}:anchor;});
}
// Ramer-Douglas-Peucker: drop points closer than `tolerance` to the simplified line.
export function simplifyPath(points:readonly XY[],tolerance:number):XY[] {
  if(points.length<3)return [...points];
  const first=points[0]!,last=points.at(-1)!,dx=last[0]-first[0],dy=last[1]-first[1],length=Math.hypot(dx,dy);
  let farthest=0,distance=-1;
  for(let index=1;index<points.length-1;index++){
    const point=points[index]!,away=length?Math.abs(dy*point[0]-dx*point[1]+last[0]*first[1]-last[1]*first[0])/length:Math.hypot(point[0]-first[0],point[1]-first[1]);
    if(away>distance){distance=away;farthest=index;}
  }
  if(distance<=tolerance)return [first,last];
  return [...simplifyPath(points.slice(0,farthest+1),tolerance).slice(0,-1),...simplifyPath(points.slice(farthest),tolerance)];
}
