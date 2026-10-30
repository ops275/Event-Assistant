import fs from 'node:fs';import path from 'node:path';import dotenv from 'dotenv';import {google} from 'googleapis';import {setTimeout as delay} from 'node:timers/promises';
import {AdminSettings,atomicJson} from './services/adminService.js';import {reminderCycle,reminderRecipient} from './services/reminderService.js';import {CalendarAccounts} from './services/calendarAccounts.js';
import {BookingLinks,publicReminderLead} from './services/bookingLinks.js';
import {manualReminderLead} from './services/manualMeeting.js';
dotenv.config({path:process.env.CALENDAR_BOT_ENV||'/root/event-bot/.env.onlyplay',quiet:true});
if(process.env.BOT_PROFILE!=='onlyplay')throw new Error('Onlyplay profile required');
const privateDir=process.env.CALENDAR_PRIVATE_DIR||'/root/event-bot/calendar-private';
const ledgerFile=process.env.REMINDER_LEDGER_FILE,settingsFile=process.env.ADMIN_SETTINGS_FILE;
if(!ledgerFile||!settingsFile||!process.env.TELEGRAM_BOT_TOKEN)throw new Error('Reminder configuration incomplete');
const lock=ledgerFile+'.lock';fs.mkdirSync(path.dirname(lock),{recursive:true});
if(fs.existsSync(lock)){const pid=Number(fs.readFileSync(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<1)throw new Error('Invalid worker lock');try{process.kill(pid,0);throw new Error('Reminder worker already running');}catch(error){if(error.code!=='ESRCH')throw error;}fs.unlinkSync(lock);}
fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});process.on('exit',()=>{try{if(fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}catch{}});
const client=JSON.parse(fs.readFileSync(path.join(privateDir,'client.json'),'utf8')).web;
const auth=new google.auth.OAuth2(client.client_id,client.client_secret);
auth.setCredentials(JSON.parse(fs.readFileSync(path.join(privateDir,'tokens.json'),'utf8')));
const target=JSON.parse(fs.readFileSync(path.join(privateDir,'test-calendar.json'),'utf8').replace(/^\uFEFF/,''));
const api=google.calendar({version:'v3',auth});const admin=new AdminSettings(settingsFile);
const accounts=new CalendarAccounts(process.env.CALENDAR_ACCOUNTS_DIR||path.join(privateDir,'accounts'));
const bookingLinks=new BookingLinks(process.env.BOOKING_LINKS_DIR||path.join(privateDir,'booking-links'));
const publicLead=(event,owner)=>publicReminderLead(bookingLinks,event,owner)||manualReminderLead(event,owner);
const contexts=new Map();
let ledger=fs.existsSync(ledgerFile)?JSON.parse(fs.readFileSync(ledgerFile,'utf8')):{deliveries:{}};
const persist=data=>atomicJson(ledgerFile,data);
async function send(recipient,text,event){
 const context=event._calendarOwner?contexts.get(event._calendarOwner):{api,target};
 if(!context||event._calendarOwner&&accounts.status(event._calendarOwner)?.version!==context.version)return {skipped:true};
 let current;try{current=(await context.api.events.get({calendarId:context.target.id,eventId:event.id},{timeout:10000})).data;}catch(error){if(Number(error.code||error.response?.status)===404)return {skipped:true};throw Object.assign(new Error('Calendar recheck failed'),{code:503});}
 if(current.status==='cancelled'||current.start?.dateTime!==event.start.dateTime||current.updated!==event.updated||current.extendedProperties?.private?.timeStatus!=='defined'||Date.parse(current.start.dateTime)<=Date.now())return {skipped:true};
 const settings=admin.read(),lead=JSON.parse(fs.readFileSync(process.env.CALENDAR_LEADS_FILE||'/root/event-bot/data/onlyplay/state.json','utf8')).leads?.[current.extendedProperties.private.leadId]||publicLead(current,event._calendarOwner);
 const expected=reminderRecipient({...current,_calendarOwner:event._calendarOwner},lead,settings);
 if(!lead||lead.deletedAt||expected!==recipient||settings.remindersEnabled===false||settings.users[recipient]?.muted||settings.users[recipient]?.blocked)return {skipped:true};
 const buttons=[];try{const url=new URL(event.htmlLink);if(url.protocol==='https:'&&['calendar.google.com','www.google.com'].includes(url.hostname))buttons.push([{text:'Open meeting',url:url.href}]);}catch{}
 const response=await fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:recipient,text,link_preview_options:{is_disabled:true},...(buttons.length?{reply_markup:{inline_keyboard:buttons}}:{})}),signal:AbortSignal.timeout(15000)});
 const result=await response.json();if(!response.ok||!result.ok)throw Object.assign(new Error('Telegram delivery failed'),{code:result.error_code||response.status,retryAfter:result.parameters?.retry_after});return result.result;
}
let stopped=false;const stop=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopped=true;stop.abort();});
console.log('Onlyplay reminder worker started');
do{
 try{
  const now=Date.now(),events=[],failures=[];contexts.clear();
  const sources=[{api,target}];
  for(const account of accounts.all()){
   if(admin.blocked(account.userId)||admin.read().users[account.userId]?.role==='promoter')continue;
   const value=accounts.load(account.userId),ownAuth=new google.auth.OAuth2(client.client_id,client.client_secret);ownAuth.setCredentials(value.tokens);ownAuth.on('tokens',tokens=>accounts.refresh(account.userId,value.version,tokens));
   const context={api:google.calendar({version:'v3',auth:ownAuth}),target:account.calendar,owner:account.userId,version:account.version};contexts.set(account.userId,context);sources.push(context);
  }
  for(const source of sources){let pageToken;try{
   do{const {data}=await source.api.events.list({calendarId:source.target.id,timeMin:new Date(now).toISOString(),timeMax:new Date(now+7*86400000).toISOString(),singleEvents:true,showDeleted:false,orderBy:'startTime',maxResults:250,privateExtendedProperty:'source=onlyplay-local-test',pageToken},{timeout:15000});events.push(...(data.items||[]).map(event=>({...event,...(source.owner?{_calendarOwner:source.owner}:{})})));pageToken=data.nextPageToken;}while(pageToken&&!stopped);
  }catch{failures.push(source.owner||'legacy');}}
  const state=JSON.parse(fs.readFileSync(process.env.CALENDAR_LEADS_FILE||'/root/event-bot/data/onlyplay/state.json','utf8'));
  for(const event of events){const lead=publicLead(event,event._calendarOwner);if(lead)state.leads[lead.id]=lead;}
  await reminderCycle({events,leads:state.leads,settings:admin.read(),ledger,persist,send,now:Date.now()});
  if(failures.length){ledger.error='calendar_unavailable:'+failures.join(',');ledger.errorAt=Date.now();persist(ledger);}
 }catch(error){ledger.error=String(Number(error.response?.status||error.code)||error.name||'request_error');ledger.errorAt=Date.now();persist(ledger);console.error('Reminder cycle failed:',ledger.error);}
 if(!stopped)await delay(30000,undefined,{signal:stop.signal}).catch(()=>{});
}while(!stopped);
