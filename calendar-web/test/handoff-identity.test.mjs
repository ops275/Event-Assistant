import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMeeting} from '../services/calendarBooking.js';
import {renderCalendarEditor} from '../services/calendarEditor.js';
const input={submission:'identity-test',date:'2026-11-02',time:'12:00',location:'Hall',meetingType:'offline'};
const target={id:'calendar',timeZone:'UTC'};
test('handoff allows a named lead without company',()=>{
 const lead={id:'lead',fields:{fullName:'Anna'}};
 const meeting=buildMeeting(input,lead,target,new Date('2026-10-31'));
 assert.equal(meeting.summary,'qooob × Anna');
 assert.match(meeting.description,/Participant: Anna\./);
 const html=renderCalendarEditor({leads:[lead],target,csrf:'csrf',canWrite:true});
 assert.ok(html.includes('>qooob × Anna</h1>'));
 assert.doesNotMatch(html,/undefined/);
});
test('handoff still requires a name even when a contact exists',()=>{
 assert.throws(()=>buildMeeting(input,{id:'lead',fields:{email:'anna@example.com'}},target,new Date('2026-10-31')));
});
test('handoff keeps company and name when both exist',()=>{
 assert.equal(buildMeeting(input,{id:'lead',fields:{fullName:'Anna',company:'Acme'}},target,new Date('2026-10-31')).summary,'qooob × Acme — Anna');
});
