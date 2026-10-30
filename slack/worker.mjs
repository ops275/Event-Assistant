import fs from 'node:fs';
import path from 'node:path';
import {SocketModeClient} from '@slack/socket-mode';
import {createSlackDelivery,eligibleHandoffs} from './slack.js';
import {createSlackApi} from './slack-api.js';
import {managerEmailReader} from './managerEmail.js';
import {verifySlackIdentity,interactiveRouter} from './slackRuntime.js';

const configFile=process.env.ONLYPLAY_SLACK_CONFIG||'/root/event-bot/onlyplay-slack-private/config.json';
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
if(config.teamId!=='T0A2LEVCK4Z'||config.appId!=='A0CCNAHET0B'||config.mode!=='production'||config.channelId!=='C0BL3MZN2BU')throw Error('Invalid Onlyplay Slack production configuration');
if(!config.botToken?.startsWith('xoxb-')||!config.appToken?.startsWith('xapp-'))throw Error('Slack credentials required');
if(!Number.isFinite(Date.parse(config.notBefore)))throw Error('Explicit notification cutover required');
const root='/root/event-bot';
for(const key of ['stateFile','journalDirectory','deliveryDirectory','calendarDirectory'])if(!path.resolve(config[key]).startsWith(root+'/'))throw Error('Only Onlyplay paths are allowed');
fs.mkdirSync(config.deliveryDirectory,{recursive:true,mode:0o700});
const lockFile=path.join(config.deliveryDirectory,'worker.lock');
if(fs.existsSync(lockFile)){
 const old=Number(fs.readFileSync(lockFile,'utf8'));if(!Number.isInteger(old)||old<1)throw Error('Invalid worker lock');
 try{process.kill(old,0);throw Error('Onlyplay Slack worker already running');}catch(e){if(e.code!=='ESRCH')throw e;}
 fs.unlinkSync(lockFile);
}
fs.writeFileSync(lockFile,String(process.pid),{flag:'wx',mode:0o600});
process.on('exit',()=>{try{if(fs.readFileSync(lockFile,'utf8')===String(process.pid))fs.unlinkSync(lockFile);}catch{}});
const ledgerFile=path.join(config.deliveryDirectory,'deliveries.json');
const ledger=fs.existsSync(ledgerFile)?JSON.parse(fs.readFileSync(ledgerFile,'utf8')):{};
function save(){
 const temporary=ledgerFile+'.tmp';const fd=fs.openSync(temporary,'w',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(ledger));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,ledgerFile);
}
const api=createSlackApi(config.botToken);
let state={};
const delivery=createSlackDelivery({api,...config,ledger,save,leadFor:id=>state.leads?.[id],personFor:id=>state.users?.[id],receiverEmailFor:managerEmailReader(config.calendarDirectory)});
await verifySlackIdentity(api,config);
await delivery.destination();
// Legacy credentials are retained only to answer buttons in messages our service
// already sent. There is one poller, and it posts new notifications only via the new app.
const legacyFile='/root/event-bot/onlyplay-slack-private/legacy-qooob-team.json';
const legacy=JSON.parse(fs.readFileSync(legacyFile,'utf8'));
if(legacy.appId!=='A0BUSM8H5UJ'||legacy.teamId!==config.teamId)throw Error('Legacy Onlyplay app identity mismatch');
const legacyApi=createSlackApi(legacy.botToken);await verifySlackIdentity(legacyApi,legacy);
const legacyDelivery=createSlackDelivery({api:legacyApi,...legacy,ledger,save,leadFor:id=>state.leads?.[id],personFor:id=>state.users?.[id]});
const routeInteractive=interactiveRouter([{appId:config.appId,delivery},{appId:legacy.appId,delivery:legacyDelivery}]);
// The SDK does not log request bodies or tokens. Keep logs deliberately terse.
const logger={debug(){},info(){},warn(){console.warn('Slack socket warning');},error(){console.error('Slack socket error');},setLevel(){},getLevel(){return 'error';},setName(){}};
const sockets=[new SocketModeClient({appToken:config.appToken,logger}),new SocketModeClient({appToken:legacy.appToken,logger})];
let chain=Promise.resolve();
function serialized(fn){const result=chain.then(fn);chain=result.catch(()=>console.error('Onlyplay Slack operation failed'));return result;}
for(const socket of sockets){socket.on('interactive',async({body,ack})=>{
 await ack();
 if(body.type!=='block_actions')return;
 await serialized(async()=>{state=JSON.parse(fs.readFileSync(config.stateFile,'utf8'));await routeInteractive(body);}).catch(()=>{});
});
socket.on('error',()=>console.error('Onlyplay Slack socket disconnected'));}
let polling=false;
async function poll(){
 if(polling)return;polling=true;
 try{await serialized(async()=>{
  state=JSON.parse(fs.readFileSync(config.stateFile,'utf8'));
  const records=[];
  for(const name of fs.readdirSync(config.journalDirectory).filter(n=>/^ea[a-f0-9]{64}\.json$/.test(n))){
   try{const record=JSON.parse(fs.readFileSync(path.join(config.journalDirectory,name),'utf8'));if(record.id+'.json'!==name)continue;records.push(record);}catch{console.error('Unreadable Onlyplay handoff record');}
  }
  for(const record of eligibleHandoffs(records,config.notBefore))try{await delivery.deliver(record);}catch{console.error('Onlyplay Slack notification pending');}
  const statuses=Object.values(ledger).flatMap(entry=>Object.values(entry.deliveries||{})).reduce((counts,receipt)=>({...counts,[receipt.status]:(counts[receipt.status]||0)+1}),{});
  const healthFile=path.join(config.deliveryDirectory,'health.json'),temporary=healthFile+'.tmp';fs.writeFileSync(temporary,JSON.stringify({ready:true,checkedAt:Date.now(),mode:config.mode,channelId:config.channelId,appId:config.appId,legacyInteractiveAppId:legacy.appId,statuses}),{mode:0o600});fs.renameSync(temporary,healthFile);
 });}catch{console.error('Onlyplay Slack poll failed');}finally{polling=false;}
}
for(const socket of sockets)await socket.start();
console.log('Onlyplay Slack ready: leadgen channel and manager DMs');
await poll();const timer=setInterval(poll,3000);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{clearInterval(timer);await Promise.allSettled(sockets.map(socket=>socket.disconnect()));process.exit(0);});
