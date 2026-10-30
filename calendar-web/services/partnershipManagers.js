// User-provided manager directory. Missing booking links stay explicitly unavailable.
export const PARTNERSHIP_MANAGERS=Object.freeze([
 {id:'gosha',name:'Gosha Dieiev',email:'gosha@qooob.com',telegram:['@yaknamene'],bookingUrl:'https://calendar.app.google/ZJmvVaaba81DwAce9'},
 {id:'andrii',name:'Andrii Skorobohatov',email:'andrii.skorobohatov@qooob.com',telegram:['@askorobohatov','@andrii_qooob']},
 {id:'vlada',name:'Vlada Transka',email:'vladlena.transka@qooob.com',telegram:['@Vlada_t1']},
 {id:'khati',name:'Khati Lekishvili',email:'khatia.lekishvili@qooob.com',telegram:['@Khati_qooob']},
 {id:'oleksandr',name:'Oleksandr Kolisnyk',email:'oleksandr.kolisnyk@qooob.com',telegram:['@zanepad']},
 {id:'daria',name:'Daria Zagorskaya',email:'onboarding@qooob.com',telegram:['@dasha_elle']},
].map(manager=>Object.freeze({...manager,telegram:Object.freeze(manager.telegram)})));
export const partnershipManager=id=>PARTNERSHIP_MANAGERS.find(manager=>manager.id===id)||null;
