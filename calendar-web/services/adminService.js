import fs from 'node:fs';import path from 'node:path';
export const ROLES={admin:'Administrator',partnership:'Partnership Manager',leadgen:'Leadgen',promoter:'Promoter'};
export function atomicJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
export class AdminSettings{
 constructor(file='',bootstrap=[]){this.file=file;this.bootstrap=bootstrap.map(String);this.memory={users:{}};}
 read(){const value=this.file&&fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):this.memory;const users={...value.users};for(const id of this.bootstrap)users[id]={...users[id],role:'admin',blocked:false};return {remindersEnabled:true,reminderMinutes:15,...value,users};}
 save(value){if(this.file)atomicJson(this.file,value);else this.memory=structuredClone(value);}
 isAdmin(id){id=String(id);return this.bootstrap.includes(id)||(!this.read().users[id]?.blocked&&this.read().users[id]?.role==='admin');}
 role(id){return this.isAdmin(id)?'admin':this.read().users[String(id)]?.role||null;}
 blocked(id){return !this.bootstrap.includes(String(id))&&Boolean(this.read().users[String(id)]?.blocked);}
 managed(id){return Boolean(this.role(id));}
 requireAdmin(id){if(!this.isAdmin(id))throw new Error('Administrative access denied.');}
 setUser(actor,id,patch){
  this.requireAdmin(actor);id=String(id);if(!/^\d{1,16}$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<1)throw new Error('Invalid Telegram ID.');
  if(patch.role!==undefined&&!Object.hasOwn(ROLES,patch.role))throw new Error('Unknown role.');
  if(this.bootstrap.includes(id)&&(patch.blocked||patch.role&&patch.role!=='admin'))throw new Error('The primary administrator cannot be changed.');
  const value=this.read();value.users[id]={...value.users[id],...patch};value.audit=[...(value.audit||[]),{at:new Date().toISOString(),actor:String(actor),target:id,change:patch}].slice(-200);this.save(value);
 }
 setReminders(actor,patch){this.requireAdmin(actor);if(patch.reminderMinutes!==undefined&&![5,15,30,60].includes(patch.reminderMinutes))throw new Error('Choose 5, 15, 30 or 60 minutes.');const value=this.read();if(patch.reminderMinutes!==undefined)value.reminderMinutes=patch.reminderMinutes;if(patch.remindersEnabled!==undefined)value.remindersEnabled=Boolean(patch.remindersEnabled);value.audit=[...(value.audit||[]),{at:new Date().toISOString(),actor:String(actor),change:patch}].slice(-200);this.save(value);}
 setMuted(id,muted){const value=this.read();value.users[String(id)]={...value.users[String(id)],muted:Boolean(muted)};this.save(value);}
}
