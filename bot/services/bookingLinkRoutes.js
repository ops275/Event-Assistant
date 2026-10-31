import fs from 'node:fs';import {randomBytes} from 'node:crypto';
import {sameAppOrigin} from './requestOrigin.js';
import {availableSlots,bookPublic,validateContact,dateInZone,plusDays} from './bookingLinks.js';import {BookingError} from './calendarBooking.js';import {renderMeetLink} from './bookingView.js';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cookie=(req,name)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
const days=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
async function body(req){if(!String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'))throw new BookingError('Неверный формат запроса.');let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)throw new BookingError('Слишком большой запрос.');}return new URLSearchParams(raw);}
export function createBookingLinkRoutes({links,accounts,admin,personal,publicBase}){
 const limits=new Map();
 const managers=()=>accounts.all().filter(a=>!admin.blocked(a.userId)&&['admin','partnership'].includes(admin.read().users[a.userId]?.role));
 const manager=id=>managers().find(a=>a.userId===String(id));
 const share=link=>publicBase().origin+'/schedule/'+link.token;
 const redirect=(res,to)=>{res.writeHead(303,{Location:to,'Cache-Control':'no-store'});res.end();};
 const rate=(req,limit)=>{const now=Date.now(),ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').slice(0,100),key=ip+':'+(req.method==='POST'?'write':'read');for(const [k,v] of limits)if(v.until<now)limits.delete(k);const item=limits.get(key)||{count:0,until:now+60000};item.count++;limits.set(key,item);return item.count<=limit;};
 function receiptPage(res,item,reply){return reply(res,200,`<p class="eyebrow">qooob</p><h2>Встреча забронирована</h2><p>${esc(item.contact.name)} · ${esc(item.contact.company)}</p><p>${esc(new Date(item.start).toLocaleString('ru-RU',{timeZone:'UTC'}))} UTC · 30 минут</p><p>Приглашение отправлено на ${esc(item.contact.email)}. Оно содержит время в вашем часовом поясе.</p>${renderMeetLink(item.event)}<p class="hint">Менеджер увидит встречу в своём календаре и получит напоминание в Telegram.</p>`);}
 async function publicRoute(req,res,url,reply){
  if(url.pathname==='/booking-link-ui.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(new URL('../booking-link-ui.js',import.meta.url)));return true;}
  if(!url.pathname.startsWith('/schedule/'))return false;
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  if(!rate(req,req.method==='POST'?8:90)){reply(res,429,'Слишком много запросов. Попробуйте через минуту.');return true;}
  const match=url.pathname.match(/^\/schedule\/([a-f0-9]{64})(?:\/(slots|book))?$/),link=match&&links.find(match[1]),owner=link&&manager(link.managerId);
  if(!link||!owner){reply(res,404,'<h2>Ссылка недоступна</h2><p>Попросите сотрудника qooob прислать актуальную ссылку.</p>');return true;}
  const endpoint=match[2],name='booking_guest_'+link.token.slice(0,12);
  try{
   if(endpoint==='slots'&&req.method==='GET'){
    const slots=await availableSlots(personal.clientFor(owner.userId),link,owner,url.searchParams.get('date'));
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({slots,timeZone:owner.calendar.timeZone}));return true;
   }
   if(endpoint==='book'&&req.method==='POST'){
    if(!sameAppOrigin(req,[publicBase().origin])){reply(res,403,'Источник запроса не разрешён.');return true;}
    const session=links.guest(cookie(req,name)),input=await body(req);
    if(!session||session.token!==link.token||session.expires<Date.now()||input.get('csrf')!==session.csrf){reply(res,403,'Страница истекла. Откройте ссылку заново.');return true;}
    const contact=validateContact(Object.fromEntries(input)),start=input.get('start');if(!Number.isFinite(Date.parse(start))||new Date(start).toISOString()!==start)throw new BookingError('Выберите время из доступных слотов.');
    const item=await bookPublic({links,link,manager:owner,api:personal.clientFor(owner.userId),submission:session.submission,start,contact});receiptPage(res,item,reply);return true;
   }
   if(endpoint||req.method!=='GET'){reply(res,405,'Недопустимый метод.');return true;}
   const previous=links.guest(cookie(req,name)),pending=previous?.token===link.token&&links.receipt(previous.submission);
   if(pending?.status==='pending'){
    const fields={csrf:previous.csrf,start:pending.start,name:pending.contact.name,company:pending.contact.company,email:pending.contact.email,consent:'yes'};
    reply(res,200,`<h2>Проверяем бронирование</h2><p>Предыдущая отправка не получила подтверждения. Проверим ту же встречу, чтобы не создать вторую.</p><form method="POST" action="/schedule/${link.token}/book">${Object.entries(fields).map(([key,value])=>`<input type="hidden" name="${key}" value="${esc(value)}">`).join('')}<button>Проверить подтверждение</button></form>`);return true;
   }
   links.cleanupGuests();
   const key=randomBytes(24).toString('hex'),session={token:link.token,csrf:randomBytes(24).toString('hex'),submission:randomBytes(16).toString('hex'),expires:Date.now()+3600000};links.saveGuest(key,session);
   res.setHeader('Set-Cookie',`${name}=${key}; HttpOnly; Secure; SameSite=Lax; Path=/schedule/${link.token}; Max-Age=3600`);
   const today=dateInZone(new Date(),owner.calendar.timeZone);
   reply(res,200,`<p class="eyebrow">qooob · BOOKING</p><h2>Выберите удобное время</h2><p>Встреча с командой qooob · 30 минут · Google Meet</p><section class="section"><label for="public-date">Дата в календаре менеджера</label><input id="public-date" type="date" value="${today}" min="${today}" max="${plusDays(today,link.rules.horizon)}"><p class="hint">${esc(days.filter((_,i)=>link.rules.days.includes(i)).join(', '))} · ${link.rules.start}–${link.rules.end} · ${esc(owner.calendar.timeZone)}. Запись не позднее чем за час.</p><label for="visitor-zone">Показать время в часовом поясе</label><select id="visitor-zone"><option>${esc(owner.calendar.timeZone)}</option><option>UTC</option></select><button type="button" id="public-slots-button" class="secondary">Показать свободное время</button><div id="public-slots" role="status"></div></section><form id="public-booking" method="POST" action="/schedule/${link.token}/book" data-token="${link.token}"><input type="hidden" name="csrf" value="${session.csrf}"><input type="hidden" name="start" id="public-start"><p id="selected-public-time" class="hint">Выберите время выше</p><label for="guest-name">Ваше имя</label><input id="guest-name" name="name" autocomplete="name" maxlength="100" required><label for="guest-company">Компания</label><input id="guest-company" name="company" autocomplete="organization" maxlength="150" required><label for="guest-email">Email для приглашения</label><input id="guest-email" name="email" type="email" autocomplete="email" maxlength="254" required><label class="consent"><input type="checkbox" name="consent" value="yes" required> Подтверждаю запись и отправку приглашения на мой email</label><p class="hint">Имя, компания и email будут доступны команде qooob для организации встречи.</p><div class="actions"><button id="public-confirm" disabled>Подтвердить встречу</button></div></form><script src="/booking-link-ui.js" defer></script>`);return true;
  }catch(error){const message=error instanceof BookingError?error.message:'Календарь не подтвердил запись. Если отправка уже выполнялась, вернитесь назад и повторите ту же форму: повторное событие не создастся.';reply(res,400,`<h2>Не удалось завершить действие</h2><p>${esc(message)}</p><p><a href="/schedule/${link.token}">Открыть выбор времени заново</a></p>`);return true;}
 }
 async function authenticatedRoute(req,res,url,identity,reply){
  if(!url.pathname.startsWith('/booking-links'))return false;
  identity.bookingLinksCsrf||=randomBytes(24).toString('hex');
  if(req.method==='POST'){
   if(!sameAppOrigin(req,[publicBase().origin])){reply(res,403,'Источник запроса не разрешён.');return true;}
   try{
    const input=await body(req);if(input.get('csrf')!==identity.bookingLinksCsrf){reply(res,403,'Форма истекла.');return true;}
    const owner=manager(input.get('managerId'));if(!owner)throw new BookingError('Менеджер ещё не подключил календарь или не получил роль менеджера.');
    if(url.pathname==='/booking-links/request'){links.ensure(owner);redirect(res,'/booking-links?manager='+owner.userId);return true;}
    if(String(identity.userId)!==owner.userId&&!admin.isAdmin(identity.userId)){reply(res,403,'Расписание меняет только сам менеджер или администратор.');return true;}
    if(url.pathname==='/booking-links/settings')links.update(owner.userId,{days:input.getAll('days'),start:input.get('start'),end:input.get('end'),horizon:input.get('horizon'),enabled:input.get('enabled')==='yes'});
    else if(url.pathname==='/booking-links/rotate'&&input.get('confirm')==='yes')links.rotate(owner.userId);
    else throw new BookingError('Подтвердите действие заново.');
    redirect(res,'/booking-links?manager='+owner.userId);return true;
   }catch(error){reply(res,400,`<p>${esc(error instanceof BookingError?error.message:'Не удалось сохранить настройки.')}</p><a href="/booking-links">К менеджерам</a>`);return true;}
  }
  if(req.method!=='GET'||url.pathname!=='/booking-links'){reply(res,405,'Недопустимый метод.');return true;}
  const options=managers(),owner=manager(url.searchParams.get('manager')),link=owner&&links.read().managers[owner.userId],csrf=identity.bookingLinksCsrf;
  let html='<p class="eyebrow">BOOKING LINK REQUEST</p><h2>Ссылка менеджера</h2><p>Выберите сотрудника и передайте ссылку клиенту. Лид заранее не нужен.</p>';
  html+=`<form method="POST" action="/booking-links/request"><input type="hidden" name="csrf" value="${csrf}"><label for="link-manager">Менеджер</label><select name="managerId" id="link-manager" required><option value="">Выберите менеджера</option>${options.map(a=>`<option value="${a.userId}" ${a.userId===owner?.userId?'selected':''}>${esc(a.email)}</option>`).join('')}</select><p class="hint">Здесь сотрудники с ролью менеджера/администратора и подключённым календарём.</p><p><button ${options.length?'':'disabled'}>Получить ссылку</button></p></form>`;
  if(!options.length)html+='<p>Менеджеры ещё не подключили Google Calendar. Роли назначаются в админке.</p>';
  if(link){html+=`<section class="section"><h2>${esc(owner.email)}</h2><p>${link.enabled?'Ссылка активна':'Ссылка отключена'}</p><label for="share-link">Ссылка для клиента</label><input id="share-link" readonly value="${esc(share(link))}"><button type="button" class="secondary" data-copy="share-link">Копировать ссылку</button><p class="hint">${link.rules.start}–${link.rules.end} · ${esc(owner.calendar.timeZone)} · ${link.rules.horizon} дней вперёд. Ссылка постоянная и принимает несколько бронирований.</p></section>`;
   if(String(identity.userId)===owner.userId||admin.isAdmin(identity.userId)){
    html+=`<section class="section"><h2>Доступность менеджера</h2><form method="POST" action="/booking-links/settings"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="managerId" value="${owner.userId}"><div class="weekdays">${days.map((day,i)=>`<label><input type="checkbox" name="days" value="${i}" ${link.rules.days.includes(i)?'checked':''}>${day}</label>`).join('')}</div><div class="row"><label>С<input type="time" name="start" step="1800" value="${link.rules.start}" required></label><label>До<input type="time" name="end" step="1800" value="${link.rules.end}" required></label></div><label>Период записи<select name="horizon">${[7,14,30,60].map(d=>`<option value="${d}" ${d===link.rules.horizon?'selected':''}>${d} дней вперёд</option>`).join('')}</select></label><label class="consent"><input type="checkbox" name="enabled" value="yes" ${link.enabled?'checked':''}> Разрешить запись по ссылке</label><button>Сохранить расписание</button></form><details><summary>Заменить ссылку</summary><p class="hint">Старая ссылка перестанет принимать записи. Уже созданные встречи сохранятся.</p><form method="POST" action="/booking-links/rotate"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="managerId" value="${owner.userId}"><label class="consent"><input type="checkbox" name="confirm" value="yes" required> Подтверждаю замену ссылки</label><button class="secondary">Создать новую ссылку</button></form></details></section>`;
   }
  }
  reply(res,200,html+'<script src="/booking-link-ui.js" defer></script>');return true;
 }
 return {publicRoute,authenticatedRoute};
}
