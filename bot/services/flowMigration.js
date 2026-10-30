// Version 5 removes the dedicated Next steps stage, retaining its stored field and materials.
export function migrateFlowV5(state) {
    const ids = new Set(Object.values(state.leads).filter(lead => lead.flowVersion === 4).map(lead => lead.id));
    const remap = stage => Number.isInteger(stage) && stage > 5 ? stage - 1 : stage;
    for (const id of ids) {
        const lead = state.leads[id];
        lead.stage = remap(lead.stage);
        lead.flowVersion = 5;
        for (const source of lead.materials || []) {
            if (source.stage === 'nextSteps' && ['pending', 'failed'].includes(source.status)) source.status = 'deferred';
        }
    }
    for (const session of Object.values(state.sessions)) {
        if (!ids.has(session.activeId)) continue;
        for (const key of ['returnStage', 'editReturnStage', 'checkpointStage']) session[key] = remap(session[key]);
        // Old step buttons contain numeric positions from the previous flow.
        session.nonce = null;
    }
    for (const entry of Object.values(state.inbox || {})) {
        if (!ids.has(entry.arrival?.id)) continue;
        if (entry.arrival.stage === 5) entry.arrival.materialStage = 'nextSteps';
        entry.arrival.stage = remap(entry.arrival.stage);
    }
    return ids.size > 0;
}
