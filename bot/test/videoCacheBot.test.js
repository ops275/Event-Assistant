import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createBot} from '../bot.js';
import {FileStore} from '../services/store.js';
import {getConfig} from '../config.js';
import {FOLLOWUP_TEMPLATE_PACKS} from '../services/followupTemplates.js';

async function harness(t,{profile='onlyplay',role='partnership',failText,failVideo=false,captureVideo=false}={}) {
 const sent=[],directory=fs.mkdtempSync(path.join(os.tmpdir(),'followup-'));let sequence=100,update=0,fail=Boolean(failText||failVideo);
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks),json=req.headers['content-type']?.includes('application/json');
  const body=json?JSON.parse(raw.toString()):{},method=req.url.split('/').at(-1);
  if(!json){const boundary=Buffer.from('--'+req.headers['content-type']?.split('boundary=')[1]);let start=raw.indexOf(boundary);while(start>=0){const next=raw.indexOf(boundary,start+boundary.length);if(next<0)break;const headerEnd=raw.indexOf(Buffer.from('\r\n\r\n'),start);if(headerEnd>start&&headerEnd<next){const header=raw.subarray(start+boundary.length,headerEnd).toString(),name=header.match(/name="([^"]+)"/);if(name&&!/filename=/.test(header))body[name[1]]=raw.subarray(headerEnd+4,next-2).toString('utf8');}start=next;}}
  const item={method,...body,raw:method==='sendVideo'&&!captureVideo?Buffer.alloc(0):raw};sent.push(item);
  if(fail&&(failVideo&&method==='sendVideo'||failText&&(body.text||body.caption)?.includes(failText))){fail=false;item.failed=true;res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error_code:500,description:'fixture failure'}));return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,result:['sendMessage','sendPhoto','sendVideo'].includes(method)?{message_id:++sequence,chat:{id:1,type:'private'},date:1,...(method==='sendVideo'?{video:{file_id:'fixture-'+(body.video||'uploaded')}}:{})}:true}));item.messageId=sequence;
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const store=new FileStore(directory);store.state.userRoles={'1':role};
 let analyzed=0;const bot=createBot({token:'123:TEST',store,config:{...getConfig({}),profile},analyzer:{aiConfigured:()=>false,analyze:async()=>{analyzed++;throw Error('unexpected analysis');}},sheets:{configured:()=>false},telegramOptions:{apiRoot:`http://127.0.0.1:${server.address().port}`}});bot.botInfo={id:123,is_bot:true,username:'qa_bot',first_name:'QA'};
 let session=store.session('1:1');
 async function send(text,chatType='private',chatId=1){await bot.handleUpdate({update_id:++update,message:{message_id:update,date:1,from:{id:1,first_name:'Staff'},chat:{id:chatId,type:chatType},text,...(text.startsWith('/')?{entities:[{type:'bot_command',offset:0,length:text.split(' ')[0].length}]}:{})}});await bot.waitForIdle();}
 async function action(name,{data=`v2:${session.nonce}:${name}`,chatType='private',chatId=1}={}){await bot.handleUpdate({update_id:++update,callback_query:{id:String(update),data,from:{id:1,first_name:'Staff'},chat_instance:'test',message:{message_id:1,date:1,chat:{id:chatId,type:chatType}}}});await bot.waitForIdle();}
 const panel=()=>sent.filter(x=>x.reply_markup?.inline_keyboard).at(-1);
 const labels=()=>panel().reply_markup.inline_keyboard.flat().map(b=>b.text);
 t.after(async()=>{await bot.waitForIdle();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
 return {store,get session(){return session;},sent,send,action,panel,labels,analyzed:()=>analyzed,reload:()=>{store.state=new FileStore(directory).state;session=store.session('1:1');}};
}
test('Materials and Follow-up share durable cache, retain captions/order and private-chat restrictions',async t=>{
 const names=['igames-marketplace.mp4','qooob-economy-operators.mp4','qooob-economy-providers.mp4','follow-up-marketplace-cover.png','follow-up-open-distribution-vs-black-box.png'];
 for(const name of names){const file=new URL('../'+name,import.meta.url);assert.ok(!fs.existsSync(file),'fixture stage must contain no real media');fs.writeFileSync(file,'fixture media '+name);t.after(()=>fs.unlinkSync(file));}
 const h=await harness(t,{captureVideo:true});
 await h.send('/materials');await h.action('materialcategory:provider');await h.action('materialsend:introduce-marketplace');
 assert.equal(h.session.materialsDelivery.status,'complete');let videos=h.sent.filter(x=>x.method==='sendVideo');assert.equal(videos.length,2);assert.ok(videos.every(v=>v.raw.includes(Buffer.from('filename='))));
 const captions=videos.map(v=>v.caption);h.reload();
 await h.action('materialsend:introduce-marketplace');videos=h.sent.filter(x=>x.method==='sendVideo');
 assert.deepEqual(videos.slice(2).map(v=>v.caption),captions);assert.ok(videos.slice(2).every(v=>typeof v.video==='string'&&v.video.startsWith('fixture-')));
 await h.send('/follow_up');await h.action('followupcategory:operator');await h.action('followuptemplate:igames-marketplace');const start=h.sent.length;await h.action('followupsend');
 assert.equal(h.session.followupDelivery.status,'complete');
 const packet=h.sent.slice(start).filter(x=>['sendVideo','sendPhoto'].includes(x.method)||x.method==='sendMessage'&&!x.reply_markup);
 assert.deepEqual(packet.map(x=>x.method),['sendPhoto','sendMessage','sendVideo','sendVideo','sendPhoto','sendMessage']);
 assert.equal(packet[2].video,'fixture-uploaded');assert.ok(packet[3].raw.includes(Buffer.from('filename=')));
 assert.ok(packet.every(x=>String(x.chat_id)==='1'));assert.equal(h.analyzed(),0);
 const count=h.sent.filter(x=>x.method==='sendVideo').length;await h.action('followupsend',{chatType:'group'});assert.equal(h.sent.filter(x=>x.method==='sendVideo').length,count);
});
test('Materials partial delivery resumes without repeating confirmed first video',async t=>{
 const names=['igames-marketplace.mp4','qooob-economy-providers.mp4'];
 for(const name of names){const file=new URL('../'+name,import.meta.url);assert.ok(!fs.existsSync(file));fs.writeFileSync(file,'fixture');t.after(()=>fs.unlinkSync(file));}
 const h=await harness(t,{failText:'stakeholders',captureVideo:true});
 await h.send('/materials');await h.action('materialcategory:provider');await h.action('materialsend:introduce-marketplace');
 assert.equal(h.session.materialsDelivery.status,'partial');assert.equal(h.session.materialsDelivery.nextIndex,1);h.reload();
 await h.action('materialretry');assert.equal(h.session.materialsDelivery.status,'complete');
 const successful=h.sent.filter(x=>x.method==='sendVideo'&&!x.failed);assert.equal(successful.length,2);
});
