import test from 'node:test';
import assert from 'node:assert/strict';
import {stagingEnvironment, verifyStagingIdentity} from './staging-config.mjs';
import {getConfig} from '../bot/config.js';
import {calendarLeadDescription} from '../bot/services/leadLink.js';

const token='9280625084:'+ 'x'.repeat(35);
test('calendar lead links use staging bot identity',()=>{
 const old=process.env.BOT_NAME;process.env.BOT_NAME='qooob_event_assistant_bot';
 try{assert.match(calendarLeadDescription('Test','lead'),/t\.me\/qooob_event_assistant_bot\?start=/);}
 finally{if(old===undefined)delete process.env.BOT_NAME;else process.env.BOT_NAME=old;}
});
test('staging rejects production token and unsupported workers',()=>{
 assert.throws(()=>stagingEnvironment({TELEGRAM_BOT_TOKEN:'8344814605:secret'},'bot'),/identity/);
 assert.throws(()=>stagingEnvironment({TELEGRAM_BOT_TOKEN:token},'slack'),/component/);
});
test('staging discards inherited production configuration and fixes every persistent path',()=>{
 const env=stagingEnvironment({TELEGRAM_BOT_TOKEN:token,DATA_DIR:'/var/lib/onlyplay',OPENAI_API_KEY:'secret',APOLLO_API_KEY:'secret',GOOGLE_APPLICATION_CREDENTIALS:'/prod',ENV_FILE:'/etc/onlyplay/bot.env',ONBOARDING_JOBS_DIR:'/prod',SLACK_BOT_TOKEN:'secret'},'bot');
 assert.equal(env.DATA_DIR,'/var/lib/qooob-staging');
 for(const key of ['OPENAI_API_KEY','APOLLO_API_KEY','GOOGLE_APPLICATION_CREDENTIALS','SLACK_BOT_TOKEN'])assert.equal(env[key],undefined);
 assert.equal(env.ENV_FILE,'/etc/qooob-staging/no-dotenv');
 assert.equal(env.ONBOARDING_JOBS_DIR,'/var/lib/qooob-staging/onboarding');
 assert.equal(getConfig(env).botName,'qooob_event_assistant_bot');
});
test('getMe identity is verified before application imports',async()=>{
 await assert.rejects(()=>verifyStagingIdentity(token,async()=>({ok:true,json:async()=>({ok:true,result:{id:8344814605,username:'Leadgen_Ass1stant_bot'}})})),/identity/);
 await verifyStagingIdentity(token,async()=>({ok:true,json:async()=>({ok:true,result:{id:9280625084,username:'qooob_event_assistant_bot'}})}));
});
