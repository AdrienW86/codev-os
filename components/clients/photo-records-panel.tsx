import { MutationForm } from "@/components/ui/mutation-form";
import { savePhotoRecordAction } from "@/app/(cockpit)/clients/[id]/photo-record-actions";
import { photoStateLabels } from "@/lib/photo-records/model";
import type { PhotoToConfirm } from "@/lib/photo-records/service";

const input = "mt-1 block w-full rounded-md border border-border bg-background px-2 py-1";

/**
 * Chantiers à confirmer (socle éditorial, lot 2) : ce que la photo montre (analyse) et ce que le client a écrit
 * (légende) restent des indices. Seule la fiche confirmée ici rend l'intervention, la commune et la date citables.
 */
export function PhotoRecordsPanel({ clientId, photos, unavailable }: { clientId: string; photos: PhotoToConfirm[] | null; unavailable: boolean }) {
  return (
    <section aria-labelledby="photo-records-title" className="mb-6 rounded-xl border border-border bg-surface p-5">
      <h2 id="photo-records-title" className="text-base font-semibold">Chantiers à confirmer</h2>
      <p className="mt-1 text-xs text-muted">L’analyse automatique dit ce que la photo montre, jamais où ni quand le chantier a eu lieu. Les agents ne citent un chantier qu’une fois confirmé ici.</p>
      {unavailable ? <p className="mt-2 text-sm text-warning">Fiches illisibles pour le moment : les agents restent sur des conseils généraux.</p>
        : photos === null ? <p className="mt-2 text-sm text-muted">Fiches photo non installées : appliquez la migration 20261210000000_photo_records.</p>
        : photos.length === 0 ? <p className="mt-2 text-sm text-muted">Aucune photo en attente de confirmation.</p>
        : (
          <ul className="mt-3 grid gap-4 lg:grid-cols-2">
            {photos.map((photo) => (
              <li key={photo.id} className="rounded-lg border border-border p-3">
                <div className="flex gap-3">
                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded-md bg-background">
                    {photo.thumbnailUrl ? <img src={photo.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 text-sm">
                    <p className="text-xs font-medium text-muted">{photoStateLabels[photo.state]}</p>
                    {photo.observed ? <p className="mt-1"><span className="text-muted">La photo montre (indice) :</span> {photo.observed}</p> : null}
                    {photo.caption ? <p className="mt-1"><span className="text-muted">Le client a écrit (à vérifier) :</span> « {photo.caption} »</p> : null}
                  </div>
                </div>
                <MutationForm action={savePhotoRecordAction} fields={{ client_id: clientId, asset_id: photo.id, decision: "validate" }} label="Confirmer le chantier" variant="primary" className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-sm sm:col-span-2">Intervention réalisée
                    <input name="intervention" required minLength={2} maxLength={200} className={input} />
                  </label>
                  <label className="text-sm">Commune
                    <input name="commune" maxLength={100} className={input} />
                  </label>
                  <label className="text-sm">Mois du chantier
                    <input name="month" type="month" className={input} />
                  </label>
                  <fieldset className="text-sm sm:col-span-2">
                    <legend>Réalisé par l’entreprise ?</legend>
                    <label className="mr-4"><input type="radio" name="done_by_client" value="yes" required /> Oui</label>
                    <label><input type="radio" name="done_by_client" value="no" /> Non (illustration, autre entreprise)</label>
                  </fieldset>
                  <label className="text-sm sm:col-span-2"><input type="checkbox" name="publication_allowed" value="yes" defaultChecked /> Le client autorise la publication avec ces informations</label>
                </MutationForm>
                <MutationForm action={savePhotoRecordAction} fields={{ client_id: clientId, asset_id: photo.id, decision: "exclude" }} label="Exclure cette photo" variant="secondary" className="mt-2" />
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
