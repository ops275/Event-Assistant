import test from 'node:test';
import assert from 'node:assert/strict';
import {createApolloService,apolloNotice} from '../services/apolloService.js';
test('saved successful enrichment has exact repeat notice after restart and cooldown, without paid call or date change',async()=>{
 for(const status of ['updated','unchanged']){
 const lead={id:'saved',fields:{email:'person@example.com'},enrichment:{apollo:{status,completedAt:'2026-10-20T10:11:12.000Z',retryAt:1,fields:{email:{source:'Apollo',at:'2026-10-20T10:11:12.000Z'}}}}};
 const before=structuredClone(lead);let count=0;
 const service=createApolloService({apiKey:'fixture',fetch:async()=>{count++;throw new Error('unexpected paid request');}});
 const result=await service.enrich(lead);assert.equal(apolloNotice(result),'Already enriched via Apollo');assert.equal(count,0);assert.deepEqual(lead,before);
 const reloaded=JSON.parse(JSON.stringify(lead));assert.equal(apolloNotice(await createApolloService({apiKey:'fixture',fetch:async()=>{throw Error('paid');}}).enrich(reloaded)),'Already enriched via Apollo');
 }
});
test('cached failed/pending/missing/ambiguous searches and busy/config errors are not called successful',()=>{
 for(const previousStatus of ['pending','timeout','not_found','ambiguous','auth_error','unchanged_failure']){
 assert.notEqual(apolloNotice({status:'cached',previousStatus}),'Already enriched via Apollo');
 }
 for(const status of ['busy','not_configured','rate_limited','unavailable'])assert.notEqual(apolloNotice({status}),'Already enriched via Apollo');
});
test('populated contacts without saved success still call Apollo',async()=>{
 let calls=0;const lead={id:'manual',fields:{email:'person@example.com',phone:'+123',jobTitle:'CEO'}};
 const result=await createApolloService({apiKey:'fixture',fetch:async()=>{calls++;return new Response('{}');}}).enrich(lead);
 assert.equal(calls,1);assert.notEqual(apolloNotice(result),'Already enriched via Apollo');
});
test('successful marker does not bypass authorization',async()=>{
 const lead={id:'x',fields:{email:'a@b.com'},enrichment:{apollo:{status:'updated'}}};
 assert.equal((await createApolloService({apiKey:'fixture'}).enrich(lead,{canApply:()=>false})).status,'changed');
});
