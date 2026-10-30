import test from 'node:test';
import assert from 'node:assert/strict';
import {createApolloService} from '../services/apolloService.js';

const lead=()=>({id:'lead-1',fields:{fullName:'Jane Doe',company:'Example',email:'jane@example.com'},materials:[],conflicts:[],edits:[]});
const person=(extra={})=>({id:'person-1',name:'Jane Doe',email:'jane@example.com',email_status:'verified',title:'CEO',linkedin_url:'https://www.linkedin.com/in/jane-doe',city:'Warsaw',country:'Poland',organization:{name:'Example',primary_domain:'example.com',website_url:'https://example.com'},...extra});
const response=(p=person(),extra={})=>({person:p,match_confidence:'high',...extra});
const json=data=>new Response(JSON.stringify(data),{status:200});
function setup(fetch,options={}){return createApolloService({apiKey:'fixture-key',fetch,now:()=>Date.parse('2026-10-28T18:00:00Z'),...options});}

test('fills empty fields from verified match, preserves manual values and stores minimal provenance',async()=>{
 const l=lead();l.fields.jobTitle='Founder';let calls=0;
 const service=setup(async(url,options)=>{
  calls++;assert.equal(url,'https://api.apollo.io/api/v1/people/match');
  assert.equal(options.headers['x-api-key'],'fixture-key');
  const body=JSON.parse(options.body);assert.equal(body.email,'jane@example.com');
  for(const key of ['reveal_phone_number','reveal_personal_emails','run_waterfall_email','run_waterfall_phone'])assert.equal(body[key],false);
  return json(response());
 });
 let saves=0;const result=await service.enrich(l,{persist:()=>saves++});
 assert.equal(result.status,'updated');assert.equal(l.fields.jobTitle,'Founder');
 assert.equal(l.fields.website,'https://example.com');assert.equal(l.fields.address,'Warsaw, Poland');
 assert.equal(l.fields.linkedin,'https://www.linkedin.com/in/jane-doe');
 assert.equal(l.enrichment.apollo.fields.website.source,'Apollo');assert.ok(l.enrichment.apollo.fields.website.at);
 assert.ok(saves>=2);assert.doesNotMatch(JSON.stringify(l.enrichment),/fixture-key|Warsaw|CEO/);
 const second=await setup(()=>{throw Error('must not call again');}).enrich(l,{persist:()=>{}});
 assert.equal(second.status,'cached');assert.equal(calls,1);
});

test('requires identity beyond name and never spends on missing inputs or disabled key',async()=>{
 let calls=0;const service=setup(async()=>{calls++;return json(response());});
 const l=lead();delete l.fields.email;
 assert.equal((await service.enrich(l)).status,'needs_identity');
 l.fields.website='https://linkedin.com/company/example';assert.equal((await service.enrich(l)).status,'needs_identity');
 assert.equal((await setup(()=>{calls++;},{apiKey:''}).enrich(lead())).status,'not_configured');assert.equal(calls,0);
});

test('name and employer domain require both exact identity and high confidence',async()=>{
 for(const [p,confidence,expected] of [[person(),'high','updated'],[person({name:'Janet Doe'}),'high','ambiguous'],[person({organization:{primary_domain:'other.com'}}),'high','ambiguous'],[person(),'medium','ambiguous'],[person(),undefined,'ambiguous']]){
  const l=lead();delete l.fields.email;l.fields.website='example.com';
  const result=await setup(async()=>json(response(p,{match_confidence:confidence}))).enrich(l);
  assert.equal(result.status,expected);if(expected!=='updated')assert.equal(l.fields.jobTitle,undefined);
 }
});

test('rejects contradictory exact identifiers, low confidence, and arrays of candidates',async()=>{
 for(const data of [response(person({email:'someone@example.com'})),response(person(),{match_confidence:'low'}),response(person(),{match_confidence:'none'}),response([person(),person()]),response(person({linkedin_url:'https://linkedin.com/in/other'}))]){
  const l=lead();l.fields.linkedin='https://linkedin.com/in/jane-doe';
  const result=await setup(async()=>json(data)).enrich(l);
  assert.equal(result.status,'ambiguous');assert.equal(l.fields.jobTitle,undefined);
 }
});

test('handles no match, partial data and filters unsafe links, personal and unverified email',async()=>{
 assert.equal((await setup(async()=>json({person:null})).enrich(lead())).status,'not_found');
 const l=lead();delete l.fields.email;l.fields.linkedin='https://linkedin.com/in/jane-doe';
 const p=person({email:'private@gmail.com',email_status:'unverified',title:null,organization:{website_url:'javascript:alert(1)'},city:null,country:null});
 assert.equal((await setup(async()=>json(response(p))).enrich(l)).status,'unchanged');
 assert.equal(l.fields.email,undefined);assert.equal(l.fields.website,undefined);
});

test('coalesces concurrent attempts and blocks persisted in-flight replay',async()=>{
 const l=lead();let release,calls=0;const pending=new Promise(r=>release=r);
 const service=setup(async()=>{calls++;await pending;return json(response());});
 const first=service.enrich(l,{persist:()=>{}});
 assert.equal((await service.enrich(l)).status,'busy');
 const reloaded=structuredClone(l);assert.equal((await setup(()=>{throw Error('paid replay');}).enrich(reloaded)).status,'cached');
 release();await first;assert.equal(calls,1);
});

test('rechecks permissions and identity after response, preserves concurrent manual edits',async()=>{
 for(const mode of ['permission','identity','manual']){
  const l=lead();let allowed=true;
  const service=setup(async()=>{if(mode==='permission')allowed=false;if(mode==='identity')l.fields.email='other@example.com';if(mode==='manual')l.fields.jobTitle='Manual';return json(response());});
  const r=await service.enrich(l,{canApply:()=>allowed});
  assert.equal(r.status,mode==='manual'?'updated':'changed');
  assert.equal(l.fields.jobTitle,mode==='manual'?'Manual':undefined);
 }
});

test('sanitizes API errors, bounds timeout and suppresses paid automatic retries',async()=>{
 for(const [status,expected] of [[401,'auth_error'],[403,'access_error'],[429,'rate_limited'],[422,'invalid_request'],[500,'unavailable']]){
  let calls=0;const l=lead();const service=setup(async()=>{calls++;return new Response(JSON.stringify({error:'secret fixture-key',error_details:{code:'TEST.ERROR'}}),{status,headers:{'retry-after':'120'}});});
  const result=await service.enrich(l);assert.equal(result.status,expected);assert.doesNotMatch(JSON.stringify(result),/fixture-key|TEST.ERROR/);
  assert.equal((await service.enrich(l)).status,'cached');assert.equal(calls,1);
 }
 const l=lead();const service=setup(async(_url,{signal})=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),{timeoutMs:20});
 const keepAlive=setTimeout(()=>{},100);try{assert.equal((await service.enrich(l)).status,'timeout');assert.equal((await service.enrich(l)).status,'cached');}finally{clearTimeout(keepAlive);}
});

test('never calls Apollo if durable start cannot be saved',async()=>{
 let calls=0;await assert.rejects(setup(async()=>{calls++;return json(response());}).enrich(lead(),{persist:()=>{throw Error('disk unavailable');}}));assert.equal(calls,0);
});
