import {createHash} from 'node:crypto';

// A routing identifier, never an authorization credential.
export const leadPayload=id=>'lead_'+createHash('sha256').update(String(id)).digest('base64url');
export const startLeadPayload=text=>String(text||'').match(/^\/start(?:@\w+)?\s+(lead_\S+)\s*$/)?.[1]||'';
export const validLeadPayload=value=>/^lead_[A-Za-z0-9_-]{43}$/.test(value);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export const botUrl=()=>{const name=process.env.BOT_NAME||'Leadgen_Ass1stant_bot';if(!/^[A-Za-z0-9_]{5,32}$/.test(name))throw new Error('Invalid bot name');return 'https://t.me/'+name;};
export function calendarLeadDescription(description,leadId){
 const url=botUrl()+'?start='+leadPayload(leadId);
 return escape(description).replaceAll('\n','<br>')+'<br><br><a href="'+url+'">Read more</a>';
}
