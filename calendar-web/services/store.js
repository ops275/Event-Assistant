import fs from 'node:fs';
import path from 'node:path';

export class FileStore {
    constructor(directory = 'data') {
        fs.mkdirSync(directory, { recursive: true });
        this.file = path.join(directory, 'state.json');
        this.state = fs.existsSync(this.file)
            ? JSON.parse(fs.readFileSync(this.file, 'utf8'))
            : { version: 2, sessions: {}, leads: {} };
        if (this.state.version !== 2 || !this.state.sessions || !this.state.leads) {
            throw new Error('Unsupported or damaged lead database');
        }
        this.state.inbox ||= {};
        this.state.receipts ||= [];
        this.state.authorizedUsers ||= [];
    }

    save() {
        // Keep the previous complete file until the new snapshot is flushed.
        const temp = `${this.file}.tmp`;
        const fd = fs.openSync(temp, 'w');
        try {
            fs.writeFileSync(fd, JSON.stringify(this.state, null, 2), 'utf8');
            fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        fs.renameSync(temp, this.file);
    }

    session(owner) {
        return this.state.sessions[owner] ||= { activeId: null };
    }

    lead(owner, id = this.session(owner).activeId) {
        const lead = this.state.leads[id];
        const assigned=String(owner).split(':').length===2&&String(owner).split(':')[0]===String(owner).split(':')[1]&&String(lead?.assigneeId||'')===String(owner).split(':')[1];
        return lead && (this.sharedLeads||lead.owner === owner||assigned) && !lead.deletedAt ? lead : null;
    }

    canEdit(owner,lead){return Boolean(lead&&!lead.deletedAt&&(lead.owner===owner||String(lead.assigneeId||'')===String(owner).split(':').at(-1)));}

    list(owner) {
        return Object.values(this.state.leads).filter(lead => Boolean(this.lead(owner,lead.id)))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    duplicates(lead) {
        const normal = value => String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
        if (!lead.fields.fullName || !lead.fields.company) return [];
        return this.list(lead.owner).filter(other => other.id !== lead.id &&
            normal(other.fields.fullName) === normal(lead.fields.fullName) && normal(other.fields.company) === normal(lead.fields.company));
    }

    isAuthorized(userId) {
        return Boolean(this.state.authorizedUsers?.includes(String(userId)));
    }

    authorize(userId) {
        const id = String(userId);
        this.state.authorizedUsers ||= [];
        if (!this.state.authorizedUsers.includes(id)) {
            this.state.authorizedUsers.push(id);
            this.save();
        }
    }
}

export function serialQueue() {
    const pending = new Map();
    return async (key, task) => {
        const previous = pending.get(key) || Promise.resolve();
        const current = previous.catch(() => {}).then(task);
        pending.set(key, current);
        try { return await current; }
        finally { if (pending.get(key) === current) pending.delete(key); }
    };
}
