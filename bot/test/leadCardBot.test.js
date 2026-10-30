import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBot} from '../bot.js';
import {createLead} from '../flow.js';
import {FileStore} from '../services/store.js';
import {getConfig} from '../config.js';

test('Telegram open callbacks show creator A to A/B and preserve website target after assignment and reopen',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'card-bot-'));const calls=[];let messageId=1;
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw||'{}');calls.push({method:req.url.split('/').at(-1),...data});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,result:{message_id:messageId++,chat:{id:data.chat_id,type:'private'},date:1,text:data.text}}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const store=new FileStore(dir);const lead=createLead('101:101','@alice','',{id:101,username:'alice',firstName:'Alice',lastName:'Creator'});
  Object.assign(lead.fields,{company:'Demo',icp:'Provider',generatedBy:'Myself',fullName:'Contact',jobTitle:'CEO',phone:'+123',linkedin:'https://linkedin.com/in/contact?trk=search&x=1',website:'https://example.com/demo/3?a=1&b=2#here'});store.state.leads[lead.id]=lead;
  const bot=createBot({token:'123:test',store,config:getConfig({BOT_PROFILE:'onlyplay',ALLOWED_TELEGRAM_USER_IDS:'101,202'}),analyzer:{aiConfigured:()=>false},sheets:{configured:()=>false},telegramOptions:{apiRoot:'http://127.0.0.1:'+server.address().port}});
  bot.botInfo={id:123,is_bot:true,first_name:'Test',username:'card_test_bot'};
  async function open(user,readOnly=false){
   const session=store.session(user+':'+user);session.nonce='test';session.view='review';
   if(readOnly)store.equalLeadAccess=false;
   const start=calls.length;
   await bot.handleUpdate({update_id:messageId+1000,callback_query:{id:String(messageId),from:{id:user,is_bot:false,first_name:user===101?'Alice':'Bob'},chat_instance:'test',data:'v2:test:open:'+lead.id,message:{message_id:messageId++,date:1,chat:{id:user,type:'private'},text:'Lead list'}}});
   await bot.waitForIdle();
   const sent=calls.slice(start).find(c=>['sendMessage','editMessageText'].includes(c.method)&&c.text?.includes('Demo'));
   assert.ok(sent,'actual Telegram card sent');assert.equal(sent.parse_mode,'HTML');
   assert.match(sent.text,/Provider by Alice Creator/);assert.doesNotMatch(sent.text,/by Myself|by Bob/);
   assert.ok(sent.text.includes('<a href="https://example.com/demo/3?a=1&amp;b=2#here">example.com/demo/3?a=1&amp;b=2#here</a>'));
   assert.ok(sent.text.includes('>CEO</a>'));assert.ok(sent.text.includes('<a href="https://linkedin.com/in/contact?trk=search&amp;x=1">LinkedIn</a>'+String.fromCharCode(10)+'+123'));return sent;
  }
  await open(101);await open(202);lead.assigneeId='202';await open(202);await open(101);
  store.save();assert.equal(new FileStore(dir).state.leads[lead.id].actorName,'Alice Creator');
  delete lead.assigneeId;await open(202,true);
  await bot.waitForIdle();
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
