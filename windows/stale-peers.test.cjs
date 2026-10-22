'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {stalePeerIds}=require('./vpn-manager.cjs');
test('cleanup includes revoked peers AND peers whose room was deleted',()=>{
 const ids=['key_active','key_revoked','key_deleted'];
 const rooms=[{id:'room_a',keys:[{id:'key_active',revoked:false},{id:'key_revoked',revoked:true}]}];
 assert.deepEqual(stalePeerIds(ids,rooms),['key_revoked','key_deleted']);
});
test('cleanup does not delete an active peer despite duplicate peer records',()=>{
 assert.deepEqual(stalePeerIds(['key_live','key_live','key_gone'],[{keys:[{id:'key_live',revoked:false}]}]),['key_gone']);
});
