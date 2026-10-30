import { randomUUID } from 'node:crypto';
import { DETAIL_FIELDS, FIELDS, MAX_FILE_BYTES, NOTE_FIELDS, STEPS } from './config.js';

export class UserError extends Error {}

export const MULTI_CONTACT_FIELDS = ['phone', 'email', 'website', 'linkedin', 'telegram', 'address', 'otherContacts'];

export function mergeContactValues(key, ...values) {
    const entries = values.flatMap(value => String(value || '').split(
        key === 'otherContacts' ? /\n\s*\n/ : ['phone', 'email', 'telegram'].includes(key) ? /\n|;|,|\s+\/\s+/ : /\n/
    )).map(value => value.trim()).filter(Boolean);
    const seen = new Set();
    return entries.filter(value => {
        const id = comparable(key, value);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    }).join(key === 'otherContacts' ? '\n\n' : '\n');
}

export function createLead(owner, actor, event = '', submitter = {}) {
    return {
        id: randomUUID(), owner, actor,
        actorId: submitter.id ? String(submitter.id) : '',
        actorUsername: submitter.username ? '@' + submitter.username : '',
        actorName: [submitter.firstName, submitter.lastName].filter(Boolean).join(' '),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        flowVersion: 5, stage: 0, identityLocked: false, status: 'draft', fields: { event },
        materials: [], conflicts: [], edits: [], completedSteps: [],
    };
}

export function touch(lead) {
    lead.updatedAt = new Date().toISOString();
    lead.status = 'draft';
}

export function addMaterial(lead, input) {
    const step = STEPS[lead.stage];
    if (!step) throw new UserError('Select a stage or field to edit.');
    if (lead.materials.some(m => m.messageId === input.messageId)) return false;
    if (input.size > MAX_FILE_BYTES) throw new UserError('File exceeds 20 MB. Please send a smaller file.');
    if (!['text', 'photo', 'audio'].includes(input.kind)) throw new UserError('This file type is not supported.');
    lead.materials.push({ ...input, id: randomUUID(), stage: step.key, status: 'pending', createdAt: new Date().toISOString() });
    touch(lead);
    return true;
}

const aliases = new Map(Object.entries({
    'full name': 'fullName', 'имя': 'fullName', 'фио': 'fullName', 'имя фамилия': 'fullName',
    'company': 'company', 'компания': 'company', 'job title': 'jobTitle', 'должность': 'jobTitle',
    'email': 'email', 'почта': 'email', 'website': 'website', 'сайт': 'website',
    'linkedin': 'linkedin', 'telegram': 'telegram', 'телеграм': 'telegram',
    'whatsapp': 'phone', 'телефон': 'phone', 'phone': 'phone', 'telephone / whatsapp': 'phone',
    'address': 'address', 'адрес': 'address', 'channel': 'channel', 'канал': 'channel',
    'other contacts': 'otherContacts', 'прочее': 'otherContacts',
}));

export function parseManual(text, identity = false) {
    const fields = {};
    for (const line of text.split('\n')) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const key = aliases.get(line.slice(0, colon).trim().toLowerCase());
        const value = line.slice(colon + 1).trim();
        if (key && value) fields[key] = MULTI_CONTACT_FIELDS.includes(key) ? mergeContactValues(key, fields[key], value) : value;
    }
    if (identity && !Object.keys(fields).length) {
        let parts = text.split('|');
        if (parts.length !== 2) parts = text.split(/\s+\/\s+/);
        if (parts.length !== 2) parts = text.split(/\s+-\s+/);
        if (parts.length !== 2) parts = text.split(/\s+from\s+/i);
        if (parts.length !== 2 && text.includes('\n')) parts = text.split('\n').map(s => s.trim()).filter(Boolean);
        if (parts.length === 2) {
            const [fullName, company] = parts.map(s => s.trim());
            if (fullName) fields.fullName = fullName;
            if (company) fields.company = company;
        }
    }
    // Recognize standalone contacts without depending on the extraction service.
    const value = text.trim();
    const phone = value.replace(/^(?:whatsapp|phone|telephone|телефон)\s*[:\-]?\s*/i, '');
    if (/^\+?[\d\s().-]+$/.test(phone) && /^\d{7,15}$/.test(phone.replace(/\D/g, ''))) fields.phone ||= phone;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fields.email ||= value;
    if (/^@[a-z0-9_]{5,32}$/i.test(value) || /^(?:https?:\/\/)?t\.me\/[a-z0-9_]{5,32}\/?$/i.test(value)) fields.telegram ||= value;
    if (/^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(value) && !fields.telegram) {
        Object.assign(fields, detectLinks(value, fields));
    }
    return fields;
}

export function missingIdentity(lead) {
    return ['fullName', 'company'].filter(key => !lead.fields[key]?.trim());
}

function identityReply(text, lead) {
    const value = text.trim();
    if (!value || value.length > 100 || /[\n:@/?!=]/.test(value) || /\d{5}/.test(value) ||
        /^(?:whatsapp|telegram|phone|email|skip|next|не знаю|пропустить|unknown)$/i.test(value)) return {};
    if (Object.keys(parseManual(value)).length) return {};
    // If fullName is already set, any short reply is the company (e.g. "qooob", "qooob company")
    if (lead.fields.fullName && !lead.fields.company && value.split(/\s+/).length <= 8) {
        return { company: value.replace(/\s+(?:company|llc|inc|ltd|corp|ooo|ооо|ком|компания)$/i, '').trim() || value };
    }
    // If company is set, short reply is fullName
    if (!lead.fields.fullName && lead.fields.company && value.split(/\s+/).length <= 5) {
        return { fullName: value };
    }
    // If neither is set: 2+ words is fullName, 1 word is company
    const words = value.split(/\s+/);
    if (!lead.fields.fullName && words.length >= 2 && words.length <= 4) {
        return { fullName: value };
    }
    if (!lead.fields.company && (words.length === 1 || /(?:company|llc|inc|ltd|corp|gmbh|studio|gaming|games|group|ооо|зао|компания)/i.test(value))) {
        return { company: value.replace(/\s+(?:company|llc|inc|ltd|corp|ooo|ооо|ком|компания)$/i, '').trim() || value };
    }
    return {};
}

function detectLinks(text, fields = {}) {
    const detected = { ...fields };
    for (const match of text.matchAll(/(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,}(?:\/[^\s,;]*)?/gi)) {
        if (text[match.index - 1] === '@') continue;
        const value = match[0].replace(/[.)]+$/, '');
        const key = /^(?:https?:\/\/)?(?:www\.)?linkedin\.com\//i.test(value) ? 'linkedin'
            : /^(?:https?:\/\/)?t\.me\//i.test(value) ? 'telegram' : 'website';
        detected[key] = mergeContactValues(key, detected[key], value);
    }
    return detected;
}

function normalized(value) { return value.trim().toLocaleLowerCase().replace(/\s+/g, ' '); }

function comparable(key, value) {
    const text = normalized(value || '');
    if (['website', 'linkedin'].includes(key)) {
        try {
            const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
            return url.hostname.toLowerCase().replace(/^www\./, '') + (url.pathname === '/' ? '' : url.pathname) + url.search + url.hash;
        } catch { return value.trim(); }
    }
    if (key === 'telegram') return text.replace(/^(?:https?:\/\/)?t\.me\//, '@').replace(/\/$/, '');
    // Ignore presentation punctuation only for a single valid phone number.
    // Keep extensions, multiple numbers and international prefixes distinct.
    if (key === 'phone' && /^\+?[\d\s().-]+$/.test(text)) {
        const compact = text.replace(/[\s().-]/g, '');
        if (/^\+?\d{7,15}$/.test(compact)) return compact;
    }
    return text;
}

export function reconcileConflicts(lead) {
    lead.conflicts = lead.conflicts.filter(c => {
        if (MULTI_CONTACT_FIELDS.includes(c.key)) {
            lead.fields[c.key] = mergeContactValues(c.key, lead.fields[c.key], c.value);
            return false;
        }
        return comparable(c.key, lead.fields[c.key]) !== comparable(c.key, c.value);
    });
}

export function cleanExtractionNote(text) {
    // Remove only complete placeholder lines generated from an empty CRM card or prompt template leakage.
    // Preserve ordinary prose and verbatim correspondence elsewhere.
    return String(text || '').split('\n').filter(line =>
        !/^\s*(?:(?:context|meeting_context|previous_correspondence|next_steps)\s*[:=]\s*(?:empty|meeting,\s*needs,\s*objections.*)\s*[.;]?\s*)+$/i.test(line) &&
        !/^\s*empty[.]?\s*$/i.test(line) &&
        !/^\s*context\s*=\s*meeting,\s*needs,\s*objections/i.test(line)
    ).join('\n').trim();
}

export function mergeFields(lead, fields, source) {
    reconcileConflicts(lead);
    const allowed = [...DETAIL_FIELDS, ...(source.stage === 'identity' ? ['fullName', 'company'] : [])];
    for (const key of allowed) {
        const value = typeof fields[key] === 'string' ? fields[key].trim() : '';
        if (!value) continue;
        const current = lead.fields[key];
        if (MULTI_CONTACT_FIELDS.includes(key)) lead.fields[key] = mergeContactValues(key, current, value);
        else if (!current) lead.fields[key] = value;
        else if (key === 'otherContacts' && current.split(/\n\s*\n/).some(part => normalized(part) === normalized(value))) continue;
        else if (comparable(key, current) !== comparable(key, value) && !lead.conflicts.some(c => c.key === key && c.value === value && c.sourceId === source.id)) {
            lead.conflicts.push({ id: randomUUID(), key, current, value, sourceId: source.id });
        }
    }
}

function append(lead, key, text) {
    if (!text?.trim()) return;
    lead.fields[key] = [lead.fields[key], text.trim()].filter(Boolean).join('\n\n');
}

function abortable(work, signal) {
    if (!signal) return work;
    return new Promise((resolve, reject) => {
        const abort = () => reject(new UserError('Processing paused. Materials saved. You can retry or proceed without extraction.'));
        Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        if (signal.aborted) { abort(); return; }
        signal.addEventListener('abort', abort, { once: true });
    });
}

export async function processStep(lead, services, persist = () => {}, signal, options = {}) {
    const key = options.stageKey || STEPS[lead.stage]?.key;
    if (!key) return;
    for (const source of lead.materials.filter(m => m.stage === key && (!options.sourceId || m.id === options.sourceId) && !['done', 'omitted'].includes(m.status))) {
        try {
            if (signal?.aborted) throw new UserError('Processing paused. Materials saved.');
            const text = source.text || '';
            let result;
            if (source.kind !== 'text' && !services.aiConfigured()) {
                source.status = 'deferred';
                source.error = 'Recognition is not connected yet. Material saved for later processing.';
                persist();
                continue;
            }
            if (source.kind === 'text' && ['icp', 'generatedBy'].includes(key)) {
                lead.fields[key] = text.trim();
                result = { fields: {}, note: '' };
            } else if (source.kind === 'text' && NOTE_FIELDS.includes(key)) {
                result = { fields: {}, note: text.trim(), nextSteps: '' };
                append(lead, key, result.note);
            } else {
                const manual = source.kind === 'text' ? parseManual(text, key === 'identity') : {};
                if (source.kind === 'text' && key === 'identity' && !Object.keys(manual).length) Object.assign(manual, identityReply(text, lead));
                if (source.kind === 'text' && key === 'identity' && Object.keys(manual).length) {
                    result = { fields: manual, note: text };
                } else if (source.kind === 'text' && !services.aiConfigured()) {
                    result = { fields: manual, note: key === 'details' && Object.keys(manual).length ? '' : text };
                } else {
                    result = await abortable(services.analyze(source, lead, { signal }), signal);
                    if (!result?.fields) throw new UserError('Recognition returned no data. Tap Next to retry.');
                    // Explicitly labelled text is authoritative over inferred fields.
                    result.fields = { ...result.fields, ...manual };
                }
                if (key === 'details' && text) result.fields = detectLinks(text, result.fields);
                if (!result || typeof result.fields !== 'object' || result.fields === null) throw new UserError('Recognition returned no data. Tap Next to retry.');
                if (result.mismatch) {
                    throw new UserError('The business card or badge belongs to a different contact. Check the material.');
                }
                if (key === 'identity' && !Object.values(result.fields).some(value => typeof value === 'string' && value.trim())) {
                    if (source.kind !== 'text') throw new UserError('Could not read contact details. Material saved. Send Full name and Company as text or retry.');
                    // Keep incomplete notes (e.g. "WhatsApp") without blocking later input.
                    result.note ||= text;
                }
                if (source.kind === 'audio' && source.targetField && Object.hasOwn(FIELDS, source.targetField)) {
                    if (NOTE_FIELDS.includes(source.targetField)) append(lead, source.targetField, result.transcript);
                    else mergeFields(lead, { [source.targetField]: result.transcript }, source);
                } else {
                    mergeFields(lead, result.fields, source);
                    if (NOTE_FIELDS.includes(key)) append(lead, key, result.note || result.transcript || text);
                }
                if (key === 'context') append(lead, 'nextSteps', result.nextSteps);
                if (key === 'identity' || key === 'details') {
                    const note = cleanExtractionNote(result.note);
                    if (note && !(lead.fields.otherContacts || '').split(/\n\s*\n/).some(part => normalized(part) === normalized(note))) append(lead, 'otherContacts', note);
                }
                if (['icp', 'generatedBy'].includes(key)) {
                    if (result.note) lead.fields[key] = result.note;
                }
            }
            source.result = result;
            source.status = 'done';
            delete source.error;
            touch(lead);
            persist();
        } catch (error) {
            source.status = 'failed';
            source.error = error instanceof UserError ? error.message : 'Recognition service is unavailable. Tap Next to retry.';
            persist();
            throw new UserError(source.error);
        }
    }
}

export function advance(lead) {
    const key = STEPS[lead.stage]?.key;
    if (!key) return;
    for (const m of lead.materials) {
        if (m.stage === key && !['done', 'omitted'].includes(m.status)) {
            m.status = 'deferred';
        }
    }
    if (key === 'identity') lead.identityLocked = true;
    if (!lead.completedSteps.includes(key)) lead.completedSteps.push(key);
    lead.stage++;
    touch(lead);
}

export function editField(lead, key, value, { replace = false } = {}) {
    if (!Object.hasOwn(FIELDS, key)) throw new UserError('Unknown field.');
    if (!replace && MULTI_CONTACT_FIELDS.includes(key) && value.trim()) {
        reconcileConflicts(lead);
        value = mergeContactValues(key, lead.fields[key], value);
    }
    lead.edits.push({ key, before: lead.fields[key] || '', value, at: new Date().toISOString() });
    lead.fields[key] = value.trim();
    lead.conflicts = lead.conflicts.filter(c => c.key !== key);
    touch(lead);
}

export function resolveConflict(lead, id, useNew) {
    const conflict = lead.conflicts.find(c => c.id === id);
    if (!conflict) return;
    if (useNew) {
        lead.edits.push({ key: conflict.key, before: lead.fields[conflict.key], value: conflict.value, at: new Date().toISOString() });
        lead.fields[conflict.key] = conflict.value;
    }
    lead.conflicts = lead.conflicts.filter(c => c.id !== id);
    touch(lead);
}

export function assertReady(lead) {
    reconcileConflicts(lead);
    if (lead.stage !== STEPS.length) throw new UserError('Complete the stages first by tapping Next.');
    if (lead.conflicts.length) throw new UserError('Resolve field differences first.');
    if (lead.materials.some(m => !['done', 'omitted', 'deferred'].includes(m.status))) throw new UserError('Unprocessed materials remaining.');
}

export function keepSourceText(lead, source) {
    if (!source || source.status !== 'failed' || !['context', 'nextSteps', 'details', 'history'].includes(source.stage)) {
        throw new UserError('This material requires recognition or manual input.');
    }
    const text = [source.text, source.transcript].filter(Boolean).join('\n');
    if (!text.trim()) throw new UserError('The material has no text yet.');
    append(lead, source.stage === 'details' ? 'otherContacts' : source.stage, text);
    source.status = 'done';
    source.result = { fields: {}, note: text, manualFallback: true };
    delete source.error;
    touch(lead);
}
