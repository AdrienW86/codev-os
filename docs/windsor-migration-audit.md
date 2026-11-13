# Audit de dépendance Windsor.ai — CODE-V OS

Recherche de code GitHub sur la branche master au 13/11/2026 :
- `windsor` : 0 résultat.
- `WINDSOR_AI` : 0 résultat.
- `windsor.ai` : 0 résultat.

Le dépôt n'a pas de fichiers dont le chemin contient « Windsor ». Les implémentations existantes
de Vercel Analytics, Google Ads et Search Console appellent leurs sources propres.

**Décision** : zéro nouveau connecteur Windsor.ai. Ne supprimer aucun secret ni compte
Windsor.ai sans inventaire externe des éventuels rapports, automatisations ou clients qui
pourraient encore l'utiliser en dehors de ce dépôt. Ce document ne démontre pas l'absence
de connexion dans d'autres applications, services ou environnements Vercel.

Google Analytics 4 est désormais prévu via les API officielles Google. Les données
GA4, Search Console et Vercel gardent leurs définitions et agrégations distinctes.
