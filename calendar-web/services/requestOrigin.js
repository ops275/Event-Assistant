// Same-origin HTML form POSTs in WebKit may omit Origin. Accept a strict
// same-origin Referer only in that case; form/session CSRF checks still apply.
export function sameAppOrigin(req,allowed){
 if(req.headers['sec-fetch-site']==='cross-site')return false;
 const candidates=allowed.filter(Boolean).map(value=>new URL(value).origin),host=req.headers.host;
 let origin;if(req.headers.origin!==undefined)origin=req.headers.origin;else {try{origin=new URL(req.headers.referer).origin;}catch{return false;}}
 try{const url=new URL(origin);return candidates.includes(url.origin)&&url.origin===origin&&url.host===host;}catch{return false;}
}
