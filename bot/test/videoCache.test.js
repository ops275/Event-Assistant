import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sendCachedVideo} from '../services/videoCache.js';

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'video-cache-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'video.mp4');fs.writeFileSync(file,'video-one');
 const stateFile=path.join(dir,'state.json');
 const store={state:{},save(){fs.writeFileSync(stateFile,JSON.stringify(this.state));}};
 const calls=[];const telegram={async sendVideo(...args){calls.push(args);return {message_id:calls.length,video:{file_id:'confirmed-id'}};}};
 const input={store,telegram,botId:123,chatId:77,assetId:'asset',asset:{file,filename:'video.mp4'},extra:{caption:'hello',parse_mode:'HTML'}};
 return {input,calls,file,stateFile,store};
}
test('upload then reuse confirmed file_id, retaining chat and options across restart',async t=>{
 const f=fixture(t);await sendCachedVideo(f.input);assert.equal(typeof f.calls[0][1],'object');
 f.store.state=JSON.parse(fs.readFileSync(f.stateFile));await sendCachedVideo(f.input);
 assert.equal(f.calls[1][1],'confirmed-id');assert.equal(f.calls[1][0],77);assert.deepEqual(f.calls[1][2],f.input.extra);
});
test('changed contents, bot and asset each force fresh upload',async t=>{
 const f=fixture(t);await sendCachedVideo(f.input);fs.writeFileSync(f.file,'video-two');await sendCachedVideo(f.input);
 await sendCachedVideo({...f.input,botId:456});await sendCachedVideo({...f.input,assetId:'other'});
 assert.ok(f.calls.every(c=>typeof c[1]==='object'));
});
test('explicit invalid ID invalidates and uploads once',async t=>{
 const f=fixture(t);await sendCachedVideo(f.input);let n=0;
 f.input.telegram.sendVideo=async (...args)=>{f.calls.push(args);if(++n===1)throw {response:{error_code:400,description:'Bad Request: wrong file identifier/HTTP URL specified'}};return {message_id:2,video:{file_id:'new-id'}};};
 await sendCachedVideo(f.input);assert.equal(n,2);assert.equal(typeof f.calls.at(-1)[1],'object');
 await sendCachedVideo(f.input);assert.equal(f.calls.at(-1)[1],'new-id');
});
test('timeout, rate limit and unrelated 400 never trigger fallback upload',async t=>{
 for(const error of [new Error('timeout'),{response:{error_code:429,description:'retry later'}},{response:{error_code:400,description:'chat not found'}}]){
 const f=fixture(t);await sendCachedVideo(f.input);let n=0;f.input.telegram.sendVideo=async()=>{n++;throw error;};
 await assert.rejects(sendCachedVideo(f.input));assert.equal(n,1);
 }
});
test('failed upload or unconfirmed response is never cached; no retry after upload error',async t=>{
 const f=fixture(t);let n=0;f.input.telegram.sendVideo=async()=>{n++;throw new Error('timeout');};
 await assert.rejects(sendCachedVideo(f.input));assert.equal(n,1);assert.equal(Object.keys(f.store.state.videoFileIds||{}).length,0);
 f.input.telegram.sendVideo=async()=>({message_id:1});await sendCachedVideo(f.input);assert.equal(Object.keys(f.store.state.videoFileIds||{}).length,0);
});
test('cache write failure after confirmed delivery does not cause resend',async t=>{
 const f=fixture(t);f.store.save=()=>{throw new Error('disk');};await sendCachedVideo(f.input);assert.equal(f.calls.length,1);
});
