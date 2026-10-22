import {test} from 'node:test';import assert from 'node:assert/strict';
import {WallLayout,sourceKey} from './wall-layout.mjs';
const a=sourceKey('room1','operator1'),b=sourceKey('room1','operator2'),c=sourceKey('room2','operator1');
function storage(){const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};}
test('source order and grid survive restart independently of changing track IDs and names',()=>{
 const disk=storage(),layout=new WallLayout(disk);layout.remember([a,b,c]);layout.move(c,-1,[a,b,c]);layout.move(c,-1,[a,b,c]);layout.setColumns(3);
 const reload=new WallLayout(disk);assert.equal(reload.columns,3);assert.deepEqual(reload.sorted([b,a,c]),[c,a,b]);assert.notEqual(a,c);assert.throws(()=>sourceKey('','p'));assert.throws(()=>sourceKey('r',{}));
});
test('offline sources retain order when online sources move and reconnect',()=>{
 const layout=new WallLayout(storage());layout.remember([a,b,c]);layout.move(c,-1,[a,c]);assert.deepEqual(layout.sorted([a,c]),[c,a]);assert.deepEqual(layout.sorted([a,b,c]),[c,b,a]);
 assert.equal(layout.move(c,-1,[a,c]),false);assert.equal(layout.move('missing',1,[a,c]),false);assert.equal(layout.move(c,8,[a,c]),false);
 layout.reset([b,a]);assert.deepEqual(layout.order,[b,a]);layout.remember([c]);assert.deepEqual(layout.sorted([c,b,a]),[b,a,c]);
});
test('legacy grid migrates, invalid settings recover and storage errors preserve in-memory layout',()=>{
 const disk=storage();disk.setItem('usc-grid-columns','2');let errors=0;const layout=new WallLayout(disk,()=>errors++);assert.equal(layout.columns,2);assert.equal(layout.setColumns(99),false);layout.remember([a]);
 disk.setItem('usc-wall-layout-v1','broken');assert.equal(new WallLayout(disk,()=>errors++).columns,0);assert.equal(errors,1);
 const denied=new WallLayout({getItem(){throw Error();},setItem(){throw Error();}},()=>errors++);denied.remember([a,b]);assert.equal(denied.move(b,-1,[a,b]),true);assert.deepEqual(denied.sorted([a,b]),[b,a]);assert.equal(denied.setColumns(4),false);assert.equal(denied.columns,4);
});
test('order storage is bounded and duplicate identities cannot corrupt order',()=>{
 const disk=storage(),layout=new WallLayout(disk);layout.remember(Array.from({length:600},(_,i)=>sourceKey('room',String(i))));assert.equal(layout.order.length,500);layout.remember([layout.order[0]]);assert.equal(layout.order.length,500);assert.deepEqual(new WallLayout(disk).order,layout.order);
});
