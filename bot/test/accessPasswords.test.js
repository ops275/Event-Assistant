import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBot} from '../bot.js';
import {getConfig} from '../config.js';
import {FileStore} from '../services/store.js';
import {AdminSettings} from '../services/adminService.js';

for (const [name, env, text, admitted] of [
 ['legacy password remains valid', {ACCESS_PASSWORD:'legacy', ACCESS_PASSWORDS:'extra'}, 'legacy', true],
 ['additional password admits a normal user', {ACCESS_PASSWORD:'legacy', ACCESS_PASSWORDS:'extra'}, 'extra', true],
 ['additional password works through start payload', {ACCESS_PASSWORD:'legacy', ACCESS_PASSWORDS:'extra'}, '/start extra', true],
 ['invalid password cannot authorize', {ACCESS_PASSWORD:'legacy', ACCESS_PASSWORDS:'extra'}, 'wrong', false],
 ['additional-only configuration still requires login', {ACCESS_PASSWORDS:'extra'}, '/start', false],
 ['additional-only configuration accepts its password', {ACCESS_PASSWORDS:'extra'}, 'extra', true],
 ['empty list entries cannot grant access', {ACCESS_PASSWORD:'legacy', ACCESS_PASSWORDS:' , | '}, '/start', false],
]) test(name, async t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qooob-auth-')), calls=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const data=JSON.parse(raw||'{}');calls.push({method:req.url.split('/').at(-1),...data});
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({ok:true,result:{message_id:10,date:1,chat:{id:101,type:'private'},text:data.text}}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const store=new FileStore(dir), config=getConfig({BOT_PROFILE:'onlyplay',...env});
 const bot=createBot({token:'123:test',store,config,analyzer:{aiConfigured:()=>false},sheets:{configured:()=>false},telegramOptions:{apiRoot:'http://127.0.0.1:'+server.address().port}});
 bot.botInfo={id:123,is_bot:true,first_name:'Test',username:'test_bot'};
 await bot.handleUpdate({update_id:1,message:{message_id:1,date:1,from:{id:101,is_bot:false,first_name:'Test'},chat:{id:101,type:'private'},text}});
 await bot.waitForIdle();
 assert.equal(store.isAuthorized('101'),admitted);
 assert.equal(new FileStore(dir).isAuthorized('101'),admitted,'authorization persists');
 assert.equal(new AdminSettings(config.adminSettingsFile,config.adminIds).isAdmin('101'),false);
 assert.equal(calls.some(c=>c.method==='deleteMessage'),admitted,'accepted password message is removed');
 if(!admitted)assert.ok(calls.some(c=>/password/i.test(c.text||'')));
});
