import {visibleManager} from './services/managerVisibility.js';
import {formatPanelHeading} from './services/panelHeading.js';
import {createApolloService,apolloNotice} from './services/apolloService.js';
import {readSearchQuery} from './services/searchQuery.js';
import {smartLeadSearch} from './services/smartLeadSearch.js';
import {matchExplanation} from './services/searchMatching.js';
import fs from 'node:fs';
import path from 'node:path';
import {CalendarAccounts} from './services/calendarAccounts.js';
import { issueBookingTicket } from './services/bookingAccess.js';
import { searchLeads } from './services/searchService.js';
import {createMeetingLeadPicker} from './services/meetingLeadPicker.js';
import { resolveRole } from './services/accessService.js';
import {AdminSettings} from './services/adminService.js';
import {createAdminPanel} from './services/adminPanel.js';
import { MENU_SECTIONS } from './menuMockup.js';
import { randomBytes,createHash } from 'node:crypto';
import { Telegraf } from 'telegraf';
import { FIELDS, STEPS, LEAD_EDIT_GROUPS } from './config.js';
import { addMaterial, advance, assertReady, createLead, editField, keepSourceText, processStep, reconcileConflicts, resolveConflict, touch, UserError } from './flow.js';
import { callback, EDIT_COMMANDS, fullText, contactCard, label, render, renderIssues, linkedinProfileUrl, normalizeNavigation } from './ui.js';
import { serialQueue } from './services/store.js';
import { createAnalyzer } from './services/openaiService.js';
import { createSheetsService } from './services/sheetsService.js';
import {createHandoffSheetsSync} from './services/handoffSheets.js';
import {handoffForRole} from './services/handoffJournal.js';
import {leadPayload,startLeadPayload,validLeadPayload} from './services/leadLink.js';
import {videoAsset} from './services/videoAssets.js';
import {sendCachedVideo} from './services/videoCache.js';
import {fileURLToPath} from 'node:url';
import {FOLLOWUP_CATEGORIES,followupTemplate,followupPhotoPath,isRetiredFollowupItem} from './services/followupTemplates.js';
import {partnershipManager} from './services/partnershipManagers.js';
import {MEETING_PERIODS,myMeetings} from './services/myMeetings.js';
import {activeEvent} from './services/eventCatalog.js';
import {createMaterials} from './services/materials.js';
import {excludedCaptureField,allowedCaptureStage,captureProjection} from './services/leadCapturePolicy.js';

function boundTelegramRequests(telegram) {
    const callApi = telegram.callApi.bind(telegram);
    telegram.callApi = async (method, payload, options = {}) => {
        if (method === 'getUpdates') return callApi(method, payload, options);
        const call = () => {
            const timeout = AbortSignal.timeout(15000);
            const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
            return callApi(method, payload, { ...options, signal });
        };
        try { return await call(); }
        catch (error) {
            const delay = error.parameters?.retry_after;
            if (error.code !== 429 || !Number.isFinite(delay) || delay < 0 || delay > 30) throw error;
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
            return call();
        }
    };
}

function materialInput(message) {
    const input={messageId:message.message_id,text:message.text||message.caption||'',groupId:message.media_group_id};
    if(message.photo){const photo=message.photo.at(-1);Object.assign(input,{kind:'photo',fileId:photo.file_id,size:photo.file_size,mime:'image/jpeg'});}
    else if(message.voice||message.audio){const audio=message.voice||message.audio;Object.assign(input,{kind:'audio',fileId:audio.file_id,size:audio.file_size,mime:audio.mime_type||'audio/ogg'});}
    else if(message.document&&['image/jpeg','image/png','image/webp'].includes(message.document.mime_type))Object.assign(input,{kind:'photo',fileId:message.document.file_id,size:message.document.file_size,mime:message.document.mime_type});
    else if(message.text)input.kind='text';
    else throw new UserError('Send text, photo, PNG/JPEG/WebP document or voice message.');
    return input;
}

export function createBot({ token, store, config, analyzer, apollo=createApolloService(), leadSearch=smartLeadSearch, sheets = createSheetsService(), telegramOptions = {}, now=()=>new Date(), revokeCalendarToken=async token=>{const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}),signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('Google revoke not confirmed');} }) {
    if(config.profile==='onlyplay')config={...config,sharedLeads:true};
    const bot = new Telegraf(token, { handlerTimeout: 86400000, telegram: telegramOptions });
    boundTelegramRequests(bot.telegram);
    store.sharedLeads=Boolean(config.sharedLeads);
    store.equalLeadAccess=config.profile==='onlyplay';
    if(store.equalLeadAccess)store.sharedLeads=true;
    const admin=new AdminSettings(config.adminSettingsFile,config.adminIds||[]);
    const adminPanel=createAdminPanel({admin,store,config});
    const searchOptions={aiOnly:config.profile==='onlyplay',indexFile:path.join(path.dirname(store.file),'search-index.json')};
    const meetingPicker=createMeetingLeadPicker({store,config,search:leadSearch,searchOptions,analyzer:{analyze:(...args)=>services.analyze(...args)},bookingButton,beginNewLead:ctx=>{
        const session=ctx.state.session;
        session.pendingHandoff={managerId:session.meetingManagerId,view:'leadgen-channel'};
        delete session.pendingChannel;delete session.leadgenDraftId;delete session.meetingCreation;session.editField=null;session.view='leadgen-channel';
    },getManagers:ctx=>{
        if(!config.calendarAccountsDir)return [];
        return new CalendarAccounts(config.calendarAccountsDir).managers(ctx.from.id,admin.read()).filter(visibleManager).filter(a=>['admin','partnership'].includes(admin.read().users[a.userId]?.role)).map(a=>({...a,displayName:admin.read().users[a.userId]?.name||store.state.users?.[a.userId]?.name||a.calendar.name||a.email}));
    }});
    const effectiveRole=id=>admin.role(id)||resolveRole(store.state,id);
    const activeConflicts=lead=>captureProjection(lead,config).conflicts;
    const unusedCaptureField=(lead,key)=>excludedCaptureField(lead,key,config);
    const activeMaterials=lead=>captureProjection(lead,config).materials;
    function identifyCaptureFlow(ctx,lead) {
        if(!lead||config.profile!=='onlyplay'||!store.canEdit(ctx.state.owner,lead))return;
        const session=ctx.state.session;
        // A bound unfinished Handoff is reliable evidence of the old new-lead route.
        if(lead.status!=='saved'&&session.meetingCreation?.leadId===lead.id&&lead.creationFlow==='partnership')lead.creationFlow='leadgen';
        if(!lead.creationFlow&&lead.status==='draft'&&lead.owner===ctx.state.owner){
            const role=effectiveRole(ctx.from.id);
            if(['partnership','leadgen','promoter'].includes(role))lead.creationFlow=role;
        }
    }
    function normalizeCapture(ctx,lead) {
        if(!lead||config.profile!=='onlyplay'||!store.canEdit(ctx.state.owner,lead))return false;
        const session=ctx.state.session;
        identifyCaptureFlow(ctx,lead);
        const stage=allowedCaptureStage(lead,lead.stage,config),changed=stage!==lead.stage;
        lead.stage=stage;
        for(const key of ['returnStage','editReturnStage','checkpointStage'])if(session[key]!=null)session[key]=allowedCaptureStage(lead,session[key],config);
        if(unusedCaptureField(lead,session.editField)){session.editField=null;session.editReturnView=null;session.view='stage';}
        return changed;
    }
    const services = analyzer || createAnalyzer({ telegram: bot.telegram });
    const enqueue = serialQueue();
    const saveQueue=serialQueue();
    const saveVersion=lead=>createHash('sha256').update(JSON.stringify([lead.fields,lead.materials,lead.conflicts,lead.stage])).digest('hex');
    const processing = new Map();
    const tasks = new Set();
    const scheduled = new Set();
    bot.waitForIdle = async () => {
        while (tasks.size) await Promise.allSettled([...tasks]);
    };
    bot.stopProcessing = () => { for (const item of processing.values()) item.controller.abort(); };
    bot.syncHandoffs=createHandoffSheetsSync({store,sheets});
    bot.recover = async () => {
        if(config.profile==='onlyplay')await bot.syncHandoffs();
        for (const entry of Object.values(store.state.inbox)) await bot.handleUpdate(entry.update);
        if(config.profile==='onlyplay')for(const lead of Object.values(store.state.leads))await autoSaveLead(lead,true);
    };

    async function processCurrent(ctx, lead, options = {}) {
        const controller = new AbortController();
        const token = randomBytes(5).toString('hex');
        const timer = setTimeout(() => controller.abort(), 60000);
        processing.set(ctx.state.owner, { controller, token });
        let progress;
        try {
            progress = await ctx.reply('Reading materials...', {
                reply_markup: { inline_keyboard: [[{ text: 'Stop processing', callback_data: `pause:${token}` }]] },
            });
            await processStep(lead, services, () => store.save(), controller.signal, options);
        } finally {
            clearTimeout(timer);
            processing.delete(ctx.state.owner);
            if (progress) await ctx.telegram.deleteMessage(ctx.chat.id, progress.message_id).catch(() => {});
        }
    }

    function finishStep(lead, session, ctx) {
        advance(lead);
        lead.stage=allowedCaptureStage(lead,lead.stage,config);
        if (session.returnStage != null) {
            lead.stage = session.returnStage;
            session.returnStage = null;
            session.view = 'review';
        } else {
            session.view = lead.stage >= STEPS.length ? 'review' : 'stage';
        }
        session.checkpointStage = null;
        session.fieldIndex = 0;
    }

    async function showIssues(ctx, lead, errorText = '') {
        const session = ctx.state.session;
        let panel = renderIssues(lead, session, errorText,config);
        if(config.profile==='onlyplay'&&panel)panel=formatPanelHeading(panel);
        const previous = session.issuePanelId;
        if (panel) {
            if (previous) {
                try {
                    await ctx.telegram.editMessageText(ctx.chat.id, previous, undefined, panel.text, {
                        ...(panel.parseMode?{parse_mode:panel.parseMode}:{}),
                        reply_markup: { inline_keyboard: panel.rows },
                    });
                    return;
                } catch { /* Recreate a deleted notification. */ }
            }
            const message = await ctx.reply(panel.text, { ...(panel.parseMode?{parse_mode:panel.parseMode}:{}),reply_markup: { inline_keyboard: panel.rows } });
            session.issuePanelId = message.message_id;
        } else session.issuePanelId = null;
        store.save();
        if (previous) await ctx.telegram.deleteMessage(ctx.chat.id, previous).catch(() => {});
    }

    async function syncLeadToSheets(lead) {return saveQueue(lead.id,()=>syncLeadSnapshot(lead));}
    async function syncLeadSnapshot(lead) {
        if (!sheets.configured() || !lead) return;
        if (activeConflicts(lead).length) return;
        if (activeMaterials(lead).some(m => !['done', 'omitted', 'deferred'].includes(m.status))) return;
        const snapshot=structuredClone(lead),version=saveVersion(lead);
        try {
            lead.savedAt ||= new Date().toISOString();
            lead.status = 'draft';
            lead.sheetsSync = { ...lead.sheetsSync, status: 'pending', attemptedAt: new Date().toISOString() };
            store.save();
            const res = await sheets.save({ ...snapshot, status: 'saved' });
            if(config.profile==='onlyplay'&&saveVersion(lead)!==version){lead.status='draft';lead.sheetsSync={...res,status:'pending',autoVersion:version};store.save();return;}
            lead.sheetsSync = { ...res, version: lead.updatedAt, status: 'synced' };
            if(config.profile==='onlyplay')lead.sheetsSync.autoVersion=version;
            lead.status = 'saved';
            lead.savedAt ||= new Date().toISOString();
            store.save();
        } catch (error) {
            console.error('Sheets save failed:', error.status || error.code || error.name);
            lead.sheetsSync = { ...lead.sheetsSync, status: 'failed', attemptedAt: new Date().toISOString() };
            if(config.profile==='onlyplay')lead.sheetsSync.autoVersion=version;
            store.save();
        }
    }

    async function autoSaveLead(lead,recover=false){
        if(config.profile!=='onlyplay'||!lead||lead.deletedAt||lead.stage!==STEPS.length)return;
        reconcileConflicts(lead);
        if(activeConflicts(lead).length||activeMaterials(lead).some(m=>!['done','omitted','deferred'].includes(m.status)))return;
        const version=saveVersion(lead);
        if(lead.sheetsSync?.status==='synced'&&!lead.sheetsSync.autoVersion&&lead.sheetsSync.version===lead.updatedAt){lead.sheetsSync.autoVersion=version;store.save();return;}
        if(lead.sheetsSync?.autoVersion===version&&(!recover||lead.sheetsSync.status==='synced')||!sheets.configured()&&lead.localSaveVersion===version){if(lead.sheetsSync?.status==='synced'||!sheets.configured()){lead.status='saved';store.save();}return;}
        if(sheets.configured())await syncLeadToSheets(lead);
        else{lead.status='saved';lead.savedAt||=new Date().toISOString();lead.localSaveVersion=version;store.save();}
    }

    async function show(ctx, replace = Boolean(ctx.callbackQuery), errorText = '') {
        const session = ctx.state.session;
        if(restrictedPromoter(ctx)){
            if(/^(search|meeting|followup-)/.test(session.view)||['list','booking-menu','my-meetings','bookinglinks-placeholder','booking-managers','booking-manager','linkedin-invitation'].includes(session.view)||session.view?.startsWith('settings')){session.view='welcome';session.editField=null;}
            for(const key of ['search','meetingSearch','meetingManagerId','meetingCreation','pendingHandoff'])delete session[key];
        }
        for(const id of session.meetingCardIds||[])await ctx.telegram.deleteMessage(ctx.chat.id,id).catch(()=>{});
        session.meetingCardIds=[];
        const lead = store.lead(ctx.state.owner);
        const readOnly=Boolean(lead&&!store.canEdit(ctx.state.owner,lead));
        if (lead&&!readOnly) reconcileConflicts(lead);
        normalizeCapture(ctx,lead);
        if(!readOnly)await autoSaveLead(lead);
        if(config.profile==='onlyplay'&&lead?.status==='saved'&&session.meetingCreation?.leadId===lead.id){
            const {managerId}=session.meetingCreation;delete session.meetingCreation;delete session.pendingHandoff;delete session.leadgenDraftId;session.meetingManagerId=managerId;session.meetingSearch={query:'',matches:[{id:lead.id}],selectedId:lead.id,mode:'meeting'};session.view='meeting-selected';
        }
        session.nonce = randomBytes(5).toString('hex');
        store.save();
        const displayConfig = { ...config, role:effectiveRole(ctx.from.id), aiConfigured: services.aiConfigured(), sheetsConfigured: sheets.configured() };
        const mainSession = session.view === 'conflicts' ? { ...session, view: session.conflictReturnView || 'review' } : session;
        const visibleLead=config.profile==='onlyplay'&&lead?handoffForRole(lead,effectiveRole(ctx.from.id)):lead;
        let panel = (config.profile==='onlyplay'?materialsFor(ctx).panel(session):null) || meetingPicker.panel(ctx) || adminPanel.panel(session,String(ctx.from.id)) || render(visibleLead, mainSession, {...displayConfig,sharedLeads:config.sharedLeads});
        if(readOnly&&['review','stage','fields','conflicts'].includes(session.view)){
            const rows=[];
            if(effectiveRole(ctx.from.id)!=='promoter')rows.push([{text:config.profile==='onlyplay'?'Hand off this lead':'Hand off lead',callback_data:callback(session,'leadmeeting')}]);
            rows.push([{text:'Full lead card',callback_data:callback(session,'full')}],[{text:'Back to leads',callback_data:callback(session,'searchresults:0')}],[{text:'Menu',callback_data:callback(session,'welcome')}]);
            const onlyplay=config.profile==='onlyplay';
            panel={text:'Shared database · Lead card\n\n'+(onlyplay?contactCard(visibleLead,displayConfig):fullText(visibleLead,config).slice(0,3300))+'\n\nOnly the creator and assigned manager can edit this lead.',rows,...(onlyplay?{parseMode:'HTML',preserveHeading:true}:{})};
        }
        if(panel&&config.profile!=='onlyplay'&&session.view==='welcome'&&effectiveRole(ctx.from.id)==='promoter')panel.rows=panel.rows.filter(row=>row.every(b=>(config.sharedLeads?/:(addflow|resume|searchmenu|bookingmenu)$/:/:(addflow|resume|bookingmenu)$/).test(b.callback_data)||b.callback_data.endsWith(':menu:settings')));
        if(panel&&restrictedPromoter(ctx)){if(session.view==='review')panel.rows.push([{text:'Add Lead',callback_data:callback(session,'addflow')}]);panel.rows=panel.rows.map(row=>row.filter(b=>{const parts=b.callback_data?.split(':');return parts&&!promoterForbidden(parts[2],parts[3]);}).map(b=>({...b,text:b.text==='Add/Edit'?'Edit Lead':b.text}))).filter(row=>row.length);}
        if(panel&&config.profile==='onlyplay'&&session.view==='welcome')panel.rows=panel.rows.map(row=>row.map(button=>button.callback_data?.endsWith(':dashboardweb')?(bookingButton(ctx,undefined,button.text,'dashboard')||button):button.callback_data?.endsWith(':onboardingweb')&&!restrictedPromoter(ctx)?(bookingButton(ctx,undefined,button.text,'onboarding')||button):button));
        if(panel&&config.profile==='onlyplay'&&lead&&!restrictedPromoter(ctx))panel.rows=panel.rows.map(row=>row.map(button=>button.callback_data?.endsWith(':leadmeeting')?(bookingButton(ctx,lead.id,button.text,'book')||button):button));
        if(panel&&session.view==='booking-menu'&&config.profile!=='onlyplay'&&effectiveRole(ctx.from.id)==='promoter')panel.rows=panel.rows.filter(row=>row.every(b=>!b.callback_data.endsWith(':bookweb')));
        if(panel&&session.view==='booking-menu')panel.rows=panel.rows.map(row=>row.map(button=>{
            if(config.profile==='onlyplay'||!button.callback_data?.endsWith(':bookweb'))return button;
            return bookingButton(ctx,undefined,button.text,'book')||button;
        }));
        if(panel&&session.view==='settings')panel.rows=panel.rows.map(row=>row.map(button=>button.callback_data?.endsWith(':calendarconnect')?(calendarLoginButton(ctx,button.text)||button):button));
        if (!panel) { session.view = 'review'; return show(ctx); }
        if (lead && !session.view?.startsWith('materials-') && !session.view?.startsWith('followup-') && !session.view?.startsWith('meeting-') && !session.view?.startsWith('settings') && !['welcome', 'menu-placeholder', 'addflow', 'leadgen-channel', 'leadgen-account', 'promoter-placeholder', 'search-menu', 'search-input', 'search-voice', 'search-filters', 'search-scope', 'delete-confirm', 'delete-confirm-final', 'extra-info', 'edit-info', 'edit-group', 'booking-menu', 'my-meetings', 'booking-managers', 'booking-manager'].includes(session.view) && (session.view === 'review' || lead.stage === STEPS.length)) {
            const duplicates = store.duplicates(lead);
            if (duplicates.length) panel.text += `\n\nContact with this name and company already exists: ${duplicates.slice(0, 3).map(item => item.id.slice(0, 8)).join(', ')}`;
        }
        if(config.profile==='onlyplay')panel=formatPanelHeading(normalizeNavigation(panel,config,session));
        if(panel.cards?.length){
            replace=false;
            for(const rawCard of panel.cards){
                const card=config.profile==='onlyplay'?formatPanelHeading(rawCard):rawCard;
                const message=await ctx.reply(card.text,{...(card.parseMode?{parse_mode:card.parseMode}:{}),reply_markup:{inline_keyboard:card.rows}});
                session.meetingCardIds.push(message.message_id);
            }
            store.save();
        }
        const previous = session.panelId;
        const previousWasAdded = session.panelIsAdded;
        if (panel.replyTo || previousWasAdded) replace = false;
        if (replace && previous) {
            try {
                await ctx.telegram.editMessageText(ctx.chat.id, previous, undefined, panel.text, {
                    ...(panel.parseMode ? { parse_mode: panel.parseMode } : {}),
                    reply_markup: { inline_keyboard: panel.rows },
                });
                await showIssues(ctx, readOnly||session.view?.startsWith('materials-')?null:lead, errorText);
                return;
            } catch { /* Send a fresh panel if the previous message was deleted. */ }
        }
        const message = await ctx.reply(panel.text, {
            ...(panel.parseMode ? { parse_mode: panel.parseMode } : {}),
            ...(panel.replyTo ? { reply_parameters: { message_id: panel.replyTo, allow_sending_without_reply: true } } : {}),
            reply_markup: { inline_keyboard: panel.rows },
        });
        session.panelId = message.message_id;
        session.panelIsAdded = Boolean(panel.replyTo);
        store.save();
        if (previous) {
            if (previousWasAdded) await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, previous, undefined, { inline_keyboard: [] }).catch(() => {});
            else await ctx.telegram.deleteMessage(ctx.chat.id, previous).catch(() => {});
        }
        await showIssues(ctx, readOnly||session.view?.startsWith('materials-')?null:lead, errorText);
    }

    function bookingButton(ctx,leadId,text='Hand off lead',intent='book') {
        if(restrictedPromoter(ctx))return null;
        if(!['calendar','booking-links','ae-slots'].includes(intent)&&effectiveRole(ctx.from.id)==='promoter'&&!(config.profile==='onlyplay'&&intent==='book'))return null;
        try{
            const base=config.bookingUrlFile?fs.readFileSync(config.bookingUrlFile,'utf8').trim():'';
            const url=new URL('/miniapp',base);if(url.protocol!=='https:')return null;
            const session=ctx.state.session;
            const managerId=intent==='book'&&['meeting-leads','meeting-selected'].includes(session.view)&&session.meetingSearch?.mode==='meeting'&&session.meetingSearch.matches?.some(match=>match.id===leadId)?session.meetingManagerId:undefined;
            url.searchParams.set('ticket',issueBookingTicket(token,{owner:ctx.state.owner,userId:String(ctx.from.id),leadId,managerId,intent}));
            return {text,web_app:{url:url.href}};
        }catch{return null;}
    }
    function calendarLoginButton(ctx,text='Connect Google Calendar'){
        try{const url=new URL('/google/start',config.googleOauthPublicUrl);if(url.protocol!=='https:')return null;url.searchParams.set('entry',issueBookingTicket(token,{owner:ctx.state.owner,userId:String(ctx.from.id),intent:'google-connect'}));return {text,url:url.href};}catch{return null;}
    }
    function bookingReplyButtons(ctx,button,back='bookingmenu') {
        const session=ctx.state.session;session.nonce=randomBytes(5).toString('hex');store.save();
        return {reply_markup:{inline_keyboard:[[button],[{text:'Back',callback_data:callback(session,back)}]]}};
    }
    function replyHeading(ctx,text,options={}) {
        const panel=config.profile==='onlyplay'?formatPanelHeading({text}):{text};
        if(config.profile==='onlyplay'&&options.reply_markup?.inline_keyboard){const rows=normalizeNavigation({rows:options.reply_markup.inline_keyboard},config,ctx.state.session).rows;options={...options,reply_markup:{...options.reply_markup,inline_keyboard:rows}};}
        return ctx.reply(panel.text,{...options,...(panel.parseMode?{parse_mode:panel.parseMode}:{})});
    }
    async function openBooking(ctx,leadId) {
        const button=bookingButton(ctx,leadId,'Open Hand off lead');
        if(!button)return ctx.reply('Hand off lead is not connected yet or is unavailable for your role.');
        return replyHeading(ctx,'Hand off lead · qooob\n\nOpen the miniapp inside Telegram.',bookingReplyButtons(ctx,button,leadId?'review':'bookingmenu'));
    }

    function hasPersonalCalendar(id){
        try{const base=config.calendarAccountsDir+'/'+String(id);const account=JSON.parse(fs.readFileSync(base+'.json','utf8'));return Boolean(config.calendarAccountsDir&&account.calendar?.id&&fs.existsSync(base+'.enc'));}catch{return false;}
    }
    async function promptCalendar(ctx,leadId=store.lead(ctx.state.owner)?.id){
        const button=calendarLoginButton(ctx);
        return replyHeading(ctx,'Connect your Google Calendar first\n\nConnect your corporate @qooob.com account to create a meeting. Then return to the bot and try again. Leads and other sections are available without a calendar connection.',button?{reply_markup:{inline_keyboard:[[button]]}}:{});
    }

    function begin(ctx, creationFlow = 'partnership') {
        delete ctx.state.session.meetingCreation;
        const actor = ctx.from.username ? '@' + ctx.from.username : [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
        const currentEvent=config.profile==='onlyplay'?activeEvent(admin.read()):null;
        const lead = store.list(ctx.state.owner).find(item => item.originUpdateId === ctx.update.update_id) || createLead(ctx.state.owner, actor, currentEvent?.name||config.event, {
            id: ctx.from.id, username: ctx.from.username, firstName: ctx.from.first_name, lastName: ctx.from.last_name,
        });
        if(currentEvent&&!lead.eventId)lead.eventId=currentEvent.id;
        lead.originUpdateId = ctx.update.update_id;
        lead.creationFlow ||= creationFlow;
        store.state.leads[lead.id] = lead;
        Object.assign(ctx.state.session, { activeId: lead.id, cardFromSearch:false, editReturnView:null, view: 'stage', editField: null, page: 0, fieldIndex: 0, returnStage: null, checkpointStage: null, albumId: null, onboarded: true });
        store.save();
        return lead;
    }

    async function list(ctx, page = 0) {
        const session = ctx.state.session;
        await showIssues(ctx, null);
        session.nonce = randomBytes(5).toString('hex');
        const visible = searchLeads(Object.values(store.state.leads), { owner:ctx.state.owner, sharedLeads:config.sharedLeads, ...(session.search || {}), query:session.search?.matches?'':session.search?.query||'', timeZone:config.timeZone || 'UTC' });
        const allowed=new Map(visible.map(l=>[l.id,l]));
        const leads=session.search?.matches?session.search.matches.map(m=>allowed.get(m.id)).filter(Boolean):visible;
        const active = store.lead(ctx.state.owner);
        const draft = active?.status === 'draft' && store.canEdit(ctx.state.owner,active) && leads.some(item=>item.id===active.id) ? active : null;
        const hasData = lead => lead.status === 'saved' || lead.materials.length || Object.values(lead.fields).some(Boolean);
        const remaining = leads.filter(lead => lead.id !== draft?.id && hasData(lead));
        const pageSize=config.profile==='onlyplay'?10:8;
        const selected = remaining.slice(page * pageSize, page * pageSize + pageSize);
        const leadRow=(lead,text)=>[{text,callback_data:callback(session,'open:'+lead.id)}];
        const rows = selected.map(lead => leadRow(lead,`${lead.status === 'saved' ? 'Saved' : 'Draft'}: ${label(lead)}`));
        if (draft && page === 0) rows.unshift(leadRow(draft,'Continue: '+label(draft)));
        if (page > 0) rows.push([{ text: config.profile==='onlyplay'?'Previous':'Back', callback_data: callback(session, 'searchresults:' + (page - 1)) }]);
        if ((page + 1) * pageSize < remaining.length) rows.push([{ text: 'Next', callback_data: callback(session, 'searchresults:' + (page + 1)) }]);
        if(config.profile!=='onlyplay'){
            rows.push([{ text: 'Search filters', callback_data: callback(session, 'searchfilters') }]);
            rows.push([{ text: 'Search Lead', callback_data: callback(session, 'searchmenu') }]);
        }
        if(config.profile==='onlyplay')rows.push([{text:'Back',callback_data:callback(session,session.search?.period?'searchscopeback':'searchmenu')}]);
        rows.push([{ text: 'Menu', callback_data: callback(session, 'welcome') }]);
        session.view = 'list';
        let text = draft || remaining.length ? 'Search Lead\n\nSelect a lead.' : (config.profile==='onlyplay'?'Search Lead\n\n':'')+(session.search?.clarification||'No leads found. Change the search or add a lead.');
        if(session.search?.query)text+='\n\nSearch: '+session.search.query;
        if(config.profile==='onlyplay'&&session.search?.matches)text+='\nFound: '+leads.length;
        const explanations=new Map((session.search?.matches||[]).map(match=>[match.id,matchExplanation(match)]));
        for(const item of [...(draft&&page===0?[draft]:[]),...selected]){const explanation=explanations.get(item.id);if(explanation)text+='\n\n'+label(item).replace(/\s+/g,' ').slice(0,120)+'\n'+explanation;}
        if(session.search?.fallback)text+='\n\nAI search is temporarily unavailable. Showing text and approximate-name matches.';
        const heading=config.profile==='onlyplay'?formatPanelHeading({text}):{text};
        text=heading.text;
        const listRows=config.profile==='onlyplay'?normalizeNavigation({rows},config,session).rows:rows;
        const listOptions={reply_markup:{inline_keyboard:listRows},...(heading.parseMode?{parse_mode:heading.parseMode}:{})};
        const previous = session.panelId;
        const target = ctx.callbackQuery?.message?.message_id || previous;
        if (target) {
            try {
                await ctx.telegram.editMessageText(ctx.chat.id, target, undefined, text, listOptions);
                session.panelId = target;
                store.save();
                return;
            } catch { /* Send a fresh list below. */ }
        }
        const message = await ctx.reply(text, listOptions);
        session.panelId = message.message_id;
        store.save();
        if (previous && previous !== message.message_id) await ctx.telegram.deleteMessage(ctx.chat.id, previous).catch(() => {});
    }

    async function exportLead(ctx, format) {
        const lead = store.lead(ctx.state.owner);
        if (!lead) return ctx.reply('Choose Add Lead in the menu.');
        const visible=config.profile==='onlyplay'?handoffForRole(lead,effectiveRole(ctx.from.id)):lead;
        const content = format === 'json' ? JSON.stringify(visible, null, 2) : fullText(visible,config);
        return ctx.replyWithDocument({ source: Buffer.from(content, 'utf8'), filename: `lead-${lead.id.slice(0, 8)}.${format}` });
    }

    bot.use(async (ctx, next) => {
        if (!ctx.from || !ctx.chat) return;
        if (ctx.chat.type !== 'private') return;
        if(admin.blocked(ctx.from.id))return ctx.reply('Access to qooob has been blocked by an administrator.');
        if(config.profile==='onlyplay'&&startLeadPayload(ctx.message?.text)){
            const id=String(ctx.from.id),admitted=admin.managed(id)||store.isAuthorized(id)||config.allowedUsers.includes(id);
            if(!admitted||config.allowedUsers.length&&!config.allowedUsers.includes(id)&&!admin.managed(id))return ctx.reply('autorizhation needed');
        }
        if(restrictedPromoter(ctx)&&/^\/(leads|export|full)(?:@\w+)?(?:\s|$)/.test(ctx.message?.text||''))return ctx.reply('Promoter role: Add Lead, Edit Lead, Materials and navigation are available.');
        if(config.profile!=='onlyplay'&&effectiveRole(ctx.from.id)==='promoter'&&(config.sharedLeads?/^\/export(?:@\w+)?(?:\s|$)/:/^\/(leads|export|full)(?:@\w+)?(?:\s|$)/).test(ctx.message?.text||''))return ctx.reply('The Promoter role can add leads. Search and meetings are unavailable.');
        if (config.allowedUsers.length && !config.allowedUsers.includes(String(ctx.from.id))&&!admin.managed(ctx.from.id)) return;

        if (config.accessPassword) {
            const userId = String(ctx.from.id);
            const isAuthorized = admin.managed(userId) || store.isAuthorized(userId) || (config.allowedUsers.length && config.allowedUsers.includes(userId));
            if (!isAuthorized) {
                if (ctx.callbackQuery) {
                    await ctx.answerCbQuery('🔐 Please enter the access password first.', { show_alert: true }).catch(() => {});
                    await ctx.reply('🔐 Please enter the access password:');
                    return;
                }
                const text = ctx.message?.text?.trim() || '';
                const startPayload = text.match(/^\/start\s+(.+)$/)?.[1]?.trim();
                const candidate = startPayload || text;
                if (candidate && candidate === config.accessPassword) {
                    store.authorize(userId);
                    await ctx.deleteMessage().catch(() => {});
                    await ctx.reply('Access granted! Welcome. ✅');
                    ctx.state.owner = `${ctx.chat.id}:${ctx.from.id}`;
                    ctx.state.session = store.session(ctx.state.owner);
                    ctx.state.session.editField = null;
                    ctx.state.session.view = 'welcome';
                    return show(ctx);
                } else {
                    if (text && !text.startsWith('/start')) {
                        await ctx.reply('❌ Incorrect password. Please try again:');
                    } else {
                        await ctx.reply('🔐 Please enter the access password:');
                    }
                    return;
                }
            }
        }

        boundTelegramRequests(ctx.telegram);
        if (store.state.receipts.includes(ctx.update.update_id)) return;
        const owner = `${ctx.chat.id}:${ctx.from.id}`;
        const running = processing.get(owner);
        if (running && (ctx.callbackQuery?.data === `pause:${running.token}` || /^\/cancel(?:@\w+)?$/.test(ctx.message?.text || ''))) {
            running.controller.abort();
            if (ctx.callbackQuery) await ctx.answerCbQuery('Processing is stopping').catch(() => {});
            return;
        }
        const arrivedLead = store.lead(owner);
        let arrival = store.state.inbox[ctx.update.update_id]?.arrival || (arrivedLead ? { id: arrivedLead.id, stage: arrivedLead.stage, view: store.session(owner).view } : null);
        if (ctx.message?.media_group_id) {
            const previousLead = store.list(owner).find(item => item.materials.some(m => m.groupId === ctx.message.media_group_id));
            const previousSource = previousLead?.materials.find(m => m.groupId === ctx.message.media_group_id);
            if (previousSource) arrival = { id: previousLead.id, stage: previousLead.stage < 2 ? previousLead.stage : STEPS.findIndex(s => s.key === previousSource.stage) };
        }
        if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
        if (scheduled.has(ctx.update.update_id)) return;
        // Acknowledge Telegram delivery only after a durable copy exists, then keep polling.
        store.state.inbox[ctx.update.update_id] = { update: ctx.update, arrival };
        store.save();
        scheduled.add(ctx.update.update_id);
        const operation = enqueue(owner, async () => {
            ctx.state.owner = owner;
            ctx.state.session = store.session(owner);
            if(config.profile==='onlyplay'){
                const session=ctx.state.session,previous=session.serviceNoticeIds||[];
                session.serviceNoticeIds=[];
                for(const id of previous)await ctx.telegram.deleteMessage(ctx.chat.id,id).catch(()=>{});
                const reply=ctx.reply.bind(ctx);
                ctx.reply=async(text,options={})=>{
                    const message=await reply(text,options);
                    // Keep cards, action panels and replies to source materials intact.
                    if(!options.reply_markup&&!options.reply_parameters&&!options.reply_to_message_id&&message?.message_id){
                        session.serviceNoticeIds.push(message.message_id);store.save();
                    }
                    return message;
                };
            }
            store.state.users||={};
            store.state.users[String(ctx.from.id)]={name:[ctx.from.first_name,ctx.from.last_name].filter(Boolean).join(' '),username:ctx.from.username||'',lastSeen:new Date().toISOString()};
            ctx.state.arrival = arrival;
            try {
                await next();
            }
            catch (error) {
                store.save();
                // SDK errors can contain credentials and full request payloads.
                if (!(error instanceof UserError)) console.error('Update failed:', error.status || error.code || error.name);
                const errorText = error instanceof UserError ? error.message : 'Action could not be completed. Data is saved, please try again.';
                if (store.lead(owner)) await show(ctx, undefined, errorText);
                else await ctx.reply(errorText);
            }
            delete store.state.inbox[ctx.update.update_id];
            store.state.receipts.push(ctx.update.update_id);
            store.state.receipts = store.state.receipts.slice(-1000);
            store.save();
        });
        tasks.add(operation);
        operation.finally(() => {
            tasks.delete(operation);
            scheduled.delete(ctx.update.update_id);
        }).catch(error => console.error('Background update failed:', error.code || error.name));
    });

    bot.start(async ctx => {
        const payload=startLeadPayload(ctx.message?.text);
        if(config.profile==='onlyplay'&&payload){
            const selected=validLeadPayload(payload)&&store.list(ctx.state.owner).find(lead=>leadPayload(lead.id)===payload);
            if(!selected)return ctx.reply('Lead is unavailable or you do not have access to it.');
            return handleAction(ctx,'open',selected.id);
        }
        ctx.state.session.editField = null;
        ctx.state.session.view = 'welcome';
        await show(ctx);
    });
    bot.command('new', async ctx => { ctx.state.session.editField = null; ctx.state.session.view = 'welcome'; await show(ctx); });
    bot.command('menu', async ctx => { ctx.state.session.editField = null; ctx.state.session.view = 'welcome'; await show(ctx); });
    for (const section of MENU_SECTIONS) {
        bot.command(section.command, ctx => {
            const [action, value] = (section.action || 'menu:' + section.id).split(':');
            ctx.state.session.nonce = null;
            return handleAction(ctx, action, value);
        });
    }
    bot.command('leads', ctx => { ctx.state.session.search = {}; return list(ctx); });
    bot.command('export', ctx => exportLead(ctx, 'json'));
    bot.command('full', ctx => exportLead(ctx, 'txt'));
    bot.command('status', async ctx => {
        if (!store.lead(ctx.state.owner)) ctx.state.session.view = 'welcome';
        await show(ctx);
    });
    bot.command('cancel', async ctx => {
        const session=ctx.state.session;
        if(config.profile==='onlyplay'&&session.pendingHandoff){
            delete session.pendingHandoff;delete session.meetingCreation;delete session.leadgenDraftId;
            session.editField=null;session.view='meeting-add';return show(ctx);
        }
        session.editField = null;
        session.view = 'stage';
        if (store.lead(ctx.state.owner)) await show(ctx);
    });
    bot.help(async ctx => {
        ctx.state.session.view = 'welcome';
        await show(ctx);
    });
    for (const [command, key] of Object.entries(EDIT_COMMANDS)) {
        bot.command(command, async ctx => {
            if(config.profile==='onlyplay'&&key==='nextSteps')throw new UserError('Next steps editing is no longer available.');
            const lead = store.lead(ctx.state.owner);
            if (!lead) throw new UserError('Create a lead first.');
            if(!store.canEdit(ctx.state.owner,lead))return ctx.reply('This lead is read-only. Only its creator or assigned manager can edit it.');
            identifyCaptureFlow(ctx,lead);
            if(unusedCaptureField(lead,key,ctx))throw new UserError('This field is not used for this lead capture flow.');
            ctx.state.session.editReturnView = null;
            ctx.state.session.editField = key;
            ctx.state.session.view = 'review';
            await show(ctx);
        });
    }

    bot.on('callback_query', async ctx => {
        const session = ctx.state.session;
        const data = ctx.callbackQuery.data || '';
        if (/^v2:[^:]+:welcome$/.test(data)) {
            session.view = 'welcome';
            session.editField = null;
            return show(ctx);
        }
        const prefix = `v2:${session.nonce}:`;
        if (!data.startsWith(prefix)) {
            await ctx.reply('This screen has changed. Here is the current step.');
            return show(ctx);
        }
        // Invalidate before any awaited operation so double taps cannot repeat transitions.
        session.nonce = null;
        const [action, value] = data.slice(prefix.length).split(':');
        return handleAction(ctx, action, value);
    });

    function materialsFor(ctx){return createMaterials({persist:()=>store.save(),checkAsset:id=>fs.accessSync(fileURLToPath(videoAsset(id).file),fs.constants.R_OK),send:item=>{
        if(item.type==='photo')return ctx.telegram.sendPhoto(ctx.chat.id,{source:followupPhotoPath(item.filename)},{caption:item.html,parse_mode:'HTML'});
        if(item.type!=='video')return ctx.telegram.sendMessage(ctx.chat.id,item.html,{parse_mode:'HTML',link_preview_options:{is_disabled:true}});
        const asset=videoAsset(item.assetId);
        return sendCachedVideo({store,telegram:ctx.telegram,botId:ctx.botInfo?.id||bot.botInfo?.id,chatId:ctx.chat.id,assetId:item.assetId,asset,extra:{caption:item.html,parse_mode:'HTML',supports_streaming:true,duration:Math.floor(asset.duration),width:asset.width,height:asset.height}});
    }});}
    function restrictedPromoter(ctx){return config.profile==='onlyplay'&&effectiveRole(ctx.from.id)==='promoter';}
    function promoterForbidden(action,value){return /^(search|meeting|followup|admin|calendar|dashboard)/.test(action)||['bookingmenu','bookingmanager','bookweb','leadmeeting','linkedin','onboardingweb','aefreeslots','bookinglinks','mymeetings','mymeetingperiod','apollo','list','open','scope','period','export','full','channel','createleadgen'].includes(action)||(action==='menu'&&!['add-lead','materials'].includes(value))||(action==='createflow'&&value!=='promoter');}
    async function promoterDenied(ctx){ctx.state.session.view='welcome';ctx.state.session.editField=null;delete ctx.state.session.meetingCreation;await ctx.reply('Promoter role: Add Lead, Edit Lead, Materials and navigation are available.');return show(ctx);}
    async function handleAction(ctx, action, value) {
        const session = ctx.state.session;
        if(!['delete','confirmdelete','finaldelete'].includes(action))delete session.pendingDelete;
        if(restrictedPromoter(ctx)&&(session.view==='linkedin-invitation'||session.view?.startsWith('followup-')))return promoterDenied(ctx);
        if(restrictedPromoter(ctx)&&promoterForbidden(action,value))return promoterDenied(ctx);
        if(config.profile==='onlyplay'&&(action.startsWith('material')||action==='menu'&&value==='materials')){
            if(ctx.chat.type!=='private'||String(ctx.chat.id)!==String(ctx.from.id))throw new UserError('Open Materials in your private chat with the bot.');
            try{await materialsFor(ctx).action(action==='menu'?'materialhome':action,value,session);}catch(error){throw new UserError(error.message);}
            return show(ctx);
        }
        if(config.profile==='onlyplay'&&(action.startsWith('followup')||action==='menu'&&value==='follow-up')){
            if(ctx.chat.type!=='private'||String(ctx.chat.id)!==String(ctx.from.id))throw new UserError('Open Follow-up Leads in your private chat with the bot.');
            session.editField=null;
            if(action==='menu'||action==='followuphome'){session.view='followup-category';return show(ctx);}
            if(action==='followupcategory'){
                if(!FOLLOWUP_CATEGORIES.includes(value))throw new UserError('Choose a valid follow-up lead type.');
                session.followupCategory=value;session.followupTemplate=null;session.view='followup-templates';return show(ctx);
            }
            if(action==='followupback'){session.view='followup-templates';return show(ctx);}
            const pack=followupTemplate(session.followupCategory,action==='followuptemplate'?value:session.followupTemplate);
            if(!pack)throw new UserError('Choose a valid follow-up template for this lead type.');
            if(action==='followuptemplate'){session.followupTemplate=pack.id;session.view='followup-template';return show(ctx);}
            if(action==='followupsend'||action==='followupupgrade'){
                if(session.view!=='followup-template')throw new UserError('Open the template and confirm sending the packet.');
                let delivery=session.followupDelivery;
                const matches=delivery?.templateId===pack.id&&delivery?.category===pack.category;
                if(action==='followupupgrade'&&(!matches||delivery.version>=2||delivery.nextIndex!==delivery.items.length))throw new UserError('Finish your existing packet before requesting an update.');
                if(action==='followupupgrade'||delivery?.templateId!==pack.id||delivery?.category!==pack.category){
                    // Snapshot serializable content so adding videos later cannot shift a partial packet's resume index.
                    delivery=session.followupDelivery={category:pack.category,templateId:pack.id,version:pack.version,items:pack.items.map(item=>({...item})),nextIndex:0,messageIds:[]};
                    store.save();
                }
                for(let index=delivery.nextIndex;index<delivery.items.length;index++){
                    const item=delivery.items[index];
                    if(isRetiredFollowupItem(item)){delivery.nextIndex=index+1;store.save();continue;}
                    try{
                        // Bypass ctx.reply: service notices expire on navigation, but forwarding materials must persist.
                        const asset=item.type==='video'?videoAsset(item.assetId):null;
                        const message=asset
                            ?await sendCachedVideo({store,telegram:ctx.telegram,botId:ctx.botInfo?.id||bot.botInfo?.id,chatId:ctx.chat.id,assetId:item.assetId,asset,extra:{caption:item.html,parse_mode:'HTML',supports_streaming:true,duration:Math.floor(asset.duration),width:asset.width,height:asset.height}})
                            :item.type==='photo'
                            ?await ctx.telegram.sendPhoto(ctx.chat.id,{source:followupPhotoPath(item.filename)},{caption:item.html,parse_mode:'HTML'})
                            :await ctx.telegram.sendMessage(ctx.chat.id,item.html,{parse_mode:'HTML',link_preview_options:{is_disabled:true}});
                        if(!message?.message_id)throw new Error('Telegram did not confirm packet delivery.');
                        delivery.messageIds.push(message.message_id);delivery.nextIndex=index+1;delivery.status='sending';store.save();
                    }catch{delivery.status='partial';store.save();return show(ctx);}
                }
                delivery.status='complete';store.save();return show(ctx);
            }
            throw new UserError('Unknown follow-up action.');
        }
        if(action==='dashboardevents'){adminPanel.action(action,value,session,String(ctx.from.id));return show(ctx);}
        if(action==='dashboardweb'){
            const button=bookingButton(ctx,undefined,'Open dashboards','dashboard');
            return replyHeading(ctx,button?'Dashboards\n\nLeads, handoffs and onboarding analytics in one miniapp.':'Dashboards are temporarily unavailable.',button?{reply_markup:{inline_keyboard:[[button]]}}:{});
        }
        if(action==='bookingmenu'){
            session.view='booking-menu';session.editField=null;session.editReturnView=null;return show(ctx);
        }
        if(action==='mymeetings'){
            if(ctx.chat.type!=='private'||String(ctx.chat.id)!==String(ctx.from.id))throw new UserError('Open My meetings in your private chat with the bot.');
            session.view='my-meetings';session.editField=null;return show(ctx);
        }
        if(action==='mymeetingperiod'){
            if(!Object.hasOwn(MEETING_PERIODS,value))throw new UserError('Choose Today, Tomorrow or This week.');
            if(ctx.chat.type!=='private'||String(ctx.chat.id)!==String(ctx.from.id))throw new UserError('Open My meetings in your private chat with the bot.');
            const meetings=myMeetings(store.handoffs.records(),{userId:String(ctx.from.id),period:value,timeZone:config.timeZone||'UTC',now:now()});
            if(meetings.length)for(const meeting of meetings)await ctx.telegram.sendMessage(ctx.chat.id,meeting.text,{parse_mode:'HTML',link_preview_options:{is_disabled:true}});
            else await ctx.telegram.sendMessage(ctx.chat.id,`No meetings for ${MEETING_PERIODS[value].toLowerCase()}.`);
            session.view='my-meetings';return show(ctx);
        }
        if(action==='onboardingweb'){
            const button=bookingButton(ctx,undefined,'Open onboarding','onboarding');
            return replyHeading(ctx,button?'Kick off Onboarding Chats\n\nChoose a lead, chat type and participants. Creation starts after confirmation in the miniapp.':'Onboarding is unavailable for your role or is not connected yet.',button?{reply_markup:{inline_keyboard:[[button]]}}:{});
        }
        if(action==='aefreeslots'){
            const button=bookingButton(ctx,undefined,'Open calendar','ae-slots');
            return replyHeading(ctx,button?(config.profile==='onlyplay'?'Check partnership free slots\n\nOpen calendar to view partnership manager free slots.':'Check Partnership Free Slots\n\nChoose a manager to view their calendar and available slots.'):'Calendar is temporarily unavailable.',button?bookingReplyButtons(ctx,button):{});
        }
        if(action==='bookinglinks'){
            if(config.profile==='onlyplay'){session.view='booking-managers';session.editField=null;return show(ctx);}
            const button=bookingButton(ctx,undefined,'Choose manager','booking-links');
            return replyHeading(ctx,button?'Partnership Booking Link\n\nChoose a manager to get their booking link for a client. No lead selection is required.':'Partnership Booking Link is temporarily unavailable.',button?bookingReplyButtons(ctx,button):{});
        }
        if(config.profile==='onlyplay'&&action==='bookingmanager'){
            if(!partnershipManager(value))throw new UserError('Choose a partnership manager from the list.');
            session.bookingManagerId=value;session.view='booking-manager';session.editField=null;return show(ctx);
        }
        if(action==='calendardisconnect'){
            if(!config.calendarAccountsDir||!hasPersonalCalendar(ctx.from.id)){session.view='settings';return show(ctx);}
            const account=new CalendarAccounts(config.calendarAccountsDir).status(ctx.from.id);session.disconnectCalendarVersion=account.version;session.view='settings-calendar-disconnect';return show(ctx);
        }
        if(action==='calendardisconnectconfirm'){
            if(session.view!=='settings-calendar-disconnect'||!session.disconnectCalendarVersion)throw new UserError('Confirm calendar disconnection again.');
            const accounts=new CalendarAccounts(config.calendarAccountsDir),account=accounts.status(ctx.from.id);
            if(account?.version!==session.disconnectCalendarVersion){session.view='settings';session.disconnectCalendarVersion=null;throw new UserError('The connection changed. Open Settings and confirm disconnection again.');}
            const value=accounts.load(ctx.from.id);accounts.remove(ctx.from.id);session.disconnectCalendarVersion=null;session.view='settings';
            let revoked=true;try{if(value?.tokens.refresh_token)await revokeCalendarToken(value.tokens.refresh_token);}catch{revoked=false;}
            await ctx.reply('Calendar disconnected in qooob. Existing meetings are preserved.'+(revoked?'':' Google did not confirm access revocation; remove access in your Google account settings if needed.'));return show(ctx);
        }
        if(action==='calendarconnect'){session.view='settings';session.editField=null;return show(ctx);}
        const promoterBlocked=config.profile==='onlyplay'?action==='apollo':action.startsWith('meeting')|| (config.sharedLeads?['bookweb','leadmeeting','apollo','export','delete','confirmdelete'].includes(action):action.startsWith('search')||['bookweb','leadmeeting','list','open','apollo','scope','period','export','full','delete','confirmdelete'].includes(action));
        if(config.profile!=='onlyplay'&&effectiveRole(ctx.from.id)==='promoter'&&(promoterBlocked||(action==='menu'&&!(config.sharedLeads?['add-lead','settings','search-lead']:['add-lead','settings']).includes(value))||(action==='createflow'&&value!=='promoter'))){await ctx.reply('Promoter role: lead capture and personal settings are available'+(config.sharedLeads?' and shared lead browsing.':'.'));session.view='welcome';return show(ctx);}
        if(action==='admintest'){await replyHeading(ctx,'qooob test reminder\n\nAn upcoming meeting reminder includes the lead name, company, time, location and Meet link. Delivery to your private chat works.');session.view='settings';return show(ctx);}
        try{if(adminPanel.action(action,value,session,String(ctx.from.id)))return show(ctx);}catch(error){await ctx.reply(error.message);session.view='settings';return show(ctx);}
        if (action === 'addflow' || action === 'new') {
            session.editField = null;
            delete session.pendingHandoff;delete session.meetingCreation;delete session.leadgenDraftId;delete session.pendingChannel;
            const role=effectiveRole(ctx.from.id);
            if(role==='partnership') {begin(ctx,role);return show(ctx);}
            if(role==='leadgen') session.view='leadgen-channel';
            else if(role==='promoter') {begin(ctx,role);return show(ctx);}
            else session.view='addflow';
            return show(ctx);
        }
        if (action === 'createflow') {
            session.editField=null;
            if(value!=='leadgen'){delete session.pendingHandoff;delete session.meetingCreation;delete session.leadgenDraftId;}
            if(value==='partnership') {begin(ctx,value);return show(ctx);}
            if(value==='leadgen') {session.view='leadgen-channel';if(session.pendingHandoff)session.pendingHandoff.view=session.view;}
            else if(value==='promoter'){if(config.profile==='onlyplay'){begin(ctx,value);return show(ctx);}session.view='promoter-placeholder';}
            else throw new UserError('Unknown creation flow.');
            return show(ctx);
        }
        if(action==='channel') {
            const channel=['LinkedIn','Email','Telegram','Event App'][Number(value)];
            if(!channel) throw new UserError('Unknown outreach channel.');
            session.pendingChannel=channel;session.view='leadgen-account';if(session.pendingHandoff)session.pendingHandoff.view=session.view;return show(ctx);
        }
        if(action==='createleadgen') {
            if(!session.pendingChannel) throw new UserError('Choose an outreach channel.');
            const pending=session.pendingHandoff;
            if(pending&&!new CalendarAccounts(config.calendarAccountsDir).managers(ctx.from.id,admin.read()).some(m=>m.userId===pending.managerId&&['admin','partnership'].includes(admin.read().users[m.userId]?.role)))throw new UserError('The manager calendar is unavailable. Go back and choose another manager.');
            const draftId=pending?.leadId||session.leadgenDraftId;
            const existing=draftId&&store.lead(ctx.state.owner,draftId);
            if(pending?.leadId&&(!existing||existing.owner!==ctx.state.owner||!store.canEdit(ctx.state.owner,existing)))throw new UserError('The unfinished handoff lead is unavailable. Go back and choose a lead again.');
            const lead=existing?.creationFlow==='leadgen'&&existing.owner===ctx.state.owner&&(pending?.leadId===existing.id||existing.stage===0)?existing:begin(ctx,'leadgen');
            session.activeId=lead.id;session.view='stage';session.editField=null;session.leadgenDraftId=lead.id;
            if(pending){pending.leadId=lead.id;pending.view='stage';session.meetingCreation={leadId:lead.id,managerId:pending.managerId};}
            lead.outreachChannel=session.pendingChannel;
            lead.outreachAccount=null;store.save();return show(ctx);
        }
        if(action==='handoffsetupback'&&session.pendingHandoff){
            delete session.pendingHandoff;delete session.meetingCreation;delete session.leadgenDraftId;
            session.view='meeting-add';session.editField=null;return show(ctx);
        }
        if(await meetingPicker.action(ctx,action,value))return show(ctx);
        if(action==='bookweb')return openBooking(ctx);
        if(action==='searchmenu') {session.view='search-menu';session.editField=null;session.search={};return show(ctx);}
        if(action==='searchtext') {session.view='search-input';session.editField=null;return show(ctx);}
        if(action==='searchvoice') {
            session.view='search-input';session.search={};session.editField=null;return show(ctx);
        }
        if(action==='searchfilters') {session.search={};session.view='search-filters';session.editField=null;return show(ctx);}
        if(action==='searchscopeback'){session.view='search-scope';return show(ctx);}
        if(action==='period') {
            if(!['today','yesterday','week','all'].includes(value)) throw new UserError('Unknown period.');
            session.search={period:value};session.view='search-scope';return show(ctx);
        }
        if(action==='scope') {
            if(config.profile==='onlyplay'&&value==='all'){session.view='search-scope';return show(ctx);}
            if(!['assigned','created','all'].includes(value)) throw new UserError('Unknown list.');
            session.search={...session.search,scope:value};return list(ctx);
        }
        if(action==='searchresults') return list(ctx,Math.max(0,Number(value)||0));
        if (action === 'menu' && MENU_SECTIONS.some(section => section.id === value)) {
            // Keep already-displayed mockup buttons working after this update.
            if (value === 'add-lead') { delete session.pendingHandoff;delete session.meetingCreation;delete session.leadgenDraftId;delete session.pendingChannel;if(restrictedPromoter(ctx))begin(ctx,'promoter');else session.view='addflow'; return show(ctx); }
            if (value === 'book-meeting') {session.view='booking-menu';session.editField=null;return show(ctx);}
            if (value === 'search-lead') {session.view='search-menu';session.search={};return show(ctx);}
            if (value === 'settings') {session.view='settings';session.editField=null;return show(ctx);}
            session.view = 'menu-placeholder';
            session.menuSection = value;
            session.editField = null;
            return show(ctx);
        }
        if (action === 'welcome') { session.view = 'welcome'; return show(ctx); }
        if (action === 'resume') {
            session.onboarded = true;
            session.editField = null;
            if(session.pendingHandoff?.leadId){
                const pendingLead=store.lead(ctx.state.owner,session.pendingHandoff.leadId);
                if(!pendingLead||pendingLead.owner!==ctx.state.owner||!store.canEdit(ctx.state.owner,pendingLead))throw new UserError('The unfinished handoff lead is unavailable. Go back and choose a lead again.');
                session.activeId=pendingLead.id;session.cardFromSearch=false;
                session.meetingCreation={leadId:pendingLead.id,managerId:session.pendingHandoff.managerId};
            }
            if(session.pendingHandoff&&session.pendingHandoff.view!=='stage'){
                session.view=session.pendingHandoff.view;return show(ctx);
            }
            session.view = 'stage';
            session.checkpointStage = null;
            return show(ctx);
        }
        if (action === 'list') return list(ctx, Math.max(0, Number(value) || 0));
        if (action === 'open') {
            const selected = store.lead(ctx.state.owner, value);
            if (!selected) throw new UserError('Lead not found.');
            Object.assign(session, { activeId: selected.id, cardFromSearch:true, editReturnView:null, view: 'review', editField: null, fieldIndex: 0, returnStage: null, checkpointStage: null, albumId: null });
            return show(ctx);
        }
        const lead = store.lead(ctx.state.owner);
        if (!lead) throw new UserError('Choose Add Lead in the menu.');
        if(normalizeCapture(ctx,lead))return show(ctx);
        if(!store.canEdit(ctx.state.owner,lead)&&!['full','export','leadmeeting','source'].includes(action)){await ctx.reply('This lead is read-only. Only its creator or assigned manager can edit it.');session.view='review';return show(ctx);}
        if(action==='extrainfo') {session.view=config.profile==='onlyplay'?'edit-info':'extra-info';session.editField=null;return show(ctx);}
        if(action==='editinfo'){session.view='edit-info';session.editField=null;session.editReturnView=null;return show(ctx);}
        if(action==='editgroup'){if(unusedCaptureField(lead,value,ctx))throw new UserError('This section is not used for this lead capture flow.');if(!Object.hasOwn(LEAD_EDIT_GROUPS,value))throw new UserError('Unknown editing section.');session.view='edit-group';session.editGroup=value;session.editField=null;session.editReturnView=null;return show(ctx);}
        if(action==='editback'){session.editField=null;session.view=config.profile==='onlyplay'?'edit-info':'edit-group';session.editReturnView=null;return show(ctx);}
        if(action==='leadmeeting'){
            if(config.profile==='onlyplay'){
                session.view='review';session.editField=null;
            }
            return openBooking(ctx,lead.id);
        }
        if(action==='linkedin'&&config.profile==='onlyplay'){
            session.editField=null;
            session.view=linkedinProfileUrl(lead.fields.linkedin)?'linkedin-invitation':'review';
            return show(ctx);
        }
        if(action==='apollo') {
            if(config.profile!=='onlyplay')return show(ctx);
            const progress=await ctx.reply('Apollo is searching for data…');
            let result;
            try{
                result=await apollo.enrich(lead,{persist:()=>store.save(),canApply:()=>!admin.blocked(ctx.from.id)&&store.lead(ctx.state.owner,lead.id)===lead&&store.canEdit(ctx.state.owner,lead)});
            }catch{result={status:'unavailable'};}
            await ctx.telegram.editMessageText(ctx.chat.id,progress.message_id,undefined,apolloNotice(result)).catch(()=>{});
            session.view='review';session.editField=null;
            return show(ctx);
        }
        if(action==='delete') {session.pendingDelete={leadId:lead.id,expires:Date.now()+300000,confirmed:false};session.view='delete-confirm';return show(ctx);}
        if(action==='confirmdelete'&&config.profile==='onlyplay'){
            if(session.view!=='delete-confirm'||value!==lead.id||session.pendingDelete?.leadId!==lead.id||session.pendingDelete.expires<Date.now())throw new UserError('Confirm deletion again.');
            session.pendingDelete.confirmed=true;session.view='delete-confirm-final';return show(ctx);
        }
        if(action==='confirmdelete'&&config.profile!=='onlyplay'||action==='finaldelete'&&config.profile==='onlyplay') {
            if(config.profile==='onlyplay'?(session.view!=='delete-confirm-final'||value!==lead.id||session.pendingDelete?.leadId!==lead.id||!session.pendingDelete.confirmed||session.pendingDelete.expires<Date.now()):(session.view!=='delete-confirm'||value!==lead.id))throw new UserError('Confirm deletion again.');
            delete session.pendingDelete;
            lead.deletedAt=new Date().toISOString();lead.deletedBy=String(ctx.from.id);
            session.activeId=null;session.editField=null;store.save();
            await ctx.reply('Lead deleted from the bot. The Google Sheets record is unchanged.');
            return list(ctx);
        }

        if (action === 'addmore') {
            session.view = 'stage';
            return show(ctx, false);
        }
        if (action === 'next' || action === 'skip') {
            if (lead.stage >= STEPS.length) return show(ctx);
            const stageKey = STEPS[lead.stage]?.key;
            if (action === 'skip') {
                for (const source of lead.materials.filter(m => m.stage === stageKey && !['done', 'omitted'].includes(m.status))) {
                    source.status = 'deferred';
                }
                touch(lead);
            } else if (lead.materials.some(m => m.stage === stageKey && !['done', 'omitted'].includes(m.status))) {
                try { await processCurrent(ctx, lead); }
                catch (error) {
                    for (const source of lead.materials.filter(m => m.stage === stageKey && !['done', 'omitted'].includes(m.status))) {
                        source.status = 'deferred';
                    }
                    touch(lead);
                }
            }
            finishStep(lead, session, ctx);
        } else if (action === 'defer') {
            for (const source of lead.materials.filter(m => m.stage === STEPS[lead.stage]?.key && ['failed', 'pending'].includes(m.status))) {
                source.status = 'deferred';
            }
            touch(lead);
            finishStep(lead, session, ctx);
        } else if (action === 'retryfailed') {
            await processCurrent(ctx, lead);
            const source = lead.materials.find(m => m.stage === STEPS[lead.stage]?.key && m.status === 'done');
            if (source && STEPS[lead.stage]?.key === 'details') {
                finishStep(lead, session, ctx);
            }
        } else if (action === 'retry') {
            if (!services.aiConfigured()) throw new UserError('Recognition is not connected yet. All materials saved, the lead is ready to use.');
            const source = activeMaterials(lead).find(m => m.status === 'deferred');
            if (source) {
                if (source.stage === 'nextSteps') {
                    await processCurrent(ctx, lead, { stageKey: source.stage, sourceId: source.id });
                    return show(ctx);
                }
                session.returnStage = lead.stage;
                lead.stage = STEPS.findIndex(s => s.key === source.stage);
                session.checkpointStage = null;
                session.view = 'stage';
                await processCurrent(ctx, lead);
                finishStep(lead, session, ctx);
            }
        } else if (action === 'pick') {
            const key = STEPS[lead.stage]?.key;
            const options = key === 'icp' ? config.icpOptions : key === 'generatedBy' ? config.generatedOptions : [];
            if (!options[Number(value)]) throw new UserError('Select an option for the current stage.');
            editField(lead, key, options[Number(value)]);
            finishStep(lead, session, ctx);
        } else if (action === 'back') {
            session.checkpointStage=null;session.fieldIndex=0;session.editField=null;session.editReturnView=null;
            if (session.returnStage != null) {
                lead.stage = session.returnStage;
                session.returnStage = null;
                session.view = 'review';
            } else if(config.profile==='onlyplay'&&lead.stage===0){
                session.view=lead.creationFlow==='leadgen'?(session.pendingChannel?'leadgen-account':'leadgen-channel'):'addflow';
                if(lead.creationFlow==='leadgen')session.leadgenDraftId=lead.id;
                if(session.pendingHandoff?.leadId===lead.id)session.pendingHandoff.view=session.view;
            } else {
                lead.stage = Math.max(0, lead.stage - 1);
                while(lead.stage>0&&unusedCaptureField(lead,STEPS[lead.stage]?.key,ctx))lead.stage--;
                session.view = 'stage';
            }
        } else if (['review', 'stage', 'steps', 'conflicts', 'more'].includes(action)) {
            if (action === 'conflicts' && session.view !== 'conflicts') session.conflictReturnView = session.view;
            session.view = action;
            session.editReturnView = null;
            session.editField = null;
            if (action === 'stage') { session.checkpointStage = null; session.fieldIndex = 0; }
        } else if (action === 'step') {
            const index = /^\d+$/.test(value) ? Number(value) : STEPS.findIndex(s => s.key === value);
            if (!Number.isInteger(index) || index < 0 || index >= STEPS.length) throw new UserError('Unknown stage.');
            if(unusedCaptureField(lead,STEPS[index].key,ctx))throw new UserError('This step is not used for this lead capture flow.');
            session.returnStage ??= lead.stage;
            lead.stage = index;
            session.checkpointStage = null;
            session.fieldIndex = 0;
            session.view = 'stage';
        } else if (action === 'fields') {
            session.view = 'fields';
            session.editReturnView = null;
            session.page = Math.max(0, Number(value) || 0);
        } else if (action === 'edit') {
            if(config.profile==='onlyplay'&&value==='nextSteps')throw new UserError('Next steps editing is no longer available.');
            if (!Object.hasOwn(FIELDS, value)) throw new UserError('Unknown field.');
            if(unusedCaptureField(lead,value,ctx))throw new UserError('This field is not used for this lead capture flow.');
            if(config.profile==='onlyplay'&&session.view==='edit-info'){session.editReturnView='edit-info';session.editField=value;return show(ctx);}
            if(session.view==='edit-group'){if(!LEAD_EDIT_GROUPS[session.editGroup]?.fields.includes(value))throw new UserError('Choose a field from this section.');session.editReturnView='edit-group';}else session.editReturnView=null;
            if (['icp', 'generatedBy'].includes(value)) {
                session.returnStage ??= lead.stage;
                lead.stage = STEPS.findIndex(s => s.key === value);
                session.checkpointStage = null;
                session.view = 'stage';
            } else session.editField = value;
        } else if (action === 'clear') {
            if(config.profile==='onlyplay'&&session.editField==='nextSteps'){session.editField=null;throw new UserError('Next steps editing is no longer available.');}
            if(unusedCaptureField(lead,session.editField,ctx)){session.editField=null;throw new UserError('This field is not used for this lead capture flow.');}
            if (session.editField) editField(lead, session.editField, '');
            session.editField = null;
            if (session.editReturnView) {
                session.view=session.editReturnView;session.editReturnView=null;
            } else if (session.editReturnStage != null) {
                lead.stage = session.editReturnStage;
                session.editReturnStage = null;
                session.view = 'stage';
            } else session.view = 'review';
        } else if (action === 'resolve') {
            const conflict=activeConflicts(lead)[0];
            if (conflict) resolveConflict(lead, conflict.id, value === 'new');
            session.view = activeConflicts(lead).length ? 'conflicts' : (session.conflictReturnView || 'review');
        } else if (action === 'source' || action === 'raw' || action === 'omit') {
            const material = lead.materials.find(m => m.id.startsWith(value) && ['pending', 'failed'].includes(m.status) && m.stage === STEPS[lead.stage]?.key);
            if (action === 'source' && material) {
                await ctx.telegram.copyMessage(ctx.chat.id, ctx.chat.id, material.messageId);
            } else if (action === 'raw') keepSourceText(lead, material);
            else if (action === 'omit' && material) {
                material.status = 'omitted'; touch(lead);
            }
        } else if (action === 'save' || action === 'sync') {
            reconcileConflicts(lead);
            if (activeConflicts(lead).length) {
                session.conflictReturnView = 'review';
                session.view = 'conflicts';
                await show(ctx);
                return;
            }
            assertReady(config.profile==='onlyplay'?{...lead,conflicts:activeConflicts(lead),materials:activeMaterials(lead)}:lead);
            if (sheets.configured()) {
                await syncLeadToSheets(lead);
                if (lead.sheetsSync?.status === 'failed') {
                    throw new UserError('Lead saved locally. Could not confirm Google Sheets write; please try saving again.');
                }
            } else {
                lead.status = 'saved';
                lead.savedAt ||= new Date().toISOString();
                store.save();
            }
            await ctx.reply(sheets.configured() ? 'Lead saved to database. ✅' : 'Lead saved locally. ✅');
            if(session.meetingCreation?.leadId===lead.id){
                const {managerId}=session.meetingCreation;delete session.meetingCreation;delete session.pendingHandoff;delete session.leadgenDraftId;
                session.meetingManagerId=managerId;session.meetingSearch={query:'',matches:[{id:lead.id}],selectedId:lead.id,mode:'meeting'};session.view='meeting-selected';
            }else session.view = 'welcome';
        } else if (action === 'export' || action === 'full') {
            await exportLead(ctx, action === 'export' ? 'json' : 'txt');
        }
        await show(ctx);
    }

    bot.on('message', async ctx => {
        const session = ctx.state.session;
        const message = ctx.message;
        let lead = store.lead(ctx.state.owner);
        if (!message.text?.startsWith('/')) {
            // Old screens and durable inbox/album uploads retain their original attribution.
            // Keep the source, but never process it as the next permitted capture field.
            const queuedLead=ctx.state.arrival&&store.lead(ctx.state.owner,ctx.state.arrival.id);
            identifyCaptureFlow(ctx,lead);identifyCaptureFlow(ctx,queuedLead);
            const queuedKey=STEPS[ctx.state.arrival?.stage]?.key;
            const currentKey=STEPS[lead?.stage]?.key;
            const retiredLead=queuedLead&&unusedCaptureField(queuedLead,queuedKey)?queuedLead:lead;
            const retiredKey=queuedLead&&unusedCaptureField(queuedLead,queuedKey)?queuedKey:
                unusedCaptureField(lead,session.editField)?session.editField:unusedCaptureField(lead,currentKey)?currentKey:null;
            if(retiredKey){
                if(!store.canEdit(ctx.state.owner,retiredLead))throw new UserError('This material belongs to a read-only lead.');
                const stage=retiredLead.stage;retiredLead.stage=STEPS.findIndex(step=>step.key===retiredKey);
                try{if(addMaterial(retiredLead,materialInput(message)))retiredLead.materials.at(-1).status='deferred';}
                finally{retiredLead.stage=stage;}
                normalizeCapture(ctx,lead);store.save();
                await ctx.reply('This step is no longer used for this lead. Your message is retained with its original step. Continue with the current screen.');
                return show(ctx);
            }
        }
        if(config.profile==='onlyplay'&&session.view?.startsWith('materials-'))return ctx.reply('Choose a template using a button.');
        if(session.view==='settings-event-form'){
            try{adminPanel.text(message.text,session,String(ctx.from.id));}catch(error){await ctx.reply(error.message);}
            return show(ctx);
        }
        if(session.view==='settings-add'){
            if(!admin.isAdmin(ctx.from.id)){session.view='settings';return show(ctx);}
            const id=message.text?.trim();if(!/^\d{1,16}$/.test(id||'')||!Number.isSafeInteger(Number(id))||Number(id)<1)return ctx.reply('Send a numeric Telegram user ID.');
            session.adminTarget=id;session.view='settings-user';return show(ctx);
        }
        if(session.view?.startsWith('settings'))return ctx.reply('Choose an action using a button in Settings.');
        if(restrictedPromoter(ctx)&&(/^(search|meeting|followup-)/.test(session.view)||['list','booking-menu','linkedin-invitation'].includes(session.view)))return promoterDenied(ctx);
        if(config.profile==='onlyplay'&&session.view?.startsWith('followup-'))return ctx.reply('Choose a follow-up action using a button.');
        if(await meetingPicker.text(ctx,message))return show(ctx);
        if(['search-input','search-voice'].includes(session.view)||config.profile==='onlyplay'&&session.view==='list') {
            const progress=await ctx.reply(message.voice||message.audio?'Transcribing and searching…':'Searching…');
            try{const query=await readSearchQuery(message,services);session.search={query,...await leadSearch(Object.values(store.state.leads),{...searchOptions,owner:ctx.state.owner,sharedLeads:config.sharedLeads,query,timeZone:config.timeZone||'UTC'})};return await list(ctx);}
            catch(error){if(error instanceof UserError){await ctx.reply(error.message);return;}throw error;}
            finally{try{await ctx.telegram.deleteMessage(ctx.chat.id,progress.message_id);}catch{}}
        }
        if(!session.editField&&['addflow','leadgen-channel','leadgen-account','promoter-placeholder','menu-placeholder','search-menu','search-filters','search-scope','delete-confirm','delete-confirm-final','extra-info','edit-info','edit-group','booking-menu','booking-managers','booking-manager','linkedin-invitation'].includes(session.view)) {
            await ctx.reply('Choose an action using a button.');return;
        }
        if (message.text?.startsWith('/')) throw new UserError('Unknown command. /help');
        if (store.list(ctx.state.owner).some(item => item.materials.some(m => m.messageId === message.message_id))) return;
        lead = store.lead(ctx.state.owner);
        if(lead&&!store.canEdit(ctx.state.owner,lead))return ctx.reply('This lead is read-only. Use Add Lead to create a new lead.');
        const fromIdle = !lead || ['welcome', 'list'].includes(session.view);
        if (fromIdle&&config.profile!=='onlyplay') lead = begin(ctx);
        if(config.profile==='onlyplay'&&fromIdle)return ctx.reply('Choose Add Lead to create a lead, or Search Lead to search.');
        normalizeCapture(ctx,lead);
        if (session.editField) {
            if(config.profile==='onlyplay'&&session.editField==='nextSteps'){session.editField=null;throw new UserError('Next steps editing is no longer available.');}
            if(unusedCaptureField(lead,session.editField,ctx)){session.editField=null;throw new UserError('This field is not used for this lead capture flow.');}
            if (!message.text) throw new UserError('Send the new field value as text.');
            editField(lead, session.editField, message.text, {replace:Boolean(session.editReturnView)});
            session.editField = null;
            if (session.editReturnView) {
                session.view=session.editReturnView;session.editReturnView=null;
            } else if (session.editReturnStage != null) {
                lead.stage = session.editReturnStage;
                session.editReturnStage = null;
                session.view = 'stage';
            } else session.view = 'review';
            return show(ctx);
        }
        const arrival = ctx.state.arrival;
        if (!fromIdle && arrival && !['welcome', 'list'].includes(arrival.view) && (arrival.id !== lead.id || arrival.stage !== lead.stage)) {
            // A queued upload stays attached to the lead/stage visible when it arrived.
            lead = store.lead(ctx.state.owner, arrival.id);
            if(!lead)throw new UserError('The original lead is no longer available. Send the material again on the current screen.');
            if(lead&&!store.canEdit(ctx.state.owner,lead))return ctx.reply('This material belongs to a read-only lead. Open your own lead and send it again.');
            lead.stage = arrival.stage;
            session.activeId = lead.id;
            await ctx.reply('Material arrived during transition. Returning it to the original stage.');
        }
        const step = STEPS[lead.stage];
        if (!step) throw new UserError('Open "Add materials" or "Edit fields" in the lead card.');
        if (!fromIdle && ['icp', 'generatedBy'].includes(step.key)) {
            const options = step.key === 'icp' ? config.icpOptions : config.generatedOptions;
            const selected = options.find(option => option.toLowerCase() === message.text?.trim().toLowerCase());
            if (selected) {
                editField(lead, step.key, selected);
                finishStep(lead, session, ctx);
                return show(ctx);
            }
            if(config.profile==='onlyplay'&&step.key==='generatedBy'&&message.text?.trim()){
                editField(lead,'generatedBy',message.text.trim());finishStep(lead,session,ctx);return show(ctx);
            }
        }
        const input = materialInput(message);
        const currentStage = lead.stage;
        if (currentStage < 2) lead.stage = 2;
        try { if (!addMaterial(lead, input)) return; }
        finally { lead.stage = currentStage; }
        if (arrival?.materialStage === 'nextSteps') lead.materials.at(-1).stage = 'nextSteps';
        session.view = 'stage';
        store.save();
        const source = lead.materials.at(-1);
        await processCurrent(ctx, lead, { stageKey: source.stage, sourceId: source.id });
        if (source.status === 'done') {
            if (source.stage === 'details' && STEPS[lead.stage]?.key === 'details') {
                finishStep(lead, session, ctx);
            } else if (['identity', 'context', 'history'].includes(source.stage) && STEPS[lead.stage]?.key === source.stage) {
                session.view = 'added';
                session.addedMessageId = message.message_id;
            }
        }
        const replace = Boolean(message.media_group_id && session.albumId === message.media_group_id);
        session.albumId = message.media_group_id || null;
        await show(ctx, replace);
    });

    bot.catch(error => console.error('Telegram handler failed:', error.code || error.name));
    return bot;
}
