import {botUrl} from './leadLink.js';
import crypto from 'node:crypto';import {google} from 'googleapis';import {issueBookingTicket,verifyBookingTicket} from './bookingAccess.js';
import {sameAppOrigin} from './requestOrigin.js';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')));
export function createCalendarConnect({accounts,credentials,admin,secret,googleOrigin,publicBase,oauthFactory,calendarFactory=options=>google.calendar(options)}){
 const scopes=['openid','email','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.calendars.readonly','https://www.googleapis.com/auth/calendar.events.owned','https://www.googleapis.com/auth/calendar.freebusy'];
 const redirect=()=>googleOrigin()+'/google/callback';
 const oauth=()=>oauthFactory?oauthFactory():new google.auth.OAuth2(credentials.client_id,credentials.client_secret,redirect());
 function clientFor(userId){const value=accounts.load(userId);if(!value)throw new Error('Календарь не подключён.');const auth=oauth();auth.setCredentials(value.tokens);auth.on('tokens',tokens=>accounts.refresh(userId,value.version,tokens));return calendarFactory({version:'v3',auth});}
 async function publicRoute(req,res,url,reply){
  if(!['/google/start','/google/callback'].includes(url.pathname))return false;
  if(req.method!=='GET'){reply(res,405,'Недопустимый метод.');return true;}
  if(req.headers.host!==new URL(googleOrigin()).host){reply(res,400,'Используйте адрес подключения из Settings.');return true;}
  try{
   if(url.pathname==='/google/start'){
    const entry=verifyBookingTicket(secret,url.searchParams.get('entry'));if(entry.intent!=='google-connect'||admin.blocked(entry.userId))throw new Error('Вход недействителен.');
    const browser=crypto.randomBytes(32).toString('hex');accounts.cleanup();const flow=accounts.begin(entry.userId,browser,redirect());
    const location=oauth().generateAuthUrl({access_type:'offline',prompt:'consent select_account',include_granted_scopes:true,scope:scopes,state:flow.state,nonce:flow.nonce,hd:'qooob.com',code_challenge:flow.challenge,code_challenge_method:'S256'});
    res.writeHead(302,{Location:location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':`google_oauth_${flow.state.slice(0,12)}=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/google; Max-Age=600`});res.end();return true;
   }
   const state=url.searchParams.get('state'),browser=cookies(req)['google_oauth_'+String(state).slice(0,12)],flow=accounts.consume(state,browser);
   if(admin.blocked(flow.userId))throw new Error('Доступ заблокирован администратором.');
   if(url.searchParams.get('error'))throw new Error('Вы отменили подключение или Google запретил доступ.');
   const code=url.searchParams.get('code');if(!code)throw new Error('Google не вернул код входа.');
   const auth=oauth();const {tokens}=await auth.getToken({code,redirect_uri:flow.redirect,codeVerifier:flow.verifier});
   const ticket=await auth.verifyIdToken({idToken:tokens.id_token,audience:credentials.client_id});const identity=accounts.validateIdentity(ticket.getPayload(),flow.nonce);
   const granted=String(tokens.scope||'').split(' ');if(!granted.some(s=>s.endsWith('/calendar.events.owned')||s.endsWith('/calendar.events')||s.endsWith('/calendar')))throw new Error('Вы не разрешили создание событий. Повторите подключение.');
   if(!granted.some(s=>['calendar.freebusy','calendar.events.freebusy','calendar.readonly','calendar'].some(scope=>s==='https://www.googleapis.com/auth/'+scope)))throw new Error('Вы не разрешили проверку занятости. Повторите подключение и разрешите все запрошенные права.');
   auth.setCredentials(tokens);const {data}=await calendarFactory({version:'v3',auth}).calendarList.get({calendarId:'primary'},{timeout:15000});
   if(data.accessRole!=='owner')throw new Error('Google не подтвердил основной личный календарь.');
   accounts.connect(flow.userId,identity,tokens,{id:data.id,name:data.summary||identity.email,timeZone:data.timeZone||'UTC'});
   res.setHeader('Set-Cookie',`google_oauth_${state.slice(0,12)}=; HttpOnly; Secure; SameSite=Lax; Path=/google; Max-Age=0`);
   res.writeHead(303,{Location:botUrl(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return true;
  }catch(error){const own=/^(Google nonce|Подключите|Google-аккаунт|OAuth-сессия|Этот Google|Google не|Вы |Доступ |Вход |Календарь)/.test(error.message||'');reply(res,400,`<h2>Подключение не завершено</h2><p>${esc(own?error.message:'Google не подтвердил подключение. Откройте Settings и начните заново. Если Workspace блокирует приложение, администратору нужно разрешить его.')}</p><a href="${botUrl()}?start=calendar_connected">Вернуться в бот</a>`);return true;}
 }
 async function authenticatedRoute(req,res,url,identity,reply){
  if(!['/calendar','/calendar/disconnect','/calendar/status'].includes(url.pathname))return false;
  const account=accounts.status(identity.userId);identity.calendarCsrf||=crypto.randomBytes(24).toString('hex');
  if(url.pathname==='/calendar/status'){
   if(req.method!=='GET'){reply(res,405,'Недопустимый метод.');return true;}
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(JSON.stringify({connected:Boolean(account),next:account&&identity.intent==='book'?'/book'+(identity.leadId?'?lead='+encodeURIComponent(identity.leadId):''):null}));return true;
  }
  if(url.pathname==='/calendar/disconnect'&&req.method==='POST'){
   if(!sameAppOrigin(req,[publicBase().origin,googleOrigin()])){reply(res,403,'Недопустимый источник запроса.');return true;}
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048){reply(res,413,'Слишком большой запрос.');return true;}}
   const input=new URLSearchParams(raw);if(input.get('csrf')!==identity.calendarCsrf||input.get('confirm')!=='yes'){reply(res,403,'Подтвердите отключение заново.');return true;}
   const value=accounts.load(identity.userId);let revoked=true;try{if(value)await oauth().revokeToken(value.tokens.refresh_token);}catch{revoked=false;}
   accounts.remove(identity.userId);identity.calendarCsrf=null;
   reply(res,200,`<h2>Календарь отключён в qooob</h2><p>Новые события от вашего имени больше не создаются. Существующие события в Google Calendar сохранены.</p>${revoked?'':'<p>Google не подтвердил отзыв разрешения. При необходимости удалите доступ Event Assistant в настройках Google-аккаунта.</p>'}<a href="/calendar">К настройкам</a>`);return true;
  }
  if(req.method!=='GET'){reply(res,405,'Недопустимый метод.');return true;}
  if(account&&url.searchParams.get('disconnect')==='confirm'){reply(res,200,`<h2>Отключить календарь?</h2><p>${esc(account.email)}. Бот перестанет создавать встречи и проверять занятость вашего календаря. Существующие события останутся.</p><form method="POST" action="/calendar/disconnect"><input type="hidden" name="csrf" value="${identity.calendarCsrf}"><input type="hidden" name="confirm" value="yes"><button>Отключить мой календарь</button></form><p><a href="/calendar">Отмена</a></p>`);return true;}
  const entry=issueBookingTicket(secret,{userId:String(identity.userId),owner:identity.owner,intent:'google-connect'}),link=googleOrigin()+'/google/start?entry='+encodeURIComponent(entry),bookingBack='/book'+(identity.leadId?'?lead='+encodeURIComponent(identity.leadId):'');
  reply(res,200,`${!account&&identity.intent==='book'?'<span data-calendar-resume hidden></span>':''}<p class="eyebrow">SETTINGS</p><h2>Мой Google Calendar</h2>${account?`<p><b>${esc(account.email)}</b><br>${esc(account.calendar.name)} · ${esc(account.calendar.timeZone)}</p><p>Подключён основной личный календарь. Он доступен при выборе менеджера в Book Meeting.</p>`:'<p>Личный календарь ещё не подключён. Общий календарь ops не является вашим подключением.</p>'}<p><a id="google-connect" class="button" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${account?'Переподключить Google Calendar':'Подключить Google Calendar'}</a></p><p class="hint">Войдите в аккаунт @qooob.com во внешнем браузере и разрешите работу с календарём. Вход Telegram и Google связываются автоматически.</p>${account?'<p><a href="/calendar?disconnect=confirm">Отключить мой календарь</a></p>':''}<p><a href="${esc(bookingBack)}">${account?'К бронированию встречи':'Проверить подключение после входа'}</a></p>`);return true;
 }
 return {publicRoute,authenticatedRoute,clientFor,scopes};
}
