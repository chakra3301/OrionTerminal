type XY=[number,number];
/** left, bottom, right, top (document px), top and bottom ellipse depth (half-axis units), wrap (0..1). */
export type CylinderValues=[number,number,number,number,number,number,number];
export type CylinderHandle={kind:"corner"|"side"|"depth";index:number}|{kind:"surface"};

// [uL, kx, ky, my] for wrap 0..1 in steps of 0.025, from photocraft upstream's cylinder_shape (PR #9798); the pinned engine has no Cylinder, so it is sent as a custom mesh.
const CYLINDER_SHAPE=[[0.166169,0.655404,0.382374,1.003104],[0.157304,0.650228,0.388326,1.002685],[0.148438,0.645374,0.394211,1.007918],[0.140060,0.639652,0.401415,1.006938],[0.131885,0.634064,0.408465,1.006069],[0.123875,0.628845,0.414586,1.005743],[0.116162,0.623565,0.421033,1.005233],[0.108674,0.618563,0.426905,1.004990],[0.101198,0.614439,0.431943,1.010787],[0.094322,0.609611,0.437749,1.010560],[0.087757,0.604929,0.443406,1.010361],[0.081514,0.600390,0.448907,1.010190],[0.075599,0.596012,0.454288,1.010019],[0.069994,0.591836,0.459420,1.009888],[0.064709,0.587844,0.464361,1.009768],[0.059740,0.584026,0.469109,1.009669],[0.055072,0.580427,0.473609,1.009588],[0.050712,0.576990,0.477904,1.009528],[0.046635,0.573760,0.481968,1.009477],[0.042824,0.570758,0.485764,1.009440],[0.039295,0.567910,0.489377,1.009411],[0.036023,0.565229,0.492800,1.009382],[0.032681,0.563478,0.495519,1.015285],[0.029877,0.561152,0.498513,1.015270],[0.027282,0.559012,0.501313,1.015245],[0.024894,0.557004,0.503913,1.015241],[0.022693,0.555163,0.506331,1.015225],[0.020668,0.553463,0.508575,1.015213],[0.018816,0.551877,0.510651,1.015217],[0.017106,0.550434,0.512556,1.015214],[0.015542,0.549100,0.514319,1.015213],[0.014115,0.547868,0.515936,1.015223],[0.012806,0.546743,0.517432,1.015223],[0.011600,0.545730,0.518775,1.015228],[0.010506,0.544788,0.520034,1.015230],[0.009510,0.543920,0.521179,1.015238],[0.008600,0.543134,0.522224,1.015244],[0.007763,0.542420,0.523173,1.015251],[0.007006,0.541757,0.524065,1.015252],[0.006315,0.541164,0.524867,1.015252],[0.005686,0.540608,0.525602,1.015261]] as const;
function cylinderShape(wrap:number) {
  const n=CYLINDER_SHAPE.length-1,x=Number.isFinite(wrap)?Math.min(1,Math.max(0,wrap))*n:0,i=Math.min(n-1,Math.floor(x)),t=x-i;
  return CYLINDER_SHAPE[i]!.map((value,k)=>value+(CYLINDER_SHAPE[i+1]![k]!-value)*t) as [number,number,number,number];
}
/** Four patches across (back, front left, front right, back) and one down; null when the silhouettes cross. */
export function cylinderMesh(v:CylinderValues) {
  if(!v.every(Number.isFinite)||v[2]<=v[0])return null;
  const a=(v[2]-v[0])/2,cx=(v[0]+v[2])/2,[uL,kx,ky,my]=cylinderShape(v[6]);
  const s=[-1,-1,-1,-1,-1,-kx,0,kx,1,1,1,1,1],e=[0,0,0,0,ky,my,1,my,ky,0,0,0,0],points:XY[]=[];
  for(let r=0;r<4;r++)s.forEach((sk,k)=>{const top=v[3]+v[4]*a*e[k]!,bottom=v[1]+v[5]*a*e[k]!;points.push([cx+a*sk,top+(bottom-top)*r/3]);});
  return {us:[0,uL,.5,1-uL,1],vs:[0,1],points};
}
/** Edges on the box, the lower ellipse's front on its bottom, 0.15 deep (less on a box so wide the bulge would take over a quarter of its height), half wrapped. */
export function cylinderDefault(rect:number[]):CylinderValues {
  const [x0,y0,x1,y1]=rect as [number,number,number,number],a=(x1-x0)/2,depth=Math.min(.15,.25*(y1-y0)/a);
  return [x0,y1-depth*a,x1,y0,depth,depth,.5];
}
export function cylinderHandles(v:CylinderValues):[XY,CylinderHandle][] {
  const [left,bottom,right,top,topDepth,bottomDepth]=v,a=(right-left)/2,cx=(left+right)/2,cy=(top+bottom)/2;
  return [[[left,top],{kind:"corner",index:0}],[[right,top],{kind:"corner",index:1}],[[right,bottom],{kind:"corner",index:2}],[[left,bottom],{kind:"corner",index:3}],[[left,cy],{kind:"side",index:0}],[[right,cy],{kind:"side",index:1}],[[cx,top+topDepth*a],{kind:"depth",index:0}],[[cx,bottom+bottomDepth*a],{kind:"depth",index:1}]];
}
/** Adobe's top depth handle bends both ellipses and the bottom one only the lower; a drag across the surface by the full width wraps the contents all the way round. */
export function cylinderDragged(v0:CylinderValues,handle:CylinderHandle,d:XY):CylinderValues {
  const v=[...v0] as CylinderValues,a=Math.max(.5,(v0[2]-v0[0])/2),depth=(value:number)=>Math.min(1,Math.max(-1,value+d[1]/a));
  if(handle.kind==="corner"){v[handle.index===0||handle.index===3?0:2]+=d[0];v[handle.index<2?3:1]+=d[1];}
  if(handle.kind==="side")v[handle.index===0?0:2]+=d[0];
  if(handle.kind==="depth"){v[5]=depth(v0[5]);if(handle.index===0)v[4]=depth(v0[4]);}
  if(handle.kind==="surface")v[6]=Math.min(1,Math.max(0,v0[6]+d[0]/(2*a)));
  const right=handle.kind==="corner"&&(handle.index===1||handle.index===2)||handle.kind==="side"&&handle.index===1;
  if(v[2]-v[0]<1){if(right)v[2]=v[0]+1;else v[0]=v[2]-1;}
  return v;
}
