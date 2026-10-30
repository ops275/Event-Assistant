export async function verifySlackIdentity(api,config){
 const auth=await api('auth.test',{});if(auth.team_id!==config.teamId||!/^B[A-Z0-9]+$/.test(auth.bot_id||''))throw Error('Slack workspace or bot mismatch');
 const {bot}=await api('bots.info',{bot:auth.bot_id});if(bot?.id!==auth.bot_id||bot.app_id!==config.appId)throw Error('Slack app identity mismatch');
 return {botId:auth.bot_id,appId:bot.app_id};
}
export function interactiveRouter(clients){return async body=>{if(body.type!=='block_actions')return;const client=clients.find(client=>client.appId===body.api_app_id);if(client)await client.delivery.click(body);};}
