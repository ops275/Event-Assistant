import test from 'node:test';
import assert from 'node:assert/strict';
import {createSlackApi} from '../slack-api.js';
test('Slack API encodes lookup arguments as form data and serializes blocks',async()=>{
 const calls=[];const api=createSlackApi('test',async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({ok:true})};});
 await api('users.lookupByEmail',{email:'ops@qooob.com'});assert.equal(calls[0].options.headers['content-type'],'application/x-www-form-urlencoded');assert.equal(new URLSearchParams(calls[0].options.body).get('email'),'ops@qooob.com');
 const blocks=[{type:'section',text:{type:'plain_text',text:'test'}}];await api('chat.postMessage',{channel:'DOPS',blocks});assert.deepEqual(JSON.parse(new URLSearchParams(calls[1].options.body).get('blocks')),blocks);
});
