// Passwords are loaded only on the server and never stored in job data or errors.
export async function transferOnboardingOwnership({client,Api,channel,managerId,loadPassword,computeCheck}){
 const users=await client.getParticipants(channel);
 const user=users.find(user=>String(user.id)===String(managerId));
 if(!user||user.bot||user.deleted)throw Object.assign(new Error('Manager must join first'),{code:'ONBOARDING_MANAGER_NOT_IN_GROUP'});
 const input=await client.getInputEntity(user);
 const participant=async()=>{const result=await client.invoke(new Api.channels.GetParticipant({channel,participant:input}));return result.participant;};
 if((await participant())?.className==='ChannelParticipantCreator')return;
 const password=loadPassword();
 if(!password)throw Object.assign(new Error('Ownership password required'),{code:'ONBOARDING_OWNERSHIP_PASSWORD_REQUIRED'});
 const state=await client.invoke(new Api.account.GetPassword());
 if(!state.hasPassword)throw Object.assign(new Error('Enable two-step verification'),{code:'ONBOARDING_TWO_FACTOR_REQUIRED'});
 const proof=await computeCheck(state,password);
 await client.invoke(new Api.channels.EditAdmin({channel,userId:input,rank:'',adminRights:new Api.ChatAdminRights({changeInfo:true,deleteMessages:true,banUsers:true,inviteUsers:true,pinMessages:true,addAdmins:true,manageCall:true,manageTopics:true})}));
 const peer=new Api.InputPeerChannel({channelId:channel.channelId,accessHash:channel.accessHash});
 await client.invoke(new Api.messages.EditChatCreator({peer,userId:input,password:proof}));
 if((await participant())?.className!=='ChannelParticipantCreator')throw Object.assign(new Error('Ownership unconfirmed'),{code:'ONBOARDING_OWNERSHIP_UNCONFIRMED'});
}

export async function leaveOnboardingGroup({client,Api,channel,managerId}){
 // A lost response after leaving must be recoverable. This is called only after
 // a verified ownership transfer was persisted in the job.
 const absent=error=>['USER_NOT_PARTICIPANT','CHANNEL_PRIVATE'].includes(error.errorMessage);
 let users;try{users=await client.getParticipants(channel);}catch(error){if(absent(error))return;throw error;}
 const user=users.find(user=>String(user.id)===String(managerId));
 if(!user||user.bot||user.deleted)throw Object.assign(new Error('Manager unavailable'),{code:'ONBOARDING_OWNERSHIP_UNCONFIRMED'});
 const input=await client.getInputEntity(user),result=await client.invoke(new Api.channels.GetParticipant({channel,participant:input}));
 if(result.participant?.className!=='ChannelParticipantCreator')throw Object.assign(new Error('Ownership changed'),{code:'ONBOARDING_OWNERSHIP_UNCONFIRMED'});
 try{await client.invoke(new Api.channels.LeaveChannel({channel}));}catch(error){if(!absent(error))throw error;}
}


// Grant the permission needed for manual invitations; Amanda retains ownership.
export async function promoteOnboardingManager({client,Api,channel,managerId}){
 const users=await client.getParticipants(channel);
 const user=users.find(user=>String(user.id)===String(managerId));
 if(!user||user.bot||user.deleted)throw Object.assign(new Error('Manager must join first'),{code:'ONBOARDING_MANAGER_NOT_IN_GROUP'});
 const input=await client.getInputEntity(user);
 const participant=async()=>{const result=await client.invoke(new Api.channels.GetParticipant({channel,participant:input}));return result.participant;};
 const hasPermission=value=>value?.className==='ChannelParticipantCreator'||value?.className==='ChannelParticipantAdmin'&&value.adminRights?.inviteUsers===true;
 const current=await participant();if(hasPermission(current))return;
 await client.invoke(new Api.channels.EditAdmin({channel,userId:input,rank:'',adminRights:new Api.ChatAdminRights({...current?.adminRights,inviteUsers:true})}));
 if(!hasPermission(await participant()))throw Object.assign(new Error('Manager admin permissions unconfirmed'),{code:'ONBOARDING_ADMIN_UNCONFIRMED'});
}
