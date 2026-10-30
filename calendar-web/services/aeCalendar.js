import {wallTime,BookingError} from './calendarBooking.js';import {dateInZone,plusDays} from './bookingLinks.js';
const hex=value=>/^#[a-f0-9]{6}$/i.test(value||'')?value:null;
const contrast=color=>{const [r,g,b]=color.slice(1).match(/../g).map(v=>parseInt(v,16));return r*.299+g*.587+b*.114>150?'#1f1f1f':'#ffffff';};
const minutes=(time,zone)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time)).map(p=>[p.type,p.value]));return Number(p.hour)*60+Number(p.minute);};
export function bookingPrefill(params,manager,now=new Date()){
 if(params.get('from')!=='ae-slots')return {};
 const zone=params.get('timeZone');
 if(!manager||params.get('manager')!==manager.userId||![manager.calendar.timeZone,'Etc/GMT-1'].includes(zone))throw new BookingError('Choose a manager and calendar time again.');
 const date=params.get('date'),time=params.get('time');if(!/^[0-2]\d:[03]0$/.test(time||'')||wallTime(date,time,zone)<=now)throw new BookingError('Choose a future available time in the calendar.');return {date,time,...(zone==='Etc/GMT-1'?{timeZone:zone}:{})};
}
export function layoutEvents(events){
 const result=events.map(e=>({...e})).sort((a,b)=>a.startMinute-b.startMinute||b.endMinute-a.endMinute);let group=[],end=-1;
 const finish=()=>{const lanes=[];for(const event of group){let lane=lanes.findIndex(value=>value<=event.startMinute);if(lane<0)lane=lanes.length;lanes[lane]=event.endMinute;event.lane=lane;}for(const event of group)event.lanes=lanes.length;};
 for(const event of result){if(event.startMinute>=end){finish();group=[];end=-1;}group.push(event);end=Math.max(end,event.endMinute);}finish();return result;
}
export async function loadCalendarView({api,manager,viewerId,date,view='week',now=new Date(),timeZone}){
 if(!['day','week'].includes(view)||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw new BookingError('Choose a date and calendar view.');
 const zone=timeZone||manager.calendar.timeZone;if(![manager.calendar.timeZone,'Etc/GMT-1'].includes(zone))throw new BookingError('Unknown time zone.');wallTime(date,'12:00',zone);
 const weekday=new Date(date+'T12:00:00Z').getUTCDay(),first=view==='week'?plusDays(date,-((weekday+6)%7)):date,days=Array.from({length:view==='week'?7:1},(_,i)=>plusDays(first,i));
 const timeMin=wallTime(first,'00:00',zone).toISOString(),timeMax=wallTime(plusDays(days.at(-1),1),'00:00',zone).toISOString(),calendarId=manager.calendar.id;
 const metadata=await Promise.allSettled([api.calendarList.get({calendarId},{timeout:10000}),api.colors.get({},{timeout:10000}),api.calendars.get({calendarId},{timeout:10000})]);
 if(metadata[0].status!=='fulfilled')throw new BookingError('Could not read the manager calendar. Check the connection.');
 const calendar=metadata[0].value.data,palette=metadata[1].status==='fulfilled'?metadata[1].value.data:{},labels=metadata[2].status==='fulfilled'?metadata[2].value.data.labelProperties?.eventLabels||[]:[];
 const [raw,availability]=await Promise.all([(async()=>{const events=[];let pageToken;do{const {data}=await api.events.list({calendarId,timeMin,timeMax,timeZone:zone,singleEvents:true,showDeleted:false,orderBy:'startTime',maxResults:250,pageToken},{timeout:15000});events.push(...(data.items||[]));pageToken=data.nextPageToken;if(events.length>10000)throw new BookingError('Too many events. Switch to day view.');}while(pageToken);return events;})(),api.freebusy.query({requestBody:{timeMin,timeMax,items:[{id:calendarId}]}},{timeout:15000})]);
 const busy=availability.data.calendars?.[calendarId];if(!busy||busy.errors?.length)throw new BookingError('Google did not confirm availability. Available slots are hidden.');
 const calendarColor=hex(calendar.backgroundColor)||hex(palette.calendar?.[calendar.colorId]?.background)||'#4285f4';
 const events=raw.filter(e=>e.status!=='cancelled').map(e=>{
  const custom=labels.find(l=>l.id===e.eventLabelId),standard=palette.event?.[e.colorId],background=hex(custom?.backgroundColor)||hex(standard?.background)||calendarColor,foreground=custom?contrast(background):hex(standard?.foreground)||hex(calendar.foregroundColor)||contrast(background);
  const masked=String(viewerId)!==String(manager.userId)&&['private','confidential'].includes(e.visibility),declined=e.attendees?.some(a=>a.self&&a.responseStatus==='declined');
  return {id:e.id,title:masked?'Busy':String(e.summary||'Untitled').slice(0,250),location:masked?'':String(e.location||'').slice(0,300),start:e.start?.dateTime||e.start?.date,end:e.end?.dateTime||e.end?.date,allDay:Boolean(e.start?.date),background,foreground,transparent:e.transparency==='transparent'||declined,declined:Boolean(declined),masked,eventType:e.eventType||'default'};
 }).filter(e=>e.start&&e.end);
 const dayStarts=[],dayLengths=[],dayTicks=[],segments=[];for(let index=0;index<days.length;index++){
  const day=days[index],from=wallTime(day,'00:00',zone).getTime(),to=wallTime(plusDays(day,1),'00:00',zone).getTime(),pieces=[];
  dayStarts.push(new Date(from).toISOString());dayLengths.push((to-from)/60000);dayTicks.push(Array.from({length:Math.ceil((to-from)/3600000)},(_,hour)=>({minute:hour*60,label:new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(from+hour*3600000))})));
  for(const event of events.filter(e=>!e.allDay)){const start=Date.parse(event.start),end=Date.parse(event.end);if(start>=to||end<=from||!Number.isFinite(start)||!Number.isFinite(end))continue;const startMinute=Math.max(0,(start-from)/60000),endMinute=Math.min((to-from)/60000,(end-from)/60000);pieces.push({...event,dayIndex:index,startMinute,endMinute:Math.max(startMinute+1,endMinute)});}
  segments.push(...layoutEvents(pieces));
 }
 const slots=[];for(let dayIndex=0;dayIndex<days.length;dayIndex++)for(let minute=0;minute<1440;minute+=30){const time=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');let start;try{start=wallTime(days[dayIndex],time,zone).getTime();}catch{continue;}if(start<=now.getTime()||(busy.busy||[]).some(b=>start<Date.parse(b.end)&&start+1800000>Date.parse(b.start)))continue;slots.push({date:days[dayIndex],time,dayIndex,minute:(start-wallTime(days[dayIndex],'00:00',zone).getTime())/60000,start:new Date(start).toISOString()});}
 const warnings=[];if(metadata[1].status!=='fulfilled')warnings.push('Google did not return event colors; the calendar color is shown.');if(metadata[2].status!=='fulfilled')warnings.push('Reconnect Google Calendar in Settings to display custom color labels.');
 if(dayLengths.some(length=>length!==1440))warnings.push('This period includes a daylight saving change. Times are labeled inside the affected day column. Repeated slots are not offered for booking.');
 const today=dateInZone(now,zone),nowMinute=(now.getTime()-wallTime(today,'00:00',zone).getTime())/60000;
 return {managerId:manager.userId,calendar:calendar.summary||manager.email,timeZone:zone,days,dayStarts,dayLengths,dayTicks,events,segments,slots,warnings,fetchedAt:now.toISOString(),today,nowMinute};
}
