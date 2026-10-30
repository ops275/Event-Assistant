import test from 'node:test';import assert from 'node:assert/strict';
import {createAeCalendarRoutes} from '../services/aeCalendarRoutes.js';
test('calendar page offers connected AEs and rejects unknown or blocked manager data',async()=>{
 let reads=0;const owner={userId:'123',email:'manager@qooob.com',calendar:{id:'primary',timeZone:'UTC'}},accounts={all:()=>[owner]},settings={users:{'123':{role:'partnership'}}},admin={read:()=>settings,blocked:()=>false,role:()=>null};
 const routes=createAeCalendarRoutes({accounts,admin,personal:{clientFor(){reads++;throw new Error('unexpected')}}}),response=()=>({headers:{},writeHead(status,h){this.status=status;this.headers=h},end(body){this.body=body}}),reply=(r,status,body)=>{r.status=status;r.body=body};
 const page=response();await routes.route({method:'GET'},page,new URL('https://example.com/ae-slots'),{userId:'1'},reply);assert.equal(page.status,200);assert.ok(page.body.includes('manager@qooob.com'));assert.ok(page.body.includes('ae-calendar-ui.js'));assert.ok(page.body.includes('id="ae-free-time"'));
 const bad=response();await routes.route({method:'GET'},bad,new URL('https://example.com/ae-slots/data?manager=999&date=2026-10-20&view=day'),{userId:'1'},reply);assert.equal(bad.status,403);assert.equal(reads,0);
 settings.users['123'].blocked=true;admin.blocked=id=>Boolean(settings.users[id]?.blocked);const blocked=response();await routes.route({method:'GET'},blocked,new URL('https://example.com/ae-slots/data?manager=123&date=2026-10-20&view=day'),{userId:'1'},reply);assert.equal(blocked.status,403);assert.equal(reads,0);
});
