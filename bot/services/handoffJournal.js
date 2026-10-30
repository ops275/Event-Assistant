import fs from 'node:fs';
import path from 'node:path';
import {atomicJson} from './adminService.js';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string';
const date=value=>text(value)&&Number.isFinite(Date.parse(value));
const person=value=>object(value)&&/^\d+$/.test(value.id)&&text(value.id)&&text(value.name);
const calendar=value=>object(value)&&text(value.id)&&Boolean(value.id)&&text(value.timeZone);
export function validHandoff(record){
 if(!object(record)||!/^ea[a-f0-9]{64}$/.test(record.id)||!text(record.leadId)||!record.leadId||!date(record.createdAt)||!['pending','confirmed','rejected'].includes(record.status)||!person(record.sender)||!person(record.creator)||!person(record.receiver)||!calendar(record.calendar)||!calendar(record.receiverCalendar)||!['offline','online'].includes(record.meetingType)||!text(record.description)||!Array.isArray(record.guests)||record.guests.some(email=>!text(email))||!object(record.notifications)||!text(record.fingerprint)||!/^[a-f0-9]{64}$/.test(record.fingerprint)||typeof record.inbox!=='boolean')return false;
 const request=record.request;
 if(record.organizer!==undefined&&!person(record.organizer))return false;
 if(!object(request)||request.id!==record.id||!text(request.summary)||!text(request.description)||!text(request.location)||!date(request.start?.dateTime)||!date(request.end?.dateTime)||!Array.isArray(request.attendees)||request.attendees.some(a=>!object(a)||!text(a.email))||request.extendedProperties?.private?.handoffId!==record.id)return false;
 if(record.insertAttempted!==undefined&&typeof record.insertAttempted!=='boolean')return false;
 if(Object.entries(record.notifications).some(([id,value])=>!/^\d+$/.test(id)||!object(value)||!['sending','sent','failed','uncertain','skipped'].includes(value.status)||(value.retryAt!==undefined&&!date(value.retryAt))))return false;
 return record.status!=='confirmed'||object(record.event)&&record.event.id===record.id&&date(record.confirmedAt)&&[record.event.summary,record.event.htmlLink,record.event.hangoutLink].every(value=>value===undefined||text(value));
}

// The web process writes only this append-per-event journal, never the bot state.
export class HandoffJournal {
 constructor(stateFile){this.directory=stateFile+'.handoffs';fs.mkdirSync(this.directory,{recursive:true,mode:0o700});this.errors=[];}
 file(id){if(!/^ea[a-f0-9]{64}$/.test(id))throw Error('Invalid handoff ID');return path.join(this.directory,id+'.json');}
 get(id){const file=this.file(id);if(!fs.existsSync(file))return null;try{const record=JSON.parse(fs.readFileSync(file,'utf8'));if(record.id!==id||!validHandoff(record))throw Error('Invalid record');return record;}catch{if(!this.errors.includes(id+'.json'))this.errors.push(id+'.json');throw Error('Handoff journal record is damaged; contact an administrator.');}}
 put(record){atomicJson(this.file(record.id),record);if(process.platform!=='win32'){const fd=fs.openSync(this.directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}return record;}
 records(){this.errors=[];return fs.readdirSync(this.directory).filter(name=>/^ea[a-f0-9]{64}\.json$/.test(name)).flatMap(name=>{try{const value=JSON.parse(fs.readFileSync(path.join(this.directory,name),'utf8'));if(value.id+'.json'!==name||!validHandoff(value))throw Error('Invalid record');return [value];}catch{this.errors.push(name);return [];}});}
}
export function projectHandoffs(state,records){
 for(const record of records.filter(r=>validHandoff(r)&&r.status==='confirmed').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))){
  const lead=state.leads?.[record.leadId];if(!lead||lead.deletedAt)continue;
  const handoff={id:record.id,status:'Handed off for manager',sender:record.sender,receiver:record.receiver,creator:record.creator,organizer:record.organizer||record.creator,at:record.createdAt,meetingType:record.meetingType,note:record.description,description:record.description,guests:record.guests,location:record.request.location,event:{id:record.event.id,calendarId:record.calendar.id,url:record.event.htmlLink},notifications:record.notifications};
  const history=(lead.handoffHistory||[]).filter(h=>h.id!==record.id);history.push(handoff);history.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));lead.handoffHistory=history;lead.handoff=history.at(-1);lead.assigneeId=lead.handoff.receiver.id;
  lead.handoffNote=lead.handoff.note;
 }
 return state;
}
export function readHandoffState(file,journal=new HandoffJournal(file)){return projectHandoffs(JSON.parse(fs.readFileSync(file,'utf8')),journal.records());}

export function handoffForRole(lead,role){
 if(['admin','partnership'].includes(role))return lead;
 const copy=structuredClone(lead);delete copy.handoffNote;
 for(const handoff of [copy.handoff,...(copy.handoffHistory||[])])if(handoff){delete handoff.note;delete handoff.description;}
 return copy;
}
