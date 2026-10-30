import fs from 'node:fs';import path from 'node:path';import {setTimeout as delay} from 'node:timers/promises';import dotenv from 'dotenv';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {OnboardingJobs,runOnboarding,canOnboard} from './services/onboardingService.js';import {connectOnboarding} from './services/onboardingTelegram.js';import {AdminSettings,atomicJson} from './services/adminService.js';
dotenv.config({path:process.env.CALENDAR_BOT_ENV||'/root/event-bot/.env.onlyplay',quiet:true});if(process.env.BOT_PROFILE!=='onlyplay')throw new Error('Onlyplay required');
const directory=process.env.ONBOARDING_PRIVATE_DIR||'/root/event-bot/onboarding-private',store=new OnboardingJobs(process.env.ONBOARDING_JOBS_DIR||'/root/event-bot/data/onlyplay/onboarding'),admin=new AdminSettings(process.env.ADMIN_SETTINGS_FILE, ['6267917103']),lock=path.join(directory,'worker.lock'),health=path.join(store.directory,'health.json');
// Linux flock retains ownership in the worker process and releases it even after a crash.
if(!process.argv.includes('--os-locked')){const child=spawnSync('flock',['-n','-F',lock,process.execPath,fileURLToPath(import.meta.url),'--os-locked',...process.argv.slice(2)],{stdio:'inherit',env:process.env});if(child.error)throw child.error;process.exit(child.status??1);}
let stopped=false,api,phase='verify-bot';const stop=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopped=true;stop.abort();});
try{
 const response=await fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/getMe',{signal:AbortSignal.timeout(15000)}),bot=await response.json();if(!bot.ok||bot.result.username!=='only_leadcapture_bot')throw new Error('Onlyplay bot not verified');
 phase='connect-account';api=await connectOnboarding({directory,runtime:process.env.ONBOARDING_RUNTIME||'/root/event-bot/onboarding-runtime/package.json',botId:bot.result.id});const expected=JSON.parse(fs.readFileSync(path.join(directory,'test-group.json'),'utf8')).accountId;
 if(process.argv.includes('--check')){console.log('Onlyplay onboarding account authorized and identity verified; no groups created.');}
 else{console.log('Onlyplay onboarding worker ready');do{
  const state=JSON.parse(fs.readFileSync(process.env.CALENDAR_LEADS_FILE||'/root/event-bot/data/onlyplay/state.json','utf8'));
  for(const job of store.all().filter(j=>['queued','creating','working'].includes(j.status))){if(stopped)break;const lead=state.leads[job.leadId];if(!canOnboard(lead,job.actor,admin.read())){job.status='cancelled';job.error='The lead was deleted or the initiator permissions changed.';store.save(job);continue;}await runOnboarding(store,job.id,api,expected);}
  atomicJson(health,{ready:true,checkedAt:Date.now(),accountVerified:true});if(!stopped)await delay(3000,undefined,{signal:stop.signal}).catch(()=>{});
 }while(!stopped);}
}catch(error){atomicJson(health,{ready:false,checkedAt:Date.now(),error:'account_or_worker_unavailable'});console.error('Onboarding worker unavailable:',phase,error.errorMessage&&/^[A-Z_]+$/.test(error.errorMessage)?error.errorMessage:error.code&&/^[A-Z_]+$/.test(error.code)?error.code:'connection_or_configuration');process.exitCode=1;}
finally{await api?.disconnect().catch(()=>{});}
