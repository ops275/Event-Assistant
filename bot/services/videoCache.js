import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

function invalidFileId(error) {
    const response=error.response||error;
    return (response.error_code||error.code)===400 && /wrong (?:remote )?file identifier|file[_ ]id (?:is )?(?:invalid|not found)|invalid file[_ ]id/i.test(response.description||'');
}

// FileStore saves this namespace atomically alongside existing durable application state.
// A cache persistence failure must not turn a confirmed delivery into a resend.
function persist(store) {
    try { store.save(); } catch { console.warn('Video file_id cache persistence failed.'); }
}

export async function sendCachedVideo({store,telegram,botId,chatId,assetId,asset,extra}) {
    const hash=createHash('sha256');
    for await (const chunk of createReadStream(asset.file)) hash.update(chunk);
    const identity=String(botId||'');
    const key=JSON.stringify([identity,assetId,hash.digest('hex')]);
    const cache=store.state.videoFileIds ||= {};
    const cached=identity&&cache[key];
    if(typeof cached==='string'&&cached) {
        try { return await telegram.sendVideo(chatId,cached,extra); }
        catch(error) {
            if(!invalidFileId(error)) throw error;
            delete cache[key];persist(store);
        }
    }
    const source=asset.file instanceof URL?fileURLToPath(asset.file):asset.file;
    const message=await telegram.sendVideo(chatId,{source,filename:asset.filename},extra);
    if(identity&&message?.message_id&&typeof message.video?.file_id==='string'&&message.video.file_id) {
        cache[key]=message.video.file_id;persist(store);
    }
    return message;
}
