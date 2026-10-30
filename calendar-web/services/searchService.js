function localDate(value, timeZone) {
 const date = new Date(value);
 if (!Number.isFinite(date.getTime())) return null;
 const parts = new Intl.DateTimeFormat('en-US', {timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const get = type => parts.find(p=>p.type===type).value;
 return Date.UTC(Number(get('year')),Number(get('month'))-1,Number(get('day')));
}

// Shared visibility is independent from Created / Assigned filters and edit rights.
export function searchLeads(leads, {owner,period='all',sharedLeads=false,scope=sharedLeads?'all':'created',query='',timeZone='UTC',now=new Date()}) {
 const today=localDate(now,timeZone), day=86400000;
 const weekday=new Date(today).getUTCDay();
 const monday=today-((weekday+6)%7)*day;
 const needle=String(query).trim().toLocaleLowerCase();
 return leads.filter(lead=> {
  const assigned=String(lead.assigneeId||'')===String(owner).split(':').at(-1);
  if ((!sharedLeads&&lead.owner!==owner&&!assigned) || lead.deletedAt) return false;
  if (scope==='created'&&lead.owner!==owner)return false;
  if (scope==='assigned' && String(lead.assigneeId||'')!==String(owner).split(':').at(-1)) return false;
  const created=localDate(lead.createdAt,timeZone);
  if (period==='today' && created!==today) return false;
  if (period==='yesterday' && created!==today-day) return false;
  if (period==='week' && (created===null || created<monday || created>today)) return false;
  const text=[lead.id,...Object.values(lead.fields||{})].join(' ').toLocaleLowerCase();
  return !needle || text.includes(needle);
 }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
