import {readSearchQuery} from './searchQuery.js';
import {smartLeadSearch} from './smartLeadSearch.js';
import {matchExplanation} from './searchMatching.js';
import {searchLeads} from './searchService.js';
import {UserError} from '../flow.js';
const clip=(value,n=90)=>Array.from(String(value||'').replace(/\s+/g,' ')).slice(0,n).join('');
export function createMeetingLeadPicker({store,config,bookingButton,beginNewLead,getManagers=()=>[],analyzer,search=smartLeadSearch,searchOptions={}}){
 const enabled=config.profile==='onlyplay';
 if(enabled)config={...config,sharedLeads:true};
 const available=ctx=>searchLeads(Object.values(store.state.leads),{owner:ctx.state.owner,scope:'all',sharedLeads:config.sharedLeads}).filter(l=>l.fields?.fullName?.trim()&&l.fields?.company?.trim());
 async function update(ctx){
  const state=ctx.state.session.meetingSearch;
  Object.assign(state,{clarification:null},await search(available(ctx),{aiOnly:enabled,...searchOptions,owner:ctx.state.owner,sharedLeads:config.sharedLeads,query:state.query,timeZone:config.timeZone||'UTC'}),{page:0});store.save();
 }
 function panel(ctx){
  const session=ctx.state.session;if(!enabled||!session.view?.startsWith('meeting-'))return null;
  if(session.meetingSearch?.mode==='browse'){session.view='search-menu';session.search={};delete session.meetingSearch;return null;}
  const state=session.meetingSearch||{query:'',matches:[]},rows=[];
  const add=(text,action)=>rows.push([{text,callback_data:`v2:${session.nonce}:${action}`}]);
  if(session.view==='meeting-managers'){
   const managers=getManagers(ctx);
   for(const manager of managers){
    const name=manager.displayName||manager.calendar.name||manager.email;
    add(name===manager.email?manager.email:clip(name,55)+' · '+manager.email,'meetingmanager:'+manager.userId);
   }
   add('Back','bookingmenu');
   return {text:managers.length?'Choose partnership manager\n\nChoose the receiving Partnership Manager.':'No manager calendars are available. Connect Google Calendar in Settings.',rows};
  }
  if(!getManagers(ctx).some(m=>m.userId===session.meetingManagerId)){session.view='meeting-managers';delete session.meetingManagerId;return panel(ctx);}
  if(session.view==='meeting-add'){
   add('Add lead from CRM','meetingcrm');add('Add new lead','meetingnew');add('Back','meetingreset');
   return {text:'Add a lead\n\nChoose the lead for the handoff.',rows};
  }
  const footer=()=>add('Back','meetingadd');
  if(session.view==='meeting-search-menu'){
   add('Voice / Text Single Search','meetingtext');add('Pre-set Bulk Search','meetingfilters');footer();
   return {text:'Search Lead\n\nSearch the leads you can access.',rows};
  }
  if(session.view==='meeting-search-input'||session.view==='meeting-search-voice'){
   add('Back','meetingsearchmenu');return {text:(session.view==='meeting-search-voice'?'Voice / Text Single Search — send text, a voice message or an audio file.\n\n':'')+'Smart Search\n\nSend text, voice or audio with a name, company or anything you remember. I will search lead cards and notes.',rows};
  }
  if(session.view==='meeting-search-filters'){
   ['Today','Yesterday','This week','All dates'].forEach((label,i)=>add(label,'meetingperiod:'+['today','yesterday','week','all'][i]));add('Back','meetingsearchmenu');return {text:'Pre-set Bulk Search\n\nChoose a period:',rows};
  }
  if(session.view==='meeting-search-scope'){
   add('Assigned to me','meetingscope:assigned');add('Created by me','meetingscope:created');add('Back','meetingfilters');return {text:'Search Lead\n\nChoose a list.',rows};
  }
  // Keep old selected screens usable after the update.
  if(session.view==='meeting-selected'){
   const lead=available(ctx).find(l=>l.id===state.selectedId);
   const button=lead&&bookingButton(ctx,lead.id,'Continue to handoff');if(button)rows.push([button]);
   add('Back to results','meetingback');
   return {text:lead?clip(lead.fields.fullName,120)+' · '+clip(lead.fields.company,120)+'\n\nOpen the handoff form with this lead.':'This lead is no longer available. Enter a new query.',rows};
  }
  const allowed=new Map(available(ctx).map(l=>[l.id,l])),matches=state.matches.filter(m=>allowed.has(m.id));
  let text=state.query?'Search: '+clip(state.query,500):'Search Lead\n\nSelect a lead.';
  if(state.fallback)text+='\n\nAI search is temporarily unavailable. Showing text and approximate-name matches.';
  if(!matches.length)text+='\n\n'+(state.clarification||'No results. Try another name or company.');
  if(state.query)text+='\nFound: '+matches.length;
  const pageSize=10,page=Math.min(state.page||0,Math.max(0,Math.ceil(matches.length/pageSize)-1));
  matches.slice(page*pageSize,page*pageSize+pageSize).forEach((match,index)=>{
   const lead=allowed.get(match.id),number=page*pageSize+index+1;
   const cardText=number+'. '+clip(lead.fields.fullName||'Unnamed',45)+' · '+clip(lead.fields.company||'Company not specified',45)+(lead.fields.jobTitle?'\n'+clip(lead.fields.jobTitle,50):'');
   const label=[lead.fields.fullName,lead.fields.company].filter(Boolean).map(value=>clip(value,42)).join(' / ');
   const button=bookingButton(ctx,lead.id,label)||{text:label,callback_data:'v2:'+session.nonce+':meetingselect:'+lead.id};
   text+='\n\n'+cardText+(matchExplanation(match)?'\n'+matchExplanation(match).slice(0,120):'');rows.push([button]);
  });
  if(page>0)add('Previous','meetingpage:'+(page-1));if((page+1)*pageSize<matches.length)add('Next','meetingpage:'+(page+1));
  if(matches.length)text+='\n\nFor another search, send a name or company.';
  add('Back',state.period ? 'meetingscopeback' : 'meetingsearchmenu');return {text,rows};
 }
 async function action(ctx,name,value){
  if(!enabled||!(name==='bookweb'||name.startsWith('meeting')))return false;
  const session=ctx.state.session;
  if(['bookweb','meetingreset'].includes(name)){
   session.meetingSearch={query:'',matches:[],mode:'meeting'};delete session.meetingManagerId;delete session.meetingLeadId;delete session.meetingCreation;delete session.pendingHandoff;session.editField=null;session.view='meeting-managers';return true;
  }
  if(name==='meetingmanager'){
   if(!getManagers(ctx).some(m=>m.userId===value))throw new UserError('The manager calendar is unavailable. Choose another manager.');
   session.meetingManagerId=value;session.meetingSearch={query:'',matches:[],mode:'meeting'};
   const lead=session.meetingLeadId&&available(ctx).find(l=>l.id===session.meetingLeadId);
   if(lead){session.meetingSearch.selectedId=lead.id;session.meetingSearch.matches=[{id:lead.id}];session.view='meeting-selected';}
   else session.view='meeting-add';delete session.meetingLeadId;return true;
  }
  if(!getManagers(ctx).some(m=>m.userId===session.meetingManagerId))throw new UserError('Choose an available manager before searching for a lead.');
  if(session.meetingSearch?.mode==='browse'){session.view='search-menu';session.search={};delete session.meetingSearch;return true;}
  const state=session.meetingSearch;if(!state)throw new UserError('Open search again.');
  if(name==='meetingblank')throw new UserError('A lead is required to create a handoff');
  if(name==='meetingnew'){
   beginNewLead(ctx);return true;
  }
  if(name==='meetingadd'){session.view='meeting-add';session.meetingSearch={query:'',matches:[],mode:'meeting'};return true;}
  if(name==='meetingcrm'||name==='meetingsearchmenu'){session.view='meeting-search-menu';session.meetingSearch={query:'',matches:[],mode:'meeting'};return true;}
  if(name==='meetingtext'){session.view='meeting-search-input';return true;}
  if(name==='meetingvoice'){session.view='meeting-search-input';return true;}
  if(name==='meetingfilters'){session.meetingSearch={query:'',matches:[],mode:'meeting'};session.view='meeting-search-filters';return true;}
  if(name==='meetingperiod'){
   if(!['today','yesterday','week','all'].includes(value))throw new UserError('Choose a period using a button above.');
   state.period=value;session.view='meeting-search-scope';return true;
  }
  if(name==='meetingscopeback'){session.view='meeting-search-scope';return true;}
  if(name==='meetingscope'||name==='meetingresults'){
   if(name==='meetingresults'||!['assigned','created'].includes(value)){session.view=state.period?'meeting-search-scope':'meeting-search-menu';return true;}
   state.scope=value;state.query='';
   state.matches=searchLeads(available(ctx),{owner:ctx.state.owner,sharedLeads:config.sharedLeads,period:state.period||'all',scope:state.scope,timeZone:config.timeZone||'UTC'}).map(l=>({id:l.id}));state.page=0;state.fallback=false;session.view='meeting-leads';return true;
  }
  if(name==='meetingselect'){
   if(!state.matches.some(m=>m.id===value)||!available(ctx).some(l=>l.id===value))throw new UserError('This lead is no longer available. Enter a new query.');state.selectedId=value;session.view='meeting-selected';
  }else if(name==='meetingback')session.view='meeting-leads';
  else if(name==='meetingpage')state.page=Math.max(0,Number(value)||0);
  else {session.view='meeting-leads';delete state.facets;}
  return true;
 }
 async function text(ctx,message){
  if(!enabled||!ctx.state.session.view?.startsWith('meeting-'))return false;
  if(ctx.state.session.view==='meeting-add')throw new UserError('Choose Add new lead or Add lead from CRM.');
  if(ctx.state.session.view==='meeting-managers')throw new UserError('First choose a Partnership Manager using a button above.');
  if(ctx.state.session.meetingSearch?.mode==='browse'){ctx.state.session.view='search-input';ctx.state.session.search={};delete ctx.state.session.meetingSearch;return false;}
  const progress=await ctx.reply(message.voice||message.audio?'Transcribing and searching…':'Searching…');
  try{
  const query=await readSearchQuery(message,analyzer);
  const session=ctx.state.session;session.view='meeting-leads';session.meetingSearch={query,matches:[],mode:'meeting'};
  await update(ctx);return true;}finally{try{await ctx.telegram.deleteMessage(ctx.chat.id,progress.message_id);}catch{}}
 }
 return {panel,action,text};
}
