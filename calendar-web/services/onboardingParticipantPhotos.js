// Only confirmed job participants are exposed. Telegram identities remain server-side.
const handle=value=>String(value||'').replace(/^@/,'').toLowerCase();
const userId=value=>/^[1-9][0-9]{0,15}$/.test(String(value))&&Number.isSafeInteger(Number(value));
export function addedParticipants(job,users={}){
 if(!job.group||!/^[a-f0-9]{32}$/.test(job.id))return [];
 return (job.participants||[]).flatMap((username,index)=>{
  if(!/^[a-z][a-z0-9_]{3,31}$/.test(username)||!job.steps?.invited?.includes(username))return [];
  const profile=job.participantProfiles?.[username],known=Object.values(users).find(u=>handle(u.username)===username);
  return [{username,name:String(profile?.name||known?.name||'@'+username).slice(0,128),photoUrl:'/onboarding/participant-photo?job='+job.id+'&index='+index}];
 });
}
export function confirmedIdentity(value){
 if(!value||!userId(value.id))return null;
 return {id:String(value.id),name:String(value.name||'').replace(/[\x00-\x1f\x7f]/g,'').slice(0,128)};
}
// No disk photo store, no arbitrary URLs, no upstream errors or URLs returned/logged.
export function createParticipantPhotoLoader({token=process.env.TELEGRAM_BOT_TOKEN,fetchImpl=fetch,now=Date.now}={}){
 const cache=new Map(),pending=new Map();const maxImage=128*1024,maxJson=64*1024;
 const remove=key=>{const entry=cache.get(key);if(entry)clearTimeout(entry.timer);cache.delete(key);};
 async function bounded(response,limit){
  if(!response.ok||Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('Unavailable');}
  const reader=response.body.getReader();let length=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw Error('Too large');chunks.push(Buffer.from(value));}return Buffer.concat(chunks);}finally{await reader.cancel().catch(()=>{});}
 }
 async function download(job,username,id,legacy){
  const signal=AbortSignal.timeout(8000);
  const call=async(method,body)=>{const r=await fetchImpl('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});const json=JSON.parse((await bounded(r,maxJson)).toString());if(!json.ok)throw Error('Unavailable');return json.result;};
  const member=await call('getChatMember',{chat_id:'-100'+job.group.id,user_id:Number(id)});
  if(String(member.user?.id)!==id||member.user?.is_bot||!['creator','administrator','member','restricted'].includes(member.status)||(member.status==='restricted'&&!member.is_member)||(legacy&&handle(member.user.username)!==username))return null;
  const result=await call('getUserProfilePhotos',{user_id:Number(id),limit:1});
  const photo=(result.photos?.[0]||[]).filter(p=>p.width>0&&p.height>0&&p.width<=640&&p.height<=640&&(!p.file_size||p.file_size<=maxImage)).sort((a,b)=>a.width-b.width)[0];
  if(!photo?.file_id)return null;
  const file=await call('getFile',{file_id:photo.file_id});
  if(file.file_size>maxImage||!/^photos\/[A-Za-z0-9_-]+\.jpg$/.test(file.file_path||''))return null;
  const response=await fetchImpl('https://api.telegram.org/file/bot'+token+'/'+file.file_path,{redirect:'error',signal});
  const bytes=await bounded(response,maxImage);
  return bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255?bytes:null;
 }
 return async(job,index,users={})=>{
  if(!token||!job.group||!/^\d{1,16}$/.test(String(job.group.id))||! /^(?:0|[1-9])$/.test(String(index)))return null;
  const username=job.participants?.[Number(index)];if(!username||!job.steps?.invited?.includes(username))return null;
  const profile=confirmedIdentity(job.participantProfiles?.[username]);
  const id=profile?.id||Object.keys(users).find(id=>userId(id)&&handle(users[id]?.username)===username);
  if(!id)return null;
  const key=job.id+':'+job.group.id+':'+username+':'+id,cached=cache.get(key);
  if(cached&&cached.until>now())return cached.bytes;
  if(pending.has(key))return pending.get(key);
  if(pending.size>=10)return null;
  const operation=(async()=>{let bytes=null;try{bytes=await download(job,username,id,!profile);}catch{}
   remove(key);if(cache.size>=64)remove(cache.keys().next().value);
   const ttl=bytes?60000:10000,entry={bytes,until:now()+ttl};
   entry.timer=setTimeout(()=>remove(key),ttl);entry.timer.unref?.();cache.set(key,entry);return bytes;
  })();
  pending.set(key,operation);try{return await operation;}finally{pending.delete(key);}
 };
}
