import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export function serverModules(directory,entry='server.mjs'){
 const root=path.resolve(directory),visited=new Set();
 function visit(relative){
  const file=path.resolve(root,relative),name=path.relative(root,file).replaceAll('\\','/');
  assert.ok(name&&!name.startsWith('../')&&!path.isAbsolute(name),'Server dependency escapes its resource directory');
  if(visited.has(name))return;visited.add(name);
  const source=fs.readFileSync(file,'utf8');
  const patterns=[/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]/g,/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g];
  for(const pattern of patterns)for(const match of source.matchAll(pattern))visit(path.relative(root,path.resolve(path.dirname(file),match[1])));
 }
 visit(entry);return [...visited].sort();
}
export function verifyServerFiles(sourceDirectory,packagedDirectory){
 const modules=serverModules(sourceDirectory);
 for(const name of modules){
  const file=path.join(packagedDirectory,name);
  assert.ok(fs.existsSync(file),'Missing packaged server dependency: '+name);
  assert.deepEqual(fs.readFileSync(file),fs.readFileSync(path.join(sourceDirectory,name)),'Packaged server dependency differs from source: '+name);
 }
 return modules;
}
