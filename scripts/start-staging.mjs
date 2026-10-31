import {stagingEnvironment,verifyStagingIdentity} from './staging-config.mjs';
const component=process.argv[2];
try{
 const env=stagingEnvironment(process.env,component);
 await verifyStagingIdentity(env.TELEGRAM_BOT_TOKEN);
 process.env=env;
 await import(component==='bot'?'../bot/index.js':'../calendar-web/calendar-web.mjs');
}catch(error){
 console.error('Staging startup failed:',error.message?.startsWith('Staging')||error.message?.startsWith('Unsupported')?error.message:'application startup error');
 process.exit(1);
}
