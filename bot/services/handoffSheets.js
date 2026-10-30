import {createHash} from 'node:crypto';
export function createHandoffSheetsSync({store,sheets}){
 let running=false;
 return async()=>{
  if(running||!sheets.configured())return;running=true;
  try{
   store.ingestHandoffs();
   for(const lead of Object.values(store.state.leads)){
    if(lead.deletedAt||!lead.handoff)continue;
    const version=createHash('sha256').update(JSON.stringify(lead.handoffHistory)).digest('hex');
    if(lead.handoffSheetsSync?.version===version&&lead.handoffSheetsSync.status==='synced')continue;
    const snapshot=structuredClone(lead);
    lead.handoffSheetsSync={status:'pending',version,attemptedAt:new Date().toISOString()};store.save();
    try{const result=await sheets.save(snapshot);lead.handoffSheetsSync={...result,status:'synced',version};}
    catch{lead.handoffSheetsSync={status:'failed',version,attemptedAt:new Date().toISOString()};}
    store.save();
   }
  }finally{running=false;}
 };
}
