import {visibleManager} from './managerVisibility.js';
import {managerOptions} from './staffDirectory.js';
import fs from 'node:fs';import {loadCalendarView} from './aeCalendar.js';import {dateInZone} from './bookingLinks.js';import {BookingError} from './calendarBooking.js';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function createAeCalendarRoutes({accounts,admin,personal}){
 const limits=new Map();
 const managers=()=>accounts.all().filter(visibleManager).filter(a=>!admin.blocked(a.userId)&&['admin','partnership'].includes(admin.read().users[a.userId]?.role));
 function staticRoute(req,res,url){if(req.method!=='GET'||url.pathname!=='/ae-calendar-ui.js')return false;res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(new URL('../ae-calendar-ui.js',import.meta.url)));return true;}
 async function route(req,res,url,identity,reply){
  if(!['/ae-slots','/ae-slots/data'].includes(url.pathname))return false;
  if(req.method!=='GET'){reply(res,405,'Method not allowed.');return true;}
  const options=managers();
  if(url.pathname==='/ae-slots/data'){
   const manager=options.find(a=>a.userId===url.searchParams.get('manager'));if(!manager){reply(res,403,'The manager calendar is not connected or is unavailable.');return true;}
   const now=Date.now();for(const [key,item] of limits)if(item.until<now)limits.delete(key);const quota=limits.get(identity.userId)||{count:0,until:now+60000};quota.count++;limits.set(identity.userId,quota);if(quota.count>30){reply(res,429,'Too many refreshes. Wait a minute.');return true;}
   try{const data=await loadCalendarView({api:personal.clientFor(manager.userId),manager,viewerId:identity.userId,date:url.searchParams.get('date'),view:url.searchParams.get('view')||'week',timeZone:url.searchParams.get('timeZone')||undefined});res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex'});res.end(JSON.stringify(data));}
   catch(error){reply(res,400,error instanceof BookingError?error.message:'Google did not confirm calendar access. Check the connection in Settings.');}return true;
  }
  const selected=options.find(a=>a.userId===url.searchParams.get('manager'))||options.find(a=>a.userId===String(identity.userId))||options[0],date=/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date')||'')?url.searchParams.get('date'):dateInZone(new Date(),selected?.calendar.timeZone||'UTC');
  reply(res,200,`<style>${styles}</style><section id="ae-calendar-app" data-can-book="${admin.role(identity.userId)==='promoter'?'no':'yes'}"><div class="ae-heading"><div><h1>Check partnership free slots</h1></div><a href="/calendar">My calendar</a></div><div class="ae-controls"><label>Manager<select id="ae-manager"><option value="">Choose a manager</option>${managerOptions(options,selected?.userId)}</select></label><label>Date<input id="ae-date" type="date" value="${date}"></label><label>View<select id="ae-view"><option value="week">Week</option><option value="day">Day</option></select></label></div><label class="ae-cet"><span>Show time in CET (UTC+1)</span><input id="ae-cet" type="checkbox" role="switch"></label><div class="ae-toolbar"><div><button class="secondary" id="ae-prev" aria-label="Previous period">‹</button><button class="secondary" id="ae-today">Today</button><button class="secondary" id="ae-next" aria-label="Next period">›</button></div><button class="secondary" id="ae-refresh">Refresh</button></div><p id="ae-status" role="status">${options.length?'Loading current calendar…':'Managers have not connected a calendar or been assigned the manager role yet.'}</p><details class="ae-info"><summary>About this calendar <span id="ae-warning-dot" hidden>•</span></summary><p id="ae-zone" class="hint"></p><div id="ae-warnings" class="hint"></div><p class="hint">Choose an available interval in the grid. Availability is checked again before saving.</p></details><div class="ae-scroll" id="ae-scroll"><div id="ae-board"></div></div><p class="hint">The selected manager primary calendar. White intervals are available; tap a time to arrange a meeting. Times use the manager time zone unless CET (UTC+1) is selected. Private colleague events appear as “Busy”. Data refreshes every minute and availability is checked again when saving.</p><dialog id="ae-event-dialog"><h2 id="ae-event-title"></h2><p id="ae-event-time"></p><p id="ae-event-location"></p><button id="ae-event-book" class="secondary" hidden>Choose this time</button><button id="ae-event-close" class="secondary">Close</button></dialog></section><script src="/ae-calendar-ui.js" defer></script>`);return true;
 }
 return {route,staticRoute};
}
const styles=`
#ae-calendar-app .ae-cet{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0;font-size:13px}#ae-calendar-app .ae-cet input{appearance:none;width:42px;min-height:26px;height:26px;flex:0 0 42px;border:0;border-radius:20px;padding:3px;background:color-mix(in srgb,var(--text) 32%,var(--bg))}#ae-calendar-app .ae-cet input:before{content:"";display:block;width:20px;height:20px;background:var(--bg);border-radius:50%}#ae-calendar-app .ae-cet input:checked{background:var(--accent)}#ae-calendar-app .ae-cet input:checked:before{transform:translateX(16px)}

main:has(#ae-calendar-app),body:has(#ae-calendar-app)>header{max-width:1440px}#ae-calendar-app h1{font-size:24px}.ae-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}.ae-heading>a{font-size:12px}.ae-controls{display:grid;grid-template-columns:minmax(180px,2fr) minmax(140px,1fr) 100px;gap:12px}.ae-controls label{margin:0}.ae-controls select,.ae-controls input{margin-top:6px}.ae-toolbar{display:flex;justify-content:space-between;gap:10px;margin:8px 0 12px}.ae-toolbar>div{display:flex;gap:6px}.ae-toolbar button{margin-top:0;min-height:36px;padding:7px 12px}#ae-status{font-size:12px;margin:8px 0}#ae-warnings{color:#986000}.ae-scroll{border:1px solid var(--line);border-radius:8px;overflow:auto;max-height:66vh;min-height:280px;margin:12px 0}.ae-board{--days:7;min-width:950px}.ae-board.ae-day{min-width:0}.ae-head,.ae-all,.ae-grid{display:grid;grid-template-columns:56px repeat(var(--days),minmax(0,1fr))}.ae-head{position:sticky;top:0;z-index:10;background:var(--bg);border-bottom:1px solid var(--line)}.ae-day-head{padding:10px 3px;text-align:center;border-left:1px solid var(--line);font-size:11px}.ae-day-head b{display:block;font-size:20px;font-weight:700}.ae-day-head.today b{color:var(--accent)}.ae-all{border-bottom:1px solid var(--line);background:var(--bg)}.ae-all-label{font-size:9px;padding:6px;color:var(--muted)}.ae-all-day{border-left:1px solid var(--line);padding:3px;min-height:28px}.ae-chip{display:block;min-height:20px;width:100%;padding:2px 5px;margin-bottom:2px;border-radius:4px;font-size:10px;text-align:left;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ae-grid{height:1440px}.ae-time-rail,.ae-column{position:relative;height:1440px}.ae-time-rail{background:var(--bg)}.ae-hour-label{position:absolute;right:6px;font-size:10px;color:var(--muted);transform:translateY(-50%)}.ae-column{border-left:1px solid var(--line);background:repeating-linear-gradient(to bottom,transparent 0,transparent 29px,var(--line) 30px)}.ae-slot{position:absolute;left:0;width:100%;height:30px;min-height:0;padding:0;border:0;border-radius:0;background:transparent;color:transparent;z-index:1;font-size:10px;font-weight:400}.ae-slot:hover,.ae-slot:focus-visible{background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent);outline:1px solid var(--accent);outline-offset:-1px}.ae-event{position:absolute;z-index:3;min-height:18px;padding:3px 5px;border-radius:5px;overflow:hidden;text-align:left;font-size:11px;line-height:1.25;font-weight:500;border:1px solid #ffffff55;box-shadow:0 0 0 1px #ffffff33;cursor:pointer}.ae-event small{display:block;font-size:10px;font-weight:400}.ae-event.transparent{background:var(--bg)!important;border-color:var(--event-color);color:var(--event-color)!important}.ae-event.declined{text-decoration:line-through;opacity:.7}.ae-now{position:absolute;left:0;right:0;height:2px;background:#ea4335;z-index:5;pointer-events:none}.ae-now:before{content:'';position:absolute;left:-4px;top:-3px;width:8px;height:8px;background:#ea4335;border-radius:50%}#ae-event-dialog{border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--text);max-width:440px;width:90%;padding:24px}#ae-event-dialog::backdrop{background:#0005}#ae-event-dialog p{margin-top:12px;font-size:13px;overflow-wrap:anywhere}#ae-event-dialog h2{font-size:19px;overflow-wrap:anywhere}@media(max-width:620px){.ae-controls{grid-template-columns:1fr 110px}.ae-controls label:first-child{grid-column:1/-1}.ae-heading h1{font-size:21px!important}.ae-heading>a{font-size:11px}.ae-scroll{max-height:64vh}}
/* Phone layout: calendar first, secondary controls progressively disclosed. */
@media(max-width:720px){
 body:has(#ae-calendar-app)>header{display:none}
 main:has(#ae-calendar-app){padding:12px 12px max(12px,env(safe-area-inset-bottom));max-width:100%;overflow-x:clip}
 #ae-calendar-app{min-width:0;--accent:#4285f4}
 .ae-heading{margin:0 0 10px;gap:8px;align-items:center}
 .ae-heading .eyebrow{display:none}
 #ae-calendar-app .ae-heading h1{font-size:22px!important;letter-spacing:-.5px;line-height:1.2}
 .ae-heading>a{font-size:12px;text-decoration:none;padding:10px 0 10px 8px;min-height:40px;display:flex;align-items:center;white-space:nowrap}
 .ae-controls{grid-template-columns:minmax(0,1fr) minmax(90px,108px);gap:8px}
 .ae-controls label{font-size:11px;color:var(--muted);font-weight:500;min-width:0}
 .ae-controls label:first-child{grid-column:1/-1}
 .ae-controls input,.ae-controls select{font-size:16px;min-height:44px;height:44px;padding:8px 10px;border-radius:10px;margin-top:4px;line-height:1.2;min-width:0;max-width:100%;color:var(--text)}
 .ae-controls input[type=date]{display:block;-webkit-appearance:none;appearance:none;text-align:left;overflow:hidden}
 .ae-controls input[type=date]::-webkit-date-and-time-value{min-height:24px;text-align:left;margin:0}
 .ae-controls select{padding-right:26px}
 .ae-toolbar{margin:10px 0 2px;align-items:center}
 .ae-toolbar button{height:40px;min-height:40px;padding:8px 12px;border-radius:10px;font-size:13px;touch-action:manipulation}
 #ae-prev,#ae-next{width:40px;font-size:22px;padding:3px 0}
 .ae-toolbar>div{gap:6px}
 #ae-status{font-size:11px;line-height:1.35;margin:6px 0 2px;overflow-wrap:anywhere;color:var(--muted)}
 .ae-info>summary{font-size:11px;min-height:24px;padding:2px 0}
 .ae-scroll{margin:0;border-radius:12px;max-height:none;height:max(320px,calc(100svh - 310px));height:max(320px,calc(var(--tg-viewport-stable-height,100svh) - 310px));min-height:320px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
 .ae-board.ae-day{width:100%;min-width:0}
 .ae-board:not(.ae-day){min-width:770px}
 .ae-head,.ae-all,.ae-grid{grid-template-columns:44px repeat(var(--days),minmax(0,1fr))}
 .ae-day-head{padding:7px 3px;font-size:10px;line-height:1.3}
 .ae-day-head b{font-size:20px;margin-top:2px}
 .ae-hour-label{font-size:10px;right:5px}
 .ae-event{font-size:12px;border-radius:6px;padding:4px 6px}
 .ae-event small{font-size:10px}
 .ae-all-label{padding:5px 2px;font-size:8px}
 .ae-slot:active{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
 #ae-calendar-app>.hint:last-of-type{font-size:10px;line-height:1.4;margin:8px 2px}
 #ae-event-dialog{position:fixed;inset:auto 0 0;margin:0;max-width:none;width:100%;max-height:75svh;overflow:auto;border-radius:18px 18px 0 0;border-bottom:0;padding:22px 20px max(20px,env(safe-area-inset-bottom))}
 #ae-event-dialog button{min-height:44px;font-size:15px}
}
@media(max-width:360px){.ae-toolbar button{padding:8px 10px;font-size:12px}.ae-controls{grid-template-columns:minmax(0,1fr) 90px}.ae-scroll{height:max(300px,calc(100svh - 300px))}}
`;
