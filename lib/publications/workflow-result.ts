// Only the confirmed outcomes emitted by submitOrReview are successful. Guards can add new refusal messages:
// an unknown message must never hide a failed approval behind a success state in the drawer or review cards.
const confirmedMessages=new Set([
 'Révision soumise à validation.',
 'Révision approuvée.',
 'Révision refusée. Créez une nouvelle révision pour la retravailler.',
]);
export function workflowSucceeded(message:string):boolean{return confirmedMessages.has(message);}
