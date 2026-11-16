'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {inventoryApp,restoreRelativeLinks}=require('../scripts/package-unix.cjs');

// Retained: switching packaging inventories or copy options can accidentally
// reject npm executable links or stop verifying exact contained link identities.
test('prepared app inventory records ordinary file identity',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'awu-package-'));
  try {
    await fs.writeFile(path.join(directory,'entry.cjs'),'hello');
    const files=inventoryApp(directory);
    assert.deepEqual(files,[{path:'entry.cjs',bytes:5,sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'}]);
  } finally {await fs.rm(directory,{recursive:true});}
});
test('prepared app inventory preserves safe relative links and rejects unsafe targets',{skip:process.platform==='win32'},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'awu-package-'));
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'awu-outside-'));
  try {
    await fs.mkdir(path.join(directory,'node_modules/.bin'),{recursive:true});
    await fs.mkdir(path.join(directory,'node_modules/which'));
    await fs.writeFile(path.join(directory,'node_modules/which/cli.cjs'),'hello');
    const link=path.join(directory,'node_modules/.bin/node-which');
    await fs.symlink('../which/cli.cjs',link);
    let entry=inventoryApp(directory).find(file=>file.path==='node_modules/.bin/node-which');
    assert.equal(entry.linkTarget,'../which/cli.cjs');
    assert.equal(entry.resolvedPath,'node_modules/which/cli.cjs');
    assert.equal(entry.sha256,'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    const copied=path.join(outside,'copied-app'),prepared=inventoryApp(directory);
    await fs.cp(directory,copied,{recursive:true,dereference:false});
    restoreRelativeLinks(directory,copied,prepared);
    assert.deepEqual(inventoryApp(copied),prepared);
    assert.equal(await fs.readlink(path.join(copied,entry.path)),entry.linkTarget);
    await fs.writeFile(path.join(directory,'node_modules/which/cli.cjs'),'changed');
    assert.notEqual(inventoryApp(directory).find(file=>file.path===entry.path).sha256,entry.sha256);
    await fs.unlink(link);await fs.symlink(path.join(directory,'node_modules/which/cli.cjs'),link);
    assert.throws(()=>inventoryApp(directory),/Absolute application link/);
    await fs.unlink(link);await fs.writeFile(path.join(outside,'external'),'external');
    await fs.symlink(path.relative(path.dirname(link),path.join(outside,'external')),link);
    assert.throws(()=>inventoryApp(directory),/escapes its root/);
    await fs.unlink(link);await fs.symlink('node-which',link);
    assert.throws(()=>inventoryApp(directory),/Cyclic application link/);
    await fs.unlink(link);await fs.symlink('../which',link);
    assert.throws(()=>inventoryApp(directory),/regular file/);
  } finally {
    await fs.rm(directory,{recursive:true});
    await fs.rm(outside,{recursive:true});
  }
});
