import {createHash} from 'node:crypto';
export function manualMeetingLead(input,submission,owner){
 const fullName=String(input.get('fullName')||'').trim(),company=String(input.get('company')||'').trim();
 if(!fullName||!company||fullName.length>150||company.length>150)throw new Error('Enter a name and company (up to 150 characters each).');
 return {id:'manual-'+createHash('sha256').update(submission).digest('hex'),owner,manualBooking:true,fields:{fullName,company}};
}
export function manualReminderLead(event,calendarOwner){
 const meta=event.extendedProperties?.private;
 if(meta?.source!=='onlyplay-local-test'||!/^manual-[a-f0-9]{64}$/.test(meta.leadId||'')||String(meta.managerTelegramId)!==String(calendarOwner)||!meta.manualName||!meta.manualCompany)return null;
 return {id:meta.leadId,owner:meta.managerTelegramId+':'+meta.managerTelegramId,fields:{fullName:meta.manualName,company:meta.manualCompany}};
}
