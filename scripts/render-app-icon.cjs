'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
async function render(profile){
 if(!profile||!path.isAbsolute(profile))throw Error('Absolute task-owned browser profile required');
 const root=path.resolve(__dirname,'..'),assets=path.join(root,'src/assets');
 const browser=await chromium.launchPersistentContext(profile,{headless:true,
  executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage();
  const source=fs.readFileSync(path.join(assets,'app-icon.svg'),'utf8');
  const images=[];
  for(const size of [16,20,24,32,40,48,64,128,256]){
   const data=await page.evaluate(async({source,size})=>{
    const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(source)));await image.decode();
    const hi=document.createElement('canvas');hi.width=hi.height=size*4;hi.getContext('2d').drawImage(image,0,0,hi.width,hi.height);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(hi,0,0,size,size);
    return canvas.toDataURL('image/png').split(',')[1];
   },{source,size});
   const bytes=Buffer.from(data,'base64');images.push({size,bytes});
   fs.writeFileSync(path.join(assets,`app-icon-${size}.png`),bytes);
  }
  const header=Buffer.alloc(6+images.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);
  let offset=header.length;images.forEach(({size,bytes},i)=>{
   const p=6+i*16;header[p]=header[p+1]=size===256?0:size;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);
   header.writeUInt32LE(bytes.length,p+8);header.writeUInt32LE(offset,p+12);offset+=bytes.length;
  });
  fs.writeFileSync(path.join(assets,'app-icon.ico'),Buffer.concat([header,...images.map(i=>i.bytes)]));
  console.log(JSON.stringify({pngSizes:images.map(i=>i.size),icoFrames:images.length}));
 }finally{await browser.close();}
}
if(require.main===module)render(process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={render};
