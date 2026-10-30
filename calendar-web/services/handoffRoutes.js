import {BookingError} from './calendarBooking.js';
import {sameAppOrigin} from './requestOrigin.js';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function createHandoffRoutes({service,sessions,sessionCookie,leads,origins,renderMeetLink=()=>''}){
 return {async route(req,res,url,identity,reply){
  if(url.pathname!=='/book'||req.method!=='POST')return false;
  if(!sameAppOrigin(req,origins())){reply(res,403,'Request origin is not allowed.');return true;}
  if(!String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded')){reply(res,415,'Use the handoff form.');return true;}
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>65536){reply(res,413,'Form is too large.');return true;}}
  const form=new URLSearchParams(raw),session=sessions.get(sessionCookie(req));
  if(!identity||!session||session.type!=='booking'||session.owner!==identity.owner||session.expires<Date.now()||session.csrf!==form.get('csrf')){reply(res,403,'This form expired. Open Hand off lead again.');return true;}
  if(session.busy){reply(res,409,'Handoff is being saved. Please wait.');return true;}
  const lead=leads(identity.owner).find(item=>item.id===form.get('leadId'));
  if(!lead){reply(res,400,'Lead was not found. Open the form again.');return true;}
  const input={submission:session.submission,managerId:form.get('managerId'),managerTelegramId:form.get('managerId'),reminderChatId:identity.userId,date:form.get('date'),time:form.get('time'),timeZone:form.get('timeZone'),location:form.get('location'),description:form.get('description'),meetingType:form.get('meetingType')||undefined,createMeet:form.get('createMeet')==='yes',inbox:form.get('inbox')==='yes',...(form.has('leadContact')?{leadContact:form.get('leadContact')}:{}),guests:form.getAll('guests').join(',').split(/[\s,;]+/).filter(Boolean),reminderMinutes:form.get('reminderMinutes')};
  session.busy=true;
  try{
   const {record,event}=await service.submit({input,lead,identity});session.result=event;
   const outcomes=Object.values(record.notifications);
   reply(res,200,`<style>.meeting-success{max-width:440px;margin:48px auto;padding:32px 24px;border:1px solid var(--line);border-radius:20px;text-align:center;background:var(--bg)}.meeting-success .success-mark{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 20px;border-radius:50%;background:color-mix(in srgb,#22a06b 14%,var(--bg));color:#22a06b;font-size:32px}.meeting-success h1{font-size:28px;font-weight:700;margin-bottom:12px}.meeting-success .success-summary{font-size:16px;overflow-wrap:anywhere;margin-bottom:12px}.meeting-success .success-note{color:var(--muted);font-size:13px;margin-bottom:28px}.meeting-success .success-actions{display:grid;gap:12px}.meeting-success .success-actions>*{width:100%;margin:0;display:flex;align-items:center;justify-content:center;min-height:48px}.meeting-success .secondary{font-size:14px}</style><section id="meeting-booked" class="meeting-success" aria-labelledby="success-title"><div class="success-mark" aria-hidden="true">✓</div><h1 id="success-title">✅ Meeting booked</h1><p class="success-summary">${escape(event.summary)}</p><p class="success-note">Your meeting is saved in Google Calendar.${outcomes.some(item=>!['sent','skipped'].includes(item.status))?' Notifications are still pending.':''}</p><div class="success-actions"><a id="open-calendar" class="button" href="${escape(event.htmlLink)}" target="_blank" rel="noopener noreferrer">📅 Open in Google Calendar</a><button id="copy-event-link" type="button" class="secondary">Copy event link for browser</button><p id="event-link-status" class="success-note" role="status" aria-live="polite">If your calendar opens without the event, copy this link into Safari or your browser and sign in with the Google account invited to this meeting.</p><button id="close-assistant" type="button" class="secondary">Close Window</button></div></section>`);
  }catch(error){reply(res,400,`<h2>Handoff not confirmed</h2><p>${escape(error instanceof BookingError?error.message:'Google Calendar did not confirm the handoff. Retry the same form; recovery also runs automatically.')}</p><a href="/book">Back to form</a>`);}
  finally{session.busy=false;}
  return true;
 }};
}
