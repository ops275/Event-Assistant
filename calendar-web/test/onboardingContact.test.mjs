import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Readable} from 'node:stream';
import {createOnboardingRoutes} from '../services/onboardingRoutes.js';
import {OnboardingJobs} from '../services/onboardingService.js';
const script=fs.readFileSync(new URL('../onboarding-ui.js',import.meta.url),'utf8');
function fixture(t,telegram='@Database_User'){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ob-contact-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const jobs=new OnboardingJobs(directory),lead={id:'lead',owner:'1:1',fields:{fullName:'Lead',company:'Company',telegram}},identity={userId:'1',onboardingCsrf:'csrf'};
 const route=createOnboardingRoutes({jobs,admin:{read:()=>({users:{1:{role:'admin'}}})},leads:()=>[lead],users:()=>({1:{username:'Current_Manager'}}),health:()=>({ready:true})}).route;
 async function request(fields){const req=Readable.from(fields?[new URLSearchParams({operationId:'e'.repeat(32),csrf:'csrf',leadId:'lead',type:'operator-biz',title:'Chat',confirm:'yes',...fields}).toString()]:[]);req.method=fields?'POST':'GET';req.headers={'content-type':'application/x-www-form-urlencoded',origin:'https://example.com',host:'example.com'};const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body}};await route(req,res,new URL('https://example.com/onboarding'+(fields?'/create':'')),identity,(r,status,body)=>{r.writeHead(status);r.end(body)},['https://example.com']);return res;}
 return {jobs,lead,request};
}
test('form exposes an editable lead username and initializes Other participants with selected managers',async t=>{
 for(const [stored,want] of [['@Database_User','@Database_User'],['https://t.me/Database_User','@Database_User'],['','']]){
  const f=fixture(t,stored),html=(await f.request()).body;
  assert.match(html,new RegExp('<input[^>]*id="ob-lead-telegram"[^>]*name="leadTelegram"[^>]*value="'+want+'"'));
  assert.doesNotMatch(html,/<input[^>]*id="ob-lead-telegram"[^>]*readonly/);
  assert.match(html,/<input[^>]*id="ob-members"[^>]*value="[^"]*@current_manager/);
 }
});
for(const [name,handle,want] of [['edited','@Edited_User',['edited_user','other_user','current_manager']],['cleared','',['other_user','current_manager']],['absent',undefined,['other_user','current_manager']]])test('POST uses '+name+' lead field without reintroducing database username',async t=>{
 const f=fixture(t),fields={participants:'@Other_User, @CURRENT_MANAGER'};if(handle!==undefined)fields.leadTelegram=handle;
 const response=await f.request(fields);assert.equal(response.status,303);assert.deepEqual(f.jobs.all()[0].participants.slice().sort(),want.slice().sort());assert.equal(f.lead.fields.telegram,'@Database_User');
});
test('submitted lead username retains validation and deduplicates with other participants',async t=>{
 const f=fixture(t);assert.equal((await f.request({leadTelegram:'not a username'})).status,400);assert.equal(f.jobs.all().length,0);
 assert.equal((await f.request({leadTelegram:'@OTHER_USER',participants:'other_user'})).status,303);assert.deepEqual(f.jobs.all()[0].participants.sort(),['current_manager','other_user']);
});
test('manager controls submit independently',async t=>{
 const f=fixture(t),html=(await f.request()).body;
 assert.match(html, /name="selectedManagers"[^>]*value="@Current_Manager"[^>]*checked/);
 assert.equal((await f.request({selectedManagers:'@Current_Manager',leadTelegram:'@Lead_User',participants:''})).status,303);
 assert.deepEqual(f.jobs.all()[0].participants,['current_manager','lead_user']);
});
test('unlisted manager cannot be injected',async t=>{assert.equal((await fixture(t).request({selectedManagers:'@Injected_User'})).status,400)});test('unique participant limit counts lead and mandatory manager after deduplication',async t=>{
 const f=fixture(t),entries=Array.from({length:8},(_,i)=>'person_'+i);
 assert.equal((await f.request({leadTelegram:'@Lead_User',participants:[...entries,'@PERSON_0','current_manager'].join(',')})).status,303);
 assert.equal(f.jobs.all()[0].participants.length,10);
 const g=fixture(t);assert.equal((await g.request({leadTelegram:'@Lead_User',participants:[...entries,'extra_user'].join(',')})).status,400);
});
import {runOnboarding,manualInvitations} from '../services/onboardingService.js';
test('Telegram partial success keeps bot and invitation fallback without sending unselected templates',async t=>{
 const f=fixture(t);await f.request({leadTelegram:'@Lead_User',participants:'@Other_User'});const job=f.jobs.all()[0];let bots=0,templates=0;
 const api={accountId:'999',create:async()=>({id:'group',accessHash:'hash'}),bot:async()=>bots++,avatar:async()=>{},history:async()=>{},invite:async(_g,h)=>{if(h==='other_user')throw new Error('Privacy')},link:async()=>({link:'https://t.me/+validLink'}),template:async()=>templates++};
 await runOnboarding(f.jobs,job.id,api,'999');const result=f.jobs.read(job.id);assert.equal(bots,1);assert.equal(templates,0);assert.equal(result.status,'partial');assert.deepEqual(result.steps.invited.sort(),['current_manager','lead_user']);assert.deepEqual(manualInvitations(result).map(p=>p.username),['other_user']);
});

test('onboarding directory includes confirmed Partnership contacts and omits excluded directory entries',async t=>{
 const html=(await fixture(t).request()).body;
 for(const handle of ['@yaknamene','@askorobohatov','@Vlada_t1','@Khati_qooob'])assert.ok(html.includes('value="'+handle+'"'));
 assert.ok(!html.includes('value="@dasha_elle"'));assert.ok(!html.includes('value="@zanepad"'));
 const f=fixture(t);assert.equal((await f.request({selectedManagers:'@Khati_qooob',participants:''})).status,303);assert.deepEqual(f.jobs.all()[0].participants,['khati_qooob','current_manager']);
 const g=fixture(t);await g.request({participants:''});assert.deepEqual(g.jobs.all()[0].participants,['current_manager']);
});
