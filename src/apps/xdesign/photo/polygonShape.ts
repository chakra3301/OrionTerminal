type XY=[number,number];
type Box={x:number;y:number;width:number;height:number};
type Rect=[number,number,number,number];

/** The engine's live polygon: its points round the ellipse in `rect` from the top, every other one pulled in by `starRatio` for a star. */
export function polygonPoints([x,y,w,h]:Rect,sides:number,starRatio=1):XY[] {
  const star=starRatio>0&&starRatio<1,count=star?sides*2:sides,rx=w/2,ry=h/2;
  return Array.from({length:count},(_,i)=>{const a=-Math.PI/2+Math.PI*2*i/count,k=star&&i%2===1?starRatio:1;return [x+rx+rx*k*Math.cos(a),y+ry+ry*k*Math.sin(a)];});
}
/** The ellipse rect whose polygon fills the dragged box, as Photoshop's Polygon and Triangle tools draw (the engine inscribes it in the ellipse instead). */
export function polygonRect(box:Box,sides:number,starRatio=1):Rect {
  const unit=polygonPoints([-1,-1,2,2],sides,starRatio),xs=unit.map(p=>p[0]),ys=unit.map(p=>p[1]);
  const [minX,maxX,minY,maxY]=[Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)];
  const rx=box.width/(maxX-minX),ry=box.height/(maxY-minY),round=(value:number)=>Math.round(value*100)/100;
  return [round(box.x-(minX+1)*rx),round(box.y-(minY+1)*ry),round(2*rx),round(2*ry)];
}
