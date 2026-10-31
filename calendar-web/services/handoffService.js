import {createHash} from 'node:crypto';
import {buildMeeting,BookingError,withCalendarLock} from './calendarBooking.js';
import {calendarBusy,intervalBusy} from './handoffAvailability.js';
import {calendarLeadDescription,leadPayload,botUrl} from './leadLink.js';
const code=error=>Number(error.code||error.response?.status)||0;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const person=(id,settings,fallback)=>({id:String(id),name:String(settings.users?.[id]?.name||fallback||id)});
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function escapedClip(value,limit){let output='';for(const character of String(value??'')){const next=escape(character);if(output.length+next.length>limit)return output+'…';output+=next;}return output;}
const managerNames={yaknamene:'Gosha Dieiev',askorobohatov:'Andrii Skorobohatov',andrii_qooob:'Andrii Skorobohatov',vlada_t1:'Vlada Transka',khati_qooob:'Khati Lekishvili',zanepad:'Oleksandr Kolisnyk',dasha_elle:'Daria Zagorskaya'};
export function createHandoffService({journal,accounts,settings,clientFor,send,nameFor=()=>'',userFor=()=>null,roleFor=()=>null,now=()=>new Date()}){
 function notification(record,recipient,config){
  const linkedPerson=person=>{
   const current=userFor(person.id)||config.users?.[person.id]||{},username=String(current.username||'').replace(/^@/,'');
   const fullName=[current.first_name||current.firstName,current.last_name||current.lastName].filter(Boolean).join(' ');
   const label=escapedClip(fullName||managerNames[username.toLowerCase()]||current.name||person.name,200);
   const href=/^[A-Za-z0-9_]{5,32}$/.test(username)?'https://t.me/'+username:'tg://user?id='+person.id;
   return `<a href="${escape(href)}">${label}</a>`;
  };
  const date=new Date(record.request.start.dateTime),timeZone=record.request.start.timeZone||record.calendar.timeZone||'UTC';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  const summary=record.request.summary,marker=summary.indexOf('qooob × '),label=marker>=0?summary.slice(marker+'qooob × '.length):summary;
  const link=botUrl()+'?start='+leadPayload(record.leadId);
  const meetingLabel=(record.meetingType==='online'?'Online':'Offline')+' meeting';
  let calendarLink=null;try{const u=new URL(record.event?.htmlLink);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.href.length<=2048&&(u.hostname==='calendar.google.com'||['google.com','www.google.com'].includes(u.hostname)&&u.pathname.startsWith('/calendar/')))calendarLink=u.href;}catch{}
  const meeting=calendarLink?`<a href="${escape(calendarLink)}">${meetingLabel}</a>`:meetingLabel;
  return `Lead handed off to ${linkedPerson(record.receiver)} from ${linkedPerson(record.sender)}\n\nqooob × <a href="${link}">${escapedClip(label,1000)}</a>\n\n${meeting} · ${parts.year}-${parts.month}-${parts.day} · ${parts.hour}:${parts.minute}${['partnership','admin'].includes(config.users?.[recipient]?.role)&&record.description?'\n\n'+escapedClip(record.description,1200):''}`;
 }
 function context({input,lead,identity},legacy,includeLeadLink=true){
  const config=settings(),creatorId=String(lead.actorId||lead.owner?.split(':').at(-1)||'');
  if(config.users?.[identity?.userId]?.blocked)throw new BookingError('Your access has been blocked by an administrator.');
  if((config.users?.[identity?.userId]?.role||roleFor(identity?.userId))==='promoter')throw new BookingError('Hand off lead is not available for promoters.');
  if(!/^\d+$/.test(String(identity?.userId||'')))throw new BookingError('Open Hand off lead from Telegram again.');
  const organizerId=legacy?legacy.creator.id:String(identity.userId),organizer=accounts.status(organizerId);
  if(!organizer?.calendar?.id)throw new BookingError('Connect your Google Calendar in Settings before creating a meeting.');
  let receiver;try{receiver=accounts.select(identity?.userId,input.managerId,config);}catch{throw new BookingError('Choose an active partnership manager with a connected calendar.');}
  if(!receiver?.calendar?.id||config.users?.[receiver.userId]?.blocked||!['admin','partnership'].includes(config.users?.[receiver.userId]?.role))throw new BookingError('Choose an active partnership manager with a connected calendar.');
  if(!/^\d+$/.test(String(identity?.userId||'')))throw new BookingError('Open Hand off lead from Telegram again.');
  const normalized={...input,meetingType:input.meetingType||(input.createMeet?'online':'offline')};
  const request=buildMeeting(normalized,lead,organizer.calendar,now());
  if(!legacy)request.description=buildMeeting({...normalized,description:''},lead,organizer.calendar,now()).description;
  // Copy edits must not change submission identity, including after a code rollback.
  let identityDescription=buildMeeting(legacy?normalized:{...normalized,description:''},lead,organizer.calendar,now(),{legacyLocationCopy:true}).description;
  if(includeLeadLink)identityDescription=calendarLeadDescription(identityDescription,lead.id);
  if(includeLeadLink){request.description=calendarLeadDescription(request.description,lead.id);request.extendedProperties.private.leadLinkVersion='1';}
  if(!legacy)request.attendees=request.attendees.filter(a=>a.email!==String(organizer.email||'').toLowerCase());
  const guests=request.attendees.map(a=>a.email);
  if(organizerId!==String(receiver.userId)&&String(receiver.email).toLowerCase()!==String(organizer.email).toLowerCase()){
   if(!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(receiver.email||''))throw new BookingError('The accepting manager must reconnect their calendar to provide an email.');
   if(!request.attendees.some(a=>a.email===receiver.email.toLowerCase()))request.attendees.push({email:receiver.email.toLowerCase()});
  }
  request.extendedProperties.private={...request.extendedProperties.private,creatorTelegramId:creatorId,...(!legacy?{organizerTelegramId:organizerId}:{}),managerTelegramId:receiver.userId,handoffId:request.id};
  const intent={leadId:lead.id,sender:person(identity.userId,config,identity.name||nameFor(identity.userId)),creator:{...person(creatorId,config,lead.actorName||nameFor(creatorId)),...(lead.actorName?{name:lead.actorName}:{})},...(!legacy?{organizer:person(organizerId,config,identity.name||nameFor(organizerId))}:{}),receiver:person(receiver.userId,config,nameFor(receiver.userId)||receiver.calendar.name||receiver.email),calendar:organizer.calendar,receiverCalendar:receiver.calendar,meetingType:normalized.meetingType,description:String(input.description||'').trim(),guests,request};
  return {intent,fingerprint:digest({...intent,request:{...request,description:identityDescription}})};
 }
 async function notify(record){
  const config=settings();
  for(const recipient of [...new Set([record.sender.id,record.receiver.id])]){
   const old=record.notifications[recipient];
   if(old?.status==='sending'){record.notifications[recipient]={...old,status:'uncertain'};journal.put(record);continue;}
   if(old&&(old.terminal||['sent','uncertain','skipped'].includes(old.status)))continue;
   if(old?.retryAt&&Date.parse(old.retryAt)>now().getTime())continue;
   if(config.users?.[recipient]?.blocked||config.users?.[recipient]?.muted){record.notifications[recipient]={status:'skipped',reason:config.users[recipient].blocked?'blocked':'muted'};journal.put(record);continue;}
   record.notifications[recipient]={status:'sending',attempts:(old?.attempts||0)+1};journal.put(record);
   try{const result=await send(recipient,notification(record,recipient,config),{parse_mode:'HTML'});record.notifications[recipient]={...record.notifications[recipient],status:'sent',messageId:result?.message_id,at:now().toISOString()};}
   catch(error){const status=code(error);record.notifications[recipient]={...record.notifications[recipient],status:status?'failed':'uncertain',code:status,...(status===429||status>=500?{retryAt:new Date(now().getTime()+Math.max(60,Number(error.retryAfter)||60)*1000).toISOString()}:{}),terminal:status===400||status===403};}
   journal.put(record);
  }
 }
 async function execute(record){
  if(record.status!=='confirmed'){
   const config=settings();
   const organizer=record.organizer||record.creator;
   const creator=accounts.status(organizer.id),receiver=accounts.status(record.receiver.id);
   if(config.users?.[organizer.id]?.blocked||!creator||creator.calendar.id!==record.calendar.id)throw new BookingError('Organizer calendar is unavailable. Reconnect the same calendar to recover this handoff.');
   if(config.users?.[record.receiver.id]?.blocked||!['admin','partnership'].includes(config.users?.[record.receiver.id]?.role)||!receiver||receiver.calendar.id!==record.receiverCalendar.id)throw new BookingError('Accepting manager calendar is unavailable. Contact an administrator to recover this handoff.');
   const api=clientFor(organizer.id);let event;
   try{event=(await api.events.get({calendarId:record.calendar.id,eventId:record.id},{timeout:10000,retry:false})).data;}
   catch(error){if(code(error)!==404)throw error;}
   if(event&&event.extendedProperties?.private?.handoffId!==record.id)throw new BookingError('Calendar event identity mismatch. Contact an administrator.');
   if(!event){
    // GET has established non-insertion. Any rejection before the next insert
    // is definitive and must not become an unattended future booking.
    record.insertAttempted=false;
    if(!record.inbox&&Date.parse(record.request.start.dateTime)<=now().getTime())throw new BookingError('The requested handoff time has passed. Open a new form and choose a future time.');
    if(!record.inbox){
     const busy=await calendarBusy({organizer:{userId:organizer.id,calendar:record.calendar},receiver:{userId:record.receiver.id,calendar:record.receiverCalendar},clientFor,start:record.request.start.dateTime,end:record.request.end.dateTime});
     if(intervalBusy(busy,Date.parse(record.request.start.dateTime)))throw new BookingError('This time is busy for the organizer or Partnership Manager. Choose another time.');
    }
    record.insertAttempted=true;journal.put(record);
    try{event=(await api.events.insert({calendarId:record.calendar.id,requestBody:record.request,...(record.request.conferenceData?{conferenceDataVersion:1}:{}),sendUpdates:record.request.attendees.length?'all':'none'},{timeout:20000,retry:false})).data;}
    catch(error){if([400,401,403,404,422].includes(code(error)))record.status='rejected';if(code(error)!==409)throw error;event=(await api.events.get({calendarId:record.calendar.id,eventId:record.id},{timeout:10000,retry:false})).data;if(event.extendedProperties?.private?.handoffId!==record.id)throw new BookingError('Calendar event identity mismatch.');}
   }
   record.event={id:event.id,summary:event.summary,htmlLink:event.htmlLink,hangoutLink:event.hangoutLink,conferenceData:event.conferenceData};record.status='confirmed';record.confirmedAt=now().toISOString();delete record.lastError;journal.put(record);
  }
  await notify(record);return {record,event:{...record.request,...record.event}};
 }
 async function executeSafely(record){
  try{return await execute(record);}
  catch(error){if(record.status==='rejected'||record.status==='pending'&&!record.insertAttempted){record.status='rejected';record.lastError=error instanceof BookingError?error.message:'Handoff was not inserted. Submit explicitly to retry.';journal.put(record);}throw error;}
 }
 function lockCalendars(record,operation){
  const ids=[...new Set([record.calendar.id,record.receiverCalendar.id])].sort();
  const lock=index=>index===ids.length?operation():withCalendarLock(ids[index],()=>lock(index+1));return lock(0);
 }
 async function submit(args){
  const id='ea'+createHash('sha256').update(args.input.submission).digest('hex'),existing=journal.get(id);
  const {intent,fingerprint}=context(args,existing&&!existing.organizer?existing:null,!existing||existing.request.extendedProperties.private.leadLinkVersion==='1');
  return withCalendarLock('handoff:'+intent.request.id,async()=>{
   let record=journal.get(intent.request.id);
   if(record&&record.fingerprint!==fingerprint)throw new BookingError('This handoff submission changed after saving started. Reopen the form to create another handoff.');
   if(!record){record={id:intent.request.id,...intent,fingerprint,createdAt:now().toISOString(),status:'pending',inbox:Boolean(args.input.inbox),notifications:{}};journal.put(record);}
   if(record.status==='rejected'){record.status='pending';record.insertAttempted=false;journal.put(record);}
   return lockCalendars(record,()=>executeSafely(record));
  });
 }
 async function recover(){
  for(const item of journal.records())await withCalendarLock('handoff:'+item.id,async()=>{
   let record;try{record=journal.get(item.id);if(!record||record.status==='rejected'||record.status==='pending'&&!record.insertAttempted)return;await lockCalendars(record,()=>executeSafely(record));}
   catch(error){if(record){record.lastError=error instanceof BookingError?error.message:'Calendar or delivery recovery pending';journal.put(record);}}
  });
 }
 return {submit,recover};
}
