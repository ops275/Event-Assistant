import {STEPS} from '../config.js';

// Persisted creation flow describes the lead; the viewer role grants access only.
export function excludedCaptureField(lead,key,config={}) {
 return config.profile==='onlyplay'&&['leadgen','promoter'].includes(lead?.creationFlow)&&['generatedBy','history'].includes(key);
}

export function allowedCaptureStage(lead,stage,config={},direction=1) {
 while(stage>=0&&stage<STEPS.length&&excludedCaptureField(lead,STEPS[stage].key,config))stage+=direction;
 return Math.max(0,stage);
}

// Save/readiness projections never delete historical fields, materials or conflicts.
export function captureProjection(lead,config={}) {
 if(!lead||config.profile!=='onlyplay')return lead;
 return {...lead,
  conflicts:lead.conflicts.filter(item=>item.key!=='nextSteps'&&!excludedCaptureField(lead,item.key,config)),
  materials:lead.materials.filter(item=>item.stage!=='nextSteps'&&item.targetField!=='nextSteps'&&!excludedCaptureField(lead,item.stage,config)&&!excludedCaptureField(lead,item.targetField,config)),
 };
}
