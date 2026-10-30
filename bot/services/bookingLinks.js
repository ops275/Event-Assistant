import fs from 'node:fs';import path from 'node:path';import {randomBytes,createHash} from 'node:crypto';
import {atomicJson} from './adminService.js';import {wallTime,BookingError,bookMeeting,withCalendarLock} from './calendarBooking.js';
export const dateInZone=(now,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export const plusDays=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
export function publicReminderLead(links,event,owner){const meta=event.extendedProperties?.private;if(!owner||!meta?.publicReservationId)return null;const lead=links.reminderLead(event.id,owner);return lead&&lead.id===meta.leadId&&lead.id==='public-'+meta.publicReservationId?lead:null;}
export function validateContact(input){
 const name=String(input.name||'').trim(),company=String(input.company||'').trim(),email=String(input.email||'').trim().toLowerCase();
 if(!name||name.length>100||!company||company.length>150||/[\x00-\x1f]/.test(name+company)||email.length>254||!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email))throw new BookingError('Укажите имя, компанию и корректный email.');
 if(input.consent!=='yes')throw new BookingError('Подтвердите отправку приглашения на указанный email.');return {name,company,email};
}
function rules(input){
 const days=[...new Set((input.days||[]).map(Number))].sort(),start=String(input.start||''),end=String(input.end||''),horizon=Number(input.horizon);
 if(!days.length||days.some(d=>!Number.isInteger(d)||d<0||d>6)||!/^([01]\d|2[0-3]):[03]0$/.test(start)||!/^([01]\d|2[0-3]):[03]0$/.test(end)||start>=end||![7,14,30,60].includes(horizon))throw new BookingError('Выберите рабочие дни, часы с шагом 30 минут и период 7–60 дней.');
 return {days,start,end,horizon};
}
export class BookingLinks{
 constructor(directory){this.directory=directory;this.file=path.join(directory,'links.json');fs.mkdirSync(directory,{recursive:true,mode:0o700});}
 read(){return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{managers:{},receipts:{}};}
 saveGuest(key,value){if(!/^[a-f0-9]{48}$/.test(key))throw new BookingError('Недействительная сессия.');atomicJson(path.join(this.directory,'guest-'+key+'.json'),value);}
 guest(key){if(!/^[a-f0-9]{48}$/.test(key||''))return null;const file=path.join(this.directory,'guest-'+key+'.json');if(!fs.existsSync(file))return null;const value=JSON.parse(fs.readFileSync(file,'utf8'));return value.expires>Date.now()?value:null;}
 cleanupGuests(){for(const name of fs.readdirSync(this.directory).filter(n=>/^guest-[a-f0-9]{48}\.json$/.test(n))){const file=path.join(this.directory,name);if(JSON.parse(fs.readFileSync(file,'utf8')).expires<Date.now())fs.unlinkSync(file);}}
 ensure(manager){const state=this.read(),id=String(manager.userId);if(!/^\d+$/.test(id))throw new BookingError('Неверный менеджер.');if(!state.managers[id]){state.managers[id]={managerId:id,token:randomBytes(32).toString('hex'),enabled:true,rules:{days:[1,2,3,4,5],start:'09:00',end:'18:00',horizon:14},createdAt:new Date().toISOString()};atomicJson(this.file,state);}return state.managers[id];}
 find(token){if(!/^[a-f0-9]{64}$/.test(token||''))return null;return Object.values(this.read().managers).find(link=>link.enabled&&link.token===token)||null;}
 update(id,patch){const state=this.read(),link=state.managers[String(id)];if(!link)throw new BookingError('Сначала получите ссылку менеджера.');if(patch.days)link.rules=rules(patch);if(patch.enabled!==undefined)link.enabled=Boolean(patch.enabled);link.updatedAt=new Date().toISOString();atomicJson(this.file,state);return link;}
 rotate(id){const state=this.read(),link=state.managers[String(id)];if(!link)throw new BookingError('Ссылка не найдена.');link.token=randomBytes(32).toString('hex');atomicJson(this.file,state);return link;}
 receipt(id){return this.read().receipts[id]||null;}
 discardPending(id){const state=this.read();if(state.receipts[id]?.status==='pending'){delete state.receipts[id];atomicJson(this.file,state);}}
 pending(link,id,start,contact){
  if(!/^[a-f0-9]{32}$/.test(id))throw new BookingError('Откройте страницу заново.');const state=this.read(),old=state.receipts[id];
  if(old){if(old.managerId!==link.managerId||old.start!==start||JSON.stringify(old.contact)!==JSON.stringify(contact))throw new BookingError('Эта отправка уже закреплена за другим временем или контактом. Откройте новую страницу.');return old;}
  const value={id,managerId:link.managerId,linkToken:link.token,start,contact,status:'pending',createdAt:new Date().toISOString()};state.receipts[id]=value;atomicJson(this.file,state);return value;
 }
 complete(id,event){const state=this.read(),item=state.receipts[id];if(!item)throw new BookingError('Бронирование не найдено.');item.status='booked';item.event={id:event.id,summary:event.summary,start:event.start,end:event.end,htmlLink:event.htmlLink,hangoutLink:event.hangoutLink,conferenceData:event.conferenceData};item.completedAt=new Date().toISOString();atomicJson(this.file,state);return item;}
 reminderLead(eventId,managerId){const item=Object.values(this.read().receipts).find(r=>r.status==='booked'&&r.managerId===String(managerId)&&r.event?.id===eventId);return item?{id:'public-'+item.id,owner:item.managerId+':'+item.managerId,fields:{fullName:item.contact.name,company:item.contact.company,email:item.contact.email},assigneeId:item.managerId}:null;}
}
export async function availableSlots(api,link,manager,date,now=new Date()){
 const zone=manager.calendar.timeZone,today=dateInZone(now,zone),policy=link.rules;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||date>plusDays(today,policy.horizon))throw new BookingError('Дата за пределами доступного периода.');
 if(date<today||!policy.days.includes(new Date(date+'T12:00:00Z').getUTCDay()))return [];
 const start=wallTime(date,policy.start,zone),end=wallTime(date,policy.end,zone);
 const {data}=await api.freebusy.query({requestBody:{timeMin:start.toISOString(),timeMax:end.toISOString(),items:[{id:manager.calendar.id}]}},{timeout:15000});
 const calendar=data.calendars?.[manager.calendar.id];if(!calendar||calendar.errors?.length)throw new BookingError('Календарь временно недоступен. Попробуйте позже.');
 const slots=[];for(let time=start.getTime();time+1800000<=end.getTime();time+=1800000){
  if(time<now.getTime()+3600000||(calendar.busy||[]).some(b=>time<Date.parse(b.end)&&time+1800000>Date.parse(b.start)))continue;
  const local=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(time));
  try{if(wallTime(date,local,zone).getTime()!==time)continue;}catch{continue;}
  slots.push(new Date(time).toISOString());
 }return slots;
}
export function bookPublic(args){return withCalendarLock('public:'+args.submission,()=>confirmPublic(args));}
async function confirmPublic({links,link,manager,api,submission,start,contact,now=new Date()}){
 const existing=links.receipt(submission),date=dateInZone(new Date(start),manager.calendar.timeZone);
 if(existing){links.pending(link,submission,start,contact);if(existing.status==='booked')return existing;
  try{const {data}=await api.events.get({calendarId:manager.calendar.id,eventId:'ea'+createHash('sha256').update('public:'+submission).digest('hex')},{timeout:10000});
   if(data.extendedProperties?.private?.publicReservationId!==submission||data.extendedProperties?.private?.managerTelegramId!==manager.userId)throw new BookingError('Google вернул другое бронирование. Обратитесь к менеджеру.');return links.complete(submission,data);
  }catch(error){if(Number(error.code||error.response?.status)!==404)throw error;}
 }
 const slots=await availableSlots(api,link,manager,date,now);if(!slots.includes(start))throw new BookingError('Это время уже занято или недоступно. Выберите другой слот.');
 links.pending(link,submission,start,contact);
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:manager.calendar.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(start)).map(p=>[p.type,p.value]));
 const lead={id:'public-'+submission,fields:{fullName:contact.name,company:contact.company,email:contact.email}};
 try{
  const event=await bookMeeting(api,{submission:'public:'+submission,date,time:parts.hour+':'+parts.minute,timeZone:manager.calendar.timeZone,managerTelegramId:manager.userId,publicReservationId:submission,createMeet:true,sendInvites:true,guests:[contact.email]},lead,manager.calendar,now);
  return links.complete(submission,event);
 }catch(error){if(!existing&&error instanceof BookingError)links.discardPending(submission);throw error;}
}
