// Local retrieval remains available when the AI service is slow or unavailable.
const normal=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const letters={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
const key=value=>normal(value).replace(/[а-я]/g,c=>letters[c]).replace(/ph/g,'f').replace(/ks/g,'x');
const words=value=>(normal(value).match(/[\p{L}\p{N}]+/gu)||[]).map(key);
const nameFamilies=[
 'daniel dan dani danny danni denni danil daniil deniil danya dania danyal daniyal den deniel',
 'alexander aleksandr alexandr alex sasha sasha sanya', 'alexandra aleksandra sasha sandra',
 'alexey alexei aleksey aleksei alyosha alesha', 'anna ana anya ania ann anne',
 'ivan vanya vania', 'michael mike mikhail mihail misha mikhael maikl',
 'julia yulia yuliya yulya yulja yulya yuliana', 'dmitriy dmitry dmitri dima',
 'sofia sophia sofiya sofya sonya sonia', 'elena yelena helena lena',
 'sergey sergei seryozha serezha', 'nikolay nikolai nikolas nicholas nick kolya',
 'mark marc', 'peter petr pyotr petya', 'robert bob bobby rob', 'william bill billy will',
 'james jim jimmy джеймс', 'john jack johnny джон', 'thomas tom tommy', 'benjamin ben benny',
 'elizabeth liz lizzy beth елизавета лиза', 'katherine catherine kate katya ekaterina katerina',
 'andrey andrei andrew andy', 'anton anthony tony', 'vladimir volodya vova',
 'steven stephen steve', 'richard rick dick', 'jose joseph joe', 'matthew matt',
 'natalia natalya natasha', 'anastasia anastasiya nastya', 'victoria viktoria vika',
 'eugene evgeniy evgeny zhenya', 'denis dennis', 'timothy tim timofey timofei',
];
const concepts=[
 'integration integrations integrate integrated integrating интеграц интеграция интеграции интеграцию',
 'presentation presentations deck pitchdeck презентац презентация презентацию презентации преза презу',
 'materials material материал материалы материалов материалами',
 'demo demos demonstration демонстрац демонстрация демонстрацию демо',
 'payment payments платеж платежи платежей платежами оплата оплату',
 'operator operators оператор оператора оператором операторы',
 'aggregator aggregators агрегатор агрегатора агрегаторы',
];
function families(groups){const map=new Map();groups.forEach((group,index)=>{for(const token of words(group)){if(!map.has(token))map.set(token,new Set());map.get(token).add(index);}});return map;}
const aliases=families(nameFamilies),meanings=families(concepts);
const sameFamily=(map,a,b)=>map.has(a)&&map.has(b)&&[...map.get(a)].some(id=>map.get(b).has(id));
const stop=new Set(words('я мы ты вы он она они с со к у в во на о об от за по про и или то ли да же а но для из до как что это этого тот того этим там тогда когда когда-то помню помнил помните кажется вроде возможно наверное точно примерно общался общалась общались общаться общение говорил говорили разговаривал разговаривали человеком человека человек чел челом челика челик кем кем-то ним ними его ее ему мне нас нам был была были звали имя найди найти поищи пожалуйста привет бот контакт somebody someone sometime remember remembered recall spoke spoken talked talking think maybe perhaps either or the a an i we you he she they with to from at about of on in is was were his her them that who called named name find search please hello hi bot me my our it once dont sure do not know')); 
function distance(a,b,limit){
 if(Math.abs(a.length-b.length)>limit)return limit+1;
 let before,previous=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const row=[i];let minimum=i;
  for(let j=1;j<=b.length;j++){
   row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
   if(before&&i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])row[j]=Math.min(row[j],before[j-2]+1);
   minimum=Math.min(minimum,row[j]);
  }
  if(minimum>limit)return limit+1;
  before=previous;previous=row;
 }
 return previous[b.length];
}
function scoreWord(a,b,name=false){
 if(a===b)return 100;
 if(sameFamily(name?aliases:meanings,a,b))return 90;
 if(Math.min(a.length,b.length)>=4&&/^\p{L}+$/u.test(a)&&/^\p{L}+$/u.test(b)&&a.length<40&&b.length<40){
  const limit=Math.min(a.length,b.length)>=8?2:1;
  if(distance(a,b,limit)<=limit)return 72;
  if(!name&&a.length>=5&&b.length>=5&&(a.startsWith(b)||b.startsWith(a)))return 68;
 }
 return 0;
}
const bestScore=(token,candidates,name=false)=>{let best=0;for(const candidate of candidates){best=Math.max(best,scoreWord(token,candidate,name));if(best===100)break;}return best;};
export function searchSources(lead){return [lead.id,...Object.values(lead.fields||{}),...(lead.materials||[]).filter(m=>!['excluded','omitted'].includes(m.status)).map(m=>m.transcript||m.text||'')].filter(v=>typeof v==='string'&&v.trim());}
const requestNouns=new Set(words('лид лида лидов лиды контакта контакты lead leads contact contacts'));
const requestVerbs=new Set(words('найди найти поищи find search'));
const discourse=new Set(words('короче такой такая такии этот эта пацан пацана парень парня чувак чувака мужик мужика блин блядь блять бля сука нахуй по-моему как-то ну вот типа вообще обсуждали обсуждал обсуждала обсуждать обсудили discuss discussed damn fucking fuck shit dude guy anyway basically sort kinda'));
function requestContent(value){
 return value
  // Strip grammatical request clauses, not arbitrary words from the user's clues.
  .replace(/(?:^|\s)(?:лид(?:а|ов|ы)?|льда|контакт(?:а|ы)?)[\s,]+(?=котор(?:ого|ы[йи]|ую|ая|ые)|по\s+имени|с\s+именем)/gu,' ')
  .replace(/(?:^|\s)котор(?:ого|ы[йи]|ую|ая|ые)\s+(?:зовут|звали|имеет\s+имя)(?=\s|$)/gu,' ')
  .replace(/(?:^|\s)(?:по\s+имени|с\s+именем)(?=\s|$)/gu,' ')
  .replace(/\b(?:a\s+|the\s+)?(?:lead|contact|person)\s+(?=whose\s+name\s+is|who\s+is\s+(?:called|named)|named|called)/gu,' ')
  .replace(/\b(?:whose\s+name\s+is|who\s+is\s+(?:called|named))\b/gu,' ')
  // ASR can retain a restarted syllable: "Дэ... Дэниил". Only remove it
  // when the following word completes that same prefix.
  .replace(/(?<![\p{L}\p{N}])([\p{L}]{1,3})\s*(?:\.{3}|…)\s*([\p{L}]+)/gu,(all,fragment,completion)=>key(completion).startsWith(key(fragment))?completion:all);
}
export function analyzeSearchQuery(query,leads){
 const clean=normal(query).replace(/не\s+помню|не\s+уверен(?:а)?|not\s+sure|(?:do\s+not|don'?t)\s+(?:fucking\s+)?remember|(?:ху[йи]|хрен|черт)\s+зна(?:ет|ю)|хз/gu,' ');
 const catalog=[...new Set(leads.flatMap(l=>words(l.fields?.fullName||'')))];
 const identities=new Set(leads.flatMap(l=>words([l.fields?.fullName,l.fields?.company].filter(Boolean).join(' '))));
 const hasRequest=words(clean).some(word=>requestVerbs.has(word));
 const tokens=[...new Set(words(requestContent(clean)).filter(word=>identities.has(word)||(!stop.has(word)&&!discourse.has(word)&&!(hasRequest&&requestNouns.has(word)))))].slice(0,32);
 const named=new Set(),nameContext=/(?:звали|зовут|имя|\bname\b|\bcalled\b|\bnamed\b)/iu.test(query);
 for(const match of String(query).matchAll(/(?:^|[\s,;])(?:то\s+ли|или|either|or|maybe|perhaps)\s+([\p{L}]+)/giu)){
  const token=key(match[1]);if((nameContext||/^\p{Lu}/u.test(match[1]))&&!stop.has(token)&&!discourse.has(token)&&!meanings.has(token))named.add(token);
 }
 // A missing candidate is still an alternative name, never an extra AND clue.
 const units=tokens.map(token=>({token,nameScore:Math.max(bestScore(token,catalog,true),aliases.has(token)||named.has(token)?72:0)}));
 const requiresAI=/(?:^|\s)(?:не|нет|без|кроме|not|except|without|вчера|сегодня|позавчера|yesterday|today|last|прошл\p{L}*|недел\p{L}*|месяц\p{L}*)(?=\s|$)|\d{4}-\d{2}-\d{2}/u.test(clean);
 const uncertain=/(?:то\s+ли|или|maybe|perhaps|either|\bor\b)/u.test(clean);
 return {units,requiresAI,uncertain,isNameOnly:units.length>0&&units.every(u=>u.nameScore>=72),
  nameVariants:[...new Set(units.flatMap(u=>aliases.has(u.token)?[...aliases].filter(([,ids])=>[...aliases.get(u.token)].some(id=>ids.has(id))).map(([name])=>name):[]))]};
}
export function localSearchMatch(lead,query,intent){
 if(!intent.units.length||intent.requiresAI)return null;
 const sources=searchSources(lead),fullName=lead.fields?.fullName||'',nameWords=words(fullName),body=[...new Set(sources.filter(text=>text!==fullName).flatMap(words))];
 const exactId=normal(query).trim()===normal(lead.id);
 if(exactId)return {id:lead.id,score:100,evidence:lead.id,reason:'Lead ID match'};
 const results=intent.units.map(unit=>{
  const nameScore=bestScore(unit.token,nameWords,true);
  const acceptedName=nameScore>=(unit.nameScore>=90?90:72)?nameScore:0;
  const bodyScore=bestScore(unit.token,body);
  return {...unit,nameHit:acceptedName,score:Math.max(acceptedName,bodyScore)};
 });
 const nameUnits=results.filter(r=>r.nameScore>=72),otherUnits=results.filter(r=>r.nameScore<72);
 const matches=intent.uncertain&&nameUnits.length?nameUnits.some(r=>r.nameHit)&&otherUnits.every(r=>r.score):results.every(r=>r.score);
 if(!matches)return null;
 const hasName=results.some(r=>r.nameHit),approximate=results.some(r=>r.nameHit&&r.nameHit<100)||intent.uncertain;
 const sourceScores=sources.map(text=>({text,hits:intent.units.filter(u=>words(text).some(word=>scoreWord(u.token,word))).length}));
 const best=sourceScores.sort((a,b)=>b.hits-a.hits)[0];
 const evidence=hasName&&!otherUnits.length?fullName:best?.hits?best.text:fullName;
 if(intent.units.length>1&&otherUnits.length&&/(?:^|\s)(?:no|not|never|without|не|нет|без|отказ\p{L}*)(?=\s|[.,;:!?]|$)/u.test(normal(evidence)))return null;
 return {id:lead.id,score:hasName?(approximate?82:96):90,evidence:evidence.slice(0,220),reason:hasName?(approximate?'Possible name match':'Name match'):'Text / discussion match'};
}
export function matchExplanation(match){
 if(!match?.evidence)return '';
 return (match.reason||'Matching details')+': '+String(match.evidence).replace(/\s+/g,' ').slice(0,150);
}
