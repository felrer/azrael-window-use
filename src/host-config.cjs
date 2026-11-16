'use strict';
const path=require('node:path');
const os=require('node:os');
function configuration(argv=process.argv.slice(2),env=process.env) {
  const packaged=env.AZ_WINDOW_USE_PACKAGED==='1';
  const absolute=(value,name)=>{if(!value||!path.isAbsolute(value))throw Error('Absolute '+name+' required');return value;};
  const option=name=>{const index=argv.indexOf(name);return index<0?undefined:absolute(argv[index+1],name);};
  const resources=env.AZ_WINDOW_USE_RESOURCES?absolute(env.AZ_WINDOW_USE_RESOURCES,'AZ_WINDOW_USE_RESOURCES'):undefined;
  if(packaged&&!resources)throw Error('Packaged resource root required');
  const appRoot=packaged?path.join(resources,'app'):path.resolve(__dirname,'..');
  const executable=absolute(env.AZ_WINDOW_USE_HOST_EXECUTABLE,'AZ_WINDOW_USE_HOST_EXECUTABLE');
  const node=absolute(env.AZ_WINDOW_USE_NODE||process.execPath,'AZ_WINDOW_USE_NODE');
  if(packaged&&argv.includes('--runtime-directory'))throw Error('Development-only --runtime-directory');
  const runtimeDirectory=option('--runtime-directory')||(resources?path.join(resources,'runtime/window-control'):path.join(appRoot,'artifacts/runtime/window-control'));
  const explicitProfile=option('--user-data-dir');
  const appData=process.platform==='win32'?(env.APPDATA||path.join(os.homedir(),'AppData/Roaming')):process.platform==='darwin'?path.join(os.homedir(),'Library/Application Support'):(env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'));
  const directory=explicitProfile||path.join(appData,'Azrael Window Use MCP');
  const args=['--shared-service',...(!packaged?['--runtime-directory',runtimeDirectory]:[]),...(explicitProfile?['--user-data-dir',directory]:[])];
  return {packaged,resources,appRoot,executable,node,runtimeDirectory,directory,args,sharedDirectory:env.AZ_WINDOW_USE_SHARED_DIRECTORY||(explicitProfile?path.join(directory,'shared'):require('./service-registry.cjs').defaultDirectory()),version:require(path.join(appRoot,'package.json')).version};
}
module.exports={configuration};
