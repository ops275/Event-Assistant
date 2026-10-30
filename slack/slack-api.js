export function createSlackApi(token,request=fetch){
 return async(method,body)=>{
  const encoded=new URLSearchParams(Object.entries(body).map(([key,value])=>[key,typeof value==='object'?JSON.stringify(value):String(value)]));
  const response=await request('https://slack.com/api/'+method,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/x-www-form-urlencoded'},body:encoded,signal:AbortSignal.timeout(15000)});
  if(response.status===429)throw Object.assign(Error('Slack rate limited'),{slackError:'ratelimited',retryAfter:response.headers.get('retry-after')});
  const result=await response.json();if(!response.ok||!result.ok)throw Object.assign(Error('Slack API rejected request'),{slackError:result.error||undefined});return result;
 };
}
