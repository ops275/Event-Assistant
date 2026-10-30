// Only these application-owned assets may be uploaded. Job data never supplies a path or metadata.
const assets=Object.freeze({
 'igames-marketplace':Object.freeze({file:new URL('../igames-marketplace.mp4',import.meta.url),filename:'igames-marketplace.mp4',duration:51.5,width:1920,height:1080,mimeType:'video/mp4'}),
 'qooob-economy-providers':Object.freeze({file:new URL('../qooob-economy-providers.mp4',import.meta.url),filename:'qooob-economy-providers.mp4',duration:68.181333,width:1920,height:1080,mimeType:'video/mp4'})
});
export function videoAsset(id){if(!Object.hasOwn(assets,id))throw new Error('Unknown video asset.');return assets[id];}
