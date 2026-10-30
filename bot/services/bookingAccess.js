import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const sign=(secret,value)=>createHmac('sha256',secret).update(value).digest('base64url');
export function issueBookingTicket(secret,identity,now=Date.now()) {
 if(!secret||!identity.owner||!identity.userId)throw new Error('Missing booking identity');
 const payload=Buffer.from(JSON.stringify({...identity,expires:now+10*60*1000,nonce:randomBytes(18).toString('hex')})).toString('base64url');
 return payload+'.'+sign(secret,payload);
}
export function verifyBookingTicket(secret,ticket,now=Date.now()) {
 if(!secret||typeof ticket!=='string'||ticket.length>2500)throw new Error('Invalid booking ticket');
 const [payload,signature,extra]=ticket.split('.');
 if(!payload||!signature||extra)throw new Error('Invalid booking ticket');
 const expected=Buffer.from(sign(secret,payload)),actual=Buffer.from(signature);
 if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new Error('Invalid booking ticket');
 const result=JSON.parse(Buffer.from(payload,'base64url').toString());
 if(!result.owner||!result.userId||!result.nonce||!Number.isFinite(result.expires)||result.expires<=now)throw new Error('Expired booking ticket');
 return result;
}

export function verifyTelegramInitData(botToken,initData,now=Date.now()) {
 if(typeof initData!=='string'||!initData||initData.length>16000)throw new Error('Invalid Telegram data');
 const params=new URLSearchParams(initData);
 if([...params.keys()].length!==new Set(params.keys()).size)throw new Error('Duplicate Telegram fields');
 const hash=params.get('hash');if(!/^[a-f0-9]{64}$/i.test(hash||''))throw new Error('Invalid Telegram hash');
 params.delete('hash');
 const check=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>key+'='+value).join('\n');
 const secret=createHmac('sha256','WebAppData').update(botToken).digest();
 const expected=createHmac('sha256',secret).update(check).digest();
 if(!timingSafeEqual(expected,Buffer.from(hash,'hex')))throw new Error('Invalid Telegram signature');
 const date=Number(params.get('auth_date'));
 if(!Number.isFinite(date)||date*1000>now+30000||now-date*1000>10*60*1000)throw new Error('Expired Telegram data');
 const user=JSON.parse(params.get('user')||'null');
 if(!Number.isSafeInteger(user?.id)||user.id<=0||user.is_bot)throw new Error('Invalid Telegram user');
 return user;
}

export function miniappDestination(ticket,{requireCalendar,connected}){
 const intent=ticket.intent||'book';if(intent==='calendar')return '/calendar';
 return intent==='dashboard'?'/dashboards':intent==='dashboard-events'?'/dashboards?tab=events':intent==='onboarding'?'/onboarding':intent==='ae-slots'?'/ae-slots':intent==='booking-links'?'/booking-links':bookingDestination(ticket);
}

export function bookingDestination(identity){
 const params=[...(identity.leadId?['lead='+encodeURIComponent(identity.leadId)]:[]),...(identity.managerId?['manager='+encodeURIComponent(identity.managerId)]:[])];
 return '/book'+(params.length?'?'+params.join('&'):'');
}

export function rememberBookingLead(identity,params){
 const leadId=params.get('lead')||'';
 if(identity)identity.leadId=leadId||undefined;
 return leadId;
}
