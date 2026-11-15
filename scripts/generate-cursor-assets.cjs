'use strict';
// Deterministic shared SVG / GDI+ geometry. PNG/ICO rasterization uses the
// installed Chromium through scripts/render-app-icon.cjs, never image synthesis.
const fs=require('node:fs'),path=require('node:path');
const {geometry}=require('../src/assets/cursor-geometry.cjs');
const root=path.resolve(__dirname,'..'),shape=geometry();
const license=fs.readFileSync(path.join(root,'native/multi-pointer/CURSOR-NOTICES.md'),'utf8');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const settings={front:{x:118,y:146},back:{x:170,y:103},height:139,rearScale:1,opacity:.5};
function cursor(p,color,alpha){return `<g opacity="${alpha}" transform="translate(${p.x} ${p.y}) scale(${139/12.8}) translate(-8.5 -8)"><path d="${shape.path}" fill="${color}" stroke="#fff" stroke-width="0.9" stroke-linejoin="round"/></g>`;}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><metadata>${escape(license)}\nRadius 1.2; ${JSON.stringify(settings)}</metadata><rect width="256" height="256" rx="56" fill="#242426"/>${cursor(settings.back,'#34D399',.5)}${cursor(settings.front,'#A78BFA',1)}</svg>\n`;
fs.writeFileSync(path.join(root,'src/assets/app-icon.svg'),svg);
const headerFile=path.join(root,'native/multi-pointer/cursor-assets.hpp');
let header=fs.readFileSync(headerFile,'utf8');
const f=v=>{const s=Number(v.toFixed(10)).toString();return s.includes('.')?s+'f':s+'.0f';};
const data=`inline constexpr float modelCornerRadius=1.2f;\ninline constexpr std::array<PathPoint, ${shape.points.length}> modelBody{{\n${shape.points.map(({p,type})=>`    {${f(p[0])}, ${f(p[1])}, ${type===131?'0x83':type}},`).join('\n')}\n}};`;
header=header.replace(/(?:inline constexpr float modelCornerRadius=.*\n)?inline constexpr std::array<PathPoint, \d+> modelBody\{\{[\s\S]*?\}\};/,data);
fs.writeFileSync(headerFile,header);
const htmlFile=path.join(root,'docs/visualizations/agent-logo-lab.html');
let html=fs.readFileSync(htmlFile,'utf8').replace(/const PATH=.*;/,'const PATH='+JSON.stringify(shape.path)+';');
fs.writeFileSync(htmlFile,html);
console.log(JSON.stringify({radius:shape.radius,points:shape.points.length,settings}));
