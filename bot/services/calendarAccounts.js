import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {atomicJson} from './adminService.js';
export class CalendarAccounts{
 constructor(directory){this.directory=directory;fs.mkdirSync(directory,{recursive:true,mode:0o700});const keyFile=path.join(directory,'.key');if(!fs.existsSync(keyFile))fs.writeFileSync(keyFile,crypto.randomBytes(32),{flag:'wx',mode:0o600});this.key=fs.readFileSync(keyFile);if(this.key.length!==32)throw new Error('Invalid calendar key');}
 id(id){id=String(id);if(!/^\d{1,16}$/.test(id)||Number(id)<1)throw new Error('Invalid Telegram user');return id;}
 write(name,value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(name));const body=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);atomicJson(path.join(this.directory,name+'.enc'),{iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body:body.toString('base64')});}
 read(name){const file=path.join(this.directory,name+'.enc');if(!fs.existsSync(file))return null;const data=JSON.parse(fs.readFileSync(file,'utf8')),decipher=crypto.createDecipheriv('aes-256-gcm',this.key,Buffer.from(data.iv,'base64'));decipher.setAAD(Buffer.from(name));decipher.setAuthTag(Buffer.from(data.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.body,'base64')),decipher.final()]).toString());}
 begin(userId,browser,redirect,now=Date.now()){
  const state=crypto.randomBytes(32).toString('hex'),nonce=crypto.randomBytes(24).toString('hex'),verifier=crypto.randomBytes(48).toString('base64url');
  const value={state,nonce,verifier,userId:this.id(userId),browser:crypto.createHash('sha256').update(browser).digest('hex'),redirect,expires:now+600000};this.write('state-'+state,value);
  return {...value,challenge:crypto.createHash('sha256').update(verifier).digest('base64url')};
 }
 consume(state,browser,now=Date.now()){
  if(!/^[a-f0-9]{64}$/.test(state||''))throw new Error('Invalid OAuth session. Start connecting again.');
  const name='state-'+state,value=this.read(name);if(!value||value.expires<=now||value.browser!==crypto.createHash('sha256').update(browser||'').digest('hex'))throw new Error('OAuth session expired or does not match this browser.');
  fs.unlinkSync(path.join(this.directory,name+'.enc'));return value;
 }
 validateIdentity(claims,nonce){if(!claims||claims.nonce!==nonce)throw new Error('Google nonce does not match.');if(claims.hd!=='qooob.com'||!String(claims.email||'').toLowerCase().endsWith('@qooob.com'))throw new Error('Connect your corporate qooob.com account.');if(!claims.sub||claims.email_verified!==true)throw new Error('Google account is not verified.');return claims;}
 status(userId){const id=this.id(userId),file=path.join(this.directory,id+'.json');return fs.existsSync(file)&&fs.existsSync(path.join(this.directory,id+'.enc'))?JSON.parse(fs.readFileSync(file,'utf8')):null;}
 all(){return fs.readdirSync(this.directory).filter(name=>/^\d+\.json$/.test(name)).map(name=>this.status(name.slice(0,-5))).filter(Boolean);}
 connect(userId,identity,tokens,calendar){
  const id=this.id(userId);if(this.all().some(a=>a.userId!==id&&a.subject===identity.sub))throw new Error('This Google account is already connected to another Telegram user.');
  if(!tokens.refresh_token)throw new Error('Google did not provide offline access. Sign in again and confirm access.');
  const version=crypto.randomBytes(16).toString('hex'),metadata={userId:id,subject:identity.sub,email:identity.email,calendar,connectedAt:new Date().toISOString(),version};
  this.write(id,{...metadata,tokens});atomicJson(path.join(this.directory,id+'.json'),metadata);return metadata;
 }
 load(userId){return this.read(this.id(userId));}
 refresh(userId,version,tokens){const value=this.load(userId);if(value?.version!==version)return;value.tokens={...value.tokens,...tokens};this.write(this.id(userId),value);}
 remove(userId){const id=this.id(userId);for(const ext of ['.enc','.json']){const file=path.join(this.directory,id+ext);if(fs.existsSync(file))fs.unlinkSync(file);}}
 managers(caller,settings){return this.all().filter(a=>!settings.users[a.userId]?.blocked&&(a.userId===String(caller)||['admin','partnership'].includes(settings.users[a.userId]?.role)));}
 select(caller,id,settings){if(!this.status(id||'0'))throw new Error('The selected manager has not connected a calendar.');const account=this.managers(caller,settings).find(a=>a.userId===String(id));if(!account)throw new Error('The manager calendar is unavailable.');return account;}
 cleanup(now=Date.now()){for(const name of fs.readdirSync(this.directory).filter(n=>/^state-[a-f0-9]{64}\.enc$/.test(n))){const key=name.slice(0,-4);if(this.read(key)?.expires<now)fs.unlinkSync(path.join(this.directory,name));}}
}
