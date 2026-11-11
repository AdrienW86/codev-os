# Agent Prospection — prescripteurs d'un client

Pour un client (métier + zone, ex. couvreur à Lyon), l'agent liste les entreprises actives
susceptibles de le recommander : architectes, syndics, agences immobilières, experts en
sinistres, courtiers, maîtres d'œuvre, promoteurs…

## Fonctionnement

1. **Profil métier** (`lib/acquisition/prescribers.ts`) : `clients.activity` est rattachée à un
   profil (couvreur, plombier, électricien, peintre, maçon, paysagiste, nettoyage ; générique sinon).
   Chaque profil liste des segments prescripteurs avec priorité, justification et codes NAF.
2. **Zone** : `clients.geographic_area` (ou la commune saisie) est géolocalisée via l'API Géo
   (`geo.api.gouv.fr`). Seule la première commune citée est utilisée (« Lyon et alentours » → Lyon).
3. **Recherche** (`lib/acquisition/sirene.ts`) : API publique Recherche d'entreprises
   (`recherche-entreprises.api.gouv.fr/near_point`), entreprises actives, rayon 5 à 50 km,
   segment par segment, 25 à 100 résultats par segment, ~5 requêtes/s (limite API : 7/s).
4. **Score sur 100** explicable : priorité du segment (≤ 55), proximité (≤ 30), taille (≤ 15).
   Une donnée inconnue rapporte 0 point.
5. **Enregistrement** dans `acquisition_prospects` (catégorie `prescriber`, statut « Découvert »),
   une preuve `acquisition_evidence` par fiche (lien Annuaire des entreprises), un historique
   dans `acquisition_discovery_runs`. Dédoublonnage par SIREN dans l'espace du client.
6. **Google Places (facultatif)** : bouton « Compléter site et téléphone », 20 fiches max par
   clic, uniquement si `GOOGLE_PLACES_API_KEY` est définie. CGU Google : `place_id` conservé,
   site et téléphone effacés (et masqués à l'affichage) après 30 jours.
7. **Export CSV** : `/api/acquisition/export?workspace=…` (administrateur uniquement),
   séparateur `;`, BOM UTF-8, formules neutralisées.

## RGPD et limites

- Données d'entreprises issues de sources publiques. Aucun dirigeant, aucun e-mail nominatif,
  aucun scraping. Les entrepreneurs individuels sont signalés (données d'une personne physique).
- Aucun contact n'est pris : l'envoi reste verrouillé par la politique Acquisition existante
  (arrêt d'urgence, approbation humaine, liste d'opposition).
- Les entreprises en diffusion restreinte sont déjà exclues par l'API.

## Mise en service

1. Appliquer `20261107000000_acquisition_foundation.sql`, puis
   `20261203000000_acquisition_prescribers.sql` (manuel, SQL Editor Supabase).
2. Dans `/acquisition`, créer l'espace du client, puis « Trouver les prescripteurs ».
3. Facultatif : `GOOGLE_PLACES_API_KEY` dans Vercel (Production + Preview), clé Google Cloud
   restreinte à « Places API (New) », facturation activée.

## Balayage complet d'une zone (multi-sources)

Formulaire « Balayer toute la zone » dans l'onglet Prescripteurs. Le travail tourne en tâche de
fond (planificateur, étape `acquisition_discovery`, ~50 s par passage toutes les 15 min) ; une
seule recherche active par client, arrêtable à tout moment.

1. **Sirene complet** (`lib/acquisition/zone-scan.ts`) : toutes les entreprises actives du rayon
   via `/near_point`, par section NAF ; une section au-delà de 10 000 résultats (plafond de l'API)
   est redécoupée par code NAF. Un code NAF encore au-delà est marqué « tronqué ». SCI et holdings
   (68.20B, 64.20Z) exclues par défaut, entrepreneurs individuels en option, plafond choisi
   (5 000 à 200 000). Les entreprises en opposition à la prospection restent exclues.
2. **OpenStreetMap** (`osm.ts`, Overpass, licence ODbL) : site, téléphone et e-mail générique
   publiés ; rapprochement par SIRET puis nom + code postal (ambigu = ignoré). Attribution
   « © contributeurs OpenStreetMap » dans l'écran et l'export.
3. **BODACC** (`bodacc.ts`) : annonces de création des 12 derniers mois du département.
4. **Sites web** (`website.ts`, `safe-fetch.ts`) : robots.txt respecté, au plus 3 pages
   (accueil, mentions légales), adresses publiques uniquement (anti-SSRF), 8 s et 600 Ko max.
   Seule une adresse générique (contact@, info@…) du domaine du site est gardée ; le SIREN
   trouvé confirme l'entreprise.

**Cœur de métier** (facultatif) : le balayage peut se limiter à des métiers (liste des segments
prescripteurs), à des grands secteurs (sections NAF) ou à des codes NAF saisis. Les codes déjà
couverts par un secteur choisi ne sont pas interrogés deux fois. Exemple : architectes à 20 km
de Strasbourg ≈ 1 100 entreprises, soit environ 45 requêtes au lieu de plusieurs milliers.

Sources écartées (CGU ou données personnelles) : Google Maps hors API, PagesJaunes, LinkedIn,
Societe.com, Infogreffe. Export : `&category=zone_company`, `&with_email=1`, 10 000 lignes max
par fichier.

Mise en service : appliquer `20261204000000_acquisition_multisource.sql` après
`20261203000000_acquisition_prescribers.sql`. Aucune nouvelle variable d'environnement.
