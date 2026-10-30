import {BookingError,wallTime} from './calendarBooking.js';

export const intervalBusy=(busy,start)=>busy.some(b=>start<Date.parse(b.end)&&start+1800000>Date.parse(b.start));

export async function calendarBusy({organizer,receiver,clientFor,start,end}){
 const accounts=[organizer,...(organizer.calendar.id===receiver.calendar.id?[]:[receiver])],busy=[];
 for(const account of accounts){
  const {data}=await clientFor(account.userId).freebusy.query({requestBody:{timeMin:start,timeMax:end,items:[{id:account.calendar.id}]}},{timeout:15000,retry:false});
  const result=data.calendars?.[account.calendar.id];
  if(!result||result.errors?.length||!Array.isArray(result.busy)||result.busy.some(b=>!Number.isFinite(Date.parse(b.start))||!Number.isFinite(Date.parse(b.end))||Date.parse(b.end)<=Date.parse(b.start)))throw new BookingError('Unable to verify organizer and accepting manager availability. Try again.');
  busy.push(...result.busy);
 }
 return busy;
}

export async function handoffAvailability({organizer,receiver,clientFor,date,timeZone,time,now=Date.now()}){
 if(!organizer?.calendar?.id)throw new BookingError('Connect your Google Calendar in Settings before creating a meeting.');
 if(![organizer.calendar.timeZone,receiver.calendar.timeZone,'Europe/Warsaw','UTC','Etc/GMT-1'].includes(timeZone))throw new BookingError('Unknown time zone.');
 const start=wallTime(date,'09:00',timeZone).getTime(),end=wallTime(date,'18:00',timeZone).getTime(),chosen=time?wallTime(date,time,timeZone).getTime():null;
 const busy=await calendarBusy({organizer,receiver,clientFor,start:new Date(Math.min(start,chosen??start)).toISOString(),end:new Date(Math.max(end,chosen===null?end:chosen+1800000)).toISOString()});
 const slots=[];for(let t=start;t+1800000<=end;t+=1800000)if(t>now&&!intervalBusy(busy,t))slots.push(new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit'}).format(new Date(t)));
 return {date,timeZone,slots,selectedAvailable:chosen===null?null:chosen>now&&!intervalBusy(busy,chosen)};
}
