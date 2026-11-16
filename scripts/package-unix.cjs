'use strict';
const packaging=require('./package.cjs');
const inventory=require('./package-inventory.cjs');
function commandLauncher(platform) {
  const host=platform==='darwin'?'WindowUseHost.app/Contents/MacOS/azrael-window-use':'WindowUseMCP';
  return '#!/bin/sh\nset -eu\nbase=$(CDPATH= cd -P "$(dirname "$0")" && pwd)\nexec "$base/'+host+'" "$@"\n';
}
if(require.main===module)packaging.main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
module.exports={...packaging,...inventory,commandLauncher};
