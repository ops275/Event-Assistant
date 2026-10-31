// Visibility in operational manager pickers is independent of authentication and roles.
export function visibleManager(person){
 return String(person?.userId??person?.id??'')!=='6267917103'&&String(person?.email??'').trim().toLowerCase()!=='ops@qooob.com';
}
