import {visibleManager} from './managerVisibility.js';
import fs from 'node:fs';
import {ROLES} from './adminService.js';
import {createEventSettings} from './eventSettings.js';
export function createAdminPanel({admin,store,config}){
 const events=createEventSettings(admin);
 const ledger=()=>config.reminderLedgerFile&&fs.existsSync(config.reminderLedgerFile)?JSON.parse(fs.readFileSync(config.reminderLedgerFile,'utf8')):{deliveries:{}};
 const name=id=>String(store.state.users?.[id]?.name||id).slice(0,65);
 const leads=()=>Object.values(store.state.leads).filter(l=>!l.deletedAt).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 function panel(session,id){
  if(session.view?.startsWith('settings-event-')&&admin.isAdmin(id)){const result=events.panel(session,id);if(result)return result;}
  if(!session.view?.startsWith('settings'))return null;
  if(session.view==='settings-reminders')session.view='settings';
  const settings=admin.read(),rows=[],add=(text,action)=>rows.push([{text,callback_data:`v2:${session.nonce}:${action}`}]);
  let text='Settings\n\nRole: '+(ROLES[admin.role(id)]||'Unassigned')+'\nMy Telegram reminders: '+(settings.users[id]?.muted?'disabled':'enabled');
  if(session.view==='settings'){
   let calendar=null;try{if(config.calendarAccountsDir){const file=config.calendarAccountsDir+'/'+id+'.json';if(fs.existsSync(file)&&fs.existsSync(config.calendarAccountsDir+'/'+id+'.enc'))calendar=JSON.parse(fs.readFileSync(file,'utf8'));}}catch{}
   text+='\nGoogle Calendar: '+(calendar?calendar.email:'not connected');
   add(calendar?'Reconnect Google Calendar':'Connect Google Calendar','calendarconnect');
   if(calendar)add('Disconnect calendar','calendardisconnect');
   if(admin.isAdmin(id)){text+='\n\nqooob administration';add('📅 Event management','eventhome');add('Users and roles','adminusers:0');add('Meetings and delivery history','adminmeetings');}
   add('Menu','welcome');return {text,rows};
  }
  if(session.view==='settings-calendar-disconnect'){
   add('Yes, disconnect','calendardisconnectconfirm');add('Cancel','adminhome');
   return {text:'Disconnect your Google Calendar?\n\nExisting events will be preserved. You can reconnect in Settings.',rows};
  }
  if(!admin.isAdmin(id)){session.view='settings';return panel(session,id);}
  if(session.view==='settings-users'){
   const ids=[...new Set([...Object.keys(store.state.users||{}),...Object.keys(settings.users),...admin.bootstrap,...store.state.authorizedUsers,...Object.keys(store.state.sessions).map(k=>k.split(':').at(-1))])].filter(x=>/^\d+$/.test(x));
   const page=Math.max(0,session.adminPage||0);text='Users and roles\n\nChoose a team member. New users need to open qooob and send /start.';
   for(const uid of ids.slice(page*8,page*8+8))add(`${name(uid)} · ${settings.users[uid]?.blocked?'blocked':ROLES[admin.role(uid)]||'no role'}`,`adminuser:${uid}`);
   if(page)add('← Back','adminusers:'+(page-1));if(ids.length>(page+1)*8)add('Next →','adminusers:'+(page+1));add('Add by Telegram ID','adminadd');
  }else if(session.view==='settings-user'){
   const uid=session.adminTarget;text=`${name(uid)}\nTelegram ID: ${uid}\nRole: ${ROLES[admin.role(uid)]||'unassigned'}\nAccess: ${admin.blocked(uid)?'blocked':'allowed'}\n\nAll authorized qooob users have equal lead access. Administrators also manage users and assignments.`;
   for(const [role,title] of Object.entries(ROLES))add(title,`adminrole:${role}`);
   add(admin.blocked(uid)?'Unblock':'Block','adminblock');add('Back to users','adminusers:0');
  }else if(session.view==='settings-add'){text='Add user\n\nSend a numeric Telegram user ID. Choose the role next. Use a personal account ID, not a group chat ID.';}
  else if(session.view==='settings-leads'){
   const items=leads(),page=session.adminPage||0;text='Manager assignment\n\nChoose a lead. The manager will receive meeting reminders. Assignment does not change lead access.';
   for(const lead of items.slice(page*8,page*8+8))add([lead.fields.fullName,lead.fields.company].filter(Boolean).join(' · ').slice(0,60)||lead.id.slice(0,8),`adminlead:${lead.id}`);
   if(!items.length)text+='\n\nNo leads yet.';if(page)add('← Back','adminleads:'+(page-1));if(items.length>(page+1)*8)add('Next →','adminleads:'+(page+1));
  }else if(session.view==='settings-assignment'){
   const lead=store.state.leads[session.adminLead];text=`Manager for ${lead?.fields?.fullName||'lead'}\n\nCurrent: ${lead?.assigneeId?name(lead.assigneeId):'unassigned'}.\nChoose a team member with the manager or administrator role.`;
   const ids=Object.keys(settings.users).filter(uid=>visibleManager({id:uid})&&!admin.blocked(uid)&&['admin','partnership'].includes(admin.role(uid))),page=session.adminManagerPage||0;
   for(const uid of ids.slice(page*8,page*8+8))add(`${name(uid)} (${uid})`,`adminassign:${uid}`);
   if(page)add('← Back','adminmanagers:'+(page-1));if(ids.length>(page+1)*8)add('Next →','adminmanagers:'+(page+1));add('Remove assignment','adminassign:none');add('Back to leads','adminleads:0');
  }else if(session.view==='settings-reminders'){
   text=`Telegram reminders\n\n${settings.remindersEnabled?'Enabled':'Disabled'} · ${settings.reminderMinutes} min.\nRecipient: assigned manager, or meeting creator if unassigned. Inbox is excluded. Calendar is checked every 30 seconds. Changing the interval does not resend a reminder for the same meeting time.`;
   add(settings.remindersEnabled?'Disable all reminders':'Enable all reminders','admintoggle');for(const minutes of [5,15,30,60])add(`Before ${minutes} min.`,'adminminutes:'+minutes);
  }else if(session.view==='settings-meetings'){
   const data=ledger(),upcoming=(data.upcoming||[]).filter(e=>Date.parse(e.start)>Date.now()).slice(0,8);text='Upcoming meetings (7 days)\n\n'+(upcoming.map(e=>`${e.start} · ${String(e.summary).slice(0,90)}`).join('\n')||'No scheduled meetings.');
   text+='\n\nRecent deliveries:\n'+(Object.values(data.deliveries||{}).sort((a,b)=>b.at-a.at).slice(0,8).map(d=>`${new Date(d.at).toISOString()} · ${d.recipient} · ${{sent:'sent',blocked:'Telegram blocked delivery',retry:'waiting for retry',uncertain:'delivery unconfirmed',sending:'sending'}[d.status]||d.status}`).join('\n')||'No deliveries yet.');add('Refresh','adminmeetings');
  }else if(session.view==='settings-status'){
   const data=ledger(),all=leads();text=`qooob status\n\nLeads: ${all.length}\nSaved: ${all.filter(l=>l.status==='saved').length}\nSheets errors: ${all.filter(l=>l.sheetsSync?.status==='failed').length}\nReminders: ${settings.remindersEnabled?'enabled':'disabled'}\nCalendar check: ${data.checkedAt?new Date(data.checkedAt).toISOString():'service has not started yet'}\nService: ${data.error?'error '+data.error:!data.checkedAt||Date.now()-data.checkedAt>120000?'no recent confirmation':'running'}\nGoogle: ${data.checkedAt&&!data.error?'calendar read confirmed':'check required'}\n\nRecent changes:\n${(settings.audit||[]).slice(-5).reverse().map(a=>`${a.at} · ${a.actor} → ${a.target||'reminders'}`).join('\n')||'No changes'}`;add('Refresh','adminstatus');
  }
  add('Settings','adminhome');return {text,rows};
 }
 function action(action,value,session,id){
  if(events.action(action,value,session,id))return true;
  if(!action.startsWith('admin'))return false;
  id=String(id);
  if(action==='adminhome'){session.view='settings';return true;}
  if(action==='adminmute'){admin.setMuted(id,!admin.read().users[id]?.muted);session.view='settings';return true;}
  admin.requireAdmin(id);
  if(['adminreminders','adminminutes','admintoggle'].includes(action)){session.view='settings';return true;}
  if(action==='adminusers'){session.adminPage=Math.max(0,Number(value)||0);session.view='settings-users';}
  else if(action==='adminuser'){if(!/^\d+$/.test(value))throw new Error('Invalid ID');session.adminTarget=value;session.view='settings-user';}
  else if(action==='adminrole'){admin.setUser(id,session.adminTarget,{role:value});if(!['admin','partnership'].includes(value)){for(const lead of Object.values(store.state.leads))if(String(lead.assigneeId)===session.adminTarget)lead.assigneeId=null;store.save();}session.view='settings-user';}
  else if(action==='adminblock'){admin.setUser(id,session.adminTarget,{blocked:!admin.blocked(session.adminTarget)});session.view='settings-user';}
  else if(action==='adminadd')session.view='settings-add';
  else if(action==='adminleads'){session.adminPage=Math.max(0,Number(value)||0);session.view='settings-leads';}
  else if(action==='adminlead'){if(!store.state.leads[value]||store.state.leads[value].deletedAt)throw new Error('Lead not found');session.adminLead=value;session.adminManagerPage=0;session.view='settings-assignment';}
  else if(action==='adminmanagers'){session.adminManagerPage=Math.max(0,Number(value)||0);session.view='settings-assignment';}
  else if(action==='adminassign'){
   const lead=store.state.leads[session.adminLead];if(!lead||lead.deletedAt)throw new Error('Lead not found');
   if(value!=='none'&&(admin.blocked(value)||!['admin','partnership'].includes(admin.role(value))))throw new Error('Choose a manager');
   lead.assigneeId=value==='none'?null:value;lead.assignedBy=id;lead.assignedAt=new Date().toISOString();store.save();
  }else if(action==='adminreminders')session.view='settings-reminders';
  else if(action==='admintoggle')admin.setReminders(id,{remindersEnabled:!admin.read().remindersEnabled});
  else if(action==='adminminutes')admin.setReminders(id,{reminderMinutes:Number(value)});
  else if(action==='adminmeetings')session.view='settings-meetings';
  else if(action==='adminstatus')session.view='settings-status';
  else throw new Error('Unknown action');
  return true;
 }
 return {panel,action,text:events.text};
}
