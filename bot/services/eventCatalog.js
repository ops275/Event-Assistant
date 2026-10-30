import {randomBytes} from 'node:crypto';

export const SIGMA_WORLD_ROME=Object.freeze({id:'sigma-world-rome-2026',name:'SiGMA World Rome',startDate:'2026-11-02',endDate:'2026-11-05',timeZone:'Europe/Rome',location:'Fiera Roma',url:'https://sigma.world/summits/world/',archived:false});
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value+'T00:00:00Z'));
const clean=value=>String(value||'').trim();
function validate(input,id){
 const event={id,name:clean(input.name),startDate:clean(input.startDate),endDate:clean(input.endDate),timeZone:clean(input.timeZone)||'UTC',location:clean(input.location),url:clean(input.url),archived:Boolean(input.archived)};
 if(!/^[a-z0-9][a-z0-9-]{2,79}$/.test(event.id)||!event.name||event.name.length>120)throw new Error('Event name is required.');
 if(!date(event.startDate)||!date(event.endDate)||event.endDate<event.startDate)throw new Error('Choose a valid event date range.');
 try{new Intl.DateTimeFormat('en',{timeZone:event.timeZone});}catch{throw new Error('Choose a valid time zone.');}
 if(event.location.length>160)throw new Error('Event location is too long.');
 if(event.url){let url;try{url=new URL(event.url);}catch{throw new Error('Event URL must use https.');}if(url.protocol!=='https:'||url.username||url.password)throw new Error('Event URL must use https.');event.url=url.href;}
 return event;
}
export function allEvents(settings={}){
 const items=new Map([[SIGMA_WORLD_ROME.id,SIGMA_WORLD_ROME],...(settings.events||[]).map(item=>[item.id,item])]);
 return [...items.values()].map(item=>validate(item,item.id)).sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.name.localeCompare(b.name));
}
export function activeEvent(settings={}){const id=settings.activeEventId===undefined?SIGMA_WORLD_ROME.id:settings.activeEventId;return allEvents(settings).find(item=>item.id===id&&!item.archived)||null;}
export function saveEvent(admin,actor,input,{idFactory}={}){
 admin.requireAdmin(actor);const id=clean(input.id)||(idFactory?idFactory():clean(input.name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,62)+'-'+randomBytes(4).toString('hex'));
 const item={...validate(input,id),createdAt:new Date().toISOString(),createdBy:String(actor)},settings=admin.read(),events=allEvents(settings).filter(event=>event.id!==id);events.push(item);settings.events=events;settings.audit=[...(settings.audit||[]),{at:item.createdAt,actor:String(actor),change:{event:id,action:'saved'}}].slice(-200);admin.save(settings);return item;
}
export function setActiveEvent(admin,actor,id){
 admin.requireAdmin(actor);id=clean(id);const settings=admin.read();if(id&&!allEvents(settings).some(item=>item.id===id&&!item.archived))throw new Error('Choose an available event.');settings.activeEventId=id||null;settings.audit=[...(settings.audit||[]),{at:new Date().toISOString(),actor:String(actor),change:{activeEventId:settings.activeEventId}}].slice(-200);admin.save(settings);return activeEvent(settings);
}
