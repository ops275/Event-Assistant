import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBot} from '../bot.js';
import {createLead} from '../flow.js';
import {FileStore} from '../services/store.js';
import {getConfig,STEPS} from '../config.js';
import {createApolloService} from '../services/apolloService.js';

async function harness(t,fetch,{profile='onlyplay',password='',role}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apollo-bot-')),calls=[];let nextId=1;
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw||'{}');calls.push({method:req.url.split('/').at(-1),...data});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,result:{message_id:nextId++,chat:{id:data.chat_id,type:'private'},date:1,text:data.text}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const store=new FileStore(dir),lead=createLead('101:101','Alice');
 Object.assign(lead.fields,{fullName:'Jane Doe',company:'Example',email:'jane@example.com',jobTitle:'Manual founder'});lead.stage=STEPS.length;lead.status='saved';store.state.leads[lead.id]=lead;
 if(role)store.state.userRoles={'101':role};
 const apollo=createApolloService({apiKey:'fixture-key',fetch:(...args)=>fetch(calls,...args)});
 const bot=createBot({token:'123:test',store,config:getConfig({BOT_PROFILE:profile,ALLOWED_TELEGRAM_USER_IDS:password?'':'101',ACCESS_PASSWORD:password}),apollo,analyzer:{aiConfigured:()=>false},sheets:{configured:()=>false},telegramOptions:{apiRoot:'http://127.0.0.1:'+server.address().port}});
 bot.botInfo={id:123,is_bot:true,first_name:'Test',username:'apollo_test_bot'};
 const session=store.session('101:101');Object.assign(session,{activeId:lead.id,view:'review',nonce:'test',panelId:77});
 let updateId=100;
 const update=(nonce=session.nonce)=>({update_id:updateId++,callback_query:{id:String(updateId),from:{id:101,is_bot:false,first_name:'Alice'},chat_instance:'test',data:`v2:${nonce}:apollo`,message:{message_id:77,date:1,chat:{id:101,type:'private'},text:'Lead card'}}});
 async function click(nonce){await bot.handleUpdate(update(nonce));await bot.waitForIdle();}
 return {store,lead,calls,bot,click,session,update};
}
const reply=()=>new Response(JSON.stringify({match_confidence:'high',person:{id:'p1',name:'Jane Doe',email:'jane@example.com',email_status:'verified',title:'CEO',linkedin_url:'https://linkedin.com/in/jane-doe',organization:{primary_domain:'example.com',website_url:'https://example.com'}}}));

test('Apollo click shows working notice before lookup then updates actual Telegram card and persisted lead',async t=>{
 let count=0;const h=await harness(t,async calls=>{
  count++;assert.ok(calls.some(c=>c.method==='sendMessage'&&/Apollo.*searching/.test(c.text)),'visible progress before paid lookup');return reply();
 });
 await h.click();
 assert.equal(count,1);assert.equal(h.lead.fields.jobTitle,'Manual founder');
 assert.equal(h.lead.fields.website,'https://example.com');
 assert.ok(h.calls.some(c=>c.method==='editMessageText'&&/Apollo: lead updated/.test(c.text)));
 const card=h.calls.findLast(c=>c.method==='editMessageText'&&c.reply_markup);
 assert.match(card.text,/example.com/);assert.match(card.text,/Jane Doe/);assert.match(card.text,/Already enriched via Apollo/);assert.ok(card.text.includes('>LinkedIn</a>'));
 assert.ok(card.reply_markup.inline_keyboard.flat().some(b=>b.text==='Enrich via Apollo'));
 assert.equal(new FileStore(path.dirname(h.store.file)).state.leads[h.lead.id].enrichment.apollo.status,'updated');
 await h.click();assert.equal(count,1);assert.ok(h.calls.some(c=>c.text==='Already enriched via Apollo'));
});

test('double-tap while lookup is pending never queues another charged call',async t=>{
 let release,count=0;const barrier=new Promise(r=>release=r);
 const h=await harness(t,async()=>{count++;await barrier;return reply();});
 const first=h.click('test');
 const deadline=Date.now()+1000;
 while(!count&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
 await h.bot.handleUpdate(h.update('test'));release();await first;
 assert.equal(count,1);
});

test('authorization, read-only, promoter and non-qooob requests never call Apollo',async t=>{
 for(const options of [{password:'secret'},{readOnly:true},{role:'promoter'},{profile:'qooob'}]){
  let count=0;const h=await harness(t,async()=>{count++;return reply();},options);
  if(options.readOnly){h.store.equalLeadAccess=false;h.lead.owner='202:202';}
  await h.click();assert.equal(count,0);assert.equal(h.lead.fields.website,undefined);
 }
});

test('failed lookup replaces working notice with safe error and leaves original card intact',async t=>{
 const h=await harness(t,async()=>new Response('private fixture-key',{status:403}));
 await h.click();
 assert.ok(h.calls.some(c=>c.method==='editMessageText'&&/API access or plan/.test(c.text)));
 assert.equal(h.lead.fields.website,undefined);assert.doesNotMatch(JSON.stringify(h.calls),/fixture-key/);
});
