import fs from 'node:fs';
import path from 'node:path';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const types=new Set(['operator-biz','operator-tech','provider-biz','provider-tech']);
const statuses=new Set(['queued','creating','working','ready','partial','uncertain','cancelled']);
export const safeOnboardingLink=value=>typeof value==='string'&&/^https:\/\/t\.me\/(?:\+|joinchat\/)[a-zA-Z0-9_-]+$/.test(value)?value:null;

function chatProjection(job,id){
 if(!object(job)||job.id!==id||typeof job.leadId!=='string'||!job.leadId||!types.has(job.type)||!statuses.has(job.status)||typeof job.title!=='string'||!job.title.trim()||job.title.length>128||/[\x00-\x1f]/.test(job.title)||typeof job.createdAt!=='string'||!Number.isFinite(Date.parse(job.createdAt))||!object(job.group))return null;
 const groupId=job.group.id;
 if(!(typeof groupId==='string'&&/^[1-9]\d{0,19}$/.test(groupId))&&!(Number.isSafeInteger(groupId)&&groupId>0))return null;
 const link=safeOnboardingLink(job.link);
 // Deliberately allowlist card data: group access hashes, session details and
 // participant/worker internals must stay in the private worker job files.
 return {groupId:String(groupId),...(link?{link}:{}),type:job.type,title:job.title,status:'Chat created',setupStatus:job.status,createdAt:job.createdAt};
}

// The bot is the sole state.json writer. Workers only publish durable jobs.
export function projectOnboardingChats(state,directory){
 if(!directory)return state;
 let entries;try{entries=fs.readdirSync(directory,{withFileTypes:true});}catch{return state;}
 for(const entry of entries){
  if(!entry.isFile()||!(/^[a-f0-9]{32}\.json$/).test(entry.name))continue;
  try{
   const job=JSON.parse(fs.readFileSync(path.join(directory,entry.name),'utf8'));
   const chat=chatProjection(job,entry.name.slice(0,-5));if(!chat)continue;
   if(!object(state.leads)||!Object.hasOwn(state.leads,job.leadId))continue;
   const lead=state.leads[job.leadId];if(!object(lead)||lead.deletedAt)continue;
   if(!object(lead.onboardingChats))lead.onboardingChats={};
   lead.onboardingChats[job.id]={...(object(lead.onboardingChats[job.id])?lead.onboardingChats[job.id]:{}),...chat};
  }catch{ /* Keep the last safe projection when a job is absent or damaged. */ }
 }
 return state;
}
