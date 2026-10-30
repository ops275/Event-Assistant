import {ONBOARDING_TEMPLATE_PACKS} from './onboardingTemplates.js';
const categories=['operator','provider'];
export function createMaterials({send,persist,checkAsset}){
 function panel(session){
  if(!session.view?.startsWith('materials-'))return null;
  const rows=[],add=(text,action)=>rows.push([{text,callback_data:`v2:${session.nonce}:${action}`}]);
  if(session.view==='materials-category'){
   add('Operator','materialcategory:operator');add('Provider','materialcategory:provider');add('Back','welcome');
   return {text:'📋 Materials',rows};
  }
  const category=session.materialsCategory,packs=ONBOARDING_TEMPLATE_PACKS.filter(p=>p.category===category),partial=session.materialsDelivery&&session.materialsDelivery.status!=='complete';
  if(partial)add('Retry','materialretry');
  else packs.forEach(pack=>add(pack.name,'materialsend:'+pack.id));
  add('Back','materialhome');
  return {text:'📋 '+(category==='operator'?'Operator':'Provider')+(partial?'\n\nDelivery interrupted.':packs.length?'':'\n\nNo templates yet.'),rows};
 }
 async function action(action,value,session){
  if(!['materialhome','materialcategory','materialsend','materialretry'].includes(action))return false;
  session.editField=null;
  if(action==='materialhome'){session.view='materials-category';return true;}
  if(action==='materialcategory'){
   if(!categories.includes(value))throw new Error('Choose Operator or Provider.');
   session.materialsCategory=value;session.view='materials-templates';return true;
  }
  let delivery=session.materialsDelivery;
  if(action==='materialsend'){
   if(delivery&&delivery.status!=='complete')throw new Error('Finish the pending template first.');
   const pack=ONBOARDING_TEMPLATE_PACKS.find(p=>p.category===session.materialsCategory&&p.id===value);
   if(session.view!=='materials-templates'||!pack)throw new Error('Choose a template again.');
   for(const item of pack.messages)if(item.type==='video')checkAsset(item.assetId);
   delivery=session.materialsDelivery={id:pack.id,category:pack.category,items:pack.messages.map(m=>({...m})),nextIndex:0,status:'sending',messageIds:[]};persist();
  }else if(!delivery||delivery.status==='complete')return true;
  session.materialsCategory=delivery.category;session.view='materials-templates';
  for(let index=delivery.nextIndex;index<delivery.items.length;index++){
   try{
    delivery.status='sending';persist();
    const result=await send(delivery.items[index]);
    if(!result?.message_id)throw new Error('Delivery unconfirmed.');
    delivery.messageIds.push(result.message_id);delivery.nextIndex=index+1;persist();
   }catch{delivery.status='partial';persist();return true;}
  }
  delivery.status='complete';persist();return true;
 }
 return {panel,action};
}
