(async()=>{
 const tg=window.Telegram?.WebApp;
 if(tg){tg.ready();tg.expand();tg.BackButton.onClick(()=>history.back());if(location.pathname==='/book')tg.BackButton.hide();else if(location.pathname!=='/miniapp')tg.BackButton.show();}
 const googleConnect=document.getElementById('google-connect');
 if(googleConnect&&tg)googleConnect.addEventListener('click',event=>{event.preventDefault();tg.openLink(googleConnect.href);});
 if(document.querySelector('[data-calendar-resume]')){
  let checking=false;const resumeBooking=async()=>{if(checking||document.hidden)return;checking=true;try{const response=await fetch('/calendar/status',{cache:'no-store'});if(!response.ok)return;const status=await response.json();if(status.connected&&typeof status.next==='string'&&/^\/book(?:\?|$)/.test(status.next))location.replace(status.next);}catch{}finally{checking=false;}};
  window.addEventListener('focus',resumeBooking);document.addEventListener('visibilitychange',resumeBooking);tg?.onEvent?.('activated',resumeBooking);setInterval(resumeBooking,3000);resumeBooking();
 }
 const form=document.getElementById('booking-form');
 if(form){
  const picker=document.getElementById('lead-picker');
  const field=name=>form.elements.namedItem(name);
  const text=(id,value)=>{document.getElementById(id).textContent=value;};
  const preview=()=>{
   const lead=picker.selectedOptions[0].dataset;
   const inbox=field('inbox').checked;
   if(inbox)field('createMeet').checked=false;
   field('createMeet').disabled=inbox;
   const meet=field('createMeet').checked;
   field('location').disabled=meet;field('location').required=!meet;
   text('meet-hint',inbox?'Для Google Meet сначала выберите время':'Ссылка создастся вместе со встречей');
   text('meeting-title',(inbox?'[Время не согласовано] ':'')+'qooob × '+lead.company.trim()+' — '+lead.name.trim());
   text('meeting-description',`Встреча qooob с ${lead.company.trim()}. Участник: ${lead.name.trim()}.`);
   text('preview-when',field('date').value?(field('date').value.split('-').reverse().join('.')+' · '+(inbox?'07:00 · Inbox':field('time').value||'Выберите время')+' · '+field('timeZone').value):'Дата и время не выбраны');
   text('preview-location',meet?'Google Meet · ссылка после создания':field('location').value.trim()||'Место не указано');
   const calendar=document.getElementById('calendar-meta');
   calendar.textContent=calendar.dataset.calendar+' · 30 минут · '+(inbox?'не занимает время, без напоминаний':'напоминание за 15 минут');
   field('time').disabled=inbox;field('time').required=!inbox;
   field('guests').disabled=inbox;field('sendInvites').disabled=inbox;
   if(inbox)field('sendInvites').checked=false;
   text('invite-hint',inbox?'Для Inbox приглашения не отправляются':field('sendInvites').checked?'Гости получат приглашение после создания':'Выключено — только запись в календаре');
  };
  picker.addEventListener('change',()=>{
   const option=picker.selectedOptions[0],lead=option.dataset;
   field('leadId').value=option.value;
   field('guests').value=lead.email||'';
   field('sendInvites').checked=false;
   text('lead-name',lead.name);text('lead-company',lead.company);text('lead-email',lead.email||'Email не указан');text('lead-avatar',lead.name.trim().slice(0,1));
   preview();tg?.HapticFeedback?.selectionChanged();
  });
  form.addEventListener('input',preview);
  form.addEventListener('change',preview);
  let slotRequest;
  const slots=document.getElementById('slots-result');
  const invalidateSlots=()=>{slotRequest?.abort();slots.replaceChildren();};
  const manager=field('managerId');
  if(manager)manager.addEventListener('change',()=>{
   const data=manager.selectedOptions[0].dataset;
   if(data.zone){let option=[...field('timeZone').options].find(o=>o.value===data.zone);if(!option){option=document.createElement('option');option.value=data.zone;option.textContent=data.zone;field('timeZone').append(option);}field('timeZone').value=data.zone;}
   const calendar=document.getElementById('calendar-meta');calendar.dataset.calendar=data.calendar||'Выберите календарь';document.getElementById('availability-title').textContent='Свободное время календаря '+calendar.dataset.calendar;
   invalidateSlots();preview();
  });
  field('date').addEventListener('change',invalidateSlots);field('timeZone').addEventListener('change',invalidateSlots);
  document.getElementById('check-slots').addEventListener('click',async()=>{
   if(!field('date').reportValidity())return;
   if(manager&&!manager.reportValidity())return;
   invalidateSlots();slotRequest=new AbortController();
   const date=field('date').value,zone=field('timeZone').value;
   slots.textContent='Проверяем календарь…';
   try{
    const response=await fetch('/slots?'+new URLSearchParams({date,timeZone:zone,format:'json',...(manager?{manager:manager.value}:{})}),{signal:slotRequest.signal});
    if(!response.ok)throw new Error('slots');
    const result=await response.json();slots.replaceChildren();
    if(!result.slots.length)slots.textContent='Свободных слотов с 09:00 до 18:00 нет.';
    for(const time of result.slots){
     const button=document.createElement('button');button.type='button';button.className='slot';button.textContent=time;
     button.addEventListener('click',()=>{field('time').value=time;field('inbox').checked=false;preview();for(const item of slots.children)item.setAttribute('aria-pressed',String(item===button));});
     slots.append(button);
    }
   }catch(error){if(error.name!=='AbortError')slots.textContent='Не удалось проверить календарь. Попробуйте ещё раз.';}
  });
  form.addEventListener('submit',()=>{const button=document.getElementById('create-meeting');button.disabled=true;button.textContent='Создаём встречу…';});
  window.addEventListener('pageshow',()=>{const button=document.getElementById('create-meeting');if(button.textContent==='Создаём встречу…'){button.disabled=false;button.textContent='Создать встречу';}});
  preview();
 }
 if(location.pathname!=='/miniapp')return;
 const status=document.getElementById('miniapp-status');
 if(!tg?.initData){status.textContent='Откройте это мини-приложение кнопкой Book Meeting в Telegram-боте qooob.';return;}
 try{
  const ticket=new URLSearchParams(location.search).get('ticket');
  const response=await fetch('/miniapp-auth',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket,initData:tg.initData})});
  const result=await response.json();
  if(!response.ok||!result.next){status.textContent=result.error||'Не удалось открыть форму. Повторите вход из бота.';return;}
  location.replace(result.next);
 }catch{status.textContent='Не удалось подключиться. Закройте окно и откройте Book Meeting заново.';}
})();
