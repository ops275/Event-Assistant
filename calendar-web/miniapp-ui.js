(async()=>{
 const tg=window.Telegram?.WebApp;
 if(tg){
  tg.ready();tg.expand();tg.BackButton.onClick(()=>{
   // Native Back exits the miniapp; explicit page links handle in-app navigation.
   // Keyboard APIs vary by Telegram client and must never prevent closing.
   try{if(typeof tg.hideKeyboard==='function')tg.hideKeyboard();}catch{}
   try{document.activeElement?.blur?.();}catch{}
   tg.close();
  });
  if(location.pathname==='/book')tg.BackButton.hide();else if(location.pathname!=='/miniapp')tg.BackButton.show();
 }
 const googleConnect=document.getElementById('google-connect');
 if(googleConnect&&tg)googleConnect.addEventListener('click',event=>{event.preventDefault();tg.openLink(googleConnect.href);});
 if(document.querySelector('[data-calendar-resume]')){
  let checking=false;const resumeBooking=async()=>{if(checking||document.hidden)return;checking=true;try{const response=await fetch('/calendar/status',{cache:'no-store'});if(!response.ok)return;const status=await response.json();if(status.connected&&typeof status.next==='string'&&/^\/book(?:\?|$)/.test(status.next))location.replace(status.next);}catch{}finally{checking=false;}};
  window.addEventListener('focus',resumeBooking);document.addEventListener('visibilitychange',resumeBooking);tg?.onEvent?.('activated',resumeBooking);setInterval(resumeBooking,3000);resumeBooking();
 }
 const calendarLink=document.getElementById('open-calendar');
 if(calendarLink&&tg)calendarLink.addEventListener('click',event=>{event.preventDefault();tg.openLink(calendarLink.href);});
 const copyEventLink=document.getElementById('copy-event-link');
 if(copyEventLink&&calendarLink)copyEventLink.addEventListener('click',async()=>{
  const status=document.getElementById('event-link-status');
  try{
   await navigator.clipboard.writeText(calendarLink.href);
   status.textContent='Event link copied. Paste it into Safari or your browser and sign in with the Google account invited to this meeting.';
  }catch{
   status.textContent='Could not copy automatically. Touch and hold Open in Google Calendar to copy the event link, then paste it into your browser.';
  }
 });
 document.getElementById('close-assistant')?.addEventListener('click',()=>{if(tg)tg.close();else if(history.length>1)history.back();else window.close();});
 if(document.getElementById('meeting-booked'))tg?.BackButton.hide();
 const form=document.getElementById('booking-form');
 if(form){
  const keyboardDone=document.getElementById('dismiss-keyboard');
  const textEntry=element=>element?.matches('textarea:not([readonly]),input:not([readonly]):not([type=checkbox]):not([type=date]):not([type=time]):not([type=hidden])');
  const dismissKeyboard=()=>{
   if(!textEntry(document.activeElement))return;
   // Telegram clients can retain their native keyboard after DOM focus changes.
   try{if(typeof tg?.hideKeyboard==='function')tg.hideKeyboard();}catch{}
   document.activeElement?.blur?.();
  };
  if(keyboardDone){
   const updateKeyboardButton=()=>{keyboardDone.hidden=!textEntry(document.activeElement);};
   form.addEventListener('focusin',updateKeyboardButton);
   form.addEventListener('focusout',()=>queueMicrotask(updateKeyboardButton));
   keyboardDone.addEventListener('pointerdown',event=>event.preventDefault());
   keyboardDone.addEventListener('click',dismissKeyboard);
   document.addEventListener('pointerdown',event=>{if(!event.target.closest('input,textarea,select,button,a,label,summary'))dismissKeyboard();});
  }
  const guestInputs=document.getElementById('guest-inputs'),leadContactInput=document.getElementById('guests');
  document.getElementById('add-guest')?.addEventListener('click',()=>{
   const input=document.createElement('input');
   input.name='guests';input.maxLength=254;input.placeholder='name@company.com';input.inputMode='email';
   input.autocomplete='email';input.setAttribute('aria-label','Guest email '+(guestInputs.children.length+1));
   guestInputs.append(input);input.focus();
  });
  guestInputs.addEventListener('focusout',event=>{if(event.target.matches('input[name=guests]')&&!event.target.value.trim())event.target.remove();});
  const picker=document.getElementById('lead-picker');
  const field=name=>form.elements.namedItem(name);
  const cetToggle=document.getElementById('display-cet');
  const setZone=zone=>{let option=[...field('timeZone').options].find(o=>o.value===zone);if(!option){option=new Option(zone,zone);field('timeZone').append(option);}field('timeZone').value=zone;};
  const changeDisplayZone=zone=>{
   const old=field('timeZone').value,date=field('date').value,time=field('time').value;
   if(date&&time&&!field('inbox').checked&&old!==zone){
    const parts=(instant,tz)=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
    const naive=Date.parse(date+'T'+time+':00Z');let instant=naive;
    for(let i=0;i<3;i++){const p=parts(instant,old);instant+=naive-Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);}
    const p=parts(instant,zone);field('date').value=`${p.year}-${p.month}-${p.day}`;field('time').value=`${p.hour}:${p.minute}`;
   }
   setZone(zone);
  };
  cetToggle.addEventListener('input',()=>{changeDisplayZone(cetToggle.checked?'Etc/GMT-1':field('managerId')?.selectedOptions[0]?.dataset.zone||'UTC');loadSlots();});
  const text=(id,value)=>{document.getElementById(id).textContent=value;};
  const onlineToggle=document.getElementById('meeting-online');
  let wasInbox=false;
  const unclearPlace='The meeting place should be added after clarifying the time';
  onlineToggle.addEventListener('input',()=>{field('meetingType').value=onlineToggle.checked?'online':'offline';});
  const preview=()=>{
   const lead=picker?picker.selectedOptions[0].dataset:{name:field('fullName').value,company:field('company').value};
   const inbox=field('inbox').checked;
   const timeHelp=document.getElementById('time-not-clarified-help');if(timeHelp)timeHelp.hidden=!inbox;
   if(inbox)field('meetingType').value='offline';
   field('meetingType').querySelector('[value=online]').disabled=inbox;
   const meet=field('meetingType').value==='online';
   onlineToggle.checked=meet;onlineToggle.disabled=inbox;
   document.getElementById('meeting-location-row').hidden=meet;
   document.getElementById('online-meeting-details').hidden=!meet;
   document.getElementById('meet-hint').hidden=meet;
   const typeIcon=document.getElementById('meeting-type-icon');typeIcon.dataset.icon=meet?'video':'chair';typeIcon.querySelector('path').setAttribute('d',typeIcon.dataset[typeIcon.dataset.icon]);
   const place=field('location');
   if(inbox)place.value=unclearPlace;
   else if(wasInbox)place.value='';
   wasInbox=inbox;
   place.disabled=meet;place.readOnly=inbox;place.required=!meet&&!inbox;
   text('meet-hint',inbox?'Time not clarified uses Offline. Choose a time to enable Google Meet.':meet?'A Google Meet link will be created for this handoff.':'Meet in person at the place below.');
   text('meeting-title',lead.company.trim()&&lead.name.trim()?(inbox?'[Clarify time] ':'')+'Onlyplay × '+lead.company.trim()+' — '+lead.name.trim():'Enter name and company');
   const attached=document.getElementById('attached-lead');attached.textContent=[lead.company.trim(),lead.name.trim()].filter(Boolean).join(' · ');attached.hidden=!attached.textContent;
   text('meeting-description',lead.company.trim()&&lead.name.trim()?`Onlyplay meeting with ${lead.company.trim()}. Attendee: ${lead.name.trim()}.`:'Meeting details will appear here.');
   text('preview-when',field('date').value?(field('date').value.split('-').reverse().join('.')+' · '+(inbox?'07:00 · Inbox':field('time').value||'Choose time')+' · '+field('timeZone').value):'Date and time not selected');
   text('preview-location',meet?'Google Meet · link after creation':field('location').value.trim()||'Place not entered');
   const calendar=document.getElementById('calendar-meta');
   calendar.textContent=calendar.dataset.calendar+' · 30 minutes · '+(inbox?'meeting time to be confirmed':'reminder 15 minutes before');
   field('time').disabled=inbox;field('time').required=!inbox;
   const timeRow=document.querySelector('.ce-time-row'),timePlaceholder=document.getElementById('time-placeholder');
   timeRow.hidden=inbox;cetToggle.closest('label').hidden=inbox;
   timeRow.classList.toggle('is-empty',!field('time').value);timeRow.classList.toggle('is-unclarified',inbox);
   timePlaceholder.hidden=Boolean(field('time').value)&&!inbox;timePlaceholder.textContent=inbox?'Time not clarified':'00:00';
   const end=document.getElementById('meeting-end');
   if(end)end.textContent='30 minutes';
   const zoneLabel=document.querySelector('.ce-zone');
   if(zoneLabel){const zone=field('timeZone').value,date=field('date').value,time=field('time').value||'12:00';
    const formatter=new Intl.DateTimeFormat('en',{timeZone:zone,timeZoneName:'longOffset'});
    const offsetAt=instant=>formatter.formatToParts(new Date(instant)).find(p=>p.type==='timeZoneName').value;
    const naive=Date.parse(date+'T'+time+':00Z');let instant=Number.isFinite(naive)?naive:Date.now();
    if(Number.isFinite(naive)){const match=offsetAt(instant).match(/GMT([+-])(\d{2}):(\d{2})/);if(match){const minutes=(Number(match[2])*60+Number(match[3]))*(match[1]==='+'?1:-1);instant=naive-minutes*60000;}}
    const offset=offsetAt(instant).replace(/^GMT$/,'GMT+0').replace(/GMT([+-])0?(\d+):00$/,'GMT$1$2').replace(/GMT([+-])0(\d):/,'GMT$1$2:');zoneLabel.textContent=zone==='Etc/GMT-1'?'CET (UTC+1)':zone+' ('+offset+')';
   }
   const note=document.getElementById('inbox-note');if(note)note.hidden=true;
   const reminder=document.getElementById('reminder-minutes');if(reminder)reminder.disabled=inbox;
   const reminderHint=document.getElementById('reminder-hint');if(reminderHint)reminderHint.hidden=!inbox;
   const availability=document.querySelector('.availability');if(availability)availability.hidden=inbox;
   for(const item of document.querySelectorAll('.slot'))item.setAttribute('aria-pressed',String(!inbox&&item.textContent===field('time').value));
  };
  picker?.addEventListener('change',()=>{
   const option=picker.selectedOptions[0],lead=option.dataset;
   field('leadId').value=option.value;
   field('description').value=lead.description||'';field('meetingType').value=lead.meetingType||'offline';field('location').value=lead.location||'';
   wasInbox=false;
   guestInputs.replaceChildren(leadContactInput);leadContactInput.value=lead.contact||'';for(const email of JSON.parse(lead.guests||'[]')){document.getElementById('add-guest').click();guestInputs.lastElementChild.value=email;}
   text('lead-name',lead.name);text('lead-company',lead.company);text('lead-email',lead.email||'Email not provided');text('lead-avatar',lead.name.trim().slice(0,1));
   preview();tg?.HapticFeedback?.selectionChanged();
  });
  form.addEventListener('input',preview);
  form.addEventListener('change',preview);
  let slotRequest,slotTimer;
  const slots=document.getElementById('slots-result');
  const selectedAvailability=document.getElementById('selected-availability');
  const selectedStatus=(state,message)=>{selectedAvailability.dataset.state=state;selectedAvailability.textContent=message;};
  const invalidateSlots=()=>{clearTimeout(slotTimer);slotRequest?.abort();slots.replaceChildren();selectedStatus('checking',field('inbox').checked?'':field('time').value?'Checking selected time…':'Choose a time to check availability.');};
  const manager=field('managerId');
  if(manager)manager.addEventListener('change',()=>{
   const data=manager.selectedOptions[0].dataset;
   if(data.zone)setZone(cetToggle.checked?'Etc/GMT-1':data.zone);
   const calendar=document.getElementById('calendar-meta');calendar.dataset.calendar=data.calendar||'Choose calendar';document.getElementById('availability-title').textContent='Sender and receiving manager availability · '+calendar.dataset.calendar;
   const email=document.getElementById('manager-email');if(email){email.textContent=data.calendar||'';email.href='mailto:'+(data.calendar||'');}const zone=document.getElementById('manager-zone');if(zone)zone.textContent=field('timeZone').value;
   field('time').value='';preview();loadSlots();
  });
  field('date').addEventListener('change',()=>loadSlots());field('timeZone').addEventListener('change',()=>loadSlots());
  field('time').addEventListener('input',()=>{invalidateSlots();slotTimer=setTimeout(loadSlots,250);});
  field('time').addEventListener('change',()=>loadSlots());
  field('inbox').addEventListener('change',()=>loadSlots());
  async function loadSlots(){
   invalidateSlots();
   const retry=document.getElementById('check-slots');retry.hidden=true;
   if(field('inbox').checked)return;
   if(!field('date').value){slots.textContent='Choose a date to see availability.';selectedStatus('unknown','Choose a date to check the selected time.');return;}
   if(manager&&!manager.value){slots.textContent='Choose a manager to see availability.';selectedStatus('unknown','Choose a manager to check the selected time.');return;}
   slotRequest=new AbortController();
   const date=field('date').value,zone=field('timeZone').value,selectedTime=field('inbox').checked?'':field('time').value;
   slots.textContent='Checking calendar…';
   const request=slotRequest;
   try{
    const response=await fetch('/slots?'+new URLSearchParams({date,timeZone:zone,format:'json',...(selectedTime?{time:selectedTime}:{}),...(manager?{manager:manager.value}:{})}),{signal:request.signal,cache:'no-store'});
    if(!response.ok)throw new Error('slots');
    const result=await response.json();if(request.signal.aborted||request!==slotRequest)return;slots.replaceChildren();
    if(!selectedTime)selectedStatus('unknown',field('inbox').checked?'':'Choose a time to check availability.');
    else if(result.selectedAvailable===false)selectedStatus('busy','Selected time is busy for you or the receiving manager. Choose another time.');
    else if(result.selectedAvailable===true)selectedStatus('available','Selected time is available for both calendars. Checked again when booking.');
    else selectedStatus('unknown','Could not confirm the selected time. Availability will be checked when booking.');
    if(!result.slots.length)slots.textContent='No available slots between 09:00 and 18:00.';
    for(const time of result.slots){
     const button=document.createElement('button');button.type='button';button.className='slot';button.textContent=time;
     button.setAttribute('aria-pressed',String(!field('inbox').checked&&time===field('time').value));
     button.addEventListener('click',()=>{field('time').value=time;field('inbox').checked=false;preview();loadSlots();});
     slots.append(button);
    }
   }catch(error){if(!request.signal.aborted&&request===slotRequest){slots.textContent='Could not check calendar.';selectedStatus('unknown',selectedTime?'Could not confirm the selected time. Availability will be checked when booking.':'');retry.textContent='Retry';retry.hidden=false;}}
  }
  document.getElementById('check-slots').addEventListener('click',()=>loadSlots());
  const availability=document.querySelector('details.availability');if(availability)availability.open=true;
  if(!field('date').value){const parts=new Intl.DateTimeFormat('en',{timeZone:field('timeZone').value,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const part=type=>parts.find(p=>p.type===type).value;field('date').value=part('year')+'-'+part('month')+'-'+part('day');}
  loadSlots();
  const guestError=document.getElementById('guest-error');
  const validateGuests=()=>{
   const inputs=[...guestInputs.querySelectorAll('input[name=guests]')];
   const contact=leadContactInput.value.trim(),contactParts=contact.split(/[\s,;]+/).filter(Boolean),primaryEmails=contactParts.every(email=>/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email))?contactParts:[];
   const emails=[...primaryEmails,...inputs.flatMap(input=>input.value.split(/[\s,;]+/).filter(Boolean))];
   const invalid=inputs.find(input=>input.value.split(/[\s,;]+/).filter(Boolean).some(email=>!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)));
   for(const input of inputs){input.removeAttribute('aria-invalid');input.setAttribute('aria-describedby','guest-error');}
   const message=invalid?'Enter a valid email address.':emails.length>20?'Add no more than 20 guest email addresses.':'';
   guestError.textContent=message;guestError.hidden=!message;
   if(invalid)invalid.setAttribute('aria-invalid','true');
   return {valid:!message,invalid};
  };
  guestInputs.addEventListener('input',()=>{if(!guestError.hidden)validateGuests();});
  form.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.target.matches('input:not([type=checkbox])')){event.preventDefault();if(['guests','leadContact'].includes(event.target.name)){validateGuests();dismissKeyboard();}}});
  form.addEventListener('submit',event=>{
   const button=document.getElementById('create-meeting');
   if(event.submitter!==button){event.preventDefault();return;}
   const guests=validateGuests();if(!guests.valid){event.preventDefault();guests.invalid?.focus();return;}
   button.disabled=true;button.textContent='Creating meeting…';
  });
  window.addEventListener('pageshow',()=>{const button=document.getElementById('create-meeting');if(button.textContent==='Creating meeting…'){button.disabled=false;button.textContent='Book meeting';}});
  document.getElementById('close-booking')?.addEventListener('click',()=>{if(tg)tg.close();else if(history.length>1)history.back();});
  preview();
 }
 if(location.pathname!=='/miniapp')return;
 const status=document.getElementById('miniapp-status');
 if(!tg?.initData){status.textContent='Open this miniapp using Hand off lead in the Onlyplay Telegram bot.';return;}
 try{
  const ticket=new URLSearchParams(location.search).get('ticket');
  const response=await fetch('/miniapp-auth',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket,initData:tg.initData})});
  const result=await response.json();
  if(!response.ok||!result.next){status.textContent=result.error||'Could not open the form. Open it again from the bot.';return;}
  location.replace(result.next);
 }catch{status.textContent='Could not connect. Close this window and open Hand off lead again.';}
})();
