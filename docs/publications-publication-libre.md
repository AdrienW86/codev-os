# Publier quand je veux (hors planning)

Sur la fiche d'un brouillon non planifié, le panneau « Planifier ce brouillon » propose d'abord **Publier quand je veux** :

- **Maintenant** : départ à la minute suivante, envoi effectif au prochain passage du planificateur (toutes les 15 minutes).
- **À une date et une heure** : jusqu'à 12 semaines, heure de Paris (fuseau du planning du canal).

Une publication est créée par réseau du brouillon (jusqu'à 5 : Facebook, Instagram, Google, TikTok, Snapchat), en dehors des créneaux du planning. Le planning automatique n'est pas modifié et l'agent ne réutilise jamais ces horaires.

Validation : les publications sont validées d'office par l'administrateur qui programme, **sauf TikTok** (confidentialité, commentaires et divulgation à choisir sur la fiche) et sauf un réseau sans média (ajouter le média sur la fiche, puis valider).

Retirer une publication programmée ainsi supprime aussi son horaire du calendrier.

Technique : migration `20261122000000_publications_manual_schedule.sql` — occurrences `origin='manual'` sans créneau, RPC `publication_schedule_manual` (une transaction : occurrences + rattachement via `publication_schedule_draft`), le reste du circuit (validation, préparation, envoi, tolérance de retard) est inchangé.
