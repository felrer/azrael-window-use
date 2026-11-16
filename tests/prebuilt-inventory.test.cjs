'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {inventoryDistribution,describeDistribution}=require('../scripts/package-unix.cjs');
// Each packaging revision must inventory the complete distribution, rather than
// only application sources, and keep native framework links explicit.
test('prebuilt transport inventory is exact and excludes only its own build receipt',t=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'awu-distribution-'));
  t.after(()=>fs.rmSync(root,{recursive:true}));
  fs.writeFileSync(path.join(root,'host'),'host');
  fs.writeFileSync(path.join(root,'build-info.json'),'receipt');
  const inventory=inventoryDistribution(root);
  assert.equal(inventory.length,1);assert.equal(inventory[0].path,'host');assert.equal(inventory[0].bytes,4);
  assert.throws(()=>describeDistribution(root,{schema:1,status:'passed'}),/source-pinned/);
  fs.writeFileSync(path.join(root,'extra'),'extra');assert.equal(inventoryDistribution(root).length,2);
});
test('prebuilt transport records relative framework aliases without following directories',{skip:process.platform==='win32'},t=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'awu-distribution-'));
  t.after(()=>fs.rmSync(root,{recursive:true}));
  fs.mkdirSync(path.join(root,'Versions/A'),{recursive:true});fs.writeFileSync(path.join(root,'Versions/A/host'),'host');
  fs.symlinkSync('A',path.join(root,'Versions/Current'));
  assert.deepEqual(inventoryDistribution(root).find(entry=>entry.type==='symlink'),{path:'Versions/Current',type:'symlink',linkTarget:'A'});
  fs.symlinkSync('../',path.join(root,'outside'));assert.throws(()=>inventoryDistribution(root),/Unsafe/);
});
