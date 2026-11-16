'use strict';
// Cosmetic events only; the Rust host owns display geometry and nonactivating windows.
function createAgentOverlay({send}) {
  let disposed=false;
  return {available:()=>!disposed,visualize(id,point,phase='active'){if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error('Invalid Agent visual position');if(!disposed)send({event:'overlay',action:'visualize',data:{id,point:{x:point.x,y:point.y},phase}});},release(id){if(!disposed)send({event:'overlay',action:'release',data:{id}});},dispose(){if(!disposed){send({event:'overlay',action:'dispose',data:{}});disposed=true;}}};
}
module.exports={createAgentOverlay};
