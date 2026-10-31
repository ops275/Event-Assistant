import fs from 'node:fs';
import {ROLES} from './adminService.js';
export function createAdminPanel({admin,store,config}){
 const ledger=()=>config.reminderLedgerFile&&fs.existsSync(config.reminderLedgerFile)?JSON.parse(fs.readFileSync(config.reminderLedgerFile,'utf8')):{deliveries:{}};
 const name=id=>String(store.state.users?.[id]?.name||id).slice(0,65);
 const leads=()=>Object.values(store.state.leads).filter(l=>!l.deletedAt).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 function panel(session,id){
  if(!session.view?.startsWith('settings'))return null;
  const settings=admin.read(),rows=[],add=(text,action)=>rows.push([{text,callback_data:`v2:${session.nonce}:${action}`}]);
  let text='Settings\n\nРоль: '+(ROLES[admin.role(id)]||'Не назначена')+'\nМои Telegram-напоминания: '+(settings.users[id]?.muted?'выключены':'включены');
  if(session.view==='settings'){
   let calendar=null;try{if(config.calendarAccountsDir){const file=config.calendarAccountsDir+'/'+id+'.json';if(fs.existsSync(file)&&fs.existsSync(config.calendarAccountsDir+'/'+id+'.enc'))calendar=JSON.parse(fs.readFileSync(file,'utf8'));}}catch{}
   text+='\nGoogle Calendar: '+(calendar?calendar.email:'не подключён');
   add(calendar?'Мой Google Calendar':'Подключить Google Calendar','calendarconnect');
   add(settings.users[id]?.muted?'Включить мои напоминания':'Выключить мои напоминания','adminmute');
   add('Проверить доставку мне','admintest');
   if(admin.isAdmin(id)){text+='\n\nАдминистрирование qooob';add('Пользователи и роли','adminusers:0');add('Назначить менеджера лиду','adminleads:0');add('Настройки напоминаний','adminreminders');add('Встречи и история отправок','adminmeetings');add('Состояние проекта','adminstatus');}
   add('Menu','welcome');return {text,rows};
  }
  if(!admin.isAdmin(id)){session.view='settings';return panel(session,id);}
  if(session.view==='settings-users'){
   const ids=[...new Set([...Object.keys(store.state.users||{}),...Object.keys(settings.users),...admin.bootstrap,...store.state.authorizedUsers,...Object.keys(store.state.sessions).map(k=>k.split(':').at(-1))])].filter(x=>/^\d+$/.test(x));
   const page=Math.max(0,session.adminPage||0);text='Пользователи и роли\n\nВыберите сотрудника. Новому пользователю нужно открыть qooob и нажать /start.';
   for(const uid of ids.slice(page*8,page*8+8))add(`${name(uid)} · ${settings.users[uid]?.blocked?'заблокирован':ROLES[admin.role(uid)]||'без роли'}`,`adminuser:${uid}`);
   if(page)add('← Назад','adminusers:'+(page-1));if(ids.length>(page+1)*8)add('Далее →','adminusers:'+(page+1));add('Добавить по Telegram ID','adminadd');
  }else if(session.view==='settings-user'){
   const uid=session.adminTarget;text=`${name(uid)}\nTelegram ID: ${uid}\nРоль: ${ROLES[admin.role(uid)]||'не назначена'}\nДоступ: ${admin.blocked(uid)?'заблокирован':'разрешён'}\n\nМенеджер: свои и назначенные лиды, встречи. Leadgen: свои лиды, встречи. Promoter: базовое добавление лидов, без поиска и встреч. Администратор: управление пользователями и назначениями.`;
   for(const [role,title] of Object.entries(ROLES))add(title,`adminrole:${role}`);
   add(admin.blocked(uid)?'Разблокировать':'Заблокировать','adminblock');add('К пользователям','adminusers:0');
  }else if(session.view==='settings-add'){text='Добавить пользователя\n\nПришлите Telegram user ID числом. Роль выберете следующим шагом. Это ID личного аккаунта, не группового чата.';}
  else if(session.view==='settings-leads'){
   const items=leads(),page=session.adminPage||0;text='Назначение менеджера\n\nВыберите лида. Менеджер получит доступ к карточке и напоминания о её встречах.';
   for(const lead of items.slice(page*8,page*8+8))add([lead.fields.fullName,lead.fields.company].filter(Boolean).join(' · ').slice(0,60)||lead.id.slice(0,8),`adminlead:${lead.id}`);
   if(!items.length)text+='\n\nЛидов пока нет.';if(page)add('← Назад','adminleads:'+(page-1));if(items.length>(page+1)*8)add('Далее →','adminleads:'+(page+1));
  }else if(session.view==='settings-assignment'){
   const lead=store.state.leads[session.adminLead];text=`Менеджер для ${lead?.fields?.fullName||'лида'}\n\nСейчас: ${lead?.assigneeId?name(lead.assigneeId):'не назначен'}.\nВыберите сотрудника с ролью менеджера или администратора.`;
   const ids=Object.keys(settings.users).filter(uid=>!admin.blocked(uid)&&['admin','partnership'].includes(admin.role(uid))),page=session.adminManagerPage||0;
   for(const uid of ids.slice(page*8,page*8+8))add(`${name(uid)} (${uid})`,`adminassign:${uid}`);
   if(page)add('← Назад','adminmanagers:'+(page-1));if(ids.length>(page+1)*8)add('Далее →','adminmanagers:'+(page+1));add('Снять назначение','adminassign:none');add('К лидам','adminleads:0');
  }else if(session.view==='settings-reminders'){
   text=`Telegram-напоминания\n\n${settings.remindersEnabled?'Включены':'Выключены'} · за ${settings.reminderMinutes} мин.\nПолучатель: назначенный менеджер; без назначения — создатель встречи. Inbox исключён. Проверка календаря каждые 30 секунд. Изменение интервала не повторяет уже отправленное напоминание для того же времени встречи.`;
   add(settings.remindersEnabled?'Выключить все напоминания':'Включить все напоминания','admintoggle');for(const minutes of [5,15,30,60])add(`За ${minutes} мин.`,'adminminutes:'+minutes);
  }else if(session.view==='settings-meetings'){
   const data=ledger(),upcoming=(data.upcoming||[]).filter(e=>Date.parse(e.start)>Date.now()).slice(0,8);text='Ближайшие встречи (7 дней)\n\n'+(upcoming.map(e=>`${e.start} · ${String(e.summary).slice(0,90)}`).join('\n')||'Запланированных встреч нет.');
   text+='\n\nПоследние отправки:\n'+(Object.values(data.deliveries||{}).sort((a,b)=>b.at-a.at).slice(0,8).map(d=>`${new Date(d.at).toISOString()} · ${d.recipient} · ${{sent:'отправлено',blocked:'Telegram запретил доставку',retry:'ожидает повтора',uncertain:'доставка не подтверждена',sending:'отправляется'}[d.status]||d.status}`).join('\n')||'Отправок пока нет.');add('Обновить','adminmeetings');
  }else if(session.view==='settings-status'){
   const data=ledger(),all=leads();text=`Состояние qooob\n\nЛидов: ${all.length}\nСохранены: ${all.filter(l=>l.status==='saved').length}\nОшибка Sheets: ${all.filter(l=>l.sheetsSync?.status==='failed').length}\nНапоминания: ${settings.remindersEnabled?'включены':'выключены'}\nПроверка календаря: ${data.checkedAt?new Date(data.checkedAt).toISOString():'сервис ещё не запущен'}\nСервис: ${data.error?'ошибка '+data.error:!data.checkedAt||Date.now()-data.checkedAt>120000?'нет свежего подтверждения':'работает'}\nGoogle: ${data.checkedAt&&!data.error?'чтение календаря подтверждено':'нужна проверка'}\n\nПоследние изменения:\n${(settings.audit||[]).slice(-5).reverse().map(a=>`${a.at} · ${a.actor} → ${a.target||'напоминания'}`).join('\n')||'Нет изменений'}`;add('Обновить','adminstatus');
  }
  if(config.sharedLeads)text=text.replace('Promoter: базовое добавление лидов, без поиска и встреч.','Promoter: добавление и просмотр общей базы, без бронирования.').replace('Менеджер получит доступ к карточке и напоминания о её встречах.','Менеджер получит права редактирования карточки и напоминания о её встречах.');
  add('Settings','adminhome');return {text,rows};
 }
 function action(action,value,session,id){
  if(!action.startsWith('admin'))return false;
  id=String(id);
  if(action==='adminhome'){session.view='settings';return true;}
  if(action==='adminmute'){admin.setMuted(id,!admin.read().users[id]?.muted);session.view='settings';return true;}
  admin.requireAdmin(id);
  if(action==='adminusers'){session.adminPage=Math.max(0,Number(value)||0);session.view='settings-users';}
  else if(action==='adminuser'){if(!/^\d+$/.test(value))throw new Error('Некорректный ID');session.adminTarget=value;session.view='settings-user';}
  else if(action==='adminrole'){admin.setUser(id,session.adminTarget,{role:value});if(!['admin','partnership'].includes(value)){for(const lead of Object.values(store.state.leads))if(String(lead.assigneeId)===session.adminTarget)lead.assigneeId=null;store.save();}session.view='settings-user';}
  else if(action==='adminblock'){admin.setUser(id,session.adminTarget,{blocked:!admin.blocked(session.adminTarget)});session.view='settings-user';}
  else if(action==='adminadd')session.view='settings-add';
  else if(action==='adminleads'){session.adminPage=Math.max(0,Number(value)||0);session.view='settings-leads';}
  else if(action==='adminlead'){if(!store.state.leads[value]||store.state.leads[value].deletedAt)throw new Error('Лид не найден');session.adminLead=value;session.adminManagerPage=0;session.view='settings-assignment';}
  else if(action==='adminmanagers'){session.adminManagerPage=Math.max(0,Number(value)||0);session.view='settings-assignment';}
  else if(action==='adminassign'){
   const lead=store.state.leads[session.adminLead];if(!lead||lead.deletedAt)throw new Error('Лид не найден');
   if(value!=='none'&&(admin.blocked(value)||!['admin','partnership'].includes(admin.role(value))))throw new Error('Выберите менеджера');
   lead.assigneeId=value==='none'?null:value;lead.assignedBy=id;lead.assignedAt=new Date().toISOString();store.save();
  }else if(action==='adminreminders')session.view='settings-reminders';
  else if(action==='admintoggle')admin.setReminders(id,{remindersEnabled:!admin.read().remindersEnabled});
  else if(action==='adminminutes')admin.setReminders(id,{reminderMinutes:Number(value)});
  else if(action==='adminmeetings')session.view='settings-meetings';
  else if(action==='adminstatus')session.view='settings-status';
  else throw new Error('Неизвестное действие');
  return true;
 }
 return {panel,action};
}
