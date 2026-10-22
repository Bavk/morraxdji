import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {serverModules,verifyServerFiles} from '../scripts/server-dependencies.mjs';

test('real server dependency closure includes settings and rejects an installer missing it',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'usc-package-regression-'));
 try{
  const source=path.resolve('server'),files=serverModules(source);assert.ok(files.includes('settings.mjs'));
  for(const file of files){fs.mkdirSync(path.dirname(path.join(directory,file)),{recursive:true});fs.copyFileSync(path.join(source,file),path.join(directory,file));}
  assert.deepEqual(verifyServerFiles(source,directory),files);
  fs.unlinkSync(path.join(directory,'settings.mjs'));assert.throws(()=>verifyServerFiles(source,directory),/Missing packaged server dependency: settings.mjs/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('new transitive imports and cycles are discovered without updating a hand-written list',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'usc-package-graph-'));
 try{fs.mkdirSync(path.join(directory,'nested'));fs.writeFileSync(path.join(directory,'server.mjs'),"import fs from 'node:fs'; import './nested/a.mjs';");fs.writeFileSync(path.join(directory,'nested/a.mjs'),"export {value} from '../b.mjs';");fs.writeFileSync(path.join(directory,'b.mjs'),"import './server.mjs'; export const value=1;");assert.deepEqual(serverModules(directory),['b.mjs','nested/a.mjs','server.mjs']);}
 finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('package check also rejects mismatched copies of existing dependency files',()=>{
 const source=fs.mkdtempSync(path.join(os.tmpdir(),'usc-package-source-')),target=fs.mkdtempSync(path.join(os.tmpdir(),'usc-package-target-'));
 try{fs.writeFileSync(path.join(source,'server.mjs'),'export const value=1;');fs.writeFileSync(path.join(target,'server.mjs'),'export const value=0;');assert.throws(()=>verifyServerFiles(source,target),/differs from source/);}
 finally{fs.rmSync(source,{recursive:true,force:true});fs.rmSync(target,{recursive:true,force:true});}
});
