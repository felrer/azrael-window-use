'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function launchOptions(args=process.argv.slice(2),env=process.env) {
  const executable=path.resolve(env.AZ_WINDOW_USE_HOST_EXECUTABLE||path.join(root,'src-tauri/target/debug/azrael-window-use'+(process.platform==='win32'?'.exe':'')));
  const node=env.AZ_WINDOW_USE_NODE||process.execPath;
  if(!path.isAbsolute(node))throw Error('AZ_WINDOW_USE_NODE must be absolute');
  for(const file of [executable,node])if(!fs.statSync(file).isFile())throw Error('Launch executable is not a file: '+file);
  const environment={...env,AZ_WINDOW_USE_DEV_ROOT:root,AZ_WINDOW_USE_NODE:node,AZ_WINDOW_USE_HOST_EXECUTABLE:executable,AZ_WINDOW_USE_RESOURCES:path.join(root,'artifacts/tauri-resources')};
  delete environment.AZ_WINDOW_USE_PACKAGED;
  delete environment.NODE_OPTIONS;delete environment.NODE_PATH;
  return {executable,args,options:{cwd:root,env:environment,stdio:'inherit',windowsHide:true}};
}
if(require.main===module)try {
  const spec=launchOptions(),child=spawn(spec.executable,spec.args,spec.options);
  child.on('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
  child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
} catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
module.exports={launchOptions};
