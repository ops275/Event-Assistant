import {MAX_FILE_BYTES} from '../config.js';
import {UserError} from '../flow.js';

export async function readSearchQuery(message,analyzer){
 let query=message.text?.trim();
 const audio=message.voice||message.audio;
 if(audio){
  if(audio.file_size>MAX_FILE_BYTES)throw new UserError('Audio exceeds 20 MB. Send a shorter message.');
  try{
   const result=await analyzer.analyze({kind:'audio',stage:'search',fileId:audio.file_id,size:audio.file_size,mime:audio.mime_type||'audio/ogg'}, {fields:{},materials:[]},{signal:AbortSignal.timeout(35000)});
   query=result.transcript?.trim();
  }catch{throw new UserError('Could not transcribe the audio. Try again or type your search query.');}
  if(!query)throw new UserError('Could not recognize speech. Send another voice message or text.');
 }
 if(!query||query.startsWith('/'))throw new UserError('Send a voice message, an audio file or a text search query.');
 if(query.length>500)throw new UserError('Shorten the search query to 500 characters.');
 return query;
}
