import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {sameAppOrigin} from '../services/requestOrigin.js';
const origins=['https://5.22.222.83','https://onlyplay.5.22.222.83.sslip.io'];
test('same-host iOS forms may prove source with Referer when Origin is absent',()=>{
 assert.equal(sameAppOrigin({headers:{host:'5.22.222.83',referer:'https://5.22.222.83/book'}},origins),true);
 assert.equal(sameAppOrigin({headers:{host:'onlyplay.5.22.222.83.sslip.io',origin:origins[1]}},origins),true);
});
test('foreign, null, absent and cross-host origins remain denied',()=>{
 for(const headers of [{origin:'https://evil.example',referer:origins[0]+'/book'},{origin:'null',referer:origins[0]+'/book'},{},{referer:'https://evil.example/book'},{origin:origins[1]},{referer:origins[0]+'/book','sec-fetch-site':'cross-site'}])assert.equal(sameAppOrigin({headers:{host:'5.22.222.83',...headers}},origins),false);
 assert.equal(sameAppOrigin({headers:{host:'evil.example',origin:'https://evil.example'}},origins),false);
});
test('authenticated booking pages keep same-origin form Referer while private public links suppress it',()=>{
 const web=fs.readFileSync(new URL('../calendar-web.mjs',import.meta.url),'utf8');assert.ok(web.includes("'Referrer-Policy':res.getHeader('Referrer-Policy')||'same-origin'"));
 const publicRoutes=fs.readFileSync(new URL('../services/bookingLinkRoutes.js',import.meta.url),'utf8');assert.ok(publicRoutes.includes("res.setHeader('Referrer-Policy','no-referrer')"));
});
