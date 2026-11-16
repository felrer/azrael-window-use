'use strict';
const path=require('node:path');
function normalizeExecutable(value, platform=process.platform) {
  if(typeof platform!=='string')platform=process.platform; // Array.map supplies its index as the second argument.
  if(platform==='win32')return require('../vendor/azrael/use-control-settings.cjs').normalizeExecutable(value);
  if(typeof value!=='string'||!value.startsWith('/')||value.length>4096||value!==value.trim()||/[\x00-\x1f\x7f*?]/.test(value))throw Error('Invalid Window Use executable path');
  return path.posix.normalize(value);
}
const executableName=value=>(process.platform==='win32'?path.win32:path.posix).basename(value);
module.exports={normalizeExecutable,executableName};
