'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {geometry}=require('../src/assets/cursor-geometry.cjs');
const root=path.resolve(__dirname,'..');
test('radius 1.2 silhouette has smooth tangent cubic joins without arc stroke seams',()=>{
 const shape=geometry();assert.equal(shape.radius,1.2);assert.ok(!shape.path.includes('A'));
 const cross=(a,b)=>a[0]*b[1]-a[1]*b[0],sub=(a,b)=>a.map((v,i)=>v-b[i]);
 shape.corners.forEach((c,i)=>{
  const prev=shape.corners[(i+3)%4],next=shape.corners[(i+1)%4];
  const incoming=sub(c.start,prev.end),outgoing=sub(next.start,c.end);
  assert.ok(Math.abs(cross(incoming,sub(c.curves[0][0],c.start)))<1e-8);
  const last=c.curves.at(-1);assert.ok(Math.abs(cross(outgoing,sub(last[2],last[1])))<1e-8);
  for(const endpoint of [c.start,c.end])assert.ok(Math.abs(Math.hypot(...sub(endpoint,c.center))-1.2)<1e-8);
 });
 const header=fs.readFileSync(path.join(root,'native/multi-pointer/cursor-assets.hpp'),'utf8');
 assert.ok(header.includes('modelCornerRadius=1.2f'));assert.ok(header.includes(`array<PathPoint, ${shape.points.length}> modelBody`));
 assert.ok(fs.readFileSync(path.join(root,'src/assets/app-icon.svg'),'utf8').includes(shape.path));
 assert.ok(fs.readFileSync(path.join(root,'docs/visualizations/agent-logo-lab.html'),'utf8').includes(shape.path));
});
test('ICO frames contain actual size-matched PNG resources',()=>{
 const ico=fs.readFileSync(path.join(root,'src/assets/app-icon.ico'));assert.equal(ico.readUInt16LE(2),1);
 assert.equal(ico.readUInt16LE(4),9);
 for(let i=0;i<9;i++){
  const at=6+16*i,size=ico[at]||256,length=ico.readUInt32LE(at+8),offset=ico.readUInt32LE(at+12);
  const png=ico.subarray(offset,offset+length);assert.equal(png.subarray(1,4).toString(),'PNG');
  assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
  assert.deepEqual(png,fs.readFileSync(path.join(root,`src/assets/app-icon-${size}.png`)));
 }
});
test('Tauri window and packaged host select approved icons',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(root,'src-tauri/tauri.conf.json'),'utf8'));
 assert.ok(config.bundle.icon.includes('../src/assets/app-icon.ico'));
 assert.ok(config.bundle.icon.includes('../src/assets/app-icon-256.png'));
 assert.ok(fs.readFileSync(path.join(root,'src/ui/index.html'),'utf8').includes('../assets/app-icon-32.png'));
});
