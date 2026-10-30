// Approved Provider copy, in delivery order. These are message data, never instructions.
export const ONBOARDING_TEMPLATE_PACKS=Object.freeze([
 {id:'greet-ask-start-dd',category:'provider',name:'Greet, Ask & Start DD',messages:[
  {name:'Welcome',html:`Hello and welcome!

I will add my teammates to the chat, and I have opened the chat history view, so please feel free to add the relevant business team members from your side — just the business folks, since we will create another chat for tech and integration.

I’ll share a guide to walk you through the integration and onboarding process in advance, before you sign the NDA and start due diligence. To do this, please share your email addresses for the DD info.`},
  {name:'Four quick points',html:`To move things forward, could you reply with 4 quick points (short text is fine)?

1. <b>Game portfolio</b>: number of games + main types (slots/live/crash/etc.) + key slot mechanics
2. <b>Markets</b>: your priority regions now + which ones you want to expand into next
3. <b>Commercial</b>: your usual model (revshare/fee/hybrid) + typical rates
4. <b>Compliance</b>: main registration country (entity) + licenses + available settlement methods + any restricted markets`}
 ]},
 {id:'introduce-marketplace',category:'provider',name:'Introduce Marketplace',messages:[
  {type:'video',assetId:'igames-marketplace',name:'Product update and materials',html:`Before you start answering questions, I want you to watch an important <i>product update</i>.

You may already know about qooob's transparent model, but we’ve recently launched the <b><i>game catalog</i></b> in beta, bringing us one step closer to the next stage of qooob — the <b>iGames Marketplace.</b>

See how our ecosystem is expanding by watching the linked <b><a href="https://drive.google.com/file/d/16HGA8WtZVbpiBJzfI_2dEj1mBQvCnfZO">video</a></b>

All marketplace capabilities are available through <b>Distribution Gateway</b> with a 1% fee + direct negotiations with operators. The <b><a href="https://drive.google.com/file/d/1e_2PdgPtnlzaKhyRExjeKviX4QWoi2wp">next short video</a></b> explains the open economics model.

I’m also sharing:

- Marketplace <b><a href="https://drive.google.com/file/d/1cJdxG91YqUsnIJPwRapbxzk6w9IiKsSc/view?usp=sharing">Presentation</a></b>
- Marketplace Onboarding <b><a href="https://drive.google.com/file/d/15mP_pfgsmVYrPZVjN1wDGFwHK-GQEL6F/view?usp=sharing">Requirements</a></b>.

If helpful, we can also jump on a short call to walk you through the model and show you the beta version of the catalog.`},
  {type:'video',assetId:'qooob-economy-providers',name:'Share with stakeholders',html:`I recommend forwarding the previous message to your <b>Legal</b>, <b>Compliance</b>, and <b>Tech stakeholders</b> to align our operational standards so we can onboard you into the marketplace environment as well.`},
  {name:'Call or clarification',html:`Guys, do you want to jump on a call to discuss the difference between the approaches, or is everything clear for now?`}
 ]},
 {id:'kick-off-contracting',category:'provider',name:'Kick off Contracting',messages:[
  {name:'Contracting',html:`Dear colleagues,

Before starting contracting, we’re sharing our <b>contract templates</b> (by email), which already incorporate the commercial, technical, and legal standards of the upcoming industry’s first <b>iGames Marketplace</b>, where providers distribute content directly and operators negotiate rates without middlemen, while the traditional convenience of single-API aggregation remains.

To start the legal review, please forward this message to your Legal &amp; Compliance stakeholders so we can align on standards, which are a prerequisite for marketplace onboarding.

When your colleagues read the <b><a href="https://docs.google.com/document/d/16jWsO1OqcSbutXC_6CIEG2PhlwEv8-A5mUhiQRp8l1U/edit?usp=sharing">cover letter</a></b>, which explains our business model, they will be prepared for smooth contracting.

<b>Together, we are building a new industry standard — an open, transparent market based on fair economics and clear accountability for every participant.</b> That’s why it’s important that our legal agreements support this model.

Thank you for your attention and cooperation!`}
 ]}
].map(pack=>Object.freeze({...pack,messages:Object.freeze(pack.messages.map(message=>Object.freeze(message)))})));

export function selectedOnboardingTemplates(type,ids=[]){
 if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!ONBOARDING_TEMPLATE_PACKS.some(pack=>pack.id===id&&type.startsWith(pack.category+'-'))))throw new Error('Choose valid introductory message templates for this chat type.');
 return ONBOARDING_TEMPLATE_PACKS.filter(pack=>ids.includes(pack.id));
}
