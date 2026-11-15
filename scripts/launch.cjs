'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const arguments_ = process.argv.slice(2);
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const electron = require('electron');
let executable = electron, childArguments = [root, ...arguments_];
if (arguments_.includes('--mcp')) {
  const source = path.join(root,'launcher/Program.cs');
  const icon = path.join(root,'src/assets/app-icon.ico');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).update(fs.readFileSync(icon)).digest('hex');
  // Icon changes must not overwrite an executable still owned by another MCP.
  const directory = path.join(root,'artifacts/build/dev-launcher',hash);
  fs.mkdirSync(directory,{recursive:true});
  executable = path.join(directory,'WindowUseMCP.exe');
  const receipt = path.join(directory,'source-sha256.txt');
  if(!fs.existsSync(executable)||!fs.existsSync(receipt)||fs.readFileSync(receipt,'utf8')!==hash){
    const result=spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:exe','/platform:x64','/win32icon:'+icon,'/out:'+executable,source],{windowsHide:true,encoding:'utf8'});
    if(result.status!==0){process.stderr.write(result.stdout||result.stderr||'Launcher compilation failed\n');process.exit(result.status||1);}
    fs.writeFileSync(receipt,hash);
  }
  childArguments=['--host',electron,'--app',root,...arguments_];
}
const child=spawn(executable,childArguments,{cwd:root,env:environment,stdio:'inherit',windowsHide:true});
child.on('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
