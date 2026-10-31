import {visibleManager} from './services/managerVisibility.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import { verifyBookingTicket, verifyTelegramInitData, miniappDestination,rememberBookingLead } from './services/bookingAccess.js';
import {AdminSettings} from './services/adminService.js';
import {CalendarAccounts} from './services/calendarAccounts.js';
import {createCalendarConnect} from './services/calendarConnect.js';
import {BookingLinks} from './services/bookingLinks.js';
import {createBookingLinkRoutes} from './services/bookingLinkRoutes.js';
import {createAeCalendarRoutes} from './services/aeCalendarRoutes.js';
import {bookingPrefill} from './services/aeCalendar.js';
import {sameAppOrigin} from './services/requestOrigin.js';
import {OnboardingJobs} from './services/onboardingService.js';
import {createOnboardingRoutes} from './services/onboardingRoutes.js';
if(process.env.CALENDAR_BOT_ENV)dotenv.config({path:process.env.CALENDAR_BOT_ENV,quiet:true});
import {renderBookingForm, bookingStyles, renderMeetLink} from './services/bookingView.js';
import { wallTime } from './services/calendarBooking.js';
import {HandoffJournal,readHandoffState,handoffForRole} from './services/handoffJournal.js';
import {handoffAvailability} from './services/handoffAvailability.js';
import {createHandoffService} from './services/handoffService.js';
import {createHandoffRoutes} from './services/handoffRoutes.js';
import {createDashboardRoutes} from './services/dashboardRoutes.js';

const privateDir=process.env.CALENDAR_PRIVATE_DIR;
if(!privateDir) throw new Error('CALENDAR_PRIVATE_DIR required');
const credentials=JSON.parse(fs.readFileSync(path.join(privateDir,'client.json'),'utf8')).web;
const redirect='http://localhost:8765/oauth/google/callback';
const oauth=new google.auth.OAuth2(credentials.client_id,credentials.client_secret,redirect);
const tokenFile=path.join(privateDir,'tokens.json');
if(fs.existsSync(tokenFile)) oauth.setCredentials(JSON.parse(fs.readFileSync(tokenFile,'utf8')));
const sessions=new Map();
const webSessions=new Map(),redeemed=new Map();
const publicMode=Boolean(process.env.CALENDAR_PUBLIC_URL_FILE);
const requireCalendar=process.env.REQUIRE_CALENDAR_CONNECTION==='true';
const nextPage=ticket=>miniappDestination(ticket,{requireCalendar,connected:Boolean(accounts.status(ticket.userId))});
const admin=new AdminSettings(process.env.ADMIN_SETTINGS_FILE||'');
const publicBase=()=>publicMode?new URL(fs.readFileSync(process.env.CALENDAR_PUBLIC_URL_FILE,'utf8').trim()):null;
const sessionCookie=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('web_session='))?.slice(12);
const port=Number(process.env.PORT||8766);
const accounts=new CalendarAccounts(process.env.CALENDAR_ACCOUNTS_DIR||path.join(privateDir,'accounts'));
const googleOrigin=()=>process.env.GOOGLE_OAUTH_PUBLIC_URL||'https://onlyplay.5.22.222.83.sslip.io';
const personal=createCalendarConnect({accounts,credentials,admin,secret:process.env.TELEGRAM_BOT_TOKEN,googleOrigin,publicBase});
const bookingLinks=new BookingLinks(process.env.BOOKING_LINKS_DIR||path.join(privateDir,'booking-links'));
const linkRoutes=createBookingLinkRoutes({links:bookingLinks,accounts,admin,personal,publicBase});
const aeRoutes=createAeCalendarRoutes({accounts,admin,personal});
const onboardingJobs=new OnboardingJobs(process.env.ONBOARDING_JOBS_DIR||'/root/event-bot/data/onlyplay/onboarding');
const onboardingRoutes=createOnboardingRoutes({jobs:onboardingJobs,admin,leads:()=>Object.values(JSON.parse(fs.readFileSync(process.env.CALENDAR_LEADS_FILE||path.join(privateDir,'onlyplay-state.json'),'utf8')).leads||{}),users:()=>JSON.parse(fs.readFileSync(process.env.CALENDAR_LEADS_FILE||path.join(privateDir,'onlyplay-state.json'),'utf8')).users||{},health:()=>{try{const h=JSON.parse(fs.readFileSync(path.join(onboardingJobs.directory,'health.json'),'utf8'));return {...h,ready:h.ready&&Date.now()-h.checkedAt<30000};}catch{return {ready:false};}}});

const target=JSON.parse(fs.readFileSync(path.join(privateDir,'test-calendar.json'),'utf8').replace(/^\uFEFF/,''));
const scopes=['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.freebusy'];
const canWrite=()=>String(oauth.credentials.scope||'').split(' ').some(scope=>scope.endsWith('/calendar.events')||scope.endsWith('/calendar'));
const leadStateFile=process.env.CALENDAR_LEADS_FILE||path.join(privateDir,'onlyplay-state.json');
const handoffJournal=new HandoffJournal(leadStateFile);
const dashboardRoutes=createDashboardRoutes({admin,state:()=>JSON.parse(fs.readFileSync(leadStateFile,'utf8')),handoffs:()=>handoffJournal.records(),onboarding:()=>onboardingJobs.all()});
const leads=owner=>Object.values(readHandoffState(leadStateFile,handoffJournal).leads||{}).filter(lead=>!lead.deletedAt&&lead.fields?.fullName?.trim());
const handoffService=createHandoffService({journal:handoffJournal,accounts,settings:()=>admin.read(),nameFor:id=>readHandoffState(leadStateFile,handoffJournal).users?.[id]?.name||'',userFor:id=>readHandoffState(leadStateFile,handoffJournal).users?.[id],roleFor:id=>readHandoffState(leadStateFile,handoffJournal).userRoles?.[id],clientFor:id=>personal.clientFor(id),send:async(recipient,text,options={})=>{
 const response=await fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:recipient,text,...(options.parse_mode?{parse_mode:options.parse_mode}:{}),link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(15000)});
 const result=await response.json();if(!response.ok||!result.ok)throw Object.assign(new Error('Telegram delivery failed'),{code:result.error_code||response.status,retryAfter:result.parameters?.retry_after});return result.result;
}});
const handoffRoutes=createHandoffRoutes({service:handoffService,sessions,sessionCookie:cookie,leads,origins:()=>[publicBase()?.origin,googleOrigin(),...(!publicMode?['http://localhost:'+port,'http://127.0.0.1:'+port]:[])],renderMeetLink});
let recoveringHandoffs=false;
async function recoverHandoffs(){if(recoveringHandoffs)return;recoveringHandoffs=true;try{await handoffService.recover();if(handoffJournal.errors.length)console.error('Damaged handoff journal records:',handoffJournal.errors.length);}catch(error){console.error('Handoff recovery failed:',error.name);}finally{recoveringHandoffs=false;}}
setInterval(recoverHandoffs,30000).unref();recoverHandoffs();
oauth.on('tokens',tokens=>{const saved={...oauth.credentials,...tokens};fs.writeFileSync(tokenFile,JSON.stringify(saved,null,2),{mode:0o600});});

const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const page=body=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>qooob — Hand off lead</title><script src="https://telegram.org/js/telegram-web-app.js"></script><script src="/miniapp-ui.js" defer></script><style>${bookingStyles}</style></head><body><header><span class="brand-mark">E</span>Event Assistant<small>qooob</small></header><main>${body}</main></body></html>`;
function reply(res,status,body){res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':res.getHeader('Referrer-Policy')||'same-origin','Content-Security-Policy':"default-src 'none'; script-src 'self' https://telegram.org; connect-src 'self'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org"});res.end(page(body));}
function cookie(req){return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('calendar_session='))?.slice(17);}
const server=http.createServer(async(req,res)=>{
 try{
  if(![publicBase()?.host,new URL(googleOrigin()).host,'localhost:'+port,'127.0.0.1:'+port].filter(Boolean).includes(req.headers.host)) return reply(res,400,'Invalid address.');
  const url=new URL(req.url,publicBase()?.origin||'http://localhost:'+port);
  let identity=null;
  if(aeRoutes.staticRoute(req,res,url))return;
  if(url.pathname==='/onboarding-ui.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(fs.readFileSync(new URL('./onboarding-ui.js',import.meta.url)));}
  if(url.pathname==='/dashboard-ui.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(fs.readFileSync(new URL('./dashboard-ui.js',import.meta.url)));}
  if(publicMode&&await linkRoutes.publicRoute(req,res,url,reply))return;
  if(publicMode&&await personal.publicRoute(req,res,url,reply))return;
  if(publicMode && url.pathname!=='/health'){
   if(url.pathname==='/miniapp-ui.js') {
    res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(fs.readFileSync(new URL('./miniapp-ui.js',import.meta.url),'utf8'));
   }
   if(url.pathname==='/miniapp' && req.method==='GET')return reply(res,200,'<h2>Hand off lead</h2><p id="miniapp-status">Connecting Telegram…</p>');
   if(url.pathname==='/miniapp-auth' && req.method==='POST'){
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
    if(!sameAppOrigin(req,[publicBase().origin,googleOrigin()])){res.writeHead(403);return res.end(JSON.stringify({error:'Request origin is not allowed.'}));}
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>20000){res.writeHead(413);return res.end('{}');}}
    let ticket,user;
    try{const input=JSON.parse(raw);ticket=verifyBookingTicket(process.env.TELEGRAM_BOT_TOKEN,input.ticket);user=verifyTelegramInitData(process.env.TELEGRAM_BOT_TOKEN,input.initData);if(String(user.id)!==String(ticket.userId)||ticket.owner!==String(user.id)+':'+String(user.id))throw new Error('Identity mismatch');}
    catch{res.writeHead(403);return res.end(JSON.stringify({error:'Could not verify Telegram sign-in. Open Hand off lead again in the bot.'}));}
    for(const [key,expiry] of redeemed)if(expiry<Date.now())redeemed.delete(key);
    for(const [key,session] of webSessions)if(session.expires<Date.now())webSessions.delete(key);
    if(redeemed.has(ticket.nonce)){
     const existing=webSessions.get(sessionCookie(req));
     if(existing&&existing.expires>Date.now()&&existing.nonce===ticket.nonce&&existing.owner===ticket.owner&&String(existing.userId)===String(ticket.userId))return res.end(JSON.stringify({next:nextPage(ticket)}));
     res.writeHead(403);return res.end(JSON.stringify({error:'Get a new Hand off lead button in the bot.'}));
    }
    redeemed.set(ticket.nonce,ticket.expires);
    const key=crypto.randomBytes(32).toString('hex');webSessions.set(key,{...ticket,name:[user.first_name,user.last_name].filter(Boolean).join(' '),expires:Date.now()+60*60*1000});
    res.setHeader('Set-Cookie',`web_session=${key}; Secure; HttpOnly; SameSite=None; Partitioned; Path=/; Max-Age=3600`);
    return res.end(JSON.stringify({next:nextPage(ticket)}));
   }
   identity=webSessions.get(sessionCookie(req));
   if(!identity||identity.expires<Date.now())return reply(res,403,'Open this form using Hand off lead in qooob. Direct URL access is disabled.');
   if(admin.blocked(identity.userId)||admin.role(identity.userId)==='promoter')return reply(res,403,'Your role or access was changed by an administrator. Booking is unavailable.');
   if(await dashboardRoutes.route(req,res,url,identity,reply,[publicBase()?.origin,googleOrigin()]))return;
   if(await personal.authenticatedRoute(req,res,url,identity,reply))return;
   if(await onboardingRoutes.route(req,res,url,identity,reply,[publicBase()?.origin,googleOrigin()]))return;
   if(await aeRoutes.route(req,res,url,identity,reply))return;
   if(await linkRoutes.authenticatedRoute(req,res,url,identity,reply))return;
   if(url.pathname==='/auth/google'||url.pathname==='/oauth/google/callback')return reply(res,403,'The test Google connection is managed locally by an administrator.');
   if(url.pathname==='/calendars'){res.writeHead(302,{Location:'/calendar','Cache-Control':'no-store'});return res.end();}
  }

  if(!['GET','POST'].includes(req.method))return reply(res,405,'Method not allowed.');
  if(url.pathname==='/')return reply(res,200,`<p>${fs.existsSync(tokenFile)?'Connection saved.':'Google Calendar is not connected yet.'}</p><p><a class="button" href="/auth/google">Connect corporate Google account</a></p>${fs.existsSync(tokenFile)?'<p><a href="/calendars">Check available calendars</a></p>':''}<p><a href="/book">Open Hand off lead</a></p><p>Sign-in opens in Google. If Workspace blocks the app, share the error text with an administrator.</p>`);
  if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"ok":true}');}
  if(url.pathname==='/auth/google'){
   const session=crypto.randomBytes(24).toString('hex');
   const state=crypto.randomBytes(24).toString('hex');
   for(const [id,item] of sessions)if(item.expires<Date.now())sessions.delete(id);
   sessions.set(session,{state,expires:Date.now()+10*60*1000});
   const authUrl=oauth.generateAuthUrl({access_type:'offline',prompt:'consent',scope:scopes,state});
   res.writeHead(302,{'Location':authUrl,'Set-Cookie':`calendar_session=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,'Cache-Control':'no-store'});return res.end();
  }
  if(url.pathname==='/oauth/google/callback'){
   const sessionId=cookie(req), session=sessions.get(sessionId);
   if(!session||session.expires<Date.now()||session.state!==url.searchParams.get('state'))return reply(res,400,'Sign-in session does not match or has expired. <a href="/">Start again</a>');
   sessions.delete(sessionId);
   if(url.searchParams.has('error'))return reply(res,400,`Google denied access: ${escape(url.searchParams.get('error'))}. <a href="/">Back</a>`);
   const code=url.searchParams.get('code');if(!code)return reply(res,400,'Google did not return an authorization code.');
   const {tokens}=await oauth.getToken(code);
   // Never carry tokens from a previously connected Google account.
   const saved=tokens;
   oauth.setCredentials(saved);fs.writeFileSync(tokenFile,JSON.stringify(saved,null,2),{mode:0o600});
   res.writeHead(302,{'Location':'/calendars','Cache-Control':'no-store','Set-Cookie':'calendar_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});return res.end();
  }
  if(url.pathname==='/calendars'){
   if(!oauth.credentials.access_token&&!oauth.credentials.refresh_token)return reply(res,401,'First <a href="/">connect Google</a>.');
   const api=google.calendar({version:'v3',auth:oauth});const items=[];let pageToken;
   do{const {data}=await api.calendarList.list({maxResults:100,pageToken},{timeout:15000});items.push(...(data.items||[]));pageToken=data.nextPageToken;}while(pageToken);
   return reply(res,200,`<h2>Connection is working</h2><p>Calendars found: ${items.length}</p><ul>${items.map(c=>`<li><b>${escape(c.summary)}</b><br><small>${escape(c.id)} · ${escape(c.accessRole)} · ${escape(c.timeZone)}</small></li>`).join('')}</ul><p><a class="button" href="/book">Open Hand off lead</a></p><a href="/">Home</a>`);
  }
  if(url.pathname==='/book' && req.method==='GET'){
   const leadId=rememberBookingLead(identity,url.searchParams);
   if(!leadId)return reply(res,400,'A lead is required to create a handoff. Return to the bot and add a lead or choose one from CRM.');
   const options=leads(identity?.owner); const selected=options.find(lead=>lead.id===leadId);
   if(leadId&&!options.some(lead=>lead.id===leadId))return reply(res,400,'This lead was deleted or is missing its name. Return to the bot, check the card and open Hand off lead again.');
   const sessionId=crypto.randomBytes(24).toString('hex');
   const csrf=crypto.randomBytes(24).toString('hex');
   sessions.set(sessionId,{csrf,type:'booking',owner:identity?.owner,submission:crypto.randomBytes(24).toString('hex'),expires:Date.now()+60*60*1000});
   res.setHeader('Set-Cookie',`calendar_session=${sessionId}; HttpOnly; ${publicMode?'SameSite=None; Secure; Partitioned; ':'SameSite=Lax; '}Path=/; Max-Age=3600`);
   const settings=admin.read(),managers=accounts.managers(identity?.userId,settings).filter(visibleManager).filter(account=>['admin','partnership'].includes(settings.users[account.userId]?.role));
   const preferred=identity?.managerId||url.searchParams.get('manager')||selected?.assigneeId||String(identity?.userId||'');
   const manager=managers.find(a=>a.userId===preferred);
   if(!manager)return reply(res,400,'The manager calendar is unavailable. Return to the bot and choose a Partnership Manager again.');
   const bookingTarget=manager?.calendar||{name:'Choose a manager calendar',timeZone:'UTC'};
   let prefill;try{prefill=bookingPrefill(url.searchParams,manager);}catch(error){return reply(res,400,escape(error.message)+' <a href="/ae-slots">Back to calendar</a>');}
   if(!identity?.userId||!accounts.status(identity.userId)?.calendar?.id)return reply(res,400,'Connect your Google Calendar in Settings before creating a meeting. <a href="/calendar">Connect calendar</a>');
   return reply(res,200,renderBookingForm({leads:options.map(lead=>handoffForRole(lead,settings.users?.[identity.userId]?.role)),selectedId:selected?.id,blank:false,csrf,target:bookingTarget,canWrite:managers.length>0,managers,managerId:manager?.userId,prefill}));
  }
  if(await handoffRoutes.route(req,res,url,identity,reply))return;
  if(url.pathname==='/slots' && req.method==='GET'){
   let manager;try{manager=accounts.select(identity?.userId,url.searchParams.get('manager'),admin.read());}catch{return reply(res,400,'Choose a connected manager calendar.');}
   const bookingTarget=manager.calendar;
   const date=url.searchParams.get('date'),timeZone=url.searchParams.get('timeZone')||bookingTarget.timeZone;
   if(![bookingTarget.timeZone,'Europe/Warsaw','UTC','Etc/GMT-1'].includes(timeZone))return reply(res,400,'Unknown time zone.');
   const result=await handoffAvailability({organizer:accounts.status(identity.userId),receiver:manager,clientFor:id=>personal.clientFor(id),date,timeZone,time:url.searchParams.get('time')||undefined});
   const {slots}=result;
   if(url.searchParams.get('format')==='json'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(JSON.stringify(result));}
   return reply(res,200,`<h2>Available slots</h2><p>${escape(date)} · ${escape(timeZone)} · 30 minutes each</p><p>${slots.map(escape).join(' · ')||'No available slots between 09:00 and 18:00.'}</p><p>Availability is checked again when creating the meeting.</p><a href="/book">Back to form</a>`);
  }
  reply(res,404,'Page not found.');
 }catch(error){
  // Never log OAuth codes, tokens, request URLs or SDK response payloads.
  console.error('Calendar check failed:',Number(error.response?.status||error.status)||'request_error');
  reply(res,502,`Check failed. HTTP ${Number(error.response?.status||error.status)||'unknown'}. Workspace or Calendar API restrictions may apply. <a href="/">Retry</a>`);
 }
});
server.listen(port,'127.0.0.1',()=>console.log('qooob calendar web ready on loopback port '+port));
