'use strict';
const {geometry}=require('./assets/cursor-geometry.cjs');
// Cosmetic only. This owner never posts, captures, suppresses or focuses input.
function createAgentOverlay({BrowserWindow,screen}) {
  const entries=new Map();let sequence=0;
  const available=()=>process.platform!=='linux'||screen.getAllDisplays().every(display=>display.scaleFactor===1);
  function visualize(id,point,phase='active'){
    if(!available())return;
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error('Invalid Agent visual position');
    let entry=entries.get(id);
    if(!entry){const number=++sequence,color=`hsl(${(number*137.50776405+240)%360} 76% 72%)`;
      const window=new BrowserWindow({width:150,height:64,transparent:true,frame:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,resizable:false,show:false,hasShadow:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      window.setIgnoreMouseEvents(true);window.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
      const html=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{margin:0;background:transparent;color:white;font:12px system-ui}svg{width:40px;height:40px;vertical-align:middle}span{border-radius:6px;padding:3px 6px;background:#242424dd}</style><svg viewBox="0 0 16 16"><path d="${geometry(1.2).path}" fill="${color}" stroke="white" stroke-width=".8"/></svg><span>Agent ${number}</span>`;
      entry={window,ready:window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html))};entries.set(id,entry);
    }
    clearTimeout(entry.timer);
    const display=screen.getDisplayNearestPoint({x:Math.round(point.x),y:Math.round(point.y)}).bounds;
    entry.window.setPosition(Math.max(display.x,Math.min(display.x+display.width-150,Math.round(point.x)-10)),Math.max(display.y,Math.min(display.y+display.height-64,Math.round(point.y)-4)));
    const show=()=>{if(entry.window.isDestroyed())return;entry.window.setOpacity(phase==='active'?1:.4);entry.window.showInactive();};
    entry.ready.then(show).catch(()=>{});
    if(phase==='active')entry.timer=setTimeout(()=>{if(!entry.window.isDestroyed())entry.window.setOpacity(.4);},1000);
  }
  function release(id){const entry=entries.get(id);if(entry){clearTimeout(entry.timer);if(!entry.window.isDestroyed())entry.window.destroy();entries.delete(id);}}
  return {visualize,release,available,dispose(){for(const id of [...entries.keys()])release(id);}};
}
module.exports={createAgentOverlay};
