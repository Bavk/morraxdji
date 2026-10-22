'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {renderCompose}=require('./compose-config.cjs');
const {managedComposeFile,recoverManagedServer,inspectManagedServer}=require('./server-recovery.cjs');
test('recovery is no-op without app-owned config',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'usc-rec-'));
 try{
  let called=false;
  assert.deepEqual(await recoverManagedServer(dir,async()=>{called=true;}),{recovered:false,reason:'Старая конфигурация LiveKit не найдена'});
  assert.equal(called,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('recovery only runs docker compose down for an owned configuration',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'usc-rec-'));
 try{
  writeFileSync(path.join(dir,'compose.yaml'),renderCompose('10.77.0.1'));
  let calls=[];
  const run=async(...params)=>{calls.push(params);return calls.length===1?'container123\n':'';};
  assert.deepEqual(await inspectManagedServer(dir,run),{configured:true,running:true});
  assert.deepEqual(await recoverManagedServer(dir,run),{recovered:true});
  assert.deepEqual(calls[1][1].slice(-2),['down','--remove-orphans']);
  assert.equal(calls[1][2],dir);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('recovery refuses unrelated or modified compose projects',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'usc-rec-'));
 try{
  writeFileSync(path.join(dir,'compose.yaml'),'name: unrelated\nservices:\n');
  assert.throws(()=>managedComposeFile(dir));
  await assert.rejects(recoverManagedServer(dir,()=>{throw Error('MUST NOT RUN');}),/не принадлежит/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
