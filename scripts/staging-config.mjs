export function stagingEnvironment(input,component){
 if(!['bot','web'].includes(component))throw new Error('Unsupported staging component');
 const token=String(input.TELEGRAM_BOT_TOKEN||'');
 if(!/^9280625084:[A-Za-z0-9_-]{30,}$/.test(token))throw new Error('Staging bot identity required');
 return {
  PATH:'/usr/bin:/bin',HOME:'/var/lib/qooob-staging',NODE_ENV:'staging',
  TELEGRAM_BOT_TOKEN:token,BOT_PROFILE:'onlyplay',BOT_NAME:'qooob_event_assistant_bot',
  ENV_FILE:'/etc/qooob-staging/no-dotenv',CALENDAR_BOT_ENV:'/etc/qooob-staging/no-dotenv',
  DATA_DIR:'/var/lib/qooob-staging',CALENDAR_LEADS_FILE:'/var/lib/qooob-staging/state.json',
  ADMIN_SETTINGS_FILE:'/var/lib/qooob-staging/admin-settings.json',
  CALENDAR_PRIVATE_DIR:'/etc/qooob-staging/calendar-private',
  CALENDAR_ACCOUNTS_DIR:'/var/lib/qooob-staging/calendar-accounts',
  ONBOARDING_JOBS_DIR:'/var/lib/qooob-staging/onboarding',
  BOOKING_LINKS_DIR:'/var/lib/qooob-staging/booking-links',
  REMINDER_LEDGER_FILE:'/var/lib/qooob-staging/reminder-ledger.json',
  BOOKING_URL_FILE:'/etc/qooob-staging/public-url',CALENDAR_PUBLIC_URL_FILE:'/etc/qooob-staging/public-url',
  GOOGLE_OAUTH_PUBLIC_URL:'https://staging.qooob.81.27.103.54.sslip.io',
  ADMIN_TELEGRAM_USER_IDS:'6267917103,329180371',ALLOWED_TELEGRAM_USER_IDS:'6267917103,329180371',
  SHARED_LEADS:'true',CALENDAR_LEGACY_ENABLED:'false',REQUIRE_CALENDAR_CONNECTION:'true',PORT:'18766',TIMEZONE:'Europe/Warsaw',
 };
}

export async function verifyStagingIdentity(token,request=fetch){
 let response,result;
 try{
  response=await request('https://api.telegram.org/bot'+token+'/getMe',{signal:AbortSignal.timeout(15000)});
  result=await response.json();
 }catch{throw new Error('Staging bot identity verification unavailable');}
 if(!response.ok||!result.ok||result.result?.id!==9280625084||result.result?.username!=='qooob_event_assistant_bot')throw new Error('Staging bot identity mismatch');
}
