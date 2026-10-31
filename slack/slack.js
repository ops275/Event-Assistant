import {slackLeadCard} from './slackLeadCard.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const validId=id=>/^ea[a-f0-9]{64}$/.test(id||'');
export const leadCard=slackLeadCard;
export function eligibleHandoffs(records,since){
 const cutoff=Date.parse(since);if(!Number.isFinite(cutoff))throw Error('Invalid cutover');
 return records.filter(r=>validId(r.id)&&r.status==='confirmed'&&Date.parse(r.confirmedAt)>=cutoff);
}
export function createSlackDelivery({api,teamId,appId,mode,channelId,ledger,save,leadFor,personFor=()=>null,receiverEmailFor=()=>null}){
 if(mode!=='production'||!/^C[A-Z0-9]+$/.test(channelId||''))throw Error('Production leadgen destination required');
 const active=user=>/^[UW][A-Z0-9]+$/.test(user?.id||'')&&!user.deleted&&!user.is_bot&&!user.is_restricted&&!user.is_ultra_restricted;
 const emailOf=value=>{const email=String(value||'').trim().toLowerCase();return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@qooob\.com$/.test(email)?email:null;};
 // Explicit user-authorized exception for Daria; no other personal emails are accepted.
 const daria={managerEmail:'onboarding@qooob.com',slackEmail:'dashazagorskaya@gmail.com',slackId:'U0BM89BR0E4'};
 const normalizedEmail=value=>String(value||'').trim().toLowerCase();
 const isDaria=user=>user?.id===daria.slackId&&normalizedEmail(user.profile?.email)===daria.slackEmail;
 const targets=new Map();let checkedChannel=false;
 async function destination(){
  if(!checkedChannel){const {channel}=await api('conversations.info',{channel:channelId});if(channel?.id!==channelId||channel.name!=='leadgen'||channel.is_archived||!channel.is_member)throw Error('Slack leadgen membership required');checkedChannel=true;}
  return {channelId};
 }
 async function manager(record){
  const email=emailOf(await receiverEmailFor(record));if(!email)throw Object.assign(Error('Manager email missing'),{slackError:'manager_email_missing'});
  if(!targets.has(email)){
   const exception=email===daria.managerEmail,lookupEmail=exception?daria.slackEmail:email;
   const {user}=await api('users.lookupByEmail',{email:lookupEmail});if(!active(user)||(exception?!isDaria(user):emailOf(user.profile?.email)!==email))throw Object.assign(Error('Manager Slack account mismatch'),{slackError:'manager_account_unavailable'});
   targets.set(email,{userId:user.id,email});
  }
  return targets.get(email);
 }
 async function dm(userId){const {channel}=await api('conversations.open',{users:userId});if(!/^D[A-Z0-9]+$/.test(channel?.id||''))throw Object.assign(Error('Invalid DM channel'),{slackError:'invalid_dm_channel'});return channel.id;}
  function content(record,lead,detail=false){
  const personLink=p=>{const known=personFor(p.id);const username=String(known?.username||'').replace(/^@/,'');const url=/^[A-Za-z0-9_]{5,32}$/.test(username)?'https://t.me/'+username:/^\d+$/.test(p.id||'')?'tg://user?id='+p.id:null;return url?`<${url}|${esc(p.name).replaceAll('|',' ')}>`:esc(p.name);};
  const date=new Date(record.request.start.dateTime);
  let time;try{time=new Intl.DateTimeFormat('sv-SE',{timeZone:record.request.start.timeZone||'Europe/Warsaw',dateStyle:'short',timeStyle:'short'}).format(date).replace(' ',' · ');}catch{time=record.request.start.dateTime;}
  const meetingLabel=(record.meetingType==='online'?'Online':'Offline')+' meeting';
  let calendarLink=null;try{const u=new URL(record.event?.htmlLink);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.href.length<=2048&&(u.hostname==='calendar.google.com'||['google.com','www.google.com'].includes(u.hostname)&&u.pathname.startsWith('/calendar/')))calendarLink=u.href;}catch{}
  const meeting=calendarLink?`<${esc(calendarLink)}|${meetingLabel}>`:meetingLabel;
  const lines=[`Lead handed off to ${personLink(record.receiver)} from ${personLink(record.sender)}`,'',`qooob × ${esc(lead.fields?.company)} — ${esc(lead.fields?.fullName)}`,'',`${meeting} · ${esc(time)}`];
  if(detail)lines.push(leadCard(lead,record).text);
  return lines.join('\n').slice(0,28000);
 }

 const final=status=>['sent','uncertain','terminal'].includes(status);
 function failure(error,posting){
  const code=error.slackError||'delivery_uncertain';
  return {status:posting&&!error.slackError?'uncertain':['invalid_blocks','invalid_arguments','msg_too_long'].includes(code)?'terminal':'failed',error:code,retryAt:Date.now()+Math.max(error.slackError==='ratelimited'?60:300,Number(error.retryAfter)||0)*1000};
 }
 async function send(entry,key,resolve){
  let receipt=entry.deliveries[key];
  if(receipt?.status==='sending'){entry.deliveries[key]={...receipt,status:'uncertain',error:'interrupted_send'};save();return;}
  if(final(receipt?.status)||Number(receipt?.retryAt)>Date.now())return;
  let dest;try{dest=await resolve();}catch(error){entry.deliveries[key]={...receipt,...failure(error,false)};save();return;}
  const text=(dest.userId?'<@'+dest.userId+'>\n':'')+content(entry.record,leadFor(entry.leadId));
  // Persist the destination and intent before POST, independently for channel and DM.
  receipt=entry.deliveries[key]={status:'sending',channelId:dest.channelId,...(dest.userId?{userId:dest.userId,email:dest.email}:{})};save();
  let result;
  try{result=await api('chat.postMessage',{channel:dest.channelId,text,unfurl_links:false,unfurl_media:false,blocks:[{type:'section',text:{type:'mrkdwn',text:text.slice(0,2900)}},{type:'actions',elements:[{type:'button',text:{type:'plain_text',text:'Open lead card'},action_id:'onlyplay_lead_dm',value:entry.record.id}]}]});}
  catch(error){Object.assign(receipt,failure(error,true));save();return;}
  if(!result?.ts){Object.assign(receipt,{status:'uncertain',error:'missing_message_confirmation'});save();return;}
  Object.assign(receipt,{status:'sent',ts:result.ts});save();
 }
 async function deliver(record){
  if(!validId(record.id)||record.status!=='confirmed')return;
  const lead=leadFor(record.leadId);if(!lead||lead.deletedAt)return;
  let entry=ledger[record.id];
  // Historical ops-only receipts remain immutable and are never replayed.
  if(entry&&!entry.deliveries)return;
  if(!entry){entry=ledger[record.id]={leadId:record.leadId,record,deliveries:{}};save();}
  if(['channel','manager'].every(key=>final(entry.deliveries[key]?.status)||Number(entry.deliveries[key]?.retryAt)>Date.now()))return entry;
  let recipient,lookupError;try{recipient=await manager(entry.record);}catch(error){lookupError=error;}
  await send(entry,'channel',async()=>({...await destination(),...(recipient||{})}));
  await send(entry,'manager',async()=>{if(lookupError)throw lookupError;return {...recipient,channelId:await dm(recipient.userId)};});
  return entry;
 }
 async function click(payload){
  if(payload.team?.id!==teamId||payload.api_app_id!==appId)return;
  const action=payload.actions?.find(a=>a.action_id==='onlyplay_lead_dm');if(!action||!validId(action.value))return;
  const entry=ledger[action.value];if(!entry)return;
  const receipts=Object.values(entry.deliveries||{}),source=receipts.find(r=>r.status==='sent'&&r.ts===payload.message?.ts&&r.channelId===payload.channel?.id);
  if(!source||source.channelId!==channelId&&source.userId!==payload.user?.id)return;
  const {user}=await api('users.info',{user:payload.user?.id});if(!active(user)||user.id!==payload.user?.id||(!emailOf(user.profile?.email)&&!isDaria(user)))return;
  const lead=leadFor(entry.leadId);if(!lead||lead.deletedAt)return;
  const target=await dm(user.id),card=leadCard(lead);await api('chat.postMessage',{channel:target,text:card.text,blocks:card.blocks,mrkdwn:false,parse:'none',unfurl_links:false,unfurl_media:false});
 }
 return {deliver,click,destination};
}
