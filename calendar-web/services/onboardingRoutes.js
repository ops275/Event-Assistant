import {addedParticipants,createParticipantPhotoLoader} from './onboardingParticipantPhotos.js';
import {PARTNERSHIP_MANAGERS} from './partnershipManagers.js';
import {directorySuggestions} from './staffDirectory.js';
import fs from 'node:fs';import {randomBytes} from 'node:crypto';import {ONBOARDING_TYPES,canOnboard,manualInvitations,onboardingAvatarFile} from './onboardingService.js';import {sameAppOrigin} from './requestOrigin.js';
import {ONBOARDING_TEMPLATE_PACKS} from './onboardingTemplates.js';
const avatarRoutes=Object.freeze({'/onboarding/avatar/operator':onboardingAvatarFile('operator-biz'),'/onboarding/avatar/provider':onboardingAvatarFile('provider-biz')});
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const leadTelegram=lead=>{const value=String(lead?.fields?.telegram??'').trim(),match=value.match(/^(?:@|https:\/\/t\.me\/)?([a-z][a-z0-9_]{3,31})$/i);return match?'@'+match[1]:'';};
const telegramUsername=value=>{const match=String(value??'').trim().match(/^@?([a-z][a-z0-9_]{3,31})$/i);return match?'@'+match[1]:'';};
const managerChoices=(settings,knownUsers)=>{
 const choices=[],seen=new Set();
 const add=person=>{const telegram=telegramUsername(person.telegram),key=telegram.toLowerCase();if(telegram&&!seen.has(key)){seen.add(key);choices.push({...person,telegram});}};
 for(const [id,access] of Object.entries(settings.users||{})){const person=knownUsers[id];if(!access?.blocked&&['admin','partnership'].includes(access?.role)&&person)add({id,name:String(person.name||person.username||id),telegram:person.username});}
 for(const person of PARTNERSHIP_MANAGERS){if(['daria','oleksandr'].includes(person.id))continue;
  const aliases=person.telegram.map(telegramUsername).filter(Boolean);
  if(Object.entries(knownUsers).some(([id,user])=>settings.users?.[id]?.blocked&&aliases.some(handle=>handle.toLowerCase()===telegramUsername(user.username).toLowerCase())))continue;
  for(const telegram of aliases)add({id:'directory:'+person.id+':'+telegram.toLowerCase(),name:person.name,telegram,email:person.email});
 }
 return choices.sort((a,b)=>a.name.localeCompare(b.name)||a.telegram.localeCompare(b.telegram));
};
const states={queued:'Queued',creating:'Creating group',working:'Setting up chat',partial:'Setup incomplete',ready:'Chat ready',uncertain:'Manual check required',cancelled:'Cancelled'};
const validInviteLink=value=>typeof value==='string'&&!/\s/.test(value)&&/^https:\/\/t\.me\/(?:\+|joinchat\/)[a-zA-Z0-9_-]+$/.test(value);
function groupInviteControls(job){const link=validInviteLink(job.link)?job.link:'';return `<div id="onboarding-link" ${link?'':'hidden'}><a id="onboarding-open-group" class="button" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open group</a><label for="onboarding-invite-url">Group invite link</label><div class="ob-copy-field"><input id="onboarding-invite-url" data-copy-group-invite value="${esc(link)}" readonly role="button" aria-label="Group invite link. Click to copy" title="Click to copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></div><p id="onboarding-copy-result" role="status" aria-live="polite"></p></div>`;}
function statusNotice(job){return String(job.error||'').replace(/\. Privacy settings or Telegram restrictions may prevent invitations; share the link manually\.$/,'').replace(/^Incomplete steps: /,'Needs attention: ');}
const resultStyles=`
.ob-result #onboarding-participants{text-align:left;margin:20px 0}
.ob-result #onboarding-participants h2{font-size:13px;margin:0 0 10px}
.ob-result .ob-participant-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 10px;list-style:none;padding:0;margin:0}
.ob-result .ob-participant{display:flex;align-items:center;gap:8px;min-width:0}
.ob-result .ob-person-avatar{position:relative;display:grid;place-items:center;flex:0 0 36px;width:36px;height:36px;border-radius:50%;background:var(--surface);font-size:12px;font-weight:600;overflow:hidden}
.ob-result .ob-person-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ob-result .ob-person-name{min-width:0;font-size:12px;line-height:1.4;overflow-wrap:anywhere}
@media(max-width:360px){.ob-result .ob-participant-list{grid-template-columns:minmax(0,1fr)}}
body:has(.ob-result)>header{display:none}
.ob-result{max-width:440px;margin:28px auto;padding:32px 24px 24px;border:1px solid var(--line);border-radius:20px;background:var(--bg);text-align:center}
.ob-result [hidden]{display:none!important}
.ob-result .ob-mark{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 20px;border-radius:50%;background:color-mix(in srgb,#22a06b 14%,var(--bg));color:#22a06b;font-size:32px}
.ob-result[data-state="uncertain"] .ob-mark,.ob-result[data-state="cancelled"] .ob-mark{background:var(--surface);color:var(--text)}
.ob-result h1{font-size:28px;font-weight:700;margin-bottom:12px;letter-spacing:-.7px}
.ob-result .ob-group-title{font-size:16px;line-height:1.5;overflow-wrap:anywhere;margin-bottom:14px}
.ob-result #onboarding-state{display:inline-block;font-size:12px;padding:4px 10px;border-radius:20px;background:var(--surface);margin-bottom:22px}
.ob-result[data-state="partial"] #onboarding-state{background:color-mix(in srgb,#d49322 14%,var(--bg));color:var(--text)}
.ob-result #onboarding-error{font-size:13px;line-height:1.5;overflow-wrap:anywhere;text-align:left;margin:0 0 18px}
.ob-result #onboarding-error:empty,.ob-result #onboarding-copy-result:empty{display:none}
.ob-result #onboarding-open-group,.ob-result .ob-close{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;margin:0;font-size:14px}
.ob-result #onboarding-link{text-align:left}
.ob-result #onboarding-link label{margin:20px 0 8px;font-size:12px}
.ob-result .ob-copy-field{position:relative}
.ob-result #onboarding-invite-url{font:inherit;font-size:16px;min-height:48px;padding-right:44px;cursor:pointer;background:var(--surface)}
.ob-result .ob-copy-field svg{position:absolute;right:14px;top:15px;width:18px;height:18px;pointer-events:none}
.ob-result #onboarding-copy-result{font-size:12px;color:var(--text);margin-top:8px}
.ob-result #onboarding-manual{text-align:left;border-top:1px solid var(--line);padding-top:20px;margin-top:24px}
.ob-result #onboarding-manual h2{font-size:15px;margin-bottom:12px}
.ob-result .ob-invite-card+.ob-invite-card{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
.ob-result .ob-invite-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.ob-result .ob-invite-row strong{font-size:14px;overflow-wrap:anywhere;min-width:0}
.ob-result .ob-invite-row a{flex-shrink:0;min-height:40px;margin:0;padding:9px 16px;font-size:13px}
.ob-result details{text-align:left;font-size:12px;margin-top:12px}
.ob-result summary{cursor:pointer;overflow-wrap:anywhere}
.ob-result textarea{display:block;width:100%;min-height:132px;resize:vertical;font:inherit;font-size:16px;margin:12px 0 0;padding:12px;background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:8px}
.ob-result .ob-meta{border-top:1px solid var(--line);margin-top:24px;padding-top:4px;text-align:left}
.ob-result .ob-meta p{margin-top:10px;overflow-wrap:anywhere}
.ob-result .ob-template-message{border:1px solid var(--line);padding:12px;border-radius:8px;margin:12px 0}
.ob-result .ob-template-preview{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
.ob-result .ob-template-message p{margin:0 0 8px}
.ob-result .ob-message-number{font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.ob-result #onboarding-retry{margin-top:20px}.ob-result #onboarding-retry button{width:100%;margin:0;min-height:44px;font-size:13px}
.ob-result .ob-close{margin-top:20px}.ob-result .ob-back{display:inline-block;margin-top:16px;font-size:12px;text-decoration:none}
@media(max-width:360px){.ob-result{padding:28px 18px 20px;margin:16px auto}.ob-result h1{font-size:26px}}
`;
function messagePreview(message,index,title=''){return `<article class="ob-template-message"><p class="ob-message-number">Message ${index+1}</p><p><strong>${title?esc(title)+' · ':''}${esc(message.name)}</strong></p><div class="ob-template-preview">${message.type==='video'?'<p class="hint">Attached video</p>':''}${message.html}</div></article>`;}
function templateChoices(){return `<fieldset class="ob-templates"><legend>Intro Messages Templates</legend><p class="hint">Choose any packs to send all their messages in the listed order. Nothing is selected by default.</p><p id="ob-template-empty" class="hint">No Operator templates are available yet.</p>${ONBOARDING_TEMPLATE_PACKS.map(pack=>`<article data-template-category="${pack.category}" hidden><label class="ob-template-choice"><input type="checkbox" name="introTemplates" value="${pack.id}" disabled><span>${esc(pack.name)} · ${pack.messages.length} messages</span></label><details><summary>Preview messages</summary>${pack.messages.map((message,index)=>messagePreview(message,index)).join('')}</details></article>`).join('')}<p class="hint">Introduce Marketplace includes two attached videos: the overview, then Provider economics.</p></fieldset>`;}
function jobIntroductions(job){return job.introMessages?.length?`<details><summary>Intro Messages Templates · ${job.introMessages.length} messages</summary>${job.introMessages.map((message,index)=>messagePreview(message,index,message.packName)).join('')}</details>`:'<p class="hint">No introductory messages are selected.</p>';}
export function renderManualInvitations(job){const invites=manualInvitations(job);return `<section id="onboarding-manual" ${invites.length?'':'hidden'}><h2>Invite personally</h2>${invites.map(i=>`<article class="ob-invite-card"><div class="ob-invite-row"><strong>@${esc(i.username)}</strong><a class="button secondary" data-invite-chat href="${esc(i.url)}" aria-label="Invite @${esc(i.username)}" target="_blank" rel="noopener noreferrer">Invite ↗</a></div><details><summary>Invitation message</summary><textarea aria-label="Invitation text for @${esc(i.username)}" readonly>${esc(i.text)}</textarea><button type="button" class="secondary" data-copy-invite>Copy invitation</button></details></article>`).join('')}</section>`;}
export function renderAddedParticipants(job,users={}){
 const participants=addedParticipants(job,users);
 return '<section id="onboarding-participants" '+(job.group?'':'hidden')+' aria-label="Added participants"><h2>Added participants</h2><p id="onboarding-participants-empty" class="hint" '+(participants.length?'hidden':'')+'>No participants have been confirmed added yet.</p><ul class="ob-participant-list">'+participants.map(person=>{
  const initials=person.name.replace(/^@/,'').split(/\s+/).filter(Boolean).map(word=>Array.from(word)[0]).slice(0,2).join('').toUpperCase();
  return '<li class="ob-participant" data-participant="'+esc(person.username)+'"><span class="ob-person-avatar" aria-hidden="true"><span>'+esc(initials)+'</span><img data-participant-photo src="'+esc(person.photoUrl)+'" width="36" height="36" alt="" decoding="async" hidden></span><span class="ob-person-name" title="@'+esc(person.username)+'">'+esc(person.name)+'</span></li>';
 }).join('')+'</ul></section>';
}
async function body(req){if(!String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'))throw new Error('Invalid form format.');let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>12000)throw new Error('Request is too large.');}return new URLSearchParams(raw);}
export function createOnboardingRoutes({jobs,admin,leads,users,health,participantPhoto=createParticipantPhotoLoader()}){
 async function route(req,res,url,identity,reply,origins){
  if(!url.pathname.startsWith('/onboarding'))return false;
  if(!identity?.userId){reply(res,403,'Authentication required.');return true;}
  const actor=String(identity.userId),settings=admin.read(),eligible=leads().filter(l=>l.fields?.fullName&&l.fields?.company&&canOnboard(l,actor,settings));identity.onboardingCsrf||=randomBytes(24).toString('hex');
  const allowed=job=>job&&eligible.some(l=>l.id===job.leadId);
  if(req.method==='POST'){
   if(!sameAppOrigin(req,origins)){reply(res,403,'Request origin is not allowed.');return true;}
   try{
    const input=await body(req);if(input.get('csrf')!==identity.onboardingCsrf){reply(res,403,'This form expired. Open Onboarding again.');return true;}
    let job,copyInvite=false;
    if(url.pathname==='/onboarding/create'){
     const lead=eligible.find(l=>l.id===input.get('leadId'));if(!lead){reply(res,403,'Only the lead creator, assigned manager or administrator can create a chat.');return true;}
     if(!health().ready)throw new Error('The group creation account is unavailable. Contact an administrator.');
     const managerId=actor;
     const selectedManagers=input.getAll('selectedManagers'),allowedManagers=new Set(managerChoices(settings,users()).map(person=>person.telegram.toLowerCase()));
     const primaryManager=String(input.get('primaryManager')||'').trim();
     if((primaryManager&&!allowedManagers.has(primaryManager.toLowerCase()))||selectedManagers.some(handle=>!allowedManagers.has(handle.toLowerCase())))throw new Error('Unknown manager selection. Reload the form.');
     const participants=[...(primaryManager?[primaryManager]:[]),...selectedManagers,...(input.get('participants')||'').split(/[\s,;]+/).filter(Boolean)];if(managerId){const username=users()[managerId]?.username;if(username)participants.push(username);}const telegram=String(input.get('leadTelegram')||'').trim();if(telegram)participants.push(telegram);
     const before=new Set(jobs.all().map(previous=>previous.id));
     job=jobs.create({...Object.fromEntries(input),introTemplates:input.getAll('introTemplates'),managerId,participants},lead,actor);copyInvite=!before.has(job.id);
    }else if(url.pathname==='/onboarding/retry'){
     job=jobs.read(input.get('id')||'');if(!allowed(job)){reply(res,403,'Access to this chat denied.');return true;}job=jobs.retry(job.id);
    }else throw new Error('Unknown action.');
    res.writeHead(303,{Location:'/onboarding?job='+job.id+(copyInvite?'&copy=1':''),'Cache-Control':'no-store'});res.end();return true;
   }catch(error){reply(res,400,`<h2>Action failed</h2><p>${esc(error.message)}</p><a href="/onboarding">Back to onboarding</a>`);return true;}
  }
  if(req.method!=='GET'){reply(res,405,'Method not allowed.');return true;}
  if(url.pathname==='/onboarding/participant-photo'){
   const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'};
   let job;try{job=jobs.read(url.searchParams.get('job')||'');}catch{}
   if(!allowed(job)){res.writeHead(403,headers);res.end();return true;}
   const index=url.searchParams.get('index');
   if(!/^(?:0|[1-9])$/.test(index||'')||!addedParticipants(job).some(p=>p.photoUrl.endsWith('&index='+index))){res.writeHead(404,headers);res.end();return true;}
   let image;try{image=await participantPhoto(job,Number(index),users());}catch{}
   if(!image){res.writeHead(404,headers);res.end();return true;}
   res.writeHead(200,{...headers,'Content-Type':'image/jpeg','Content-Length':image.length});res.end(image);return true;
  }
  if(Object.hasOwn(avatarRoutes,url.pathname)){

   const image=fs.readFileSync(avatarRoutes[url.pathname]);res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':image.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});res.end(image);return true;
  }
  if(url.pathname==='/onboarding/status'){
   let job;try{job=jobs.read(url.searchParams.get('id')||'');}catch{}
   if(!allowed(job)){reply(res,403,'Chat access denied.');return true;}res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({...jobs.public(job),addedParticipants:addedParticipants(job,users())}));return true;
  }
  if(url.pathname!=='/onboarding'){reply(res,404,'Page not found.');return true;}
  let job;try{job=jobs.read(url.searchParams.get('job')||'');}catch{}
  const existing=jobs.all().filter(allowed),csrf=identity.onboardingCsrf;
  if(job){
   if(!allowed(job)){reply(res,403,'Access to this chat denied.');return true;}
   const notice=statusNotice(job),hasGroup=Boolean(job.group),complete=job.status==='ready',invites=manualInvitations(job),existingResult=!job.operationVersion||url.searchParams.get('copy')!=='1';
   const onlyInvites=invites.length&&notice.startsWith('Needs attention: ')&&notice.slice(17).split(', ').every(item=>invites.some(invite=>'@'+invite.username===item));
   reply(res,200,`<style>${resultStyles}</style><section id="onboarding-status" class="ob-result" data-id="${job.id}" data-state="${job.status}" data-existing="${existingResult}" data-auto-copy="${url.searchParams.get('copy')==='1'}" aria-labelledby="ob-result-title"><div id="ob-result-mark" class="ob-mark" aria-hidden="true">${hasGroup?'✓':job.status==='uncertain'?'!':job.status==='cancelled'?'×':'…'}</div><h1 id="ob-result-title">${hasGroup?(existingResult?'Existing chat':'Chat created'):states[job.status]||job.status}</h1><p class="ob-group-title">${esc(job.title)}</p><p id="onboarding-state" role="status" aria-live="polite" ${complete?'hidden':''}>${states[job.status]||job.status}</p><p id="onboarding-error" ${onlyInvites?'hidden':''}>${esc(notice)}</p>${groupInviteControls(job)}${renderAddedParticipants(job,users())}${renderManualInvitations(job)}<div class="ob-meta"><details><summary>Chat details</summary><p>${esc(job.leadName)} · ${esc(job.company)} · ${ONBOARDING_TYPES[job.type]}</p><p>Creation requested: <time datetime="${esc(job.createdAt)}">${esc(job.createdAt)}</time></p><p id="onboarding-created-date" ${job.group?.createdAt?'':'hidden'}>Created in Telegram: <time datetime="${esc(job.group?.createdAt||'')}">${esc(job.group?.createdAt||'')}</time></p><p>Participants: ${job.participants.map(h=>'@'+esc(h)).join(', ')||'invite by link'}</p>${job.introMessages?.length?jobIntroductions(job):''}</details></div><form id="onboarding-retry" method="POST" action="/onboarding/retry" ${job.status==='partial'?'':'hidden'}><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="id" value="${job.id}"><button class="secondary">Retry setup</button></form>${job.status==='uncertain'?'<p class="ob-uncertain">Check Telegram for the group before creating another chat.</p>':''}<button id="close-assistant" type="button" class="secondary ob-close">Close Window</button><a class="ob-back" href="/onboarding">Back to leads and chats</a></section><script src="/onboarding-ui.js" defer></script>`);return true;
  }
  const knownUsers=users(),manager=knownUsers[actor],managerName=identity.name||manager?.name||(manager?.username?'@'+manager.username:actor),teamManagers=managerChoices(settings,knownUsers);
  const chosen=eligible.find(l=>l.id===url.searchParams.get('lead'))||eligible[0];
  reply(res,200,`<style>.ob-templates{border:1px solid var(--line);border-radius:9px;margin:20px 0;padding:16px;min-width:0}.ob-templates legend,.ob-managers legend{font-weight:600}.ob-template-choice,.ob-manager-choice{display:flex;align-items:flex-start;gap:10px;margin:12px 0}.ob-template-choice input,.ob-manager-choice input{width:20px;min-height:20px;flex:0 0 20px}.ob-template-message{border:1px solid var(--line);border-radius:8px;padding:12px;margin:12px 0}.ob-message-number{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.ob-template-preview{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;margin:8px 0 0}.ob-template-preview a{overflow-wrap:anywhere}.ob-title{font-size:23px;letter-spacing:-.5px}.ob-note{background:var(--surface);padding:12px;border-radius:9px;font-size:12px;margin:16px 0}.ob-managers{border:0;margin:12px 0 20px;padding:0;min-width:0}.ob-confirm{display:flex;align-items:flex-start;gap:10px;margin:20px 0;font-size:12px}.ob-confirm input{width:20px;min-height:20px;margin-top:2px;flex:0 0 20px}.ob-history a{display:block;padding:12px 0;border-bottom:1px solid var(--line);text-decoration:none;overflow-wrap:anywhere}@media(max-width:650px){#onboarding-form input,#onboarding-form select,#onboarding-form textarea{font-size:16px;min-width:0}#onboarding-form .row{grid-template-columns:minmax(0,1fr)}#onboarding-form input[type=checkbox]{min-height:20px}.ob-title{font-size:22px}}</style><h1 class="ob-title">New Onboarding Chat</h1>${eligible.length?`<form id="onboarding-form" method="POST" action="/onboarding/create"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="operationId" value="${randomBytes(16).toString('hex')}"><label for="ob-lead">Lead</label><select id="ob-lead" name="leadId" required>${eligible.map(l=>`<option value="${esc(l.id)}" data-company="${esc(l.fields.company)}" data-telegram="${esc(leadTelegram(l))}" ${chosen?.id===l.id?'selected':''}>${esc(l.fields.fullName)} · ${esc(l.fields.company)}</option>`).join('')}</select><label for="ob-lead-telegram">Lead · Telegram username</label><input id="ob-lead-telegram" name="leadTelegram" value="${esc(leadTelegram(chosen))}" placeholder="@username" maxlength="33" pattern="@?[A-Za-z][A-Za-z0-9_]{3,31}" autocomplete="off" type="text" style="display:block;box-sizing:border-box;width:100%;min-height:48px;padding:12px;border:1px solid var(--line,#cbd5e1);border-radius:8px;background:var(--bg,#fff);color:var(--text,#111);font-size:16px;-webkit-appearance:none"><label for="ob-type">Chat type</label><select id="ob-type" name="type">${Object.entries(ONBOARDING_TYPES).map(([id,title])=>`<option value="${id}">${title}</option>`).join('')}</select><p style="display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin:16px 0"><img id="ob-avatar" src="/onboarding/avatar/operator" alt="Operator group avatar" width="88" height="88" style="display:block;border-radius:50%;object-fit:cover"><span class="hint">Group Avatar white for Operators / black for Providers</span></p><label for="ob-title" style="margin-top:0">Group title</label><input id="ob-title" name="title" value="${esc(('qooob × '+chosen.fields.company+' | Biz').slice(0,128))}" maxlength="128" required><label for="ob-manager">Manager</label><select id="ob-manager" name="primaryManager" data-creator-telegram="${esc(telegramUsername(manager?.username))}"><option value="">Choose a manager</option>${teamManagers.map(person=>`<option value="${esc(person.telegram)}" data-telegram="${esc(person.telegram)}" ${person.telegram.toLowerCase()===telegramUsername(manager?.username).toLowerCase()?'selected':''}>${esc(person.name)} · ${esc(person.telegram)}</option>`).join('')}</select><p class="hint">Created by ${esc(managerName)}. The creator remains a participant for ownership transfer.</p><label for="ob-members">Other participants · Telegram username</label><input id="ob-members" name="participants" value="${esc([...new Set([telegramUsername(manager?.username),...teamManagers.map(person=>person.telegram)].filter(Boolean).map(handle=>handle.toLowerCase()))].filter(handle=>handle!==leadTelegram(chosen).toLowerCase()).join(', '))}" placeholder="@ivan, @anna" maxlength="500"><p class="hint">Up to 10 Telegram usernames, including the lead and manager; the bot is added separately. If Telegram prevents adding them, share the link.</p><fieldset class="ob-managers"><legend>Managers</legend>${teamManagers.map(person=>`<label class="ob-manager-choice"><input type="checkbox" name="selectedManagers" value="${esc(person.telegram)}" data-manager-telegram="${esc(person.telegram)}" checked><span>${esc(person.name)} · ${esc(person.telegram)}</span></label>`).join('')||'<p class="hint">No managers with a Telegram username are available.</p>'}</fieldset>${templateChoices()}<label class="ob-confirm"><input type="checkbox" name="confirm" value="yes" required><span>I confirm that I have reviewed and verified all group settings.</span></label><button id="ob-create" ${health().ready?'':'disabled'}>Create chat</button><p class="hint">Each new form creates a new chat. Resubmitting this form resumes the same operation. Open a previous chat below to retry its setup.</p></form>`:'<p>No eligible leads. Fill in the name and company; only the creator, assigned manager or administrator can create a chat.</p>'}<section class="section ob-history"><h2>Created chats</h2>${existing.slice(0,30).map(j=>`<a href="/onboarding?job=${j.id}">${esc(j.title)}</a>`).join('')||'<p class="hint">No chats yet.</p>'}</section>${directorySuggestions('telegram',PARTNERSHIP_MANAGERS.filter(person=>!['daria','oleksandr'].includes(person.id)).flatMap(person=>person.telegram.map(handle=>({...person,telegram:[handle]}))))}<script src="/onboarding-ui.js" defer></script>`);return true;
 }
 return {route};
}
