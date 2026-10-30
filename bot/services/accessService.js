// Role resolution is separate from choosing a lead creation flow.
// No privileges are granted by the temporary flow selector.
export function resolveRole(state, userId) {
 const role=state.userRoles?.[String(userId)];
 return ['partnership','leadgen','promoter'].includes(role) ? role : null;
}
