import {hideFromBoardAction,restoreToBoardAction} from '@/app/(cockpit)/publications/board-actions';

// Single UI of the board-only removal, shared by the table menu and the drawer. Removal needs an explicit confirmation;
// nothing is deleted (board-visibility records an append-only audit event).
export function BoardVisibilityForm({publicationId,hidden}:{publicationId:string;hidden:boolean}){
 if(hidden)return <form action={restoreToBoardAction} className="p-1"><input type="hidden" name="publication_id" value={publicationId}/><button className="w-full rounded px-2 py-1.5 text-left hover:bg-border/40">Remettre dans le tableau</button></form>;
 return <details data-remove-from-board="true"><summary className="cursor-pointer list-none rounded px-3 py-1.5 text-red-700 hover:bg-border/40">Retirer du tableau…</summary>
  <form action={hideFromBoardAction} className="space-y-2 p-3 text-xs"><input type="hidden" name="publication_id" value={publicationId}/>
   <p>La ligne disparaîtra du tableau. Rien n’est supprimé : versions, validations, médias, coûts et historique sont conservés. Vous pourrez la réafficher avec « Afficher les retirées ».</p>
   <label className="flex items-start gap-2"><input type="checkbox" name="confirm" required/>Je confirme le retrait de cette publication du tableau.</label>
   <button className="w-full rounded-lg border border-red-600 px-3 py-1.5 text-red-700">Retirer du tableau</button></form></details>;
}
