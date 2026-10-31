import crypto from 'node:crypto';import {google} from 'googleapis';import {issueBookingTicket,verifyBookingTicket,bookingDestination} from './bookingAccess.js';
import {sameAppOrigin} from './requestOrigin.js';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')));
export function createCalendarConnect({accounts,credentials,admin,secret,googleOrigin,publicBase,oauthFactory,calendarFactory=options=>google.calendar(options)}){
 const scopes=['openid','email','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.calendars.readonly','https://www.googleapis.com/auth/calendar.events.owned','https://www.googleapis.com/auth/calendar.freebusy'];
 const redirect=()=>googleOrigin()+'/google/callback';
 const oauth=()=>oauthFactory?oauthFactory():new google.auth.OAuth2(credentials.client_id,credentials.client_secret,redirect());
 function clientFor(userId){const value=accounts.load(userId);if(!value)throw new Error('Calendar is not connected.');const auth=oauth();auth.setCredentials(value.tokens);auth.on('tokens',tokens=>accounts.refresh(userId,value.version,tokens));return calendarFactory({version:'v3',auth});}
 async function publicRoute(req,res,url,reply){
  if(!['/google/start','/google/callback'].includes(url.pathname))return false;
  if(req.method!=='GET'){reply(res,405,'Method not allowed.');return true;}
  if(req.headers.host!==new URL(googleOrigin()).host){reply(res,400,'Use the connection link in Settings.');return true;}
  try{
   if(url.pathname==='/google/start'){
    const entry=verifyBookingTicket(secret,url.searchParams.get('entry'));if(entry.intent!=='google-connect'||admin.blocked(entry.userId))throw new Error('Invalid sign-in.');
    const browser=crypto.randomBytes(32).toString('hex');accounts.cleanup();const flow=accounts.begin(entry.userId,browser,redirect());
    const location=oauth().generateAuthUrl({access_type:'offline',prompt:'consent select_account',include_granted_scopes:true,scope:scopes,state:flow.state,nonce:flow.nonce,hd:'qooob.com',code_challenge:flow.challenge,code_challenge_method:'S256'});
    res.writeHead(302,{Location:location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':`google_oauth_${flow.state.slice(0,12)}=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/google; Max-Age=600`});res.end();return true;
   }
   const state=url.searchParams.get('state'),browser=cookies(req)['google_oauth_'+String(state).slice(0,12)],flow=accounts.consume(state,browser);
   if(admin.blocked(flow.userId))throw new Error('Access blocked by an administrator.');
   if(url.searchParams.get('error'))throw new Error('You cancelled the connection or Google denied access.');
   const code=url.searchParams.get('code');if(!code)throw new Error('Google did not return a sign-in code.');
   const auth=oauth();const {tokens}=await auth.getToken({code,redirect_uri:flow.redirect,codeVerifier:flow.verifier});
   const ticket=await auth.verifyIdToken({idToken:tokens.id_token,audience:credentials.client_id});const identity=accounts.validateIdentity(ticket.getPayload(),flow.nonce);
   const granted=String(tokens.scope||'').split(' ');if(!granted.some(s=>s.endsWith('/calendar.events.owned')||s.endsWith('/calendar.events')||s.endsWith('/calendar')))throw new Error('You did not allow event creation. Connect again.');
   if(!granted.some(s=>['calendar.freebusy','calendar.events.freebusy','calendar.readonly','calendar'].some(scope=>s==='https://www.googleapis.com/auth/'+scope)))throw new Error('You did not allow availability checks. Connect again and grant all requested permissions.');
   auth.setCredentials(tokens);const {data}=await calendarFactory({version:'v3',auth}).calendarList.get({calendarId:'primary'},{timeout:15000});
   if(data.accessRole!=='owner')throw new Error('Google did not confirm the primary personal calendar.');
   accounts.connect(flow.userId,identity,tokens,{id:data.id,name:data.summary||identity.email,timeZone:data.timeZone||'UTC'});
   res.setHeader('Set-Cookie',`google_oauth_${state.slice(0,12)}=; HttpOnly; Secure; SameSite=Lax; Path=/google; Max-Age=0`);
   res.writeHead(303,{Location:'https://t.me/Leadgen_Ass1stant_bot','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return true;
  }catch(error){const own=/^(Google |Connect your corporate|Invalid OAuth|OAuth session|This Google|You |Access blocked|Invalid sign-in|Calendar is)/.test(error.message||'');reply(res,400,`<h2>Connection incomplete</h2><p>${esc(own?error.message:'Google did not confirm the connection. Open Settings and start again. If Workspace blocks the app, an administrator needs to allow it.')}</p><a href="https://t.me/Leadgen_Ass1stant_bot?start=calendar_connected">Return to bot</a>`);return true;}
 }
 async function authenticatedRoute(req,res,url,identity,reply){
  if(!['/calendar','/calendar/disconnect','/calendar/status'].includes(url.pathname))return false;
  const account=accounts.status(identity.userId);identity.calendarCsrf||=crypto.randomBytes(24).toString('hex');
  if(url.pathname==='/calendar/status'){
   if(req.method!=='GET'){reply(res,405,'Method not allowed.');return true;}
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(JSON.stringify({connected:Boolean(account),next:account&&identity.intent==='book'?bookingDestination(identity):null}));return true;
  }
  if(url.pathname==='/calendar/disconnect'&&req.method==='POST'){
   if(!sameAppOrigin(req,[publicBase().origin,googleOrigin()])){reply(res,403,'Request origin is not allowed.');return true;}
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048){reply(res,413,'Request is too large.');return true;}}
   const input=new URLSearchParams(raw);if(input.get('csrf')!==identity.calendarCsrf||input.get('confirm')!=='yes'){reply(res,403,'Confirm disconnection again.');return true;}
   const value=accounts.load(identity.userId);let revoked=true;try{if(value)await oauth().revokeToken(value.tokens.refresh_token);}catch{revoked=false;}
   accounts.remove(identity.userId);identity.calendarCsrf=null;
   reply(res,200,`<h2>Calendar disconnected in qooob</h2><p>New events will no longer be created on your behalf. Existing Google Calendar events are preserved.</p>${revoked?'':'<p>Google did not confirm access revocation. If needed, remove Event Assistant access in your Google account settings.</p>'}<a href="/calendar">Back to settings</a>`);return true;
  }
  if(req.method!=='GET'){reply(res,405,'Method not allowed.');return true;}
  if(account&&url.searchParams.get('disconnect')==='confirm'){reply(res,200,`<h2>Disconnect calendar?</h2><p>${esc(account.email)}. The bot will stop creating meetings and checking your calendar availability. Existing events are preserved.</p><form method="POST" action="/calendar/disconnect"><input type="hidden" name="csrf" value="${identity.calendarCsrf}"><input type="hidden" name="confirm" value="yes"><button>Disconnect my calendar</button></form><p><a href="/calendar">Cancel</a></p>`);return true;}
  const entry=issueBookingTicket(secret,{userId:String(identity.userId),owner:identity.owner,intent:'google-connect'}),link=googleOrigin()+'/google/start?entry='+encodeURIComponent(entry),bookingBack=bookingDestination(identity);
  reply(res,200,`${!account&&identity.intent==='book'?'<span data-calendar-resume hidden></span>':''}<p class="eyebrow">SETTINGS</p><h2>My Google Calendar</h2>${account?`<p><b>${esc(account.email)}</b><br>${esc(account.calendar.name)} · ${esc(account.calendar.timeZone)}</p><p>Your primary personal calendar is connected. It is available when choosing a manager for Hand off lead.</p>`:'<p>Your personal calendar is not connected yet. The shared ops calendar is not your personal connection.</p>'}<p><a id="google-connect" class="button" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${account?'Reconnect Google Calendar':'Connect Google Calendar'}</a></p><p class="hint">Sign in to your @qooob.com account in an external browser and allow calendar access. Telegram and Google identities are linked automatically.</p>${account?'<p><a href="/calendar?disconnect=confirm">Disconnect my calendar</a></p>':''}<p><a href="${esc(bookingBack)}">${account?'Continue to booking':'Check connection after signing in'}</a></p>`);return true;
 }
 return {publicRoute,authenticatedRoute,clientFor,scopes};
}
