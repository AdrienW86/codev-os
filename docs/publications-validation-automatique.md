# Publications — validation automatique

Option par client (fiche client → onglet Publications → « Valider automatiquement si je n’agis pas »), désactivée par défaut.

1. L’agent prépare chaque créneau quelques jours avant (« Préparer combien de jours avant le créneau ») et le place « À valider ».
   Une notification « publication à valider » est envoyée (cloche CODE-V OS et notifications push).
2. Jusqu’à N heures avant la publication (réglage du client, 12 h par défaut), l’humain peut approuver, modifier ou rejeter.
3. Passé ce délai, sans action, le planificateur approuve la publication au nom de l’administrateur qui a délégué la
   préparation automatique (journal : `publication.auto_approved`). La diffusion suit au créneau, comme une approbation manuelle.

Jamais approuvé automatiquement :
- **TikTok** : TikTok impose un choix humain de la visibilité et un consentement à chaque publication.
- une publication **modifiée par un humain** (révision « manual ») : elle repasse en validation manuelle ;
- une publication **sans photo**, sur un canal désactivé, archivée, rejetée, ou dont le créneau est passé ;
- quand l’arrêt général est actif ou la diffusion désactivée.

La base revérifie toutes ces règles sous verrou (`publication_auto_approve`).
