import {visibleManager} from './managerVisibility.js';
import {PARTNERSHIP_MANAGERS} from './partnershipManagers.js';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function managerOptions(accounts,selected){
 const remaining=accounts.filter(visibleManager),options=PARTNERSHIP_MANAGERS.map(person=>{const index=remaining.findIndex(a=>String(a.email).toLowerCase()===person.email);const account=index<0?null:remaining.splice(index,1)[0];return {person,account};});
 return options.map(({person,account})=>account?`<option value="${esc(account.userId)}" data-zone="${esc(account.calendar.timeZone)}" data-calendar="${esc(account.email)}" ${account.userId===selected?'selected':''}>${esc(person.name)} · ${esc(person.email)}</option>`:`<option value="" disabled>${esc(person.name)} · ${esc(person.email)}</option>`).join('')+remaining.map(a=>`<option value="${esc(a.userId)}" data-zone="${esc(a.calendar.timeZone)}" data-calendar="${esc(a.email)}" ${a.userId===selected?'selected':''}>${esc(a.displayName||a.email)}</option>`).join('');
}
export function directorySuggestions(mode,people=PARTNERSHIP_MANAGERS){
 const data=JSON.stringify(people).replaceAll('<','\\u003c');
 return `<script>(${suggestionsClient.toString()})(${data},${JSON.stringify(mode)});</script>`;
}
function suggestionsClient(people,mode){
 const selector=mode==='email'?'input[name="guests"]':'#ob-members',id='staff-contact-suggestions-'+mode;
 let popup=document.createElement('div');popup.id=id;popup.hidden=true;popup.setAttribute('role','group');popup.style.cssText='position:absolute;z-index:1000;background:var(--bg,#fff);color:var(--text,#222);border:1px solid var(--line,#ccc);border-radius:8px;box-shadow:0 8px 24px #0002;max-height:260px;overflow:auto';document.body.append(popup);let active;
 const norm=s=>s.trim().toLowerCase().replace(/^@/,'');
 function close(){popup.hidden=true;if(active)active.setAttribute('aria-expanded','false');}
 function show(input){
  active=input;const value=input.value,match=value.match(/^(.*[,;\n]\s*)?([^,;\n]*)$/s),prefix=match?.[1]||'',query=norm(match?.[2]||'');
  popup.replaceChildren();if(!query){close();return;}
  const used=new Set(prefix.split(/[,;\s]+/).map(norm));
  const matches=people.filter(p=>[p.name,p.email,...p.telegram].some(v=>norm(v).includes(query))&&!(mode==='email'?[p.email]:p.telegram).some(v=>used.has(norm(v))));
  for(const person of matches){const button=document.createElement('button');button.type='button';button.textContent=person.name+' · '+(mode==='email'?person.email:person.telegram[0]);button.style.cssText='display:block;text-align:left;width:100%;background:transparent;color:inherit;border:0;border-radius:0;margin:0;padding:12px;font-size:13px;min-height:44px';button.addEventListener('pointerdown',event=>event.preventDefault());button.addEventListener('click',()=>{input.value=prefix+(mode==='email'?person.email:person.telegram.find(t=>norm(t).includes(query))||person.telegram[0]);input.dispatchEvent(new Event('input',{bubbles:true}));close();input.focus();});popup.append(button);}
  if(!matches.length){close();return;}
  const rect=input.getBoundingClientRect();popup.style.left=(rect.left+scrollX)+'px';popup.style.top=(rect.bottom+scrollY+4)+'px';popup.style.width=rect.width+'px';popup.hidden=false;input.setAttribute('aria-expanded','true');input.setAttribute('aria-controls',id);input.setAttribute('autocomplete','off');
 }
 document.addEventListener('input',event=>{if(event.target.matches(selector))show(event.target);});
 document.addEventListener('focusin',event=>{if(event.target.matches(selector))show(event.target);else if(!popup.contains(event.target))close();});
 document.addEventListener('pointerdown',event=>{if(!popup.contains(event.target)&&event.target!==active)close();});
 document.addEventListener('keydown',event=>{if(popup.hidden)return;if(event.key==='Escape'){close();return;}if(event.key==='ArrowDown'){event.preventDefault();(popup.contains(document.activeElement)?document.activeElement.nextElementSibling:popup.firstElementChild)?.focus();}if(event.key==='ArrowUp'){event.preventDefault();document.activeElement.previousElementSibling?.focus();}if(event.key==='Enter'&&popup.contains(document.activeElement)){event.preventDefault();document.activeElement.click();}});
 
}



