import fs from 'node:fs';import path from 'node:path';import {createHash,randomBytes} from 'node:crypto';import {atomicJson} from './adminService.js';
export const ONBOARDING_TYPES={'operator-biz':'Operator Biz','operator-tech':'Operator Tech','provider-biz':'Provider Biz','provider-tech':'Provider Tech'};
export function canOnboard(lead,actor,settings){return Boolean(lead&&!lead.deletedAt&&!settings.users?.[actor]?.blocked&&settings.users?.[actor]?.role!=='promoter'&&(settings.users?.[actor]?.role==='admin'||lead.owner===actor+':'+actor||String(lead.assigneeId||'')===String(actor)));}
export function manualInvitations(job){
 if(!job.group||!['partial','ready'].includes(job.status)||!/^https:\/\/t\.me\/(?:\+|joinchat\/)[a-zA-Z0-9_-]+$/.test(job.link||''))return [];
 const text='Привет! Создали чат для онбординга «'+job.title+'». Присоединяйся, пожалуйста:\n'+job.link;
 return (job.participants||[]).filter(username=>/^[a-z][a-z0-9_]{3,31}$/.test(username)&&!job.steps?.invited?.includes(username)).map(username=>({username,text,url:'https://t.me/'+username+'?text='+encodeURIComponent(text)}));
}
export class OnboardingJobs{
 constructor(directory){this.directory=directory;fs.mkdirSync(directory,{recursive:true,mode:0o700});}
 file(id){if(!/^[a-f0-9]{32}$/.test(id))throw new Error('Неверный чат.');return path.join(this.directory,id+'.json');}
 read(id){const file=this.file(id);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
 save(job){atomicJson(this.file(job.id),job);return job;}
 all(){return fs.readdirSync(this.directory).filter(n=>/^[a-f0-9]{32}\.json$/.test(n)).map(n=>this.read(n.slice(0,-5))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 public(job){const {group,introRandomId,...value}=job;return {...value,manualInvites:manualInvitations(job),hasGroup:Boolean(group),groupId:group?.id};}
 create(input,lead,actor){
  if(input.confirm!=='yes'||input.leadId!==lead.id||!Object.hasOwn(ONBOARDING_TYPES,input.type))throw new Error('Выберите лида, тип чата и подтвердите создание.');
  const title=String(input.title||'').trim(),intro=String(input.intro||'').trim();if(!title||title.length>128||/[\x00-\x1f]/.test(title)||intro.length>3000)throw new Error('Название: 1–128 символов; сообщение: до 3000 символов.');
  const participants=[...new Set((input.participants||[]).map(v=>String(v).trim().replace(/^@/, '').toLowerCase()).filter(Boolean))];if(participants.length>10||participants.some(v=>!/^[a-z][a-z0-9_]{3,31}$/.test(v)))throw new Error('Укажите до 10 Telegram username, например @ivan, через запятую.');
  const id=createHash('sha256').update(lead.id+'|'+input.type).digest('hex').slice(0,32),old=this.read(id);if(old)return old;
  return this.save({id,leadId:lead.id,leadName:lead.fields.fullName,company:lead.fields.company,type:input.type,title,participants,intro,actor:String(actor),managerId:input.managerId||null,status:'queued',createdAt:new Date().toISOString(),steps:{invited:[]},introRandomId:BigInt('0x'+randomBytes(7).toString('hex')).toString(),audit:[{at:new Date().toISOString(),action:'confirmed',actor:String(actor)}]});
 }
 retry(id){const job=this.read(id);if(job?.status!=='partial')throw new Error('Повтор доступен только для незавершённой настройки созданной группы.');job.status='queued';job.error=null;return this.save(job);}
}
export async function runOnboarding(store,id,api,expectedAccount){
 if(String(api.accountId)!==String(expectedAccount))throw new Error('Подключён другой Telegram-аккаунт.');const job=store.read(id);if(!job||['ready','uncertain','cancelled'].includes(job.status))return;
 if(!job.group&&['creating','working'].includes(job.status)){job.status='uncertain';job.error='Создание группы не подтверждено. Проверьте Telegram вручную; автоматический повтор отключён.';store.save(job);return;}
 const cooldownFile=path.join(store.directory,'cooldown.json');if((fs.existsSync(cooldownFile)?JSON.parse(fs.readFileSync(cooldownFile,'utf8')).until:0)>Date.now()||job.retryAt>Date.now())return;
 function cooldown(error){const seconds=Number(error.seconds)||0;if(seconds>0){job.retryAt=Date.now()+seconds*1000;atomicJson(cooldownFile,{until:job.retryAt});}return seconds>0;}
 if(!job.group){job.status='creating';store.save(job);try{job.group=await api.create(job.title);if(!job.group?.id||!job.group.accessHash)throw new Error('Missing group');store.save(job);}catch(error){cooldown(error);job.status='uncertain';job.error='Telegram не подтвердил создание. Группа могла появиться — проверьте аккаунт перед новым действием.';store.save(job);return;}}
 job.status='working';store.save(job);const failures=[];
 async function step(key,operation){if(job.steps[key]||job.retryAt>Date.now())return;try{await operation();job.steps[key]=true;store.save(job);}catch(error){failures.push(key);cooldown(error);}}
 await step('bot',()=>api.bot(job.group));
 for(const handle of job.participants)if(!(job.retryAt>Date.now())&&!job.steps.invited.includes(handle))try{await api.invite(job.group,handle);job.steps.invited.push(handle);store.save(job);}catch(error){failures.push('@'+handle);if(cooldown(error))break;}
 await step('link',async()=>{const result=await api.link(job.group);if(!/^https:\/\/t\.me\/(\+|joinchat\/)/.test(result.link||''))throw new Error('Invite not confirmed');job.link=result.link;});
 if(job.intro)await step('intro',()=>api.intro(job.group,job.intro,job.introRandomId));
 job.status=failures.length?'partial':'ready';job.error=failures.length?'Не завершены шаги: '+failures.join(', ')+'. Приватность или ограничения Telegram могут запрещать приглашение; можно передать ссылку вручную.':null;job.updatedAt=new Date().toISOString();store.save(job);
}
