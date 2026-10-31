import { createHash } from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fallbackLeadContact,leadContactEmails} from './leadContact.js';
export class BookingError extends Error {}

function localParts(date,timeZone) {
 const values=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}
export function wallTime(date,time,timeZone) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))throw new BookingError('Specify a date and time.');
 const text=date+'T'+time+':00', naive=Date.parse(text+'Z');
 if(!Number.isFinite(naive)||new Date(naive).toISOString().slice(0,19)!==text)throw new BookingError('Invalid date or time.');
 const offsets=new Set();
 for(let hour=-36;hour<=36;hour+=12){const point=naive+hour*3600000;offsets.add(Date.parse(localParts(new Date(point),timeZone)+'Z')-point);}
 const candidates=[...offsets].map(offset=>new Date(naive-offset)).filter(d=>localParts(d,timeZone)===text);
 if(candidates.length!==1)throw new BookingError('This time is ambiguous or does not exist due to daylight saving time. Choose another time.');
 return candidates[0];
}
export function buildMeeting(input,lead,target,now=new Date(),{legacyLocationCopy=false}={}) {
 input={...input,createMeet:input.meetingType?input.meetingType==='online':input.createMeet};
 if(input.meetingType&&!['offline','online'].includes(input.meetingType))throw new BookingError('Choose Offline or Online.');
 if(input.createMeet&&input.inbox)throw new BookingError('Agree on the time before choosing Online.');
 const customDescription=String(input.description||'').trim();
 if(customDescription.length>3000)throw new BookingError('Description must be at most 3000 characters.');
 if(!lead?.fields?.fullName?.trim())throw new BookingError('Fill in the lead name first.');
 if(input.createMeet&&input.inbox)throw new BookingError('Agree on the meeting time before choosing Google Meet.');
 const location=input.createMeet?'Google Meet':input.inbox?'The meeting place should be added after clarifying the time':input.location?.trim();
 if(!location||location.length>300)throw new BookingError('Specify a meeting place (up to 300 characters).');
 if(!input.submission)throw new BookingError('Open the form again.');
 const chosenReminder=input.reminderMinutes==null?15:Number(input.reminderMinutes);
 if(![0,5,15,30,60].includes(chosenReminder))throw new BookingError('Choose a reminder time.');
 const reminderMinutes=input.inbox?0:chosenReminder;
 const timeZone=input.timeZone||target.timeZone;
 const start=wallTime(input.date,input.inbox?'07:00':input.time,timeZone);
 if(input.inbox ? input.date<localParts(now,timeZone).slice(0,10) : start<=now)throw new BookingError('Choose a future date and time.');
 const contact=String(input.leadContact??fallbackLeadContact(lead)).trim();
 if(contact.length>500||/[\x00-\x1f]/.test(contact))throw new BookingError('Lead contact: up to 500 characters on one line.');
 const contactEmails=leadContactEmails(contact);
 const guests=[...new Set([...(Object.hasOwn(input,'leadContact')||!Array.isArray(input.guests)?contactEmails:[]),...(Array.isArray(input.guests)?input.guests:[])].map(x=>String(x).trim().toLowerCase()).filter(Boolean))];
 if(guests.length>20||guests.some(x=>!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(x)))throw new BookingError('Check guest email addresses (at most 20).');
 const company=String(lead.fields.company||'').trim();
 const summary='qooob × '+[company,lead.fields.fullName.trim()].filter(Boolean).join(' — ');
 const description=[`qooob meeting with ${company||lead.fields.fullName.trim()}.`,`Participant: ${lead.fields.fullName.trim()}.`,'Duration: 30 minutes.',`${legacyLocationCopy?'Location':'Place'}: ${location}.`,input.inbox?'Meeting time is NOT agreed. 07:00 is an internal Inbox time, not the meeting time.':'Meeting time is agreed.'].join('\n');
 return {
  id:'ea'+createHash('sha256').update(input.submission).digest('hex'),
  summary:(input.inbox?'[Clarify time] ':'')+summary,description:[description,...(contact&&!contactEmails.length?['Lead contact: '+contact]:[]),customDescription].filter(Boolean).join('\n\n'),
  location,start:{dateTime:start.toISOString(),timeZone},
  ...(input.createMeet?{conferenceData:{createRequest:{requestId:createHash('sha256').update('meet:'+input.submission).digest('hex'),conferenceSolutionKey:{type:'hangoutsMeet'}}}}:{}),
  end:{dateTime:new Date(start.getTime()+30*60000).toISOString(),timeZone},
  attendees:guests.map(email=>({email})),
  colorId:input.inbox?'11':'2',transparency:input.inbox?'transparent':'opaque',
  reminders:{useDefault:false,overrides:reminderMinutes?[{method:'popup',minutes:reminderMinutes}]:[]},
  extendedProperties:{private:{...(contact?{leadContact:contact}:{}),reminderMinutes:String(reminderMinutes),...(lead.manualBooking?{manualName:lead.fields.fullName,manualCompany:lead.fields.company}:{}),leadId:lead.id,source:'onlyplay-local-test',timeStatus:input.inbox?'inbox':'defined',...(/^[a-f0-9]{32}$/.test(String(input.publicReservationId||''))?{publicReservationId:input.publicReservationId}:{}),...(/^\d+$/.test(String(input.reminderChatId||''))?{reminderChatId:String(input.reminderChatId)}:{}),...(/^\d+$/.test(String(input.managerTelegramId||''))?{managerTelegramId:String(input.managerTelegramId)}:{})}},
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
  if(!calendar||calendar.errors?.length)throw new BookingError('Could not check calendar availability.');
  if(calendar.busy?.length){
   // Recover a successful earlier submission whose HTTP response was lost.
   try {
    const {data}=await api.events.get({calendarId:target.id,eventId:requestBody.id},{timeout:15000});
    if(data.extendedProperties?.private?.leadId===lead.id) return finishConference(api,data,target);
   }catch(error){if(Number(error.code||error.response?.status)!==404)throw error;}
   throw new BookingError('The selected time is busy. Choose another slot.');
  }
 }
 try {
  const {data}=await api.events.insert({calendarId:target.id,requestBody,...(requestBody.conferenceData?{conferenceDataVersion:1}:{}),sendUpdates:requestBody.attendees.length?'all':'none'},{timeout:20000,retry:false});
  return finishConference(api,data,target);
 }catch(error){
  if(Number(error.code||error.response?.status)!==409)throw error;
  const {data}=await api.events.get({calendarId:target.id,eventId:requestBody.id},{timeout:15000});
  return finishConference(api,data,target);
 }
}
