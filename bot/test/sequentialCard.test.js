import test from 'node:test';
import assert from 'node:assert/strict';
import {createLead} from '../flow.js';
import {render} from '../ui.js';
const config={profile:'onlyplay',role:'partnership'};
function lead(fields={}){const l=createLead('1:1','Test');Object.assign(l.fields,{fullName:'Jane',company:'Demo',jobTitle:'CEO <&>',phone:'+123',email:'jane@example.com',...fields});return l;}
function card(l,cardFromSearch=true){return render(l,{view:'review',nonce:'test',cardFromSearch},config).text;}
test('personal LinkedIn appears immediately above phones with complete escaped URL and preserved title link',()=>{
 const l=lead({linkedin:'https://www.linkedin.com/in/jane/?trk=one&x=two#profile'});
 for(const fromSearch of [true,false]){
 const text=card(l,fromSearch);assert.ok(text.includes('<a href="https://www.linkedin.com/in/jane/">CEO &lt;&amp;&gt;</a>'));
 assert.ok(text.includes('<a href="https://www.linkedin.com/in/jane/?trk=one&amp;x=two#profile">LinkedIn</a>\n+123'));
 }
});
test('LinkedIn has logical contact position without phone/title; missing and company URLs create no fake link',()=>{
 const text=card(lead({linkedin:'linkedin.com/in/jane',phone:'',jobTitle:''}));assert.ok(text.includes('>LinkedIn</a>\njane@example.com'));
 for(const linkedin of ['',null,'https://linkedin.com/company/demo','https://evil.example/in/jane','javascript:alert(1)']){
 const text=card(lead({linkedin}));assert.ok(!text.includes('>LinkedIn</a>'));assert.ok(!text.includes('href="javascript:'));
 }
});
test('Apollo success caption uses saved actual date without mutation; failures have no success caption',()=>{
 for(const status of ['updated','unchanged']){
 const l=lead({linkedin:'https://linkedin.com/in/jane'});l.enrichment={apollo:{status,completedAt:'2026-10-27T23:45:00.000Z',fields:status==='updated'?{linkedin:{source:'Apollo',at:'2026-10-26T12:34:00.000Z'}}:{}}};
 const before=structuredClone(l);const expected=status==='updated'?'2026-10-26':'2026-10-27';
 assert.ok(card(l).includes('Already enriched via Apollo · '+expected));assert.deepEqual(l,before);
 }
 for(const status of ['pending','timeout','not_found','ambiguous','access_error']){
 const l=lead();l.enrichment={apollo:{status,completedAt:'2026-10-27T00:00:00Z',fields:{email:{at:'2026-10-26T12:34:00Z'}}}};
 assert.ok(!card(l).includes('enriched via Apollo'));
 }
 const l=lead();l.enrichment={apollo:{status:'updated',completedAt:'invalid',fields:{}}};assert.ok(!card(l).includes('enriched via Apollo'));
});
