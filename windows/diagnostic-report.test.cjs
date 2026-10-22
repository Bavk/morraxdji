'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeDiagnosticReport}=require('./diagnostic-report.cjs');
test('support report contains only safe allowlisted values, no secrets or operator identifiers',()=>{
 const report=makeDiagnosticReport({version:'0.11.0',now:'2026-10-22T10:00:00Z',
  status:{running:false,mode:'vpn',operatorUrl:'USCV1.SUPER_SECRET_TOKEN',ips:['10.77.0.1']},
  diag:{nativeReady:false,vpnConfigured:true,vpnInterfaceUp:false,wireGuardInstalled:true,
   relay:{reachable:false,error:'Authorization Bearer SECRET_TOKEN_123',windowsRegistered:false},
   previousServer:{running:true,error:'privateKey=SECRET_KEY'},
   ports:[{port:7880,protocol:'tcp',available:false,reason:'SECRET_REASON'}],
   adminToken:'SECRET_TOKEN_123',configPath:'C:/private/wireguard/usc-host.conf',
   peers:[{name:'Operator Test',privateKey:'SECRET_KEY'}]}});
 const serialized=JSON.stringify(report);
 for(const secret of ['SECRET','USCV1','10.77.0.1','Operator Test','usc-host.conf','privateKey','Authorization'])
   assert.equal(serialized.includes(secret),false,secret);
 assert.equal(report.format,'usc-support-v1');
 assert.equal(report.ports[0].port,7880);
 assert.equal(report.guidance.length>0,true);
});
test('support report handles missing fields and has no secret or IP keys',()=>{
 const report=makeDiagnosticReport();
 assert.equal(report.nativeReady,false);
 assert.deepEqual(report.ports,[]);
 assert.equal('ips' in report,false);
 assert.equal('password' in report,false);
});
