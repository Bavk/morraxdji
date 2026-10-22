// Offline pre-upload check. Validates known secret filenames and Android network policy.
// Does NOT prove there are no secrets inside arbitrary source files.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const blocked=[];
const denyName=/^(?:\.env(?:\..+)?|internal-secrets\.json|rooms\.json|usc-host\.conf|relay-state\.json|livekit\.yaml|compose\.yaml)$/i;
const denyExt=/\.(?:pem|p12|pfx|jks|keystore|key)$/i;
function scan(dir){
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    if(e.name==='.git'||e.name==='node_modules'||e.name==='.gradle'||e.name==='build'||e.name==='release'||e.name==='dist')continue;
    const file=path.join(dir,e.name);
    if(e.isDirectory()){scan(file);continue;}
    if(!e.isFile())continue;
    const rel=path.relative(root,file).replaceAll(path.sep,'/');
    if(e.name==='.env.example')continue;
    if(denyName.test(e.name)||denyExt.test(e.name))blocked.push(rel);
  }
}
scan(root);
assert.deepEqual(blocked,[],`Do not upload working secrets: ${blocked.join(', ')}`);
const manifest=fs.readFileSync(path.join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
assert.match(manifest,/android:networkSecurityConfig="@xml\/network_security_config"/);
assert.doesNotMatch(manifest,/usesCleartextTraffic="true"/);
const main=fs.readFileSync(path.join(root,'android/app/src/main/res/xml/network_security_config.xml'),'utf8');
assert.match(main,/<base-config cleartextTrafficPermitted="false"/);
assert.match(main,/<domain>10\.77\.0\.1<\/domain>/);
const debug=fs.readFileSync(path.join(root,'android/app/src/debug/AndroidManifest.xml'),'utf8');
assert.match(debug,/network_security_config_debug/);
assert.match(debug,/tools:replace=/);
const debugPolicy=fs.readFileSync(path.join(root,'android/app/src/debug/res/xml/network_security_config_debug.xml'),'utf8');
assert.match(debugPolicy,/<base-config cleartextTrafficPermitted="true"/);
const workflow=fs.readFileSync(path.join(root,'.github/workflows/build-and-test.yml'),'utf8');
for (const required of ['workflow_dispatch','windows-build:','android-build:','upload-artifact@v4'])assert.ok(workflow.includes(required));
console.log('Repository preflight: OK; no blocked secret filenames, Android network policies and workflow present.');
