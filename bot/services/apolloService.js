import {createHash} from 'node:crypto';

const DAY=86400000;
const text=value=>typeof value==='string'?value.trim():'';
const normalized=value=>text(value).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ');
const email=value=>/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(text(value))?text(value).toLowerCase():'';
const personalDomains=new Set(['gmail.com','googlemail.com','yahoo.com','hotmail.com','outlook.com','live.com','icloud.com','me.com','aol.com','proton.me','protonmail.com','mail.ru','yandex.ru']);
const excludedDomains=new Set([...personalDomains,'linkedin.com','facebook.com','instagram.com','t.me','telegram.me','x.com','twitter.com','linktr.ee']);
function website(value){
 const input=text(value);if(!input||/[\s\\\u0000-\u001f\u007f]/u.test(input))return '';
 try{const u=new URL(/^https?:\/\//i.test(input)?input:'https://'+input);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||!u.hostname.includes('.')||!/[a-z]/i.test(u.hostname)||u.hostname.endsWith('.local'))return '';return /^https?:\/\//i.test(input)?input:u.href;}catch{return '';}
}
function domain(value){const url=website(value);if(!url)return '';const host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');if([...excludedDomains].some(d=>host===d||host.endsWith('.'+d)))return '';return host;}
function linkedin(value){
 const url=website(value);if(!url)return '';
 const u=new URL(url);if(!/^(www\.)?linkedin\.com$/i.test(u.hostname)||!/^\/in\/[\p{L}\p{N}_%-]+\/?$/u.test(u.pathname))return '';
 return 'https://www.linkedin.com'+u.pathname.replace(/\/$/,'');
}
function identifiers(lead){
 const f=lead.fields||{};
 const input={name:text(f.fullName),organization_name:text(f.company),email:email(f.email),linkedin_url:linkedin(f.linkedin),domain:domain(f.website)};
 return Object.fromEntries(Object.entries(input).filter(([,v])=>v));
}
const fingerprint=lead=>createHash('sha256').update(JSON.stringify(identifiers(lead))).digest('hex');
const actionable=input=>Boolean(input.email||input.linkedin_url||input.domain&&input.name?.split(/\s+/).length>=2);
function safeMatch(data,input){
 const p=data?.person;
 if(p==null)return {status:'not_found'};
 if(typeof p!=='object'||Array.isArray(p))return {status:'ambiguous'};
 const confidence=data.match_confidence??p.match_confidence;
 if(confidence!==undefined&&confidence!=='high')return {status:'ambiguous'};
 const returnedEmail=email(p.email),returnedLinkedin=linkedin(p.linkedin_url);
 if(input.email&&returnedEmail&&input.email!==returnedEmail||input.linkedin_url&&returnedLinkedin&&input.linkedin_url!==returnedLinkedin)return {status:'ambiguous'};
 const exact=Boolean(input.email&&input.email===returnedEmail||input.linkedin_url&&input.linkedin_url===returnedLinkedin);
 const returnedDomain=domain(p.organization?.primary_domain)||domain(p.organization?.website_url);
 const name=normalized(p.name||[p.first_name,p.last_name].filter(Boolean).join(' '));
 if(!exact&&!(confidence==='high'&&input.domain===returnedDomain&&input.name&&normalized(input.name)===name))return {status:'ambiguous'};
 // A contradictory full name is unsafe even when another identifier matches.
 if(input.name&&name&&normalized(input.name)!==name)return {status:'ambiguous'};
 const fields={jobTitle:text(p.title).slice(0,250),linkedin:returnedLinkedin,
  website:returnedDomain?website(p.organization?.website_url)||'https://'+returnedDomain:'',
  address:[p.city,p.state,p.country].map(text).filter(Boolean).join(', ').slice(0,350)};
 if(p.email_status==='verified'&&returnedEmail&&!personalDomains.has(returnedEmail.split('@')[1]))fields.email=returnedEmail;
 return {personId:text(p.id).slice(0,100),confidence:confidence||'exact_identifier',fields};
}

/** One synchronous people lookup; no phone, personal email, waterfall or automatic retries. */
export function createApolloService({apiKey=process.env.APOLLO_API_KEY||'',fetch:request=globalThis.fetch,now=Date.now,timeoutMs=15000}={}){
 const active=new Set();let blockedUntil=0,blockedStatus='rate_limited';
 return {async enrich(lead,{persist=()=>{},canApply=()=>true}={}){
  if(!canApply()||lead.deletedAt)return {status:'changed'};
  if(active.has(lead.id))return {status:'busy'};
  const previous=lead.enrichment?.apollo;
  if(['updated','unchanged'].includes(previous?.status))return {status:'cached',previousStatus:previous.status,retryAt:previous.retryAt};
  if(!apiKey)return {status:'not_configured'};
  const input=identifiers(lead),hash=fingerprint(lead),stamp=now();
  if(!actionable(input))return {status:'needs_identity'};
  if(previous&&[previous.fingerprint,previous.appliedFingerprint].includes(hash)&&Number(previous.retryAt)>stamp)return {status:'cached',previousStatus:previous.status,retryAt:previous.retryAt};
  if(blockedUntil>stamp)return {status:blockedStatus,retryAt:blockedUntil};
  active.add(lead.id);
  const record={source:'Apollo',fingerprint:hash,status:'pending',startedAt:new Date(stamp).toISOString(),retryAt:stamp+DAY,fields:{...previous?.fields}};
  lead.enrichment||={};lead.enrichment.apollo=record;
  let result;
  try{
   // Durable pending marker prevents replaying an unknown paid request after restart.
   persist();
   try{
    const res=await request('https://api.apollo.io/api/v1/people/match',{method:'POST',redirect:'error',headers:{'content-type':'application/json','accept':'application/json','x-api-key':apiKey},body:JSON.stringify({...input,reveal_personal_emails:false,reveal_phone_number:false,run_waterfall_email:false,run_waterfall_phone:false}),signal:AbortSignal.timeout(timeoutMs)});
    if(!res.ok){
     const status=({401:'auth_error',403:'access_error',422:'invalid_request',400:'invalid_request',429:'rate_limited',402:'credits_exhausted'})[res.status]||'unavailable';
     const retrySeconds=Number(res.headers.get('retry-after'));
     const wait=status==='rate_limited'?Math.max(60000,Math.min(DAY,Number.isFinite(retrySeconds)?retrySeconds*1000:60000)):status==='unavailable'?300000:60000;
     result={status};record.retryAt=now()+wait;
     if(['auth_error','access_error','rate_limited','credits_exhausted'].includes(status)){blockedUntil=record.retryAt;blockedStatus=status;}
    }else{
     const data=await res.json();const match=safeMatch(data,input);
     if(!canApply()||lead.deletedAt||fingerprint(lead)!==hash)result={status:'changed'};
     else if(match.status)result={status:match.status};
     else{
      const added=[];const at=new Date(now()).toISOString();
      for(const [key,value] of Object.entries(match.fields)){
       if(!value||text(lead.fields[key]))continue;
       lead.fields[key]=value;added.push(key);
       record.fields[key]={source:'Apollo',at,personId:match.personId};
      }
      if(added.length){lead.updatedAt=at;lead.status='draft';}
      Object.assign(record,{personId:match.personId,confidence:match.confidence,appliedFingerprint:fingerprint(lead)});
      result={status:added.length?'updated':'unchanged',fields:added};
     }
    }
   }catch(error){
    result={status:['TimeoutError','AbortError'].includes(error?.name)?'timeout':'unavailable'};
    // Network/parse failures may follow a charged call. Retain 24h cooldown.
   }
   record.status=result.status;record.completedAt=new Date(now()).toISOString();persist();
   return result;
  }finally{active.delete(lead.id);}
 }};
}

export function apolloNotice(result){
 if(result.status==='cached'&&['updated','unchanged'].includes(result.previousStatus))return 'Already enriched via Apollo';
 const messages={updated:'Apollo: lead updated. Existing values were kept.',unchanged:'Apollo: match found; no new fields to add.',not_found:'Apollo: no match found. Lead unchanged.',ambiguous:'Apollo: the match could not be confirmed. Lead unchanged.',needs_identity:'Apollo: add an email, a LinkedIn profile, or a full name and company website first.',not_configured:'Apollo is not configured. Contact an administrator.',busy:'Apollo is already searching for this lead…',changed:'Apollo: the lead or your access changed during the search. No data applied.',auth_error:'Apollo: API key is invalid or expired. Contact an administrator.',access_error:'Apollo: API access or plan permission is missing. Contact an administrator.',credits_exhausted:'Apollo: credits are exhausted. Contact an administrator.',rate_limited:'Apollo: request limit reached. Please try later.',invalid_request:'Apollo: identifiers could not be processed. Check the lead details.',unavailable:'Apollo is temporarily unavailable. No automatic retry was sent.',timeout:'Apollo search timed out. No automatic retry was sent.'};
 if(result.status==='cached')return 'Apollo: a recent search is already recorded ('+(messages[result.previousStatus]||'result unknown')+'). No new request was sent; try again later.';
 return messages[result.status]||messages.unavailable;
}
