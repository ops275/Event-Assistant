import {leadPayload} from './leadLink.js';

const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const dateKey=(date,timeZone)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value]));
const key=(date,timeZone)=>{const parts=dateKey(date,timeZone);return `${parts.year}-${parts.month}-${parts.day}`;};
const addDays=(value,days)=>{const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day+days,12));return date.toISOString().slice(0,10);};
const clip=(value,limit=1400)=>{let result='';for(const character of String(value??'')){const safe=escape(character);if(result.length+safe.length>limit)return result+'…';result+=safe;}return result;};
const involved=(record,userId)=>[record.sender?.id,record.organizer?.id,record.receiver?.id].some(id=>String(id||'')===String(userId));
function safeCalendarLink(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.href.length<=2048&&(url.hostname==='calendar.google.com'||['google.com','www.google.com'].includes(url.hostname)&&url.pathname.startsWith('/calendar/'))?url.href:null;}catch{return null;}}
function format(record,timeZone){
 const date=new Date(record.request.start.dateTime),zone=record.request.start.timeZone||record.calendar?.timeZone||timeZone;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));
 const prefix='Onlyplay × ',summary=String(record.request.summary||''),label=summary.startsWith(prefix)?summary.slice(prefix.length):summary;
 const leadLink='https://t.me/only_leadcapture_bot?start='+leadPayload(record.leadId),meetingLabel=(record.meetingType==='online'?'Online':'Offline')+' meeting',calendarLink=safeCalendarLink(record.event?.htmlLink);
 const meeting=calendarLink?`<a href="${escape(calendarLink)}">${meetingLabel}</a>`:meetingLabel;
 return `Onlyplay × <a href="${leadLink}">${clip(label)}</a>\n${meeting} · ${parts.year}-${parts.month}-${parts.day} · ${parts.hour}:${parts.minute}`;
}

export const MEETING_PERIODS=Object.freeze({today:'Today',tomorrow:'Tomorrow',week:'This week'});

export function myMeetings(records,{userId,period,timeZone='UTC',now=new Date()}){
 if(!Object.hasOwn(MEETING_PERIODS,period))throw new Error('Unknown meeting period.');
 const today=key(now,timeZone),dates=period==='today'?[today]:period==='tomorrow'?[addDays(today,1)]:Array.from({length:7},(_,index)=>addDays(today,index));
 return (records||[]).filter(record=>record?.status==='confirmed'&&!record.inbox&&involved(record,userId)&&Number.isFinite(Date.parse(record.request?.start?.dateTime))&&dates.includes(key(new Date(record.request.start.dateTime),record.request.start.timeZone||record.calendar?.timeZone||timeZone))).sort((a,b)=>Date.parse(a.request.start.dateTime)-Date.parse(b.request.start.dateTime)||String(a.id).localeCompare(String(b.id))).map(record=>({record,text:format(record,timeZone)}));
}
