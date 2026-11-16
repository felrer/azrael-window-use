'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function zipWindows({distribution,release,run,version,files,step}) {
  const zipName='WindowUseMCP-'+version+'-win32-x64.zip',zip=path.join(release,zipName);
  const zipInventoryFile=path.join(run,'zip-inventory.json'),zipScript=path.join(run,'zip.ps1');
  fs.writeFileSync(zipScript,"$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n$created=[System.IO.Compression.ZipFile]::Open($env:WU_PACKAGE_ZIP,[System.IO.Compression.ZipArchiveMode]::Create)\ntry { $base=[System.IO.Path]::GetFullPath($env:WU_PACKAGE_DIRECTORY); $prefix=[System.IO.Path]::GetFileName($base); foreach($file in [System.IO.Directory]::GetFiles($base,'*',[System.IO.SearchOption]::AllDirectories)) { $relative=$file.Substring($base.Length+1).Replace([char]92,[char]47); [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($created,$file,($prefix+'/'+$relative),[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null } } finally { $created.Dispose() }\n$archive=[System.IO.Compression.ZipFile]::OpenRead($env:WU_PACKAGE_ZIP)\n$rows=@()\ntry { foreach($entry in $archive.Entries) { if($entry.FullName.EndsWith('/')) { continue }; $stream=$entry.Open(); $hash=[System.Security.Cryptography.SHA256]::Create(); try { $digest=[BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant(); $rows+=@{path=$entry.FullName; bytes=$entry.Length; sha256=$digest} } finally { $stream.Dispose(); $hash.Dispose() } } } finally { $archive.Dispose() }\nConvertTo-Json -Depth 5 -InputObject @($rows) | Set-Content -LiteralPath $env:WU_PACKAGE_ZIP_INVENTORY -Encoding UTF8\n");
  // Generated script receives paths as data; no shell interpolation of paths.
  const original={WU_PACKAGE_DIRECTORY:process.env.WU_PACKAGE_DIRECTORY,WU_PACKAGE_ZIP:process.env.WU_PACKAGE_ZIP,WU_PACKAGE_ZIP_INVENTORY:process.env.WU_PACKAGE_ZIP_INVENTORY};
  Object.assign(process.env,{WU_PACKAGE_DIRECTORY:distribution,WU_PACKAGE_ZIP:zip,WU_PACKAGE_ZIP_INVENTORY:zipInventoryFile});
  try {step('zip-and-verify','C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',zipScript],run);}finally{for(const [key,value]of Object.entries(original))if(value===undefined)delete process.env[key];else process.env[key]=value;}
  const entries=JSON.parse(fs.readFileSync(zipInventoryFile,'utf8').replace(/^\uFEFF/,'')),zipped=new Map();
  for(const entry of entries){if(zipped.has(entry.path))throw Error('Duplicate ZIP member');zipped.set(entry.path,entry);}
  if(zipped.size!==files.length)throw Error('ZIP member count differs from payload');
  for(const member of files){const entry=zipped.get(path.basename(distribution)+'/'+member.path);if(!entry||entry.bytes!==member.bytes||entry.sha256!==member.sha256)throw Error('ZIP content differs: '+member.path);}
  return {path:zipName,bytes:fs.statSync(zip).size,sha256:sha(fs.readFileSync(zip)),exactContents:true};
}
module.exports={zipWindows};
