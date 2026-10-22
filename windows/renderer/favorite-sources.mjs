import {sourceKey} from './wall-layout.mjs';
const KEY='usc-favorite-sources-v1',LIMIT=500;
function valid(key){try{const parts=JSON.parse(key);return Array.isArray(parts)&&parts.length===2&&sourceKey(...parts)===key;}catch{return false;}}
export class FavoriteSources{
 constructor(storage,onError=()=>{}){this.storage=storage;this.onError=onError;this.keys=new Set();try{const raw=storage.getItem(KEY);if(raw){const keys=JSON.parse(raw);if(!Array.isArray(keys)||keys.length>LIMIT||!keys.every(valid))throw Error();this.keys=new Set(keys);}}catch{onError();}}
 has(key){return this.keys.has(key);}
 toggle(key){if(!valid(key))return false;if(this.keys.has(key))this.keys.delete(key);else{if(this.keys.size>=LIMIT)return false;this.keys.add(key);}try{this.storage.setItem(KEY,JSON.stringify([...this.keys]));}catch{this.onError();}return true;}
}
