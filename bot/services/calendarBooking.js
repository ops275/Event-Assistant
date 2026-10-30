import { createHash } from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
export class BookingError extends Error {}

function localParts(date,timeZone) {
 const values=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}
export function wallTime(date,time,timeZone) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))throw new BookingError('Укажите дату и время.');
 const text=date+'T'+time+':00', naive=Date.parse(text+'Z');
 if(!Number.isFinite(naive)||new Date(naive).toISOString().slice(0,19)!==text)throw new BookingError('Некорректная дата или время.');
 const offsets=new Set();
 for(let hour=-36;hour<=36;hour+=12){const point=naive+hour*3600000;offsets.add(Date.parse(localParts(new Date(point),timeZone)+'Z')-point);}
 const candidates=[...offsets].map(offset=>new Date(naive-offset)).filter(d=>localParts(d,timeZone)===text);
 if(candidates.length!==1)throw new BookingError('Время неоднозначно или не существует из-за перевода часов. Выберите другое время.');
 return candidates[0];
}
export function buildMeeting(input,lead,target,now=new Date()) {
 if(!lead?.fields?.fullName?.trim()||!lead.fields.company?.trim())throw new BookingError('Сначала заполните имя и компанию в карточке лида.');
 if(input.createMeet&&input.inbox)throw new BookingError('Для Google Meet сначала согласуйте время встречи.');
 const location=input.createMeet?'Google Meet':input.location?.trim();
 if(!location||location.length>300)throw new BookingError('Укажите место встречи (до 300 символов).');
 if(!input.submission)throw new BookingError('Откройте форму заново.');
 const timeZone=input.timeZone||target.timeZone;
 const start=wallTime(input.date,input.inbox?'07:00':input.time,timeZone);
 if(input.inbox ? input.date<localParts(now,timeZone).slice(0,10) : start<=now)throw new BookingError('Выберите будущую дату и время.');
 const guests=[...new Set((input.guests||[]).map(x=>String(x).trim().toLowerCase()).filter(Boolean))];
 if(guests.length>20||guests.some(x=>!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(x)))throw new BookingError('Проверьте адреса гостей (не более 20).');
 if(input.inbox&&guests.length)throw new BookingError('Для Inbox без согласованного времени приглашения не отправляются.');
 if(guests.length&&!input.sendInvites)throw new BookingError('Подтвердите отправку приглашений гостям.');
 const summary=`Onlyplay × ${lead.fields.company.trim()} — ${lead.fields.fullName.trim()}`;
 const description=[`Встреча Onlyplay с ${lead.fields.company.trim()}.`,`Участник: ${lead.fields.fullName.trim()}.`,'Продолжительность: 30 минут.',`Место: ${location}.`,input.inbox?'Время встречи НЕ согласовано. 07:00 — внутренний Inbox, не время встречи.':'Время встречи согласовано.'].join('\n');
 return {
  id:'ea'+createHash('sha256').update(input.submission).digest('hex'),
  summary:(input.inbox?'[Время не согласовано] ':'')+summary,description,
  location,start:{dateTime:start.toISOString(),timeZone},
  ...(input.createMeet?{conferenceData:{createRequest:{requestId:createHash('sha256').update('meet:'+input.submission).digest('hex'),conferenceSolutionKey:{type:'hangoutsMeet'}}}}:{}),
  end:{dateTime:new Date(start.getTime()+30*60000).toISOString(),timeZone},
  attendees:guests.map(email=>({email})),
  colorId:input.inbox?'11':'2',transparency:input.inbox?'transparent':'opaque',
  reminders:{useDefault:false,overrides:input.inbox?[]:[{method:'popup',minutes:15}]},
  extendedProperties:{private:{leadId:lead.id,source:'onlyplay-local-test',timeStatus:input.inbox?'inbox':'defined',...(/^[a-f0-9]{32}$/.test(String(input.publicReservationId||''))?{publicReservationId:input.publicReservationId}:{}),...(/^\d+$/.test(String(input.reminderChatId||''))?{reminderChatId:String(input.reminderChatId)}:{}),...(/^\d+$/.test(String(input.managerTelegramId||''))?{managerTelegramId:String(input.managerTelegramId)}:{})}},
 };
}
async function finishConference(api,event,target){
 for(let attempt=0;attempt<3&&event.conferenceData?.createRequest?.status?.statusCode==='pending'&&!event.hangoutLink;attempt++){
  await delay(500);
  try{event=(await api.events.get({calendarId:target.id,eventId:event.id},{timeout:4000,retry:false})).data;}
  catch{return event;} // The event already exists: never report a failed booking or reinsert it.
 }
 return event;
}
const calendarOperations=new Map();
export function withCalendarLock(key,operation){
 const previous=calendarOperations.get(key)||Promise.resolve(),current=previous.catch(()=>{}).then(operation);calendarOperations.set(key,current);
 const clean=()=>{if(calendarOperations.get(key)===current)calendarOperations.delete(key);};current.then(clean,clean);return current;
}
export function bookMeeting(api,input,lead,target,now=new Date()) {return withCalendarLock(target.id,()=>bookMeetingOnce(api,input,lead,target,now));}
async function bookMeetingOnce(api,input,lead,target,now) {
 const requestBody=buildMeeting(input,lead,target,now);
 if(!input.inbox){
  const result=await api.freebusy.query({requestBody:{timeMin:requestBody.start.dateTime,timeMax:requestBody.end.dateTime,items:[{id:target.id}]}},{timeout:15000});
  const calendar=result.data.calendars?.[target.id];
  if(!calendar||calendar.errors?.length)throw new BookingError('Не удалось проверить свободное время календаря.');
  if(calendar.busy?.length){
   // Recover a successful earlier submission whose HTTP response was lost.
   try {
    const {data}=await api.events.get({calendarId:target.id,eventId:requestBody.id},{timeout:15000});
    if(data.extendedProperties?.private?.leadId===lead.id) return finishConference(api,data,target);
   }catch(error){if(Number(error.code||error.response?.status)!==404)throw error;}
   throw new BookingError('Выбранное время занято. Выберите другой слот.');
  }
 }
 try {
  const {data}=await api.events.insert({calendarId:target.id,requestBody,...(input.createMeet?{conferenceDataVersion:1}:{}),sendUpdates:requestBody.attendees.length?'all':'none'},{timeout:20000,retry:false});
  return finishConference(api,data,target);
 }catch(error){
  if(Number(error.code||error.response?.status)!==409)throw error;
  const {data}=await api.events.get({calendarId:target.id,eventId:requestBody.id},{timeout:15000});
  return finishConference(api,data,target);
 }
}
