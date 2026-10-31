import {visibleManager} from './managerVisibility.js';
import {managerOptions} from './staffDirectory.js';
import fs from 'node:fs';import {randomBytes} from 'node:crypto';
import {sameAppOrigin} from './requestOrigin.js';
import {availableSlots,bookPublic,validateContact,dateInZone,plusDays} from './bookingLinks.js';import {BookingError} from './calendarBooking.js';import {renderMeetLink} from './bookingView.js';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cookie=(req,name)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
async function body(req){if(!String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'))throw new BookingError('Invalid request format.');let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)throw new BookingError('Request is too large.');}return new URLSearchParams(raw);}
export function createBookingLinkRoutes({links,accounts,admin,personal,publicBase}){
 const limits=new Map();
 const managers=()=>accounts.all().filter(a=>!admin.blocked(a.userId)&&['admin','partnership'].includes(admin.read().users[a.userId]?.role));
 const manager=id=>managers().find(a=>a.userId===String(id));
 const share=link=>publicBase().origin+'/schedule/'+link.token;
 const redirect=(res,to)=>{res.writeHead(303,{Location:to,'Cache-Control':'no-store'});res.end();};
 const rate=(req,limit)=>{const now=Date.now(),ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').slice(0,100),key=ip+':'+(req.method==='POST'?'write':'read');for(const [k,v] of limits)if(v.until<now)limits.delete(k);const item=limits.get(key)||{count:0,until:now+60000};item.count++;limits.set(key,item);return item.count<=limit;};
 function receiptPage(res,item,reply){return reply(res,200,`<p class="eyebrow">qooob</p><h2>Meeting booked</h2><p>${esc(item.contact.name)} · ${esc(item.contact.company)}</p><p>${esc(new Date(item.start).toLocaleString('en-GB',{timeZone:'UTC'}))} UTC · 30 minutes</p><p>Invitation sent to ${esc(item.contact.email)}. It includes the time in your time zone.</p>${renderMeetLink(item.event)}<p class="hint">The manager will see the meeting in their calendar and receive a Telegram reminder.</p>`);}
 async function publicRoute(req,res,url,reply){
  if(url.pathname==='/booking-link-ui.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(new URL('../booking-link-ui.js',import.meta.url)));return true;}
  if(!url.pathname.startsWith('/schedule/'))return false;
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  if(!rate(req,req.method==='POST'?8:90)){reply(res,429,'Too many requests. Try again in a minute.');return true;}
  const match=url.pathname.match(/^\/schedule\/([a-f0-9]{64})(?:\/(slots|book))?$/),link=match&&links.find(match[1]),owner=link&&manager(link.managerId);
  if(!link||!owner){reply(res,404,'<h2>Link unavailable</h2><p>Ask your qooob contact for a current link.</p>');return true;}
  const endpoint=match[2],name='booking_guest_'+link.token.slice(0,12);
  try{
   if(endpoint==='slots'&&req.method==='GET'){
    const slots=await availableSlots(personal.clientFor(owner.userId),link,owner,url.searchParams.get('date'));
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({slots,timeZone:owner.calendar.timeZone}));return true;
   }
   if(endpoint==='book'&&req.method==='POST'){
    if(!sameAppOrigin(req,[publicBase().origin])){reply(res,403,'Request origin is not allowed.');return true;}
    const session=links.guest(cookie(req,name)),input=await body(req);
    if(!session||session.token!==link.token||session.expires<Date.now()||input.get('csrf')!==session.csrf){reply(res,403,'This page expired. Open the link again.');return true;}
    const contact=validateContact(Object.fromEntries(input)),start=input.get('start');if(!Number.isFinite(Date.parse(start))||new Date(start).toISOString()!==start)throw new BookingError('Choose one of the available slots.');
    const item=await bookPublic({links,link,manager:owner,api:personal.clientFor(owner.userId),submission:session.submission,start,contact});receiptPage(res,item,reply);return true;
   }
   if(endpoint||req.method!=='GET'){reply(res,405,'Method not allowed.');return true;}
   const previous=links.guest(cookie(req,name)),pending=previous?.token===link.token&&links.receipt(previous.submission);
   if(pending?.status==='pending'){
    const fields={csrf:previous.csrf,start:pending.start,name:pending.contact.name,company:pending.contact.company,email:pending.contact.email,consent:'yes'};
    reply(res,200,`<h2>Checking booking</h2><p>The previous submission was not confirmed. We will check the same meeting to avoid creating a duplicate.</p><form method="POST" action="/schedule/${link.token}/book">${Object.entries(fields).map(([key,value])=>`<input type="hidden" name="${key}" value="${esc(value)}">`).join('')}<button>Check confirmation</button></form>`);return true;
   }
   links.cleanupGuests();
   const key=randomBytes(24).toString('hex'),session={token:link.token,csrf:randomBytes(24).toString('hex'),submission:randomBytes(16).toString('hex'),expires:Date.now()+3600000};links.saveGuest(key,session);
   res.setHeader('Set-Cookie',`${name}=${key}; HttpOnly; Secure; SameSite=Lax; Path=/schedule/${link.token}; Max-Age=3600`);
   const today=dateInZone(new Date(),owner.calendar.timeZone);
   reply(res,200,`<p class="eyebrow">qooob · BOOKING</p><h2>Choose a convenient time</h2><p>Meeting with the qooob team · 30 minutes · Google Meet</p><section class="section"><label for="public-date">Date in the manager calendar</label><input id="public-date" type="date" value="${today}" min="${today}" max="${plusDays(today,link.rules.horizon)}"><p class="hint">${esc(days.filter((_,i)=>link.rules.days.includes(i)).join(', '))} · ${link.rules.start}–${link.rules.end} · ${esc(owner.calendar.timeZone)}. Book at least one hour in advance.</p><label for="visitor-zone">Show times in time zone</label><select id="visitor-zone"><option>${esc(owner.calendar.timeZone)}</option><option>UTC</option></select><button type="button" id="public-slots-button" class="secondary">Show available times</button><div id="public-slots" role="status"></div></section><form id="public-booking" method="POST" action="/schedule/${link.token}/book" data-token="${link.token}"><input type="hidden" name="csrf" value="${session.csrf}"><input type="hidden" name="start" id="public-start"><p id="selected-public-time" class="hint">Choose a time above</p><label for="guest-name">Your name</label><input id="guest-name" name="name" autocomplete="name" maxlength="100" required><label for="guest-company">Company</label><input id="guest-company" name="company" autocomplete="organization" maxlength="150" required><label for="guest-email">Invitation email</label><input id="guest-email" name="email" type="email" autocomplete="email" maxlength="254" required><label class="consent"><input type="checkbox" name="consent" value="yes" required> I confirm the booking and invitation to my email</label><p class="hint">Your name, company and email will be shared with the qooob team to arrange the meeting.</p><div class="actions"><button id="public-confirm" disabled>Confirm meeting</button></div></form><script src="/booking-link-ui.js" defer></script>`);return true;
  }catch(error){const message=error instanceof BookingError?error.message:'Calendar did not confirm the booking. If you already submitted, go back and resubmit the same form to avoid a duplicate event.';reply(res,400,`<h2>Could not complete the action</h2><p>${esc(message)}</p><p><a href="/schedule/${link.token}">Choose a time again</a></p>`);return true;}
 }
 async function authenticatedRoute(req,res,url,identity,reply){
  if(!url.pathname.startsWith('/booking-links'))return false;
  identity.bookingLinksCsrf||=randomBytes(24).toString('hex');
  if(req.method==='POST'){
   if(!sameAppOrigin(req,[publicBase().origin])){reply(res,403,'Request origin is not allowed.');return true;}
   try{
    const input=await body(req);if(input.get('csrf')!==identity.bookingLinksCsrf){reply(res,403,'This form expired.');return true;}
    const owner=manager(input.get('managerId'));if(!owner)throw new BookingError('The manager has not connected a calendar or been assigned the manager role.');
    if(url.pathname==='/booking-links/request'){links.ensure(owner);redirect(res,'/booking-links?manager='+owner.userId);return true;}
    if(String(identity.userId)!==owner.userId&&!admin.isAdmin(identity.userId)){reply(res,403,'Only the manager or an administrator can change this schedule.');return true;}
    if(url.pathname==='/booking-links/settings')links.update(owner.userId,{days:input.getAll('days'),start:input.get('start'),end:input.get('end'),horizon:input.get('horizon'),enabled:input.get('enabled')==='yes'});
    else if(url.pathname==='/booking-links/rotate'&&input.get('confirm')==='yes')links.rotate(owner.userId);
    else throw new BookingError('Confirm the action again.');
    redirect(res,'/booking-links?manager='+owner.userId);return true;
   }catch(error){reply(res,400,`<p>${esc(error instanceof BookingError?error.message:'Could not save settings.')}</p><a href="/booking-links">Back to managers</a>`);return true;}
  }
  if(req.method!=='GET'||url.pathname!=='/booking-links'){reply(res,405,'Method not allowed.');return true;}
  const options=managers().filter(visibleManager),owner=manager(url.searchParams.get('manager')),link=owner&&links.read().managers[owner.userId],csrf=identity.bookingLinksCsrf;
  let html='<p class="eyebrow">BOOKING LINK REQUEST</p><h2>Manager booking link</h2><p>Choose a team member and share their link with the client. No lead is required in advance.</p>';
  html+=`<form method="POST" action="/booking-links/request"><input type="hidden" name="csrf" value="${csrf}"><label for="link-manager">Manager</label><select name="managerId" id="link-manager" required><option value="">Choose a manager</option>${managerOptions(options,owner?.userId)}</select><p class="hint">Team members with the manager or administrator role and a connected calendar appear here.</p><p><button ${options.length?'':'disabled'}>Get link</button></p></form>`;
  if(!options.length)html+='<p>Managers have not connected Google Calendar yet. Assign roles in administration settings.</p>';
  if(link){html+=`<section class="section"><h2>${esc(owner.email)}</h2><p>${link.enabled?'Link enabled':'Link disabled'}</p><label for="share-link">Client booking link</label><input id="share-link" readonly value="${esc(share(link))}"><button type="button" class="secondary" data-copy="share-link">Copy link</button><p class="hint">${link.rules.start}–${link.rules.end} · ${esc(owner.calendar.timeZone)} · ${link.rules.horizon} days ahead. This permanent link accepts multiple bookings.</p></section>`;
   if(String(identity.userId)===owner.userId||admin.isAdmin(identity.userId)){
    html+=`<section class="section"><h2>Manager availability</h2><form method="POST" action="/booking-links/settings"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="managerId" value="${owner.userId}"><div class="weekdays">${days.map((day,i)=>`<label><input type="checkbox" name="days" value="${i}" ${link.rules.days.includes(i)?'checked':''}>${day}</label>`).join('')}</div><div class="row"><label>From<input type="time" name="start" step="1800" value="${link.rules.start}" required></label><label>To<input type="time" name="end" step="1800" value="${link.rules.end}" required></label></div><label>Booking window<select name="horizon">${[7,14,30,60].map(d=>`<option value="${d}" ${d===link.rules.horizon?'selected':''}>${d} days ahead</option>`).join('')}</select></label><label class="consent"><input type="checkbox" name="enabled" value="yes" ${link.enabled?'checked':''}> Allow bookings through this link</label><button>Save schedule</button></form><details><summary>Replace link</summary><p class="hint">The old link will stop accepting bookings. Existing meetings are preserved.</p><form method="POST" action="/booking-links/rotate"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="managerId" value="${owner.userId}"><label class="consent"><input type="checkbox" name="confirm" value="yes" required> I confirm replacing the link</label><button class="secondary">Create new link</button></form></details></section>`;
   }
  }
  reply(res,200,html+'<script src="/booking-link-ui.js" defer></script>');return true;
 }
 return {publicRoute,authenticatedRoute};
}
