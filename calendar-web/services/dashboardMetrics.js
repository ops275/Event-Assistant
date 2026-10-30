const day=value=>String(value||'').slice(0,10);
const pct=(part,total)=>total?Math.round(part*1000/total)/10:0;
const median=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;const mid=Math.floor(sorted.length/2),value=sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;return Math.round(value*10)/10;};
const title=value=>String(value||'Unknown').replace(/(^|-)([a-z])/g,(_,space,char)=>(space?' ':'')+char.toUpperCase());
const series=map=>[...map].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label));
const countBy=(items,key)=>series(items.reduce((map,item)=>{const label=key(item)||'Unknown';map.set(label,(map.get(label)||0)+1);return map;},new Map()));
const isoDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value:null;
function dateRange(from,to){const start=isoDate(from)||'1970-01-01',end=isoDate(to)||'9999-12-31';if(end<start)throw new Error('Invalid dashboard range.');return {start,end};}
function trend(items,getDate,start,end,bucket){
 const values=new Map(),cursor=new Date(start+'T00:00:00Z'),last=new Date(end+'T00:00:00Z');
 while(cursor<=last){const key=bucket==='week'?day(new Date(cursor.getTime()-((cursor.getUTCDay()+6)%7)*86400000)):day(cursor);values.set(key,0);cursor.setUTCDate(cursor.getUTCDate()+(bucket==='week'?7:1));}
 for(const item of items){const raw=day(getDate(item)),d=new Date(raw+'T00:00:00Z'),key=bucket==='week'?day(new Date(d.getTime()-((d.getUTCDay()+6)%7)*86400000)):raw;if(values.has(key))values.set(key,values.get(key)+1);}
 return [...values].map(([label,value])=>({label,value}));
}
export function dashboardSnapshot({leads=[],handoffs=[],onboarding=[],users={},from,to,eventId=''}){
 const {start,end}=dateRange(from,to),days=Math.floor((Date.parse(end)-Date.parse(start))/86400000)+1,bucket=days>45?'week':'day';
 const real=leads.filter(lead=>!lead.deletedAt&&!lead.mockData),byId=new Map(real.map(lead=>[lead.id,lead]));
 const eventLeads=real.filter(lead=>!eventId||lead.eventId===eventId),visibleLeads=eventLeads.filter(lead=>day(lead.createdAt)>=start&&day(lead.createdAt)<=end),allowed=new Set(eventLeads.map(lead=>lead.id));
 const historical=real.flatMap(lead=>(lead.handoffHistory||[]).map(item=>({...item,leadId:lead.id,createdAt:item.createdAt||item.at,status:item.status==='Handed off for manager'?'confirmed':item.status}))),mergedHandoffs=[...new Map([...handoffs,...historical].map(item=>[item.id,item])).values()];
 const visibleHandoffs=mergedHandoffs.filter(item=>item.status==='confirmed'&&byId.has(item.leadId)&&(!eventId||allowed.has(item.leadId))&&day(item.createdAt)>=start&&day(item.createdAt)<=end);
 const visibleOnboarding=onboarding.filter(item=>(!eventId||allowed.has(item.leadId))&&day(item.createdAt)>=start&&day(item.createdAt)<=end);
 const contacts=['email','telegram','phone','linkedin'];
 const leadTimes=id=>Date.parse(byId.get(id)?.createdAt);
 return {meta:{from:start,to:end,eventId,bucket,generatedAt:new Date().toISOString()},leads:{
  total:visibleLeads.length,savedRate:pct(visibleLeads.filter(item=>item.status==='saved').length,visibleLeads.length),handoffRate:pct(new Set(visibleHandoffs.map(item=>item.leadId)).size,visibleLeads.length),onboardingRate:pct(new Set(visibleOnboarding.map(item=>item.leadId)).size,visibleLeads.length),contactableRate:pct(visibleLeads.filter(item=>contacts.some(key=>item.fields?.[key])).length,visibleLeads.length),
  trend:trend(visibleLeads,item=>item.createdAt,start,end,bucket),byCreator:countBy(visibleLeads,item=>item.actorName||users[item.actorId]?.name||item.actor||'Unknown'),byFlow:countBy(visibleLeads,item=>title(item.creationFlow||'unknown')),byIcp:countBy(visibleLeads,item=>item.fields?.icp||'Unknown'),byStatus:countBy(visibleLeads,item=>title(item.status)),
 },handoffs:{total:visibleHandoffs.length,uniqueLeads:new Set(visibleHandoffs.map(item=>item.leadId)).size,onlineRate:pct(visibleHandoffs.filter(item=>item.meetingType==='online').length,visibleHandoffs.length),medianLeadToHandoffHours:median(visibleHandoffs.map(item=>(Date.parse(item.createdAt)-leadTimes(item.leadId))/3600000)),trend:trend(visibleHandoffs,item=>item.createdAt,start,end,bucket),bySender:countBy(visibleHandoffs,item=>item.sender?.name||'Unknown'),byReceiver:countBy(visibleHandoffs,item=>item.receiver?.name||'Unknown'),byType:countBy(visibleHandoffs,item=>title(item.meetingType))},onboarding:{total:visibleOnboarding.length,uniqueLeads:new Set(visibleOnboarding.map(item=>item.leadId)).size,readyRate:pct(visibleOnboarding.filter(item=>item.status==='ready').length,visibleOnboarding.length),medianLeadToOnboardingHours:median(visibleOnboarding.map(item=>(Date.parse(item.createdAt)-leadTimes(item.leadId))/3600000)),trend:trend(visibleOnboarding,item=>item.createdAt,start,end,bucket),byType:countBy(visibleOnboarding,item=>title(item.type)),byStatus:countBy(visibleOnboarding,item=>title(item.status))}};
}
