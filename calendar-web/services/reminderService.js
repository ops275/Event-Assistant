export function reminderRecipient(event,lead,settings){
 const meta=event.extendedProperties?.private;
 if(meta?.handoffId&&event._calendarOwner){const recipient=String(meta.managerTelegramId||'');return String(event._calendarOwner)===(meta.organizerTelegramId||meta.creatorTelegramId)&&['admin','partnership'].includes(settings.users?.[recipient]?.role)?recipient:null;}
 if(event._calendarOwner){const owner=String(event._calendarOwner);return /^\d+$/.test(owner)&&event.extendedProperties?.private?.managerTelegramId===owner&&settings.users?.[owner]?.role!=='promoter'?owner:null;}
 const creator=lead?.owner?.match(/^(\d+):\1$/)?.[1],assignee=String(lead?.assigneeId||'');
 return /^\d+$/.test(assignee)&&['partnership','admin'].includes(settings.users?.[assignee]?.role)?assignee:creator;
}
export async function reminderCycle({events,leads,settings,ledger,persist,send,now=Date.now()}){
 ledger.deliveries||={};
 const defaultMinutes=[5,15,30,60].includes(settings.reminderMinutes)?settings.reminderMinutes:15;
 ledger.upcoming=events.filter(e=>e.status!=='cancelled'&&e.start?.dateTime&&Date.parse(e.start.dateTime)>now&&e.extendedProperties?.private?.timeStatus!=='inbox').map(e=>({id:e.id,summary:e.summary,start:e.start.dateTime,timeZone:e.start.timeZone,leadId:e.extendedProperties?.private?.leadId})).slice(0,100);
 if(settings.remindersEnabled!==false)for(const event of events){
  const meta=event.extendedProperties?.private,lead=leads[meta?.leadId];
  const chosen=meta?.reminderMinutes;
  const minutes=chosen===undefined?defaultMinutes:(['0','5','15','30','60'].includes(chosen)?Number(chosen):0);
  if(minutes===0)continue;
  const start=Date.parse(event.start?.dateTime),remaining=start-now;
  if(!event.id||event.status==='cancelled'||meta?.source!=='onlyplay-local-test'||meta.timeStatus!=='defined'||!lead||lead.deletedAt||!Number.isFinite(start)||remaining<=0||remaining>minutes*60000)continue;
  const recipient=reminderRecipient(event,lead,settings);if(!recipient)continue;
  if(settings.users?.[recipient]?.blocked||settings.users?.[recipient]?.muted)continue;
  const key=[...(event._calendarOwner?[event._calendarOwner]:[]),event.id,event.start.dateTime,recipient].join('|'),old=ledger.deliveries[key];
  if(old&&(['sent','blocked','uncertain'].includes(old.status)||old.retryAt>now))continue;
  // After a crash between Telegram accepting a message and committing its receipt,
  // suppress an ambiguous resend; expose it in the admin delivery ledger.
  if(old?.status==='sending'){old.status='uncertain';persist(ledger);continue;}
  let zone=event.start.timeZone||'UTC',when;try{when=new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(start));}catch{zone='UTC';when=new Date(start).toISOString();}
  const text=[`Meeting in ${Math.ceil(remaining/60000)} min.`,String(event.summary||'Meeting').slice(0,250),`${when} · ${zone}`,event.location?`Location: ${String(event.location).slice(0,300)}`:'',event.hangoutLink?.startsWith('https://meet.google.com/')?event.hangoutLink:''].filter(Boolean).join('\n');
  ledger.deliveries[key]={status:'sending',at:now,eventId:event.id,recipient,start:event.start.dateTime,attempts:(old?.attempts||0)+1};persist(ledger);
  try{const result=await send(recipient,text,event,lead);Object.assign(ledger.deliveries[key],result?.skipped?{status:'skipped'}:{status:'sent',sentAt:now,messageId:result?.message_id});}
  catch(error){const code=Number(error.code)||0;Object.assign(ledger.deliveries[key],{status:[400,403].includes(code)?'blocked':code===0?'uncertain':'retry',code,retryAt:now+Math.max(60,Number(error.retryAfter)||60)*1000});}
  persist(ledger);
 }
 for(const [key,item] of Object.entries(ledger.deliveries))if(item.at<now-30*86400000)delete ledger.deliveries[key];
 ledger.checkedAt=now;ledger.error=null;persist(ledger);
}
