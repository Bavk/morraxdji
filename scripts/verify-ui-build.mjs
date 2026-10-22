// Executed after Vite build. An Electron file:// page cannot resolve assets
// written as /assets/... against the filesystem root.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(project,'windows','dist');
const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
const references=[...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map(match=>match[1]).filter(name=>name.endsWith('.js') || name.endsWith('.css'));
assert.ok(references.length>=2,'Missing bundled JavaScript/CSS in Vite HTML');
for(const relative of references){
  assert.ok(relative.startsWith('./'),`Absolute asset path breaks file://: ${relative}`);
  const absolute=path.resolve(out,relative);
  assert.ok(absolute.startsWith(out+path.sep),'Asset escapes dist folder');
  assert.ok(fs.existsSync(absolute),`Missing output asset: ${relative}`);
}
console.log(`Electron renderer verified: ${references.length} relative asset(s)`);
