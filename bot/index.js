import { BOT_COMMANDS } from './menuMockup.js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { createBot } from './bot.js';
import { getConfig, STEPS } from './config.js';
import { migrateFlowV5 } from './services/flowMigration.js';
import { FileStore } from './services/store.js';

const envPath = process.env.ENV_FILE || process.env.DOTENV_CONFIG_PATH || '.env';
dotenv.config({ path: envPath, override: true, quiet: true });
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error(`Missing TELEGRAM_BOT_TOKEN in ${envPath}`);
    process.exit(1);
}
const directory = process.env.DATA_DIR || (process.env.BOT_PROFILE ? `data/${process.env.BOT_PROFILE}` : 'data');
fs.mkdirSync(directory, { recursive: true });
const lockFile = path.join(directory, 'bot.lock');
if (fs.existsSync(lockFile)) {
    const previousPid = Number(fs.readFileSync(lockFile, 'utf8'));
    if (!Number.isInteger(previousPid) || previousPid < 1) throw new Error('Invalid bot.lock');
    let running = true;
    try { process.kill(previousPid, 0); } catch (error) {
        if (error.code === 'ESRCH') running = false;
        else throw error;
    }
    if (running) throw new Error('Another bot instance is already running');
    fs.unlinkSync(lockFile);
}
fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
process.on('exit', () => {
    try {
        if (fs.readFileSync(lockFile, 'utf8') === String(process.pid)) fs.unlinkSync(lockFile);
    } catch { /* A stale lock is checked against the live process on the next launch. */ }
});

const store = new FileStore(directory, process.env.BOT_PROFILE === 'onlyplay'
    ? { onboardingJobsDirectory: process.env.ONBOARDING_JOBS_DIR || path.join(directory, 'onboarding') }
    : {});
// Only the bot persists projected state. Web/worker processes write durable records.

let migrated = false;
const oldSteps = ['icp', 'generatedBy', 'identity', 'context', 'nextSteps', 'details', 'history'];
const newStage = { icp: 0, generatedBy: 1, identity: 2, context: 3, nextSteps: 4, history: 4, details: 5 };
for (const lead of Object.values(store.state.leads)) {
    if ((lead.flowVersion || 0) >= 3) continue;
    lead.stage = lead.stage >= oldSteps.length ? 6 : (newStage[oldSteps[lead.stage]] ?? 0);
    lead.flowVersion = 3;
    migrated = true;
}
for (const lead of Object.values(store.state.leads)) {
    if ((lead.flowVersion || 0) >= 4) continue;
    if (lead.stage >= 6) lead.stage = 7;
    else if (lead.stage === 5) lead.stage = 6;
    lead.flowVersion = 4;
    migrated = true;
}
if (migrateFlowV5(store.state)) migrated = true;
for (const session of Object.values(store.state.sessions)) {
    session.checkpointStage = null;
    session.fieldIndex = 0;
    session.editReturnStage = null;
    const active = store.state.leads[session.activeId];
    if (active && active.stage < STEPS.length && session.view === 'review') session.view = 'stage';
}
if (migrated) store.save();
const bot = createBot({ token: process.env.TELEGRAM_BOT_TOKEN, store, config: getConfig() });
if(process.env.BOT_PROFILE==='onlyplay')setInterval(()=>{try{store.save();bot.syncHandoffs().catch(error=>console.error('Handoff Sheets recovery failed:',error.name));}catch(error){console.error('Handoff projection failed:',error.name);}},30000).unref();

try {
    await bot.telegram.setMyCommands(BOT_COMMANDS);
    await bot.telegram.setChatMenuButton({ menuButton: { type: 'commands' } });
} catch (error) {
    console.error('Menu setup failed:', error.code || error.name);
}

await bot.recover();
bot.launch(() => {
    console.log('Event Assistant v2 connected as @' + bot.botInfo.username);
    console.log('OpenAI: ' + (process.env.OPENAI_API_KEY ? 'configured' : 'not configured; manual text available'));
    console.log('Storage: local drafts enabled');
}).catch(error => {
    console.error('Bot stopped:', error.code || error.name);
    process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
        bot.stopProcessing();
        try { bot.stop(signal); } catch { /* Startup can still be in progress. */ }
        await bot.waitForIdle();
        store.save();
    });
}
