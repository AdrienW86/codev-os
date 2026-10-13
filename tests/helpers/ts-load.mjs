// Loads a TypeScript module in an isolated VM with mocked imports (same approach as the Publications test suites).
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as React from 'react';
const native=createRequire(import.meta.url);
export const root=resolve(new URL('../..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
// globals (optional): extra names exposed to the module (e.g. a fake process for a route handler).
export function load(file,mocks={},globals={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,Math,Array,String,Boolean,Promise,Error,RegExp,Intl,Buffer,Uint8Array,FormData,URLSearchParams,URL,console,setTimeout,...globals,
   require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='react')return React;if(name==='server-only')return {};
   if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
export const src=file=>readFileSync(resolve(root,file),'utf8');
export const json=value=>JSON.parse(JSON.stringify(value));
export const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const form=entries=>{const f=new FormData();for(const [k,v] of Object.entries(entries))f.set(k,v);return f;};
