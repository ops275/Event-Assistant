import { MENU_SECTIONS } from './menuMockup.js';
import { FIELDS, STEPS, LEAD_EDIT_GROUPS } from './config.js';
import { MULTI_CONTACT_FIELDS } from './flow.js';
import { safeOnboardingLink } from './services/onboardingProjection.js';
import {FOLLOWUP_CATEGORIES,FOLLOWUP_TEMPLATE_PACKS,followupTemplate} from './services/followupTemplates.js';
import {PARTNERSHIP_MANAGERS,partnershipManager} from './services/partnershipManagers.js';
import {excludedCaptureField,allowedCaptureStage,captureProjection} from './services/leadCapturePolicy.js';

export const clip = (text, length = 180) => {
    const value = Array.from(String(text || ''));
    return value.length > length ? value.slice(0, length - 3).join('') + '...' : value.join('');
};
const clipUtf16 = (value, limit) => {
    const text=String(value||'');if(text.length<=limit)return text;
    let prefix='';for(const character of text){if(prefix.length+character.length>limit-3)break;prefix+=character;}
    return prefix+'...';
};
export function label(lead) {
    return [lead.fields.fullName, lead.fields.company].filter(Boolean).map(value=>clip(String(value).replace(/\s+/g,' ').trim(),33)).join(' / ') || 'New lead';
}
export function callback(session, action) { return 'v2:' + session.nonce + ':' + action; }
const button = (session, text, action) => ({ text, callback_data: callback(session, action) });
export function linkedinProfileUrl(value) {
    if (typeof value !== 'string') return null;
    const input = value.trim();
    if (!input || /[\s\\]/u.test(input)) return null;
    try {
        const url = new URL(/^https:\/\//i.test(input) ? input : 'https://' + input);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !/(^|\.)linkedin\.com$/.test(url.hostname)) return null;
        if (!/^\/in\/[-\p{L}\p{N}_]+\/?$/u.test(decodeURIComponent(url.pathname))) return null;
        return url.origin + url.pathname;
    } catch { return null; }
}
const LINKEDIN_INVITATION = 'Hey, we’ve just met at the event. Let’s connect!';
const visibleLead = (lead, config) => !lead || config.profile !== 'onlyplay' ? lead : {
    ...lead,
    conflicts: lead.conflicts.filter(item => item.key !== 'nextSteps'),
    materials: lead.materials.filter(item => item.stage !== 'nextSteps' && item.targetField !== 'nextSteps'),
};
const hiddenCaptureField=excludedCaptureField;

// Let Telegram size the message naturally; keep actions in a consistent column.
const layoutPanel = panel => panel && panel.rows.length
    ? { ...panel, rows: panel.rows.flatMap(row => row.map(item => [item])) }
    : panel;

export function normalizeNavigation(panel, config = {}, session = {}) {
    if (!panel || config.profile !== 'onlyplay') return panel;
    const rows = panel.rows.map(row => row.map(item => ({ ...item, text: /^Back(?:\b|$)/.test(item.text) ? '<< back' : item.text === 'Next' ? 'next >>' : item.text === 'Menu' ? '☰ menu' : item.text })));
    if (session.view !== 'welcome' && !rows.flat().some(item => item.callback_data?.endsWith(':welcome'))) rows.push([button(session, '☰ menu', 'welcome')]);
    return { ...panel, rows };
}

export function fieldTitle(key, config = {}) {
    if (config.profile === 'onlyplay') {
        if (key === 'generatedBy') return 'Introduced by';
        if (key === 'context') return 'Meeting/chatting context';
    }
    return FIELDS[key];
}

function fieldLines(lead, config = {}) {
    const first = ['fullName', 'company', 'jobTitle'];
    const keys = [...first, ...Object.keys(FIELDS).filter(key => !first.includes(key))];
    return keys.filter(key => lead.fields[key] && !(config.profile === 'onlyplay' && key === 'nextSteps')).map(key => fieldTitle(key, config) + ': ' +
        clip(String(lead.fields[key]).replace(/\s*\n+\s*/g, '; '), ['context', 'nextSteps', 'history'].includes(key) ? 250 : 120));
}

const FIELD_COMMANDS = {
    icp: 'icp_type', generatedBy: 'generated_by',
    fullName: 'full_name', company: 'company', jobTitle: 'job_title',
    context: 'meeting_context', nextSteps: 'next_steps', history: 'previous_correspondence',
    email: 'email', website: 'website', linkedin: 'linkedin', telegram: 'telegram',
    phone: 'telephone_whatsapp', address: 'address', otherContacts: 'other_contacts',
};

export const EDIT_COMMANDS = Object.fromEntries(Object.entries(FIELD_COMMANDS).map(([key, command]) => [command, key]));

function escapeHtml(value) {
    return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function cardLine(lead, key, config = {}) {
    const limits = { context: 600, nextSteps: 400, history: 1000 };
    const value = lead.fields[key] ? escapeHtml(clip(lead.fields[key], limits[key] || 150)) : '<i>empty</i>';
    const title = config.profile === 'onlyplay' && key === 'generatedBy' ? 'Introduced by (/generated_by)' : `/${FIELD_COMMANDS[key]}`;
    return `${title}: ${value}`;
}

export function contactCard(lead, config = {}) {
    if(config.profile==='onlyplay')return onlyplayContactCard(lead,config);
    const section = (title, keys) => [`<b>${title}</b>`, ...keys.map(key => cardLine(lead, key, config))].join('\n');
    const namePart = clip([lead.fields.fullName, lead.fields.company].filter(Boolean).join(' from '), 100);
    const contactTitle = namePart ? `👤 ${escapeHtml(namePart)}` : '👤 &lt;Full Name&gt; from &lt;Company&gt;';
    const lines = [
        '💡 <i>Tap a command below to edit or supplement a field.</i>',
        section(contactTitle, ['fullName', 'company', 'icp', 'generatedBy']),
        section('💬 ' + fieldTitle('context', config), ['context']),
        section('🗂 Previous correspondence', ['history']),
        ...(config.profile === 'onlyplay' ? [] : [section('✅ Next steps', ['nextSteps'])]),
        section('📇 Lead details', ['jobTitle', 'phone', 'telegram', 'email', 'website', 'linkedin', 'address', 'otherContacts']),
    ];
    if(lead.handoff)lines.push(escapeHtml(handoffText(lead)));
    if(config.profile==='onlyplay')for(const chat of Object.values(lead.onboardingChats||{})){
        if(chat?.status!=='Chat created'||!chat.groupId)continue;
        const link=safeOnboardingLink(chat.link);
        lines.push(escapeHtml(['Chat created',chat.title,link].filter(Boolean).join('\n')));
    }
    if (config?.cardFooter) {
        lines.push(config.cardFooter);
    }
    return lines.join('\n\n');
}

function websiteLinks(value) {
    const values=String(value||'').split(/\r?\n/).map(item=>item.trim()).filter(Boolean);
    const limit=Math.max(3,Math.floor(180/Math.max(1,values.length)));
    const displayed=[];let used=0;
    for(const [index,input] of values.entries()){
        const separator=displayed.length?3:0;
        const available=180-used-separator-(index<values.length-1?6:0);
        if(available<3){displayed.push({input:null,label:'...'});break;}
        const label=clipUtf16(input.replace(/^https?:\/\//i,''),Math.min(limit,available));
        displayed.push({input,label});used+=separator+label.length;
    }
    return displayed.map(({input,label:plainLabel})=>{
        const label=escapeHtml(plainLabel);
        if(input===null)return label;
        // Validate with URL, but retain the original spelling, path, query and fragment.
        if(/[\s\\\u0000-\u001f\u007f]/u.test(input)||input.startsWith('//'))return label;
        const http=/^https?:\/\//i.test(input);
        if(!http&&/^[a-z][a-z0-9+.-]*:/i.test(input)&&!(/^[^/:?#]+:\d+(?:[/?#]|$)/.test(input)))return label;
        const href=http?input:'https://'+input;
        try {
            const url=new URL(href);
            if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)return label;
        } catch { return label; }
        return `<a href="${escapeHtml(href).replaceAll('"','&quot;')}">${label}</a>`;
    }).join(' | ');
}

function onlyplayContactCard(lead,config) {
    const f=lead.fields, text=(value,limit=120)=>escapeHtml(clipUtf16(String(value||'').trim(),limit));
    const website=websiteLinks(f.website);
    const lines=[`<b>${text(f.company)||'Company'}</b>${website?' | '+website:''}`];
    const source=String(f.generatedBy||'').trim();
    const creator=[lead.actorName,lead.actor,lead.actorUsername].find(value=>typeof value==='string'&&value.trim())?.trim();
    const introducedBy=/^myself$/i.test(source) ? (creator||f.generatedBy) : /^nobody(?: \(my own lead\))?$/i.test(source) ? (lead.actorName||lead.actor||lead.actorUsername||'') : f.generatedBy;
    if(f.icp||introducedBy)lines[0]+='\n'+[text(f.icp,80),introducedBy?'by '+text(introducedBy,100):''].filter(Boolean).join(' ');
    lines.push('<b>👤 '+(text(f.fullName)||'Full name')+'</b>');
    const linkedin=linkedinProfileUrl(f.linkedin);
    if(f.jobTitle||linkedin)lines[lines.length-1]+='\n🎖️ '+(linkedin?`<a href="${escapeHtml(linkedin).replaceAll('"','&quot;')}">${text(f.jobTitle)||'Linkedin'}</a>`:text(f.jobTitle));
    for(const key of ['context','history'])if(f[key])lines.push('<blockquote><i>'+text(f[key],key==='context'?450:600)+'</i></blockquote>');
    const contacts=[];
    if(f.telegram)contacts.push(text(f.telegram,120));
    if(linkedin){
        const input=f.linkedin.trim();
        const fullUrl=new URL(/^https:\/\//i.test(input)?input:'https://'+input).href;
        contacts.push(`<a href="${escapeHtml(fullUrl).replaceAll('"','&quot;')}">LinkedIn</a>`);
    }
    const phone=[f.phone&&text(f.phone,120),(f.telegramId||f.contactId)&&text(f.telegramId||f.contactId,60)].filter(Boolean).join(' | ');if(phone)contacts.push(phone);
    if(f.email)contacts.push(text(f.email,180));
    if(f.linkedin&&!linkedin)contacts.push(text(f.linkedin,180));
    if(f.address)contacts.push(text(f.address,120));
    if(f.otherContacts)contacts.push(text(f.otherContacts,200));
    if(contacts.length)lines.push(contacts.join('\n'));
    const apollo=lead.enrichment?.apollo;
    const fieldDate=Object.values(apollo?.fields||{}).map(item=>item.at).filter(at=>typeof at==='string'&&Number.isFinite(Date.parse(at))).sort().at(-1);
    const enrichedAt=fieldDate||(typeof apollo?.completedAt==='string'&&Number.isFinite(Date.parse(apollo.completedAt))?apollo.completedAt:null);
    if(['updated','unchanged'].includes(apollo?.status)&&enrichedAt)lines.push('Already enriched via Apollo · '+text(enrichedAt.slice(0,10)));
    lines.push('🦾 vibecoded by qooob');
    return lines.join('\n\n').replaceAll('</blockquote>\n\n<blockquote>', '</blockquote>\n<blockquote>');
}

function handoffText(lead) {
    const h=lead.handoff;if(!h)return '';
    const person=p=>p?.name||p?.id||'Unknown';
    return ['Lead handoff: '+h.status,'Sender: '+person(h.sender),'Receiver: '+person(h.receiver),'Handed off: '+h.at,'Type: '+h.meetingType,'Original creator: '+person(h.creator),h.description?'Description: '+h.description:'',h.event?.url?'Calendar: '+h.event.url:''].filter(Boolean).join('\n');
}

export function summary(lead, config = {}) {
    lead=visibleLead(lead,config);
    const lines = fieldLines(lead, config);
    if (!lead.fields.fullName && !lead.fields.company) lines.push('Name and company not specified yet.');
    if (lead.conflicts.length) lines.push('\nDifferent values found. Choose the correct one.');
    const deferred = lead.materials.filter(m => m.status === 'deferred').length;
    if (deferred) lines.push('\nPending extraction: ' + deferred);
    return lines.join('\n');
}

export function addedText(source, lead, config = {}) {
    if (source.stage === 'identity') {
        const name = lead?.fields.fullName?.trim();
        const company = lead?.fields.company?.trim();
        const lines = [
            'Full name: ' + (name ? clip(name, 150) : 'not recognized'),
            'Company: ' + (company ? clip(company, 150) : 'not recognized'),
        ];
        return 'Contact added. ✅\n\n' + lines.join('\n');
    }
    const titles = { identity: 'Contact added. ✅', context: 'Context added. ✅', history: 'Correspondence added. ✅', details: 'Details added. ✅' };
    const result = source.result || {};
    const lines = Object.entries(result.fields || {})
        .filter(([key, value]) => Object.hasOwn(FIELDS, key) && !(config.profile === 'onlyplay' && key === 'nextSteps') && typeof value === 'string' && value.trim())
        .map(([key, value]) => fieldTitle(key, config) + ': ' + value.trim());
    const note = result.note || result.transcript;
    if (note && !Object.values(result.fields || {}).includes(note)) lines.push(note);
    if (config.profile !== 'onlyplay' && result.nextSteps && result.nextSteps !== result.fields?.nextSteps) lines.push('Next steps: ' + result.nextSteps);
    return (titles[source.stage] || 'Details added. ✅') + '\n\n' + clip(lines.join('\n\n') || 'No details recognized.', 3500);
}

export function render(lead, session, config = {}) {
    if(config.profile==='onlyplay'&&session.editField==='nextSteps')session={...session,editField:null,view:'review'};
    if(hiddenCaptureField(lead,session.editField,config))session={...session,editField:null,view:'review'};
    if(lead)lead={...captureProjection(lead,config),stage:allowedCaptureStage(lead,lead.stage,config)};
    return layoutPanel(normalizeNavigation(renderContent(visibleLead(lead,config), session, config),config,session));
}

function renderContent(lead, session, config) {
    const rows = [];
    const add = (...items) => rows.push(items.map(([text, action]) => button(session, text, action)));
    if(config.profile==='onlyplay'&&session.view?.startsWith('followup-')){
        if(session.view==='followup-category'){
            add(['Operator','followupcategory:operator']);add(['Provider','followupcategory:provider']);
            add(['Back','welcome']);add(['Menu','welcome']);
            return {text:'Follow-up Leads\n\nChoose the lead type. Templates are delivered only to your private chat; you decide what to forward.\n\nTelegram · WhatsApp / LinkedIn / Email — Coming soon.',rows};
        }
        const category=FOLLOWUP_CATEGORIES.includes(session.followupCategory)?session.followupCategory:null;
        const title=category==='operator'?'Operator':'Provider';
        if(session.view==='followup-templates'||!followupTemplate(category,session.followupTemplate)){
            const packs=FOLLOWUP_TEMPLATE_PACKS.filter(pack=>pack.category===category);
            packs.forEach(pack=>add([pack.name,'followuptemplate:'+pack.id]));
            add(['Back','followuphome']);add(['Menu','welcome']);
            return {text:'Follow-up Leads · '+title+'\n\n'+(packs.length?'Choose a template.':'No Provider follow-up templates have been supplied yet.'),rows};
        }
        const pack=followupTemplate(category,session.followupTemplate),delivery=session.followupDelivery;
        const current=delivery?.category===category&&delivery?.templateId===pack.id;
        const count=current?delivery.nextIndex:0,total=current?delivery.items.length:pack.items.length,complete=count===total,partial=current&&delivery.status==='partial';
        const legacy=current&&delivery.version<2;
        if(!complete)add([count||partial?'Retry remaining packet':'Send packet to me','followupsend']);
        if(complete&&legacy)add(['Send updated packet with videos','followupupgrade']);
        add(['Back','followupback']);add(['Menu','welcome']);
        const content=legacy?'Version '+delivery.version+' packet without videos. '+(complete?'The updated packet with both videos is available on request.':'Retry preserves your original packet. After it finishes, you can request the updated packet with both videos.'):'Version '+pack.version+' packet includes both videos with captions and both images.';
        return {text:'Follow-up Leads · '+pack.name+'\n\n'+content+'\n\n'+(complete?(legacy?'Version '+delivery.version+' packet':'Packet')+' sent to your private chat. You decide which messages to forward.':count||partial?'Delivery stopped: '+count+' of '+total+' messages confirmed. Retry continues after confirmed messages. The last unconfirmed message may have arrived if Telegram did not confirm it.':'Send the packet to your private chat. Nothing is sent to a lead.'),rows};
    }
    if (config.profile === 'onlyplay' && session.view === 'linkedin-invitation' && lead) {
        const url = linkedinProfileUrl(lead.fields.linkedin);
        if (url) {
            rows.push([{ text: 'Copy message', copy_text: { text: LINKEDIN_INVITATION } }]);
            rows.push([{ text: 'Open LinkedIn Profile', url }]);
        }
        add(['Back', 'review']);
        return { text: '🤝 LinkedIn invitation\n\n' + (url ? LINKEDIN_INVITATION : 'A valid LinkedIn profile is required. Add or update it in the lead card.'), rows };
    }
    if(config.profile==='onlyplay'&&['booking-managers','bookinglinks-placeholder'].includes(session.view)){
        PARTNERSHIP_MANAGERS.forEach(manager=>add([manager.name,'bookingmanager:'+manager.id]));
        add(['Back','bookingmenu']);
        return {text:'Partnership Booking Link\n\nChoose a partnership manager.',rows};
    }
    if(config.profile==='onlyplay'&&session.view==='booking-manager'){
        const manager=partnershipManager(session.bookingManagerId);
        if(!manager){add(['Back','bookinglinks']);return {text:'Partnership Booking Link\n\nChoose a manager from the list.',rows};}
        if(manager.bookingUrl)rows.push([{text:'Copy booking link',copy_text:{text:manager.bookingUrl}}]);
        add(['Back','bookinglinks']);
        return {text:manager.name+'\n\n'+manager.email+'\n'+manager.telegram.join('\n')+'\n\nBooking link\n'+(manager.bookingUrl||'Coming soon'),rows};
    }
    if(session.view==='bookinglinks-placeholder'){
        add(['Back','bookingmenu']);
        return {text:'Partnership Booking Link\n\nComing soon. Managers will be able to add their own booking links.',rows};
    }
    if (session.view === 'booking-menu') {
        add(['Hand off to Partnership', 'bookweb']);
        add(['Check Partnership Free Slots', 'aefreeslots']);
        add(['Partnership Booking Link', 'bookinglinks']);
        add(['My meetings', 'mymeetings']);
        add(['Menu', 'welcome']);
        return {text:'Hand off lead',rows};
    }
    if (session.view === 'my-meetings') {
        add(['Today','mymeetingperiod:today']);
        add(['Tomorrow','mymeetingperiod:tomorrow']);
        add(['This week','mymeetingperiod:week']);
        add(['Back','bookingmenu']);
        add(['Menu','welcome']);
        return {text:'My meetings\n\nChoose a period.',rows};
    }
    if (session.view === 'addflow') {
        add([config.profile === 'onlyplay' ? 'Partnership' : 'Adding by Partnership', 'createflow:partnership']);
        add([config.profile === 'onlyplay' ? 'Leadgen' : 'Adding by Leadgen', 'createflow:leadgen']);
        add([config.profile === 'onlyplay' ? 'Promoter' : 'Adding by Promoter', 'createflow:promoter']);
        if(config.profile==='onlyplay')add(['Back','welcome']);
        add(['Menu', 'welcome']);
        return { text: config.profile === 'onlyplay' ? 'Add your role' : 'Add Lead\n\nChoose a lead capture flow. Automatic role detection is not available yet.', rows };
    }
    if (session.view === 'leadgen-channel') {
        ['LinkedIn','Email','Telegram','Event App'].forEach((name,i)=>add([name,'channel:'+i]));
        add(['Back', session.pendingHandoff?'handoffsetupback':'addflow']);
        return { text: (config.profile === 'onlyplay' ? 'Leadgen' : 'Adding by Leadgen') + '\n\nOutreach Channel', rows };
    }
    if (session.view === 'leadgen-account') {
        const title={LinkedIn:'Avatar Name',Email:'Mailbox Name',Telegram:'Telegram Handle','Event App':'Event Name'}[session.pendingChannel];
        add(['Continue without account','createleadgen']);
        add(['Back','createflow:leadgen']);
        return { text: session.pendingChannel+' — '+title+'\n\nAccount selection is not available yet.',rows };
    }
    if (session.view === 'promoter-placeholder') {
        add(['Back','addflow']);
        return {text:(config.profile === 'onlyplay' ? 'Promoter' : 'Adding by Promoter') + '\n\nThis capture flow is not available yet.',rows};
    }
    if (session.view === 'search-menu' || session.view === 'search-input' || session.view === 'search-voice') {
        if(session.view==='search-menu') {
            add(['Voice / Text Single Search','searchtext']);
            add(['Pre-set Bulk Search','searchfilters']);
            if(config.profile !== 'onlyplay')add([config.sharedLeads?'All leads':'My leads','searchresults:0']);
        } else add(['Back','searchmenu']);
        add(['Menu','welcome']);
        return {text:session.view==='search-voice' ? 'Voice / Text Single Search\n\nSend text, a voice message or audio. Describe the lead, when you spoke and what you discussed.' : session.view==='search-input' ? 'Search Lead\n\nSend text, a voice message or audio with a name, company, email, contact or Lead ID.' : 'Search Lead\n\nSearch the leads you can access.',rows};
    }
    if (session.view === 'search-filters') {
        ['Today','Yesterday','This week','All dates'].forEach((name,i)=>add([name,'period:'+['today','yesterday','week','all'][i]]));
        add(['Back','searchmenu']);
        return {text:'Pre-set Bulk Search\n\nChoose a period:',rows};
    }
    if (session.view === 'search-scope') {
        add(['Assigned to me','scope:assigned']);
        add(['Created by me','scope:created']);
        if(config.profile !== 'onlyplay')add(['All leads','scope:all']);
        add(['Back','searchfilters']);
        return {text:'Search Lead\n\nChoose a list.'+(config.profile === 'onlyplay' ? '' : ' '+(config.sharedLeads?'All leads — the shared lead database.':'All leads — leads you created or are assigned to you.')),rows};
    }
    if (session.view === 'delete-confirm' && lead) {
        add([config.profile==='onlyplay'?'Delete':'Delete from bot','confirmdelete:'+lead.id]);
        add(['Cancel','review']);
        return {text:(config.profile==='onlyplay'?'Are you sure you want to delete this lead?\n\n'+label(lead):'Delete lead “'+label(lead)+'” from the bot?')+'\n\nIt will be hidden from search. The Google Sheets copy remains. The record is retained in the database archive.',rows};
    }
    if (config.profile==='onlyplay' && session.view==='delete-confirm-final' && lead) {
        add(['Yes, delete lead','finaldelete:'+lead.id]);
        add(['Cancel','review']);
        return {text:'Confirm deletion one more time\n\n'+label(lead)+'\n\nThe lead will be hidden from the bot. The database archive and Google Sheets copy remain.',rows};
    }
    if (session.view === 'menu-placeholder') {
        const section = MENU_SECTIONS.find(item => item.id === session.menuSection);
        add(['Back to menu', 'welcome']);
        return { text: (section?.title || 'Section') + '\n\nThis section is not available yet.', rows };
    }
    if (session.view === 'welcome' || !lead) {
        MENU_SECTIONS.filter(section=>config.profile!=='onlyplay'||config.role!=='promoter'||['add-lead','materials'].includes(section.id)).forEach(section => add([section.title, section.action || 'menu:' + section.id]));
        if(config.profile==='onlyplay'&&(session.pendingHandoff||lead&&lead.stage<STEPS.length&&!session.cardFromSearch))add(['Continue adding lead','resume']);
        return { text: 'Event Assistant\n\nChoose a section:', rows };
    }
    if (session.editField) {
        const key = session.editField;
        add(['Clear', 'clear'], ['Back', session.editReturnView ? 'editback' : session.editReturnStage != null ? 'detailback' : 'review']);
        return { text: '✏️ ' + fieldTitle(key, config) + '\n' + clip(lead.fields[key] || 'Not specified', 1000) + (!session.editReturnView && MULTI_CONTACT_FIELDS.includes(key) ? '\n\nSend additional contacts, one per line. Existing contacts will be kept. To replace them, tap Clear first.' : '\n\nSend a new value.'), rows };
    }
    if (config.profile === 'onlyplay' && ['edit-info', 'extra-info', 'edit-group'].includes(session.view)) {
        Object.keys(FIELD_COMMANDS).filter(key => key !== 'nextSteps' && !hiddenCaptureField(lead,key,config))
            .forEach(key => add([fieldTitle(key, config), 'edit:' + key]));
        add(['Back to review', 'review']);
        return {text: 'What would you like to edit?', rows};
    }
    if (session.view === 'edit-info') {
        Object.entries(LEAD_EDIT_GROUPS).forEach(([key, group]) => add([group.title, 'editgroup:' + key]));
        add(['Back', 'review']);
        return {text: 'Edit info\n\n' + label(lead), rows};
    }
    if (session.view === 'edit-group' && Object.hasOwn(LEAD_EDIT_GROUPS, session.editGroup)) {
        const group=LEAD_EDIT_GROUPS[session.editGroup];
        group.fields.forEach(key => add([fieldTitle(key, config), 'edit:' + key]));
        add(['Back', 'editinfo']);
        return {text: group.title + '\n\n' + label(lead) + '\nChoose a field to replace its value.', rows};
    }
    if (session.view === 'fields') {
        const keys = Object.keys(FIELD_COMMANDS).filter(key => config.profile !== 'onlyplay' || key !== 'nextSteps'&&!hiddenCaptureField(lead,key,config));
        const start = (session.page || 0) * 7;
        keys.slice(start, start + 7).forEach(key => add([fieldTitle(key, config), 'edit:' + key]));
        if (start > 0) add(['Previous', 'fields:' + (session.page - 1)]);
        if (start + 7 < keys.length) add(['Next', 'fields:' + (session.page + 1)]);
        add(['Back', 'review']);
        return { text: 'What to edit?', rows };
    }
    if (session.view === 'steps') {
        STEPS.forEach((step, i) => {if(hiddenCaptureField(lead,step.key,config))return;add([config.profile === 'onlyplay' && ['context', 'generatedBy'].includes(step.key) ? fieldTitle(step.key, config) : step.title, 'step:' + i]);});
        add(['Back', 'review']);
        return { text: 'What to add?', rows };
    }
    if (session.view === 'more') {
        add(['Full text', 'full'], ['Export JSON', 'export']);
        add(['Add materials', 'steps'], ['My leads', 'list:0']);
        add(['Back', 'review']);
        return { text: label(lead), rows };
    }
    if (session.view === 'extra-info' && lead) {
        add(['Adding Name & Company','step:identity']);
        add(['Adding Meeting Context','step:context']);
        add(['Adding Previous Correspondence','step:history']);
        add(['Adding Details','step:details']);
        add(['Back','review']);
        return {text:'Add Extra Info\n\n'+label(lead),rows};
    }
    if (session.view === 'review' || lead.stage === STEPS.length) {
        if (lead.stage < STEPS.length && !session.cardFromSearch) add(['Next', 'stage']);
        else if (config.profile !== 'onlyplay' && !lead.conflicts.length && !session.cardFromSearch) {
            const contextStep = STEPS.findIndex(s => s.key === 'context');
            const historyStep = STEPS.findIndex(s => s.key === 'history');
            const detailsStep = STEPS.findIndex(s => s.key === 'details');
            if (contextStep !== -1) add(['Add more context', 'step:' + contextStep]);
            if (historyStep !== -1) add(['Add more correspondence', 'step:' + historyStep]);
            if (detailsStep !== -1) add(['Add more lead details', 'step:' + detailsStep]);
            add(['Save to database', 'save']);
        }
        if(config.profile!=='onlyplay'||config.role!=='promoter'&&lead.creationFlow!=='promoter')add([config.profile === 'onlyplay' ? 'Hand off this lead' : 'Hand off lead','leadmeeting']);
        if (config.profile === 'onlyplay' && linkedinProfileUrl(lead.fields.linkedin)) add(['Invite via LinkedIn', 'linkedin']);
        if (config.profile === 'onlyplay') add(['Add/Edit', 'editinfo']);
        else {
            add(['Add Extra Info','extrainfo']);
            add(['Edit info','editinfo']);
        }
        if(config.profile!=='onlyplay'||config.role!=='promoter'&&lead.creationFlow!=='promoter')add(['Enrich via Apollo','apollo']);
        add([config.profile === 'onlyplay' ? 'Delete lead' : 'Delete','delete']);
        if(config.profile !== 'onlyplay' && session.cardFromSearch && lead.status!=='saved' && lead.stage===STEPS.length && !lead.conflicts.length) add(['Save to database','save']);
        if(config.profile !== 'onlyplay')add(['Search Lead','searchmenu']);
        if(config.profile==='onlyplay'&&!session.cardFromSearch&&lead.status!=='saved')add(['Back','back']);
        add(['Menu','welcome']);
        let text = contactCard(lead, config);
        if (config.profile === 'onlyplay' && lead.stage === STEPS.length) {
            const syncStatus = lead.sheetsSync?.status;
            const unprocessed = lead.materials.find(m => !['done', 'omitted', 'deferred'].includes(m.status));
            let status;
            if (lead.conflicts.length) status = 'Resolve differences to finish saving.';
            else if (unprocessed) {
                status = 'Unprocessed materials remaining. Review them to finish saving.';
                const stepIndex = STEPS.findIndex(step => step.key === unprocessed.stage);
                if (stepIndex >= 0) add(['Review materials', 'step:' + stepIndex]);
            } else if (syncStatus === 'failed') {
                status = 'Lead saved locally. Google Sheets save failed.';
                add(['Retry save', 'sync']);
            } else if (syncStatus === 'pending') {
                status = 'Google Sheets confirmation pending. Retry saving.';
                add(['Retry save', 'sync']);
            } else if (lead.status === 'saved') status = syncStatus === 'synced' ? 'Lead saved to database. ✅' : 'Lead saved locally. ✅';
            else {
                status = 'Lead not saved yet. Retry saving.';
                add(['Retry save', 'sync']);
            }
            text += '\n\n' + status;
        }
        return { text, rows, parseMode: 'HTML', ...(config.profile==='onlyplay'?{preserveHeading:true}:{}) };
    }
    const step = STEPS[lead.stage];
    const additions = { identity: 'Add more contact details', context: 'Add more context', history: 'Add more correspondence', details: 'Add more details' };
    if (session.view === 'added' && additions[step.key]) {
        add([additions[step.key], 'addmore']);
        add(['Next', 'next']);
        if(config.profile==='onlyplay')add(['Back','back']);
        const source = lead.materials.find(m => m.messageId === session.addedMessageId && m.stage === step.key && m.status === 'done');
        if (source) return { text: addedText(source, lead, config), rows, replyTo: session.addedMessageId };
        rows.length = 0;
    }
    const options = (step.key === 'icp' ? config.icpOptions : step.key === 'generatedBy' ? config.generatedOptions : []) || [];
    options.forEach((option, i) => add([config.profile==='onlyplay'&&option==='Nobody'?'nobody (my own lead)':option, 'pick:' + i]));
    add(['Next', 'next']);
    if(config.profile==='onlyplay')add(['Back','back']);
    const title = config.profile === 'onlyplay' && ['generatedBy', 'context'].includes(step.key)
        ? (step.key === 'context' ? '💬 ' : '') + fieldTitle(step.key, config) : step.title;
    const prompt = config.profile === 'onlyplay' && step.key === 'generatedBy'
        ? 'Who introduced this lead? Choose an option or enter text.' : step.prompt;
    const lines = [title, '', prompt];
    return {
        text: lines.map((line, index) => index === 0 ? `<b>${escapeHtml(line)}</b>` : escapeHtml(line)).join('\n'),
        rows,
        parseMode: 'HTML',
    };
}

export function renderConflict(lead, session, config = {}) {
    lead=visibleLead(lead,config);
    const conflict = lead.conflicts[0];
    if (!conflict) return null;
    return {
        text: fieldTitle(conflict.key, config) + '\n\nCurrent: ' + clip(lead.fields[conflict.key], 600) +
            '\nFrom new message: ' + clip(conflict.value, 600) + '\n\nWhich one to keep?',
        rows: [[button(session, 'Keep current', 'resolve:keep'), button(session, 'Use new', 'resolve:new')]],
    };
}

export function fullText(lead, config = {}) {
    lead=visibleLead(lead,config);
    return ['Lead ID: ' + lead.id, 'Created: ' + lead.createdAt, 'Author: ' + lead.actor, '',
        handoffText(lead),
        ...Object.entries(FIELDS).filter(([key])=>config.profile!=='onlyplay'||key!=='nextSteps').map(([key]) => fieldTitle(key, config) + ':\n' + (lead.fields[key] || 'Not specified') + '\n'),
        'SOURCE MATERIALS', ...lead.materials.map((m, i) => [
            (i + 1) + '. ' + m.stage + ' / ' + m.kind + ' / ' + m.status,
            m.text || '', m.transcript || '', m.result?.note || '', m.error || '',
        ].filter(Boolean).join('\n'))].join('\n\n');
}

export function renderIssues(lead, session, errorText = '', config = {}) {
    return layoutPanel(normalizeNavigation(renderIssueContent(captureProjection(visibleLead(lead,config),config), session, errorText, config),config,session));
}

function renderIssueContent(lead, session, errorText = '', config = {}) {
    const lines = [];
    const rows = [];
    const add = (text, action) => rows.push([button(session, text, action)]);
    if (errorText) lines.push(clip(errorText, 600));
    if (!lead || ['welcome', 'list'].includes(session.view) || session.editField) {
        return lines.length ? { text: lines.join('\n\n'), rows } : null;
    }
    if (lead.conflicts.length) {
        if (session.view === 'conflicts') {
            const conflict = renderConflict(lead, session, config);
            lines.push(conflict.text);
            rows.push(...conflict.rows);
        } else {
            lines.push('Different values found. Choose which to keep.');
            add('Resolve differences', 'conflicts');
        }
    }
    const failed = lead.materials.find(m => m.stage === STEPS[lead.stage]?.key && m.status === 'failed');
    if (failed) {
        if (failed.error !== errorText) lines.push(clip(failed.error || 'Could not read this material.', 600));
        add('Retry recognition', 'retryfailed');
        add('Continue without extraction', 'defer');
        if (['context', 'nextSteps', 'details', 'history'].includes(failed.stage) && (failed.text || failed.transcript)) {
            add('Keep text', 'raw:' + failed.id.slice(0, 8));
        }
    }
    if (lead.materials.some(m => m.status === 'deferred')) {
        lines.push('Some materials pending extraction.');
        add('Retry deferred', 'retry');
    }
    if (lead.sheetsSync?.status === 'failed') {
        if (!errorText) lines.push('Could not confirm Google Sheets save. Please retry.');
        add(config.profile === 'onlyplay' ? 'Retry save' : 'Retry saving', config.profile === 'onlyplay' ? 'sync' : 'save');
    }
    return lines.length ? { text: lines.join('\n\n'), rows } : null;
}
