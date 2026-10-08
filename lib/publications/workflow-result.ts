// Messages of the existing workflow functions (submitOrReview) that mean the operation was refused or not confirmed.
const failurePrefixes=['Opération non confirmée','Identifiant','Validation impossible','Média requis avant validation'];
export function workflowSucceeded(message:string):boolean{return !failurePrefixes.some(prefix=>message.startsWith(prefix));}
