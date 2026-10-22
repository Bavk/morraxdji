// Independent of npm dependencies. Check source prerequisites and never treat
// a successful source audit as a successful Android or Windows binary build.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const mustExist=[
 'windows/main.cjs','windows/room-lifecycle.cjs','windows/preload.cjs','windows/package.json','windows/diagnostic-report.cjs',
 'windows/smoke.cjs','windows/renderer/main.js','windows/renderer/index.html','windows/vite.config.mjs','scripts/verify-ui-build.mjs',
 'server/server.mjs','server/revoked-reconciler.mjs','server/pending-deletions.mjs',
 'server/livekit-admin.mjs','server/operator-network.mjs',
 'android/app/build.gradle.kts','android/app/src/main/AndroidManifest.xml',
 'android/app/src/main/res/xml/network_security_config.xml','android/app/src/debug/res/xml/network_security_config_debug.xml',
 'scripts/repo-safety.mjs','GITHUB_START_RU.md', 'CHANGELOG_v0.15_RU.md',
 'android/app/src/main/java/com/universalstream/operator/MainActivity.kt',
 'relay/relay.mjs','relay/install-relay-ubuntu.sh',
 '.github/workflows/build-and-test.yml'
];
for(const f of mustExist)assert.ok(fs.statSync(f).isFile(),`Missing ${f}`);
const win=JSON.parse(fs.readFileSync('windows/package.json','utf8'));
const vite=(await import('../windows/vite.config.mjs')).default;
assert.equal(vite.root,'renderer');
assert.equal(vite.base,'./','Electron file:// needs relative Vite base');
assert.equal(vite.build.outDir,'../dist');
assert.match(win.scripts['build:ui'],/verify-ui-build/,'Check renderer assets after Vite');
assert.equal(win.build?.extraResources?.[0]?.to,'server');
assert.ok(win.build.files.includes('diagnostic-report.cjs'),'Packaged Electron must include diagnostics module');
assert.ok(win.build.files.includes('room-lifecycle.cjs'),'Packaged Electron must include room lifecycle module');
const workflow=fs.readFileSync('.github/workflows/build-and-test.yml','utf8');
assert.match(workflow,/Check Windows installer format/);
assert.match(workflow,/Smoke test real Electron renderer and preload/);
assert.match(workflow,/Verify packaged LiveKit API sources/);
assert.equal(win.scripts['smoke:ui'],'electron smoke.cjs');
assert.match(workflow,/Verify Android APK package and debug signature/);
for(const dep of ['server.mjs','livekit-admin.mjs','operator-network.mjs','revoked-reconciler.mjs','pending-deletions.mjs']){
 assert.ok(fs.existsSync(`server/${dep}`));
 assert.ok(win.build.extraResources.some(x=>x.from==='../server' && x.filter.some(filter=>filter==='*.mjs' || filter===dep)),
  `Packaged Electron server misses ${dep}`);
}
const androidSource=fs.readFileSync('android/app/src/main/java/com/universalstream/operator/MainActivity.kt','utf8');
assert.match(androidSource,/adaptOutputToDimensions\s*=\s*false/,'Preserve screen edges of non-16:9 controllers');
const android=fs.readFileSync('android/app/src/main/AndroidManifest.xml','utf8');
assert.match(android,/FOREGROUND_SERVICE_MEDIA_PROJECTION/);
assert.match(android,/android:foregroundServiceType="mediaProjection"/);
const gradle=fs.readFileSync('android/build.gradle.kts','utf8');
assert.match(gradle,/8\.7\.3/);
const shell=fs.readFileSync('relay/install-relay-ubuntu.sh','utf8');
assert.match(shell,/USC_FORWARD/);
console.log(`Source structure: OK (${mustExist.length} required files; packaged server dependency graph checked)`);
