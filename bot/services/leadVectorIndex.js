import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const EMBEDDING_MODEL='text-embedding-3-small';
export const EMBEDDING_DIMENSIONS=1536;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function leadDocuments(lead){
 const identity=[lead.fields?.fullName,lead.fields?.company].filter(Boolean).join(' · ');
 const sources=[['Lead ID',lead.id],...Object.entries(lead.fields||{}),...(lead.materials||[])
  .filter(m=>!['excluded','omitted'].includes(m.status)).map(m=>['Note '+(m.createdAt||''),m.transcript||m.text||''])];
 const chunks=[];
 for(const [label,value] of sources){
  if(typeof value!=='string'||!value.trim())continue;
  const chars=Array.from(value);
  for(let start=0;start<chars.length;start+=1350){
   const source=chars.slice(start,start+1500).join('');
   const header=Array.from(identity+'\n'+label).slice(0,500).join('');
   chunks.push({text:header+'\n'+source,source,label});
   if(start+1500>=chars.length)break;
  }
 }
 return chunks;
}
export const leadFingerprint=lead=>hash([lead.createdAt,leadDocuments(lead)]);
export function validVector(vector,dimensions){return Array.isArray(vector)&&vector.length===dimensions&&vector.every(Number.isFinite)&&vector.some(v=>v!==0);}
export function validateVectorIndex(index,{model=EMBEDDING_MODEL,dimensions=EMBEDDING_DIMENSIONS}={}){
 if(index?.version!==1||index.model!==model||index.dimensions!==dimensions||!Array.isArray(index.entries)||!Number.isFinite(Date.parse(index.updatedAt)))throw Error('Invalid vector index metadata');
 const ids=new Set();
 for(const entry of index.entries){
  if(typeof entry.id!=='string'||ids.has(entry.id)||typeof entry.hash!=='string'||!Array.isArray(entry.chunks)||!entry.chunks.length)throw Error('Invalid vector index entry');
  ids.add(entry.id);
  for(const chunk of entry.chunks)if(typeof chunk.text!=='string'||typeof chunk.source!=='string'||typeof chunk.label!=='string'||!validVector(chunk.vector,dimensions))throw Error('Invalid vector index chunk');
 }
 return index;
}
export function readVectorIndex(file,options={}){
 if(!file)return null;
 try{return validateVectorIndex(JSON.parse(fs.readFileSync(file,'utf8')),options);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export function writeVectorIndex(file,index){
 validateVectorIndex(index,{model:index.model,dimensions:index.dimensions});
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const temporary=file+'.'+randomUUID()+'.tmp';
 try{
  const fd=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(index));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);
 }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
export async function buildVectorIndex(leads,{previous=null,embed,model=EMBEDDING_MODEL,dimensions=EMBEDDING_DIMENSIONS,now=new Date()}={}){
 if(previous)validateVectorIndex(previous,{model,dimensions});
 const old=new Map((previous?.entries||[]).map(e=>[e.id,e])),entries=[],pending=[];
 for(const lead of leads.filter(l=>!l.deletedAt)){
  const fingerprint=leadFingerprint(lead),cached=old.get(lead.id);
  if(cached?.hash===fingerprint){entries.push(cached);continue;}
  const chunks=leadDocuments(lead);if(!chunks.length)continue;
  entries.push({id:lead.id,hash:fingerprint,chunks});pending.push(...chunks);
 }
 for(let offset=0;offset<pending.length;offset+=32){
  const batch=pending.slice(offset,offset+32),vectors=await embed(batch.map(c=>c.text));
  if(!Array.isArray(vectors)||vectors.length!==batch.length)throw Error('Incomplete embedding response');
  vectors.forEach((vector,i)=>{if(!validVector(vector,dimensions))throw Error('Invalid embedding vector');batch[i].vector=vector;});
 }
 return validateVectorIndex({version:1,model,dimensions,updatedAt:new Date(now).toISOString(),entries},{model,dimensions});
}
export function cosine(a,b){
 let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
 return dot/Math.sqrt(aa*bb);
}
