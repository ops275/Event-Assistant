import {allEvents,activeEvent,saveEvent,setActiveEvent} from './eventCatalog.js';

const fields=[['name','✏️ Name','Event name'],['startDate','📅 Start date','YYYY-MM-DD'],['endDate','📅 End date','YYYY-MM-DD'],['timeZone','🌍 Time zone','Europe/Rome'],['location','📍 Location','Optional'],['url','🔗 Website','https:// · optional']];
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const clear=session=>{delete session.eventDraft;delete session.eventStep;delete session.eventChoices;};
export function createEventSettings(admin){
 function panel(session,id){
  if(!session.view?.startsWith('settings-event-'))return null;
  admin.requireAdmin(id);
  const rows=[],add=(text,action)=>rows.push([{text,callback_data:`v2:${session.nonce}:${action}`}]);
  let text;
  if(session.view==='settings-event-home'){
   text='📅 Event management';
   add('🎯 Active event','eventactive');add('➕ Add event','eventnew');add('Back','adminhome');
   return {text,rows};
  }else if(session.view==='settings-event-active'){
   const events=allEvents(admin.read()).filter(e=>!e.archived),current=activeEvent(admin.read());
   session.eventChoices=events.map(e=>e.id);
   text='🎯 Active event\n\n'+(current?.name||'None');
   events.forEach((event,index)=>add((event.id===current?.id?'✓ ':'')+event.name,`eventchoose:${index}`));
   add('No active event','eventchoose:none');
  }else if(session.view==='settings-event-form'&&session.eventDraft){
   const [key,title,hint]=fields[session.eventStep];text=title+'\n\n'+hint;
   if(key==='timeZone')add('Europe/Rome','eventzone');
   if(['location','url'].includes(key))add('Skip','eventskip');
   if(session.eventStep>0)add('Back','eventback');
  }else if(session.view==='settings-event-review'&&session.eventDraft){
   text='📅 Review event\n\n'+fields.map(([key,title])=>title.replace(/^\S+ /,'')+': '+(session.eventDraft[key]||'—')).join('\n');
   add('Save','eventsave');add('Back','eventback');
  }else{clear(session);session.view='settings';return null;}
  add('Cancel','eventcancel');return {text,rows};
 }
 function text(value,session,id){
  if(session.view!=='settings-event-form')return false;
  admin.requireAdmin(id);
  if(!session.eventDraft||!fields[session.eventStep])throw new Error('Open Add event again.');
  value=String(value||'').trim();const key=fields[session.eventStep][0];
  if(key==='name'&&(!value||value.length>120))throw new Error('Name: 1–120 characters.');
  if(['startDate','endDate'].includes(key)&&!validDate(value))throw new Error('Use YYYY-MM-DD.');
  if(key==='endDate'&&value<session.eventDraft.startDate)throw new Error('End must follow start.');
  if(key==='timeZone'){try{if(!value)throw Error();new Intl.DateTimeFormat('en',{timeZone:value});}catch{throw new Error('Enter a valid time zone.');}}
  if(key==='location'&&value.length>160)throw new Error('Location: max 160 characters.');
  if(key==='url'&&value.length>500)throw new Error('Website: max 500 characters.');
  if(key==='url'&&value){let url;try{url=new URL(value);}catch{}if(!url||url.protocol!=='https:'||url.username||url.password)throw new Error('Use an https:// URL.');}
  session.eventDraft[key]=value;session.eventStep++;if(session.eventStep===fields.length)session.view='settings-event-review';
  return true;
 }
 function action(action,value,session,id){
  if(!['eventhome','eventactive','eventnew','eventchoose','eventzone','eventskip','eventback','eventsave','eventcancel','dashboardevents'].includes(action))return false;
  admin.requireAdmin(id);
  if(action==='eventcancel'||action==='eventhome'||action==='dashboardevents'){clear(session);session.view='settings-event-home';}
  else if(action==='eventactive'){clear(session);session.view='settings-event-active';}
  else if(action==='eventnew'){clear(session);session.eventDraft={};session.eventStep=0;session.view='settings-event-form';}
  else if(action==='eventchoose'){
   if(session.view!=='settings-event-active')return true;
   const eventId=value==='none'?'':/^\d+$/.test(value||'')?session.eventChoices?.[Number(value)]:undefined;
   if(eventId===undefined)throw new Error('Choose an event again.');
   setActiveEvent(admin,id,eventId);clear(session);session.view='settings-event-home';
  }else if(action==='eventsave'){
   if(session.view!=='settings-event-review'||!session.eventDraft)return true;
   saveEvent(admin,id,session.eventDraft);clear(session);session.view='settings-event-home';
  }else if(action==='eventback'){
   if(!session.eventDraft)return true;
   session.eventStep=Math.max(0,session.eventStep-1);session.view='settings-event-form';
  }else if(action==='eventzone'){
   if(session.view==='settings-event-form'&&fields[session.eventStep]?.[0]==='timeZone')text('Europe/Rome',session,id);
  }else if(action==='eventskip'){
   if(session.view==='settings-event-form'&&['location','url'].includes(fields[session.eventStep]?.[0]))text('',session,id);
  }
  return true;
 }
 return {panel,action,text};
}
