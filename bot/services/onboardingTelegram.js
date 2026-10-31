import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
export async function connectOnboarding({directory,runtime,botId}){
 let phase='LOAD_RUNTIME';
 try{
 const require=createRequire(runtime),{TelegramClient,Api}=require('teleproto'),{StringSession}=require('teleproto/sessions'),{Logger}=require('teleproto/extensions/Logger'),bigInt=require('big-integer');
 const credentials=JSON.parse(fs.readFileSync(path.join(directory,'credentials.json'),'utf8')),saved=JSON.parse(fs.readFileSync(path.join(directory,'test-group.json'),'utf8'));
 if(!saved.accountId)throw new Error('Expected account not configured');
 const client=new TelegramClient(new StringSession(fs.readFileSync(path.join(directory,'session.txt'),'utf8').trim()),credentials.apiId,credentials.apiHash,{connectionRetries:2,requestRetries:1,retryDelay:1000,floodSleepThreshold:0,deviceModel:'qooob Onboarding',systemVersion:'Linux',appVersion:'1.0',baseLogger:new Logger('none'),receiveUpdates:false});
 try{
  phase='CONNECT';await client.connect();phase='CHECK_AUTH';if(!await client.checkAuthorization())throw new Error('Session not authorized');phase='GET_ACCOUNT';const me=await client.getMe();if(me.bot||String(me.id)!==String(saved.accountId))throw new Error('Account mismatch');phase='VERIFY_BOT';
  const bot=await client.getEntity('Leadgen_Ass1stant_bot');if(!bot.bot||String(bot.id)!==String(botId)||bot.username?.toLowerCase()!=='leadgen_ass1stant_bot')throw new Error('Bot identity mismatch');
  const channel=g=>new Api.InputChannel({channelId:bigInt(g.id),accessHash:bigInt(g.accessHash)}),peer=g=>new Api.InputPeerChannel({channelId:bigInt(g.id),accessHash:bigInt(g.accessHash)});
  async function invite(group,user){const input=await client.getInputEntity(user);try{const result=await client.invoke(new Api.channels.InviteToChannel({channel:channel(group),users:[input]}));if(result.missingInvitees?.length)throw new Error('Invite privacy');}catch(error){if(error.errorMessage!=='USER_ALREADY_PARTICIPANT')throw error;}
   const participant=await client.invoke(new Api.channels.GetParticipant({channel:channel(group),participant:input}));if(!['ChannelParticipant','ChannelParticipantAdmin','ChannelParticipantCreator','ChannelParticipantSelf'].includes(participant.participant?.className))throw new Error('Membership not confirmed');
  }
  return {accountId:String(me.id),disconnect:()=>client.disconnect(),
   create:async title=>{const result=await client.invoke(new Api.channels.CreateChannel({title,about:'qooob · Onboarding',megagroup:true}));const group=result.chats.find(c=>c.megagroup);if(!group?.accessHash)throw new Error('Create not confirmed');return {id:String(group.id),accessHash:String(group.accessHash)};},
   bot:group=>invite(group,bot),invite:async(group,handle)=>{const user=await client.getEntity(handle);if(user.bot||user.deleted)throw new Error('User required');return invite(group,user);},
   link:group=>client.invoke(new Api.messages.ExportChatInvite({peer:peer(group),title:'qooob onboarding'})),
   intro:(group,message,randomId)=>client.invoke(new Api.messages.SendMessage({peer:peer(group),message,randomId:bigInt(randomId),noWebpage:true}))
  };
 }catch(error){await client.disconnect().catch(()=>{});throw error;}
 }catch(error){if(!error.code)error.code='ONBOARDING_'+phase;throw error;}
}
