import {followupPhotoPath} from '../../bot/services/followupTemplates.js';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {onboardingAvatarFile} from './onboardingService.js';
import {videoAsset} from './videoAssets.js';
import {promoteOnboardingManager} from './onboardingOwnership.js';
export async function connectOnboarding({directory,runtime,botId}){
 let phase='LOAD_RUNTIME';
 try{
 const require=createRequire(runtime),{TelegramClient,Api}=require('teleproto'),{StringSession}=require('teleproto/sessions'),{Logger}=require('teleproto/extensions/Logger'),{CustomFile}=require('teleproto/client/uploads'),bigInt=require('big-integer');
 const credentials=JSON.parse(fs.readFileSync(path.join(directory,'credentials.json'),'utf8')),saved=JSON.parse(fs.readFileSync(path.join(directory,'test-group.json'),'utf8'));
 if(!saved.accountId)throw new Error('Expected account not configured');
 const client=new TelegramClient(new StringSession(fs.readFileSync(path.join(directory,'session.txt'),'utf8').trim()),credentials.apiId,credentials.apiHash,{connectionRetries:2,requestRetries:1,retryDelay:1000,floodSleepThreshold:0,deviceModel:'qooob Onboarding',systemVersion:'Linux',appVersion:'1.0',baseLogger:new Logger('none'),receiveUpdates:false});
 try{
  phase='CONNECT';await client.connect();phase='CHECK_AUTH';if(!await client.checkAuthorization())throw new Error('Session not authorized');phase='GET_ACCOUNT';const me=await client.getMe();if(me.bot||String(me.id)!==String(saved.accountId))throw new Error('Account mismatch');phase='VERIFY_BOT';
  const bot=await client.getEntity('Leadgen_Ass1stant_bot');if(!bot.bot||String(bot.id)!==String(botId)||bot.username?.toLowerCase()!=='leadgen_ass1stant_bot')throw new Error('Bot identity mismatch');
  const channel=g=>new Api.InputChannel({channelId:bigInt(g.id),accessHash:bigInt(g.accessHash)}),peer=g=>new Api.InputPeerChannel({channelId:bigInt(g.id),accessHash:bigInt(g.accessHash)});
  async function invite(group,user){const input=await client.getInputEntity(user);try{const result=await client.invoke(new Api.channels.InviteToChannel({channel:channel(group),users:[input]}));if(result.missingInvitees?.length)throw new Error('Invite privacy');}catch(error){if(error.errorMessage!=='USER_ALREADY_PARTICIPANT')throw error;}
   const participant=await client.invoke(new Api.channels.GetParticipant({channel:channel(group),participant:input}));if(!['ChannelParticipant','ChannelParticipantAdmin','ChannelParticipantCreator','ChannelParticipantSelf'].includes(participant.participant?.className))throw new Error('Membership not confirmed');
   return {id:String(user.id),name:[user.firstName,user.lastName].filter(Boolean).join(' ').slice(0,128)};
  }
  return {accountId:String(me.id),disconnect:()=>client.disconnect(),
   create:async title=>{const result=await client.invoke(new Api.channels.CreateChannel({title,about:'',megagroup:true}));const group=result.chats.find(c=>c.megagroup);if(!group?.accessHash)throw new Error('Create not confirmed');return {id:String(group.id),accessHash:String(group.accessHash),title:String(group.title||title),...(Number.isFinite(Number(group.date))&&Number(group.date)>0?{createdAt:new Date(Number(group.date)*1000).toISOString()}: {})};},
   bot:group=>invite(group,bot),invite:async(group,handle)=>{const user=await client.getEntity(handle);if(user.bot||user.deleted)throw new Error('User required');return invite(group,user);},
   avatar:async(group,type)=>{const file=fileURLToPath(onboardingAvatarFile(type)),uploaded=await client.uploadFile({file:new CustomFile(path.basename(file),fs.statSync(file).size,file),workers:1});return client.invoke(new Api.channels.EditPhoto({channel:channel(group),photo:new Api.InputChatUploadedPhoto({file:uploaded})}));},
   history:async group=>{try{return await client.invoke(new Api.channels.TogglePreHistoryHidden({channel:channel(group),enabled:false}));}catch(error){if(error.errorMessage!=='CHAT_NOT_MODIFIED')throw error;}},
   link:group=>client.invoke(new Api.messages.ExportChatInvite({peer:peer(group),title:'qooob onboarding'})),
   template:(group,html,randomId)=>{const {HTMLParser}=require('teleproto/extensions/html'),[text,entities]=HTMLParser.parse(html);return client.invoke(new Api.messages.SendMessage({peer:peer(group),message:text,entities,randomId:bigInt(randomId),noWebpage:true}));},
   video:async(group,message,randomId)=>{const asset=videoAsset(message.assetId),file=fileURLToPath(asset.file),{HTMLParser}=require('teleproto/extensions/html'),[text,entities]=HTMLParser.parse(message.html);
    const uploaded=await client.uploadFile({file:new CustomFile(asset.filename,fs.statSync(file).size,file),workers:1});
    const media=new Api.InputMediaUploadedDocument({file:uploaded,mimeType:asset.mimeType,attributes:[new Api.DocumentAttributeVideo({duration:asset.duration,w:asset.width,h:asset.height,supportsStreaming:true}),new Api.DocumentAttributeFilename({fileName:asset.filename})]});
    return client.invoke(new Api.messages.SendMedia({peer:peer(group),media,message:text,entities,randomId:bigInt(randomId)}));},
   photo:async(group,message,randomId)=>{const file=followupPhotoPath(message.filename),{HTMLParser}=require('teleproto/extensions/html'),[text,entities]=HTMLParser.parse(message.html);
    const uploaded=await client.uploadFile({file:new CustomFile(path.basename(file),fs.statSync(file).size,file),workers:1});
    return client.invoke(new Api.messages.SendMedia({peer:peer(group),media:new Api.InputMediaUploadedPhoto({file:uploaded}),message:text,entities,randomId:bigInt(randomId)}));},
   managerAdmin:(group,managerId)=>promoteOnboardingManager({client,Api,channel:channel(group),managerId}),
   intro:(group,message,randomId)=>client.invoke(new Api.messages.SendMessage({peer:peer(group),message,randomId:bigInt(randomId),noWebpage:true}))
  };
 }catch(error){await client.disconnect().catch(()=>{});throw error;}
 }catch(error){if(!error.code)error.code='ONBOARDING_'+phase;throw error;}
}
