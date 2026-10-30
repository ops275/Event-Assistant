import {telegramCardHtml} from './telegramLeadCard.js';
const decode=value=>String(value).replace(/&(amp|lt|gt|quot);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"'}[entity]));
const validLink=value=>{try{const url=new URL(value);return url.protocol==='mailto:'||(['http:','https:'].includes(url.protocol)&&Boolean(url.hostname)&&!url.username&&!url.password&&!/\s/.test(value));}catch{return false;}};
function linkedText(text,style,href){
 const plain=value=>({type:'text',text:value,...(Object.keys(style).length?{style:{...style}}:{})});
 if(href)return validLink(href)?[{type:'link',url:href,text,...(Object.keys(style).length?{style:{...style}}:{})}]:[plain(text)];
 const result=[],pattern=/https?:\/\/[^\s<>]+|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?<![<A-Za-z0-9])@[A-Za-z][A-Za-z0-9_]{3,31}/g;let position=0;
 for(const match of text.matchAll(pattern)){
  if(match.index>position)result.push(plain(text.slice(position,match.index)));
  const value=match[0],url=value.startsWith('@')?'https://t.me/'+value.slice(1):value.includes('://')?value:'mailto:'+value;
  result.push(validLink(url)?{type:'link',url,text:value,...(Object.keys(style).length?{style:{...style}}:{})}:plain(value));position=match.index+value.length;
 }
 if(position<text.length)result.push(plain(text.slice(position)));return result;
}
export function slackLeadCard(lead){
 const html=telegramCardHtml(lead),elements=[];let section={type:'rich_text_section',elements:[]},style={},href;
 const flush=()=>{if(section.elements.some(e=>e.text?.trim()))elements.push(section);section={type:'rich_text_section',elements:[]};};
 for(const token of html.match(/<[^>]*>|[^<]+/g)||[]){
  if(token==='<b>')style.bold=true;else if(token==='</b>')delete style.bold;
  else if(token==='<i>')style.italic=true;else if(token==='</i>')delete style.italic;
  else if(token==='<blockquote>'){flush();section={type:'rich_text_quote',elements:[]};}
  else if(token==='</blockquote>')flush();
  else if(token.startsWith('<a '))href=decode(token.match(/href="([^"]*)"/)?.[1]||'');
  else if(token==='</a>')href=undefined;
  else if(!token.startsWith('<'))section.elements.push(...linkedText(decode(token),style,href));
 }
 flush();return {text:decode(html.replace(/<[^>]*>/g,'')),blocks:[{type:'rich_text',elements}]};
}
