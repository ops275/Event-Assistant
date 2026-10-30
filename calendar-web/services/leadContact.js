export const isGuestEmail=value=>/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(value||''));
export const fallbackLeadContact=lead=>['email','telegram','phone','linkedin','otherContacts','telegramId','contactId','website'].map(key=>String(lead?.fields?.[key]||'').trim()).find(Boolean)||'';
export const leadContactEmails=value=>{const values=String(value||'').split(/[\s,;]+/).filter(Boolean);return values.length&&values.every(isGuestEmail)?values.map(v=>v.toLowerCase()):[];};
export const savedLeadContact=lead=>String(lead?.handoff?.leadContact??fallbackLeadContact(lead));
export const extraLeadGuests=lead=>{const primary=new Set(leadContactEmails(savedLeadContact(lead)));return (Array.isArray(lead?.handoff?.guests)?lead.handoff.guests:[]).filter(email=>!primary.has(String(email).toLowerCase()));};
