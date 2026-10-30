(()=>{
 for(const button of document.querySelectorAll('[data-copy]'))button.addEventListener('click',async()=>{const field=document.getElementById(button.dataset.copy);try{await navigator.clipboard.writeText(field.value);button.textContent='Link copied';}catch{field.focus();field.select();button.textContent='Copy the selected link';}});
 const form=document.getElementById('public-booking');if(!form)return;
 const date=document.getElementById('public-date'),zone=document.getElementById('visitor-zone'),slots=document.getElementById('public-slots'),start=document.getElementById('public-start'),confirm=document.getElementById('public-confirm');
 const local=Intl.DateTimeFormat().resolvedOptions().timeZone;if(local){if(![...zone.options].some(o=>o.value===local))zone.add(new Option(local,local));zone.value=local;}
 let request;const invalidate=()=>{request?.abort();slots.replaceChildren();start.value='';confirm.disabled=true;document.getElementById('selected-public-time').textContent='Choose a time above';};
 const label=time=>new Intl.DateTimeFormat('en-GB',{timeZone:zone.value,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(time));
 date.addEventListener('change',invalidate);zone.addEventListener('change',invalidate);
 document.getElementById('public-slots-button').addEventListener('click',async()=>{
  if(!date.reportValidity())return;invalidate();request=new AbortController();slots.textContent='Checking availability…';
  try{const response=await fetch('/schedule/'+form.dataset.token+'/slots?'+new URLSearchParams({date:date.value}),{signal:request.signal});if(!response.ok)throw new Error('availability');const data=await response.json();slots.replaceChildren();if(!data.slots.length)slots.textContent='No available times. Choose another date.';
   for(const time of data.slots){const button=document.createElement('button');button.type='button';button.className='slot';button.textContent=label(time);button.addEventListener('click',()=>{start.value=time;confirm.disabled=false;document.getElementById('selected-public-time').textContent=label(time)+' · '+zone.value+' · 30 minutes';for(const item of slots.children)item.setAttribute('aria-pressed',String(item===button));});slots.append(button);}
  }catch(error){if(error.name!=='AbortError')slots.textContent='Could not check the calendar. Try again later.';}
 });
 form.addEventListener('submit',event=>{if(!start.value){event.preventDefault();return;}confirm.disabled=true;confirm.textContent='Booking meeting…';});
 window.addEventListener('pageshow',()=>{confirm.disabled=!start.value;confirm.textContent='Confirm meeting';});
})();
