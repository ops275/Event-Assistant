import fs from 'node:fs';import path from 'node:path';
// Account metadata contains the verified Google email; encrypted credentials are never read.
export function managerEmailReader(directory){return record=>{const id=String(record.receiver?.id||'');if(!/^\d+$/.test(id))return null;try{const account=JSON.parse(fs.readFileSync(path.join(directory,id+'.json'),'utf8'));return String(account.userId)===id&&typeof account.email==='string'?account.email:null;}catch{return null;}};}
