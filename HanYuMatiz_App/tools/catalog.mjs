import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
export function buildCatalog({mode='public'}={}){
  if(!['public','private'].includes(mode))throw Error('Modo inválido.');
  const data=JSON.parse(fs.readFileSync(path.join(ROOT,'data/catalog.json'),'utf8'));
  for(const key of ['words','contrasts','scenarios','exercises','examples','relations','fixtures','levels','lessons']){
    if(!Array.isArray(data[key])||new Set(data[key].map(row=>row.id)).size!==data[key].length)throw Error('Catálogo inválido: '+key);
  }
  data.mode=mode;
  const content=Object.fromEntries(Object.entries(data).filter(([key])=>!['mode','delivery','dataVersion'].includes(key)));
  data.dataVersion=crypto.createHash('sha256').update(canonical(content)).digest('hex');
  return data;
}
