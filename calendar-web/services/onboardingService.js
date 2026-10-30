import {addedParticipants,confirmedIdentity} from './onboardingParticipantPhotos.js';
import fs from 'node:fs';import path from 'node:path';import {createHash,randomBytes} from 'node:crypto';import {atomicJson} from './adminService.js';
import {selectedOnboardingTemplates} from './onboardingTemplates.js';
export const ONBOARDING_TYPES={'operator-biz':'Operator Biz','operator-tech':'Operator Tech','provider-biz':'Provider Biz','provider-tech':'Provider Tech'};
const operatorAvatar=new URL('../operator-avatar-white.jpg',import.meta.url),providerAvatar=new URL('../provider-avatar-black.jpg',import.meta.url);
const avatarFiles=Object.freeze({'operator-biz':operatorAvatar,'operator-tech':operatorAvatar,'provider-biz':providerAvatar,'provider-tech':providerAvatar});
export function onboardingAvatarFile(type){if(!Object.hasOwn(avatarFiles,type))throw new Error('Unknown chat type.');return avatarFiles[type];}
export function canOnboard(lead,actor,settings){return Boolean(lead&&!lead.deletedAt&&!settings.users?.[actor]?.blocked&&settings.users?.[actor]?.role!=='promoter'&&(settings.users?.[actor]?.role==='admin'||lead.owner===actor+':'+actor||String(lead.assigneeId||'')===String(actor)));}
export function manualInvitations(job){
 if(!job.group||!['partial','ready'].includes(job.status)||!/^https:\/\/t\.me\/(?:\+|joinchat\/)[a-zA-Z0-9_-]+$/.test(job.link||''))return [];
 const text='Hi! We created the onboarding chat “'+job.title+'”. Please join:\n'+job.link;
 return (job.participants||[]).filter(username=>/^[a-z][a-z0-9_]{3,31}$/.test(username)&&!job.steps?.invited?.includes(username)).map(username=>({username,text,url:'https://t.me/'+username+'?text='+encodeURIComponent(text)}));
}
export class OnboardingJobs{
 constructor(directory){this.directory=directory;fs.mkdirSync(directory,{recursive:true,mode:0o700});}
 file(id){if(!/^[a-f0-9]{32}$/.test(id))throw new Error('Invalid chat.');return path.join(this.directory,id+'.json');}
 read(id){const file=this.file(id);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
 save(job){atomicJson(this.file(job.id),job);return job;}
 all(){return fs.readdirSync(this.directory).filter(n=>/^[a-f0-9]{32}\.json$/.test(n)).map(n=>this.read(n.slice(0,-5))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 public(job){const {group,intro,introRandomId,introMessages,participantProfiles,requestFingerprint,...value}=job;return {...value,...(introMessages?{introMessages:introMessages.map(({randomId,...message})=>message)}:{}),addedParticipants:addedParticipants(job),manualInvites:manualInvitations(job),hasGroup:Boolean(group),groupId:group?.id,groupCreatedAt:group?.createdAt};}
 create(input,lead,actor){
  if(input.confirm!=='yes'||input.leadId!==lead.id||!Object.hasOwn(ONBOARDING_TYPES,input.type))throw new Error('Choose a lead and chat type, and confirm creation.');
  const packs=selectedOnboardingTemplates(input.type,input.introTemplates),messageId=()=>BigInt('0x'+randomBytes(7).toString('hex')).toString();
  const title=String(input.title||'').trim();if(!title||title.length>128||/[\x00-\x1f]/.test(title))throw new Error('Title: 1–128 characters.');
  const participants=[...new Set((input.participants||[]).map(v=>String(v).trim().replace(/^@/, '').toLowerCase()).filter(Boolean))];if(participants.length>10||participants.some(v=>!/^[a-z][a-z0-9_]{3,31}$/.test(v)))throw new Error('Enter up to 10 Telegram usernames, such as @ivan, separated by commas.');
  if(!/^[a-f0-9]{32}$/.test(input.operationId||''))throw new Error('This creation form expired. Open New Onboarding Chat again.');
  // An operation belongs to one form submission, not to the lifetime of a lead/type.
  // Synchronous read/save keeps simultaneous HTTP submissions in this web process atomic.
  const id=createHash('sha256').update('operation-v1|'+actor+'|'+input.operationId).digest('hex').slice(0,32);
  const requestFingerprint=createHash('sha256').update(JSON.stringify({leadId:lead.id,type:input.type,title,participants:[...participants].sort(),templates:packs.map(p=>p.id),managerId:String(input.managerId||'')})).digest('hex');
  const old=this.read(id);if(old){if(old.requestFingerprint!==requestFingerprint)throw new Error('This operation already has different settings. Open New Onboarding Chat for a new operation.');return old;}
  return this.save({id,operationVersion:1,requestFingerprint,leadId:lead.id,leadName:lead.fields.fullName,company:lead.fields.company,type:input.type,title,participants,introTemplates:packs.map(pack=>pack.id),introMessages:packs.flatMap(pack=>pack.messages.map(message=>({...message,packId:pack.id,packName:pack.name,randomId:messageId()}))),actor:String(actor),managerId:input.managerId||null,status:'queued',createdAt:new Date().toISOString(),steps:{invited:[],introMessages:[]},audit:[{at:new Date().toISOString(),action:'confirmed',actor:String(actor)}]});
 }
 retry(id){const job=this.read(id);if(job?.status!=='partial')throw new Error('Retry is available only for incomplete setup of an existing group.');job.status='queued';job.error=null;return this.save(job);}
}
export async function runOnboarding(store,id,api,expectedAccount){
 if(String(api.accountId)!==String(expectedAccount))throw new Error('A different Telegram account is connected.');const job=store.read(id);if(!job||['ready','uncertain','cancelled'].includes(job.status))return;
 if(!job.group&&['creating','working'].includes(job.status)){job.status='uncertain';job.error='Group creation is unconfirmed. Check Telegram manually; automatic retry is disabled.';store.save(job);return;}
 const cooldownFile=path.join(store.directory,'cooldown.json');if((fs.existsSync(cooldownFile)?JSON.parse(fs.readFileSync(cooldownFile,'utf8')).until:0)>Date.now()||job.retryAt>Date.now())return;
 function cooldown(error){const seconds=Number(error.seconds)||0;if(seconds>0){job.retryAt=Date.now()+seconds*1000;atomicJson(cooldownFile,{until:job.retryAt});}return seconds>0;}
 if(!job.group){job.status='creating';store.save(job);try{job.group=await api.create(job.title);if(!job.group?.id||!job.group.accessHash)throw new Error('Missing group');store.save(job);}catch(error){cooldown(error);job.status='uncertain';job.error='Telegram did not confirm creation. The group may exist; check the account before trying again.';store.save(job);return;}}
 // Old queued jobs contain snapshots from before video captions were introduced.
 // Upgrade a pack only when none of its messages has been delivered.
 const oldMessages=job.introMessages||[],marketplace=oldMessages.filter(m=>m.packId==='introduce-marketplace');
 if(marketplace.length===5&&marketplace[0].type!=='video'&&marketplace.filter(m=>m.type==='video').length===2&&!oldMessages.some((m,i)=>m.packId==='introduce-marketplace'&&job.steps.introMessages?.[i])){
  const pack=selectedOnboardingTemplates(job.type,['introduce-marketplace'])[0],replacement=pack.messages.map(m=>({...m,packId:pack.id,packName:pack.name,randomId:marketplace.find(old=>m.type==='video'?old.type==='video'&&old.assetId===m.assetId:old.name===m.name)?.randomId}));
  if(replacement.every(m=>m.randomId)){
   const messages=[],sent=[];let replaced=false;
   oldMessages.forEach((m,i)=>{if(m.packId===pack.id){if(!replaced){messages.push(...replacement);sent.push(...replacement.map(()=>false));replaced=true;}}else{messages.push(m);sent.push(Boolean(job.steps.introMessages?.[i]));}});
   job.introMessages=messages;job.steps.introMessages=sent;store.save(job);
  }
 }
 job.status='working';store.save(job);const failures=[];
 async function step(key,operation){if(job.steps[key]||job.retryAt>Date.now())return;try{await operation();job.steps[key]=true;store.save(job);}catch(error){const reason=String(error.errorMessage||error.code||'');failures.push((key==='owner'?'ownership transfer':key)+(key==='owner'&&/^(ONBOARDING_[A-Z_]+|PASSWORD_[A-Z_]+(?:_\d+)?|SESSION_TOO_FRESH_\d+)$/.test(reason)?' ('+reason+')':''));cooldown(error);}}
 await step('bot',()=>api.bot(job.group));
 await step('avatar',()=>api.avatar(job.group,job.type));
 await step('history',()=>api.history(job.group));
 // Participants and the welcome message must wait until history is confirmed visible.
 if(job.steps.history){
 for(const handle of job.participants)if(!(job.retryAt>Date.now())&&!job.steps.invited.includes(handle))try{const identity=confirmedIdentity(await api.invite(job.group,handle));if(identity){job.participantProfiles||={};job.participantProfiles[handle]=identity;}job.steps.invited.push(handle);store.save(job);}catch(error){failures.push('@'+handle);if(cooldown(error))break;}
 await step('link',async()=>{const result=await api.link(job.group);if(!/^https:\/\/t\.me\/(\+|joinchat\/)/.test(result.link||''))throw new Error('Invite not confirmed');job.link=result.link;});
 // A failed send stays at the head of the remaining sequence. Its persisted random ID
 // lets Telegram deduplicate an unconfirmed successful send when this job resumes.
 let templatesComplete=true;
 for(const [index,message] of (job.introMessages||[]).entries()){
  job.steps.introMessages||=[];if(job.steps.introMessages[index])continue;
  if(job.retryAt>Date.now()){templatesComplete=false;break;}
  try{if(message.type==='video')await api.video(job.group,message,message.randomId);else await api.template(job.group,message.html,message.randomId);job.steps.introMessages[index]=true;store.save(job);}
  catch(error){failures.push('template '+message.packName+' / '+message.name);cooldown(error);templatesComplete=false;break;}
 }
 }
 const setupComplete=['bot','avatar','history','link'].every(key=>job.steps[key])&&job.participants.every(handle=>job.steps.invited.includes(handle))&&(job.introMessages||[]).every((_,i)=>job.steps.introMessages?.[i]);
 if(setupComplete&&!failures.length){
  await step('owner',async()=>{if(!/^\d+$/.test(String(job.managerId||''))||String(job.managerId)===String(api.accountId))throw Object.assign(new Error('Manager required'),{code:'ONBOARDING_MANAGER_REQUIRED'});await api.owner(job.group,String(job.managerId));});
  if(job.steps.owner)await step('leave',()=>api.leave(job.group,String(job.managerId)));
 }
 if(!failures.length&&(!setupComplete||!job.steps.owner||!job.steps.leave))failures.push('setup pending');
 job.status=failures.length?'partial':'ready';job.error=failures.length?'Incomplete steps: '+failures.join(', ')+'. Privacy settings or Telegram restrictions may prevent invitations; share the link manually.':null;job.updatedAt=new Date().toISOString();store.save(job);
}
