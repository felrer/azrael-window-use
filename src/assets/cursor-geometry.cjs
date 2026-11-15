'use strict';
// Fluent-derived Agent silhouette. Keep straight edges and leg angle fixed.
// Tangent circular fillets, split into <=45 degree cubic segments. Using one
// closed cubic contour avoids SVG arc/stroke tessellation joins at the crown.
const sub=(a,b)=>a.map((v,i)=>v-b[i]), add=(a,b)=>a.map((v,i)=>v+b[i]);
const mul=(a,k)=>a.map(v=>v*k), len=a=>Math.hypot(...a);
const top0=[5.662930136,2.248456407],top1=[12.661012404,8.412598761];
const leg0=[7.751627583,10.615965994],leg1=[5.839058974,13.542698176];
const left=4.00195,ledge=10.163002159;
const slope=(top1[1]-top0[1])/(top1[0]-top0[0]);
const legSlope=(leg1[1]-leg0[1])/(leg1[0]-leg0[0]);
const vertices=[[left,top0[1]+(left-top0[0])*slope],
 [top0[0]+(ledge-top0[1])/slope,ledge],
 [leg0[0]+(ledge-leg0[1])/legSlope,ledge],
 [left,leg0[1]+(left-leg0[0])*legSlope]];
function geometry(radius=1.2) {
 if(!Number.isFinite(radius)||radius<=0||radius>1.6)throw Error('Invalid cursor radius');
 const corners=vertices.map((p,i)=>{
  const prev=vertices[(i+3)%4],next=vertices[(i+1)%4];
  const u=mul(sub(prev,p),1/len(sub(prev,p))),v=mul(sub(next,p),1/len(sub(next,p)));
  const theta=Math.acos(u[0]*v[0]+u[1]*v[1]),d=radius/Math.tan(theta/2);
  const start=add(p,mul(u,d)),end=add(p,mul(v,d));
  const cross=(p[0]-prev[0])*(next[1]-p[1])-(p[1]-prev[1])*(next[0]-p[0]);
  const sign=cross>0?1:-1, incoming=mul(u,-1);
  const center=add(start,mul([-incoming[1],incoming[0]],sign*radius));
  let a=Math.atan2(start[1]-center[1],start[0]-center[0]);
  let delta=Math.atan2(end[1]-center[1],end[0]-center[0])-a;
  if(sign>0&&delta<0)delta+=2*Math.PI;if(sign<0&&delta>0)delta-=2*Math.PI;
  const count=Math.ceil(Math.abs(delta)/(Math.PI/4)),step=delta/count,curves=[];
  for(let j=0;j<count;j++){
   const b=a+step,k=4/3*Math.tan(step/4);
   const p0=j?add(center,[radius*Math.cos(a),radius*Math.sin(a)]):start;
   const p3=j===count-1?end:add(center,[radius*Math.cos(b),radius*Math.sin(b)]);
   curves.push([add(p0,[-radius*k*Math.sin(a),radius*k*Math.cos(a)]),
    add(p3,[radius*k*Math.sin(b),-radius*k*Math.cos(b)]),p3]);a=b;
  }
  return {start,end,curves,center,sign};
 });
 const n=v=>Number(v.toFixed(10)),fmt=p=>p.map(n).join(' ');
 const path=corners.map((c,i)=>(i?'L':'M')+fmt(c.start)+c.curves.map(ps=>'C'+ps.map(fmt).join(' ')).join('')).join('')+'Z';
 const points=[];for(const [i,c] of corners.entries()){
  points.push({p:c.start,type:i?1:0});for(const ps of c.curves)for(const p of ps)points.push({p,type:3});
 }points.at(-1).type=0x83;
 return {radius,path,points,corners,angle:Math.atan2(leg1[1]-leg0[1],leg0[0]-leg1[0])*180/Math.PI};
}
module.exports={geometry};
