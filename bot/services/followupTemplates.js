import {fileURLToPath} from 'node:url';

export const FOLLOWUP_CATEGORIES=Object.freeze(['operator','provider']);
const PHOTOS=Object.freeze(['follow-up-marketplace-cover.png','follow-up-open-distribution-vs-black-box.png']);
export function followupPhotoPath(name){
 if(!PHOTOS.includes(name))throw new Error('Unknown follow-up photo.');
 return fileURLToPath(new URL('../'+name,import.meta.url));
}

// Old delivery snapshots keep their indexes; the bot skips this retired item.
export function isRetiredFollowupItem(item){
 return item?.type==='text'&&/^Employee instructions\s*[—–-]\s*keep this message for yourself\./i.test(String(item.html||'').trim());
}

export const FOLLOWUP_TEMPLATE_PACKS=Object.freeze([
 Object.freeze({id:'igames-marketplace',category:'operator',name:'After Event Template',version:3,missingVideos:0,items:Object.freeze([
  {type:'photo',filename:PHOTOS[0],html:'We build the industry’s first <b>iGames Marketplace</b>, where providers distribute content directly and operators negotiate rates without middlemen, while the traditional convenience of single-API aggregation remains.'},
  {type:'text',html:'To help me understand which part of our solution to focus on, could you tell me what would bring more value to your business at this stage? Full operational control over your game portfolio or the best possible game rates on the market?'},
  {type:'video',assetId:'igames-marketplace',html:`Inside iGames Marketplace, operators <b>fully control their Game Portfolio:</b>

- discover providers based on their readiness to enter new markets;
- discover games by performance &amp; manage game portfolio;
- start integrations &amp; access updated game assets;
- manage promo campaigns;
- manage settlements;
- receive reports;
- use growth analytics.

This Video shows the main functionality.`},
  {type:'video',assetId:'qooob-economy-operators',html:`Access to the marketplace comes through our Distribution Gateway, qooob.com, not another black-box aggregator, so open economics let operators negotiate <b>the Best Possible Rates</b> for games. As a result, operators protect their NGR.

The other video shows how open economics works.`},
  {type:'photo',filename:PHOTOS[1],html:'I’d also like to quickly compare Open Distribution with Black Box.'},
  {type:'text',html:`I have a suggestion. Let’s hop on the call and discuss which aggregator you’re currently working with and which jobs we could take over — from reducing rates with your current providers to expanding your portfolio for specific markets.

The integration list has more than 100 providers, but our catalog has around 1.000. So we can act as your sourcing partner to onboard vendors that fit your casino brands and business strategy.

Shall we schedule a demo and discovery call?`},
 ].map(item=>Object.freeze(item)))})
]);

export function followupTemplate(category,id){
 if(!FOLLOWUP_CATEGORIES.includes(category))return null;
 return FOLLOWUP_TEMPLATE_PACKS.find(pack=>pack.category===category&&pack.id===id)||null;
}
