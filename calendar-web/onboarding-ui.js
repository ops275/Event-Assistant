(()=>{
 const form=document.getElementById('onboarding-form');if(form){const lead=document.getElementById('ob-lead'),type=document.getElementById('ob-type'),title=document.getElementById('ob-title');const members=document.getElementById('ob-members'),leadHandle=document.getElementById('ob-lead-telegram');
 const primary=document.getElementById('ob-manager'),managerChecks=[...(form.querySelectorAll?.('[data-manager-telegram]')||[])];
 const key=value=>String(value||'').trim().replace(/^@/,'').toLowerCase();
 const entries=()=>members.value.split(/[\s,;]+/).filter(Boolean);
 const automatic=()=>new Map([primary?.dataset.creatorTelegram,primary?.value,...managerChecks.filter(input=>input.checked).map(input=>input.dataset.managerTelegram)].filter(Boolean).map(value=>[key(value),'@'+key(value)]));
 let previousAutomatic=automatic(),manualEntries=new Map(entries().filter(value=>!previousAutomatic.has(key(value))).map(value=>[key(value),value]));
 const captureManual=()=>{const values=new Map(entries().map(value=>[key(value),value]));for(const handle of manualEntries.keys())if(!values.has(handle))manualEntries.delete(handle);for(const [handle,value] of values)if(!previousAutomatic.has(handle))manualEntries.set(handle,value);};
 const syncParticipants=()=>{captureManual();const selected=automatic(),values=new Map(manualEntries);for(const [handle,value] of selected)values.set(handle,value);values.delete(key(leadHandle?.value));members.value=[...values.values()].join(', ');previousAutomatic=selected;};
 const updateLeadHandle=()=>{if(leadHandle)leadHandle.value=lead.selectedOptions[0].dataset.telegram||'';syncParticipants();};
 for(const input of managerChecks)input.addEventListener('change',syncParticipants);
 primary?.addEventListener('change',syncParticipants);members.addEventListener('input',captureManual);members.addEventListener('change',syncParticipants);leadHandle?.addEventListener('change',syncParticipants);syncParticipants();
 const avatar=document.getElementById('ob-avatar'),avatars={'operator-biz':'operator','operator-tech':'operator','provider-biz':'provider','provider-tech':'provider'};const updateAvatar=()=>{if(avatar&&Object.hasOwn(avatars,type.value)){const kind=avatars[type.value];avatar.src='/onboarding/avatar/'+kind;avatar.alt=(kind==='operator'?'Operator':'Provider')+' group avatar';}};updateAvatar();
 const updateTemplates=()=>{const category=avatars[type.value],cards=[...(form.querySelectorAll?.('[data-template-category]')||[])];let available=false;for(const card of cards){const shown=card.dataset.templateCategory===category,input=card.querySelector('input[name="introTemplates"]');card.hidden=!shown;input.disabled=!shown;if(!shown)input.checked=false;else available=true;}const empty=document.getElementById('ob-template-empty');if(empty){empty.hidden=available;empty.textContent='No '+(category==='provider'?'Provider':'Operator')+' templates are available yet.';}};updateTemplates();
 let manual=false;title.addEventListener('input',()=>manual=true);const update=()=>{updateAvatar();updateTemplates();if(!manual)title.value=('qooob × '+lead.selectedOptions[0].dataset.company+' | '+type.selectedOptions[0].textContent.replace(/^(?:Operator|Provider)\s+/, '')).slice(0,128);};lead.addEventListener('change',()=>{manual=false;update();updateLeadHandle()});type.addEventListener('change',update);form.addEventListener('submit',()=>{syncParticipants();const button=document.getElementById('ob-create');button.disabled=true;button.textContent='Queueing creation…';});window.addEventListener('pageshow',event=>{if(!event.persisted)return;document.getElementById('ob-create').disabled=false;document.getElementById('ob-create').textContent='Create chat';});}
 document.addEventListener('click',async event=>{
  const link=event.target.closest('[data-invite-chat], #onboarding-open-group');if(link&&window.Telegram?.WebApp?.openTelegramLink){event.preventDefault();window.Telegram.WebApp.openTelegramLink(link.href);return;}
  const groupCopy=event.target.closest('[data-copy-group-invite]');if(groupCopy){event.preventDefault();automaticCopy=false;await copyGroupInvite(true);return;}
  const button=event.target.closest('[data-copy-invite]');if(!button)return;event.preventDefault();automaticCopy=false;const text=button.closest('article').querySelector('textarea');try{await navigator.clipboard.writeText(text.value);button.textContent='Invitation copied';}catch{text.focus();text.select();button.textContent='Selected — copy the text';}
 });
 function manualInvites(invites){
  const section=document.getElementById('onboarding-manual');if(!section)return;section.querySelectorAll('article').forEach(node=>node.remove());section.hidden=true;
  for(const invite of invites||[]){
   if(!/^[a-z][a-z0-9_]{3,31}$/.test(invite.username)||!/^https:\/\/t\.me\/[a-z][a-z0-9_]{3,31}\?text=/.test(invite.url))continue;
   section.hidden=false;const card=document.createElement('article');card.className='ob-invite-card';
   const row=document.createElement('div');row.className='ob-invite-row';const title=document.createElement('strong');title.textContent='@'+invite.username;
   const link=document.createElement('a');link.className='button secondary';link.dataset.inviteChat='';link.href=invite.url;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label','Invite @'+invite.username);link.textContent='Invite ↗';row.append(title,link);
   const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Invitation message';
   const draft=document.createElement('textarea');draft.readOnly=true;draft.value=invite.text;draft.setAttribute('aria-label','Invitation text for @'+invite.username);
   const copy=document.createElement('button');copy.type='button';copy.className='secondary';copy.dataset.copyInvite='';copy.textContent='Copy invitation';details.append(summary,draft,copy);card.append(row,details);section.append(card);
  }
 }
 function bindParticipantPhoto(img){
  const show=()=>{img.hidden=!(img.complete&&img.naturalWidth>0);};
  img.addEventListener('load',show);img.addEventListener('error',()=>{img.hidden=true});show();
 }
 document.querySelectorAll('[data-participant-photo]').forEach(bindParticipantPhoto);
 function addedParticipants(people){
  const section=document.getElementById('onboarding-participants'),list=section?.querySelector('ul');if(!list)return;
  const valid=(people||[]).filter(p=>/^[a-z][a-z0-9_]{3,31}$/.test(p.username)&&typeof p.name==='string'&&p.name.length<=128&&p.photoUrl?.startsWith('/onboarding/participant-photo?job='+box.dataset.id+'&index=')&&/^[0-9]$/.test(p.photoUrl.split('&index=')[1]));
  const signature=JSON.stringify(valid);if(section.dataset.participants===signature)return;section.dataset.participants=signature;list.replaceChildren();section.hidden=false;const empty=document.getElementById('onboarding-participants-empty');if(empty)empty.hidden=Boolean(valid.length);
  for(const person of valid){
   const row=document.createElement('li');row.className='ob-participant';row.dataset.participant=person.username;
   const avatar=document.createElement('span');avatar.className='ob-person-avatar';avatar.setAttribute('aria-hidden','true');
   const initials=document.createElement('span');initials.textContent=person.name.replace(/^@/,'').split(/\s+/).filter(Boolean).map(word=>Array.from(word)[0]).slice(0,2).join('').toUpperCase();
   const image=document.createElement('img');image.dataset.participantPhoto='';image.width=36;image.height=36;image.alt='';image.hidden=true;image.decoding='async';bindParticipantPhoto(image);image.src=person.photoUrl;
   const name=document.createElement('span');name.className='ob-person-name';name.title='@'+person.username;name.textContent=person.name;avatar.append(initials,image);row.append(avatar,name);list.append(row);
  }
 }
 const box=document.getElementById('onboarding-status');if(!box)return;const labels={queued:'Queued',creating:'Creating group',working:'Setting up chat',partial:'Setup incomplete',ready:'Chat ready',uncertain:'Manual check required',cancelled:'Cancelled'};
 const validInviteLink=value=>typeof value==='string'&&!/\s/.test(value)&&/^https:\/\/t\.me\/(?:\+|joinchat\/)[a-zA-Z0-9_-]+$/.test(value);
 const inviteUrl=document.getElementById('onboarding-invite-url'),copyResult=document.getElementById('onboarding-copy-result');
 inviteUrl.addEventListener('keydown',event=>{if(!['Enter',' '].includes(event.key))return;event.preventDefault();automaticCopy=false;void copyGroupInvite(true);});
 let automaticCopy=false,copyInFlight=false,pollInFlight=false;
 if(box.dataset.autoCopy==='true'){
  automaticCopy=true;
  // Consume the creation intent before any asynchronous work or link polling.
  // History removes it from reload/back navigation; session storage also covers a stale URL.
  try{const key='onboarding-invite-copy:'+box.dataset.id;automaticCopy=!window.sessionStorage.getItem(key);window.sessionStorage.setItem(key,'attempted');}catch{}
  try{const url=new URL(window.location.href);url.searchParams.delete('copy');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);}catch{}
 }
 document.addEventListener('copy',()=>{automaticCopy=false});
 async function copyGroupInvite(manual){
  if(copyInFlight||!validInviteLink(inviteUrl?.value))return;
  copyInFlight=true;copyResult.textContent='';
  try{if(typeof navigator.clipboard?.writeText!=='function')throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(inviteUrl.value);copyResult.textContent='Copied';}
  catch{copyResult.textContent='Select the link to copy manually.';if(manual){inviteUrl.focus();inviteUrl.select();}}
  finally{copyInFlight=false;}
 }
 function updateInviteLink(value){
  const valid=validInviteLink(value);document.getElementById('onboarding-link').hidden=!valid;inviteUrl.readOnly=true;inviteUrl.value=valid?value:'';
  const link=document.getElementById('onboarding-open-group');if(link)link.href=valid?value:'';
  if(valid&&automaticCopy){automaticCopy=false;void copyGroupInvite(false);}
 }
 updateInviteLink(inviteUrl.value);
 async function refresh(){if(pollInFlight||document.hidden||['ready','uncertain','cancelled','partial'].includes(box.dataset.state))return;pollInFlight=true;try{const response=await fetch('/onboarding/status?id='+box.dataset.id,{cache:'no-store'});if(!response.ok)return;const data=await response.json();if(data.hasGroup&&Array.isArray(data.addedParticipants))addedParticipants(data.addedParticipants);const created=document.getElementById('onboarding-created-date');if(created&&typeof data.groupCreatedAt==='string'&&!Number.isNaN(Date.parse(data.groupCreatedAt))){created.hidden=false;const time=created.querySelector('time');time.dateTime=data.groupCreatedAt;time.textContent=data.groupCreatedAt;}if(Array.isArray(data.manualInvites))manualInvites(data.manualInvites);box.dataset.state=data.status;document.getElementById('onboarding-state').textContent=labels[data.status]||data.status;box.querySelector('#ob-result-title').textContent=data.hasGroup?(box.dataset.existing==='true'?'Existing chat':'Chat created'):labels[data.status]||data.status;
 const mark=box.querySelector('#ob-result-mark');mark.textContent=data.hasGroup?'✓':data.status==='uncertain'?'!':data.status==='cancelled'?'×':'…';
 document.getElementById('onboarding-state').hidden=data.status==='ready';
 const error=document.getElementById('onboarding-error'),notice=String(data.error||'').replace(/\. Privacy settings or Telegram restrictions may prevent invitations; share the link manually\.$/,'').replace(/^Incomplete steps: /,'Needs attention: ');error.textContent=notice;
 error.hidden=Boolean(data.manualInvites?.length&&notice.startsWith('Needs attention: ')&&notice.slice(17).split(', ').every(item=>data.manualInvites.some(invite=>'@'+invite.username===item)));document.getElementById('onboarding-retry').hidden=data.status!=='partial';updateInviteLink(data.link);}catch{}finally{pollInFlight=false;}}
 setInterval(refresh,3000);refresh();
})();
