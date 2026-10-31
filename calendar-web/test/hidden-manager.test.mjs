import test from 'node:test';
import assert from 'node:assert/strict';
import {managerOptions} from '../services/staffDirectory.js';
test('hidden ops administrator is absent from manager choices without removing the account',()=>{
 const accounts=[{userId:'6267917103',email:'Ops@qooob.com',calendar:{timeZone:'UTC'}},{userId:'329180371',email:'gosha@qooob.com',calendar:{timeZone:'UTC'}}];
 const before=structuredClone(accounts),html=managerOptions(accounts,'6267917103');
 assert.doesNotMatch(html,/6267917103|Ops@qooob.com/i);
 assert.match(html,/329180371/);assert.deepEqual(accounts,before);
});
import {createOnboardingRoutes} from '../services/onboardingRoutes.js';
import {createAeCalendarRoutes} from '../services/aeCalendarRoutes.js';
import {CalendarAccounts} from '../services/calendarAccounts.js';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('onboarding omits ops from manager choices and default participants while preserving existing history',async()=>{
 const settings={users:{6267917103:{role:'admin'},329180371:{role:'admin'}}};
 const jobs={all:()=>[]};const route=createOnboardingRoutes({jobs,admin:{read:()=>settings},leads:()=>[{id:'lead',owner:'329180371:329180371',fields:{fullName:'Test lead',company:'Test company'}}],users:()=>({6267917103:{name:'Ops',username:'krtlnk'},329180371:{name:'Gosha',username:'yaknamene'}}),health:()=>({ready:true}),participantPhoto:async()=>null}).route;
 let html,status;await route({method:'GET'},{},new URL('https://example.com/onboarding'),{userId:'329180371'},(r,s,b)=>{status=s;html=b},[]);
 assert.match(html,/qooob \u00d7 Test company \| Biz/);assert.equal(status,200);assert.doesNotMatch(html,/@krtlnk|6267917103/);assert.match(html,/@yaknamene/);assert.match(html,/Test lead/);assert.equal(settings.users[6267917103].role,'admin');
});
test('free slots picker excludes ops even when ops is the viewer',async()=>{
 const accounts={all:()=>[{userId:'6267917103',email:'ops@qooob.com',calendar:{timeZone:'UTC'}}]},admin={blocked:()=>false,read:()=>({users:{6267917103:{role:'admin'}}}),role:()=> 'admin'};
 const {route}=createAeCalendarRoutes({accounts,admin,personal:{clientFor(){throw Error('No probe calls')}}});let html,status;
 await route({method:'GET'},{},new URL('https://example.com/ae-slots'),{userId:'6267917103'},(r,s,b)=>{status=s;html=b});
 assert.equal(status,200);assert.doesNotMatch(html,/ops@qooob.com|value="6267917103"/);
});
test('hidden admin keeps calendar connection and access to existing meetings',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hidden-ops-'));
 try{const accounts=new CalendarAccounts(dir);accounts.connect('6267917103',{sub:'ops',email:'ops@qooob.com'},{refresh_token:'test-only'},{id:'primary',timeZone:'UTC'});
 assert.equal(accounts.select('6267917103','6267917103',{users:{6267917103:{role:'admin'}}}).email,'ops@qooob.com');assert.equal(accounts.load('6267917103').tokens.refresh_token,'test-only');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('ops creating onboarding is not automatically invited and selected working manager gets admin setup',async()=>{
 const settings={users:{6267917103:{role:'admin'},329180371:{role:'admin'}}},known={6267917103:{name:'Ops',username:'krtlnk'},329180371:{name:'Gosha',username:'yaknamene'}};let saved;
 const jobs={all:()=>[],create(input){saved=input;return {id:'created'}}};
 const {route}=createOnboardingRoutes({jobs,admin:{read:()=>settings},leads:()=>[{id:'lead',fields:{fullName:'Test',company:'Company'}}],users:()=>known,health:()=>({ready:true}),participantPhoto:async()=>null});
 let html,status;const reply=(r,s,b)=>{status=s;html=b};
 await route({method:'GET'},{},new URL('https://example.com/onboarding'),{userId:'6267917103'},reply,[]);
 assert.doesNotMatch(html,/value="[^"]*@krtlnk|data-creator-telegram="@krtlnk"/);
 const {Readable}=await import('node:stream');const req=Readable.from([new URLSearchParams({csrf:'csrf',leadId:'lead',primaryManager:'@yaknamene',participants:'@lead_user',confirm:'yes'}).toString()]);req.method='POST';req.headers={host:'example.com',origin:'https://example.com','content-type':'application/x-www-form-urlencoded'};
 await route(req,{writeHead(s){status=s},end(){}},new URL('https://example.com/onboarding/create'),{userId:'6267917103',onboardingCsrf:'csrf'},reply,['https://example.com']);
 assert.equal(status,303);assert.equal(saved.managerId,'329180371');assert.ok(saved.participants.includes('@yaknamene'));assert.ok(!saved.participants.some(s=>s.replace(/^@/,'')==='krtlnk'));
});

