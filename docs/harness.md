# Organisation harness des agents

Objectif : CODE-V OS fonctionne comme une agence autonome, chaque agent étant un expert cantonné à sa mission, sous le contrôle d’un chef de projet par client.

## Les briques

| Brique | Fichier | Rôle |
| --- | --- | --- |
| Charte des agents | `lib/harness/charter.ts` | Mission, niveau d’expertise, périmètre, interdits, déclencheurs et lieu des réglages client de chaque agent. Source unique. |
| Cadre de mission | `withCharter()` | Ajouté en tête de chaque appel IA (Publications, Blog, Visuels, Vidéo, Photothèque, Google Ads, SEO) : rester dans sa mission, ne jamais inventer, ne jamais exécuter une action non demandée. |
| Supervision | `lib/agents/coverage.ts` | Un agent actif sans exécution planifiée est signalé (/agents, accueil) ; les planifications manquantes se créent en un clic, rien n’est réactivé sans l’administrateur. |
| Santé de l’équipe | `lib/harness/health.ts` | État réel de chaque agent d’après le dernier passage du planificateur et les derniers jobs. Jamais « opérationnel » sans preuve. |
| Chef de projet | `lib/harness/client-plan.ts` | Par client : agents attendus selon les services souscrits, ce qui travaille, ce qui est à régler, ce qui attend l’administrateur (fiche client → Agents). |

## Équipes

Pilotage (Chef de projet, Rapport) · Contenu (Publications, Blog, Visuels, Vidéo, Photothèque) · Site et SEO (SEO, Monitoring) · Réputation (Avis Google, voir `docs/reviews-agent.md`) · Publicité (Google Ads) · Prospection · Veille.

L’ancien « Agent Automatisation » n’a jamais eu d’exécution : il n’a pas de charte.

## Réparer plutôt que jeter (Agent Publications)

Une phrase (hors accroche) portant une formulation récurrente ou un terme non confirmé est retirée si le texte garde deux phrases et 60 % de sa longueur. Rien n’est ajouté ni reformulé ; sinon le refus habituel s’applique.

## Ajouter un agent

1. Une entrée dans `harnessCharters` (mission, interdits, déclencheur, réglages client).
2. Ses appels IA passent par `withCharter("<id>", instructions)`.
3. S’il dépend d’une exécution planifiée du registre, l’ajouter à `expectedSchedules` (`lib/agents/coverage.ts`).
4. Sa place dans `buildClientPlan` s’il dépend d’un service client.

## Chef d'orchestre : semaine et contrôle quotidien

- **Semaine du client** (`lib/harness/week-plan.ts`, fiche client → Agents) : les 7 prochains jours, jour par jour, à partir des seules échéances enregistrées (diffusions programmées, articles prévus, exécutions planifiées calculées avec leur récurrence). Les agents à cadence (Visuels, Vidéo, Photothèque) sont listés à part, sans date inventée.
- **Réglages par client** (`settingsOf` dans `lib/harness/client-plan.ts`) : chaque agent affiche ses réglages propres au client (créneaux, validation, cadence, rythme, budget IA, planifications). Rien n'est affiché pour un agent désactivé.
- **Contrôle quotidien** (`lib/harness/control.ts` + `control-service.ts`, étape `harness_control` du planificateur) : une fois par jour à partir de 7 h (Paris), pour chaque client ayant un service actif, chaque écart (agent à régler, semaine sans diffusion alors que la diffusion est active, blog sans article sur 14 jours) ouvre un incident interne `source = system`, empreinte `harness:<client>:<code>`. Un écart disparu est résolu automatiquement. Le contrôle n'active, ne publie et ne réactive rien. Bouton « Lancer le contrôle des clients » sur /agents.

## Budget IA par client

- **Passerelle mesurée** (`lib/ai/metered.ts`) : même signature que `structuredResponse`. Les agents Blog, Visuels et Vidéo travaillent dans un périmètre `withAiScope({ agent, clientId })`. Avant chaque appel, la dépense du mois du client est comparée au plafond (avec une marge de 0,02 €) ; au-delà, l'appel n'a pas lieu (`ai_budget_exceeded`). Chaque appel facturé est journalisé dans `ai_usage`.
- **Dépense du mois** : `ai_usage` + Publications (`agent_runs`) + Photothèque (`client_media_ai_month_spend`), en mois civil de Paris. Publications et Photothèque gardent aussi leur propre garde-fou.
- **Plafond** (`client_ai_budgets`, fiche client → Agents) : 5 € par mois par défaut, de 0 à 200 €. 0 coupe l'IA de ces agents pour le client.
- Migration `20261206000000_ai_usage_budget` à appliquer. Sans elle, rien n'est mesuré ni bloqué (comportement d'avant). Si la dépense est illisible, l'appel est refusé.
- **Assistants mesurés** (`meteredProvider`) : l'analyse Google Ads (interactive et rapports), la conversation SEO et la suggestion de légende de la Photothèque passent aussi par le plafond. Les jetons renvoyés par OpenAI ou Anthropic sont journalisés dans `ai_usage`. Le coût est estimé au tarif public du modèle (× 1,25) ; un modèle inconnu est compté au tarif prudent (3 $ / 15 $ par million). Au plafond, Google Ads repasse en analyse déterministe (`ai_budget_exceeded`), SEO répond à partir des règles et la Photothèque ne propose pas de légende. L'assistant du cockpit, sans client, n'est pas compté.

## Point de situation des agents (le Directeur consulte toute l'équipe)

- **Format commun** (`lib/harness/briefing.ts`, pur) : pour chaque agent, son état d'exécution (santé), ses constats datés tirés des données enregistrées, ses manques, la date de sa dernière activité et un drapeau « sans activité récente » (plus de 14 jours sans constat pour un agent planifié). Une lecture qui échoue rend l'agent « illisible », jamais « opérationnel ».
- **Lecteurs** (`lib/harness/briefing-service.ts`) : `briefingReaders` est un `Record<HarnessAgentId, …>` : un agent ajouté à la charte sans lecteur ne compile pas. Lecture seule, aucun agent relancé, aucune API externe.
- **Directeur** : `director_briefing` joint le point de situation de tous les agents (pour un client nommé ou pour l'ensemble) et cite ceux à examiner dans sa réponse.
- **Assistant** : outil `agent_briefing` (agent et client facultatifs) pour consulter un agent ou toute l'équipe.
- **Contrôles indépendants** : chaque verdict de vérification des faits et d'anti-doublon est journalisé (`audit_logs`, action `editorial_review.checked`, sans le texte) pour que leur activité soit visible.
- **Registres** : la charte reste la référence ; `tests/agent-briefing.test.mjs` vérifie que le registre d'exécution (`lib/agents/registry.ts`) et le catalogue de l'écran Agents (`lib/agents/catalog.ts`) n'ont aucun agent sans charte (hors ancien « Automatisation »).

Pour ajouter un agent : en plus des étapes ci-dessus, lui donner un lecteur dans `briefingReaders`.

## Agent Rapport : croisement référencement × contenus

- **Sources ajoutées** (`lib/reports/extras-service.ts`, lecture seule, source illisible = omise) : fenêtre GA4 de 30 jours la plus récente close dans la période, audits Lighthouse (mobile et ordinateur, avec Core Web Vitals réels quand Chrome les fournit), diffusions publiées par réseau avec leur sujet, articles publiés (et leur requête visée), newsletters envoyées.
- **Sections** (`lib/reports/insights.ts`, pur) : « Contenus diffusés par réseau », « Blog et newsletters », « Audience et conversions (Google Analytics 4) », « Qualité du site (Lighthouse) », « Lectures croisées » ; la version client reprend contenus, résultats et lectures croisées.
- **Lectures croisées** : deux mesures enregistrées mises en regard, chacune avec sa période (posts sociaux × visites venues des réseaux, posts Google Business × visites Google Maps, article × visites en page d'entrée et requête visée, Google Ads × trafic payant/naturel GA4, clics Search Console × conversions naturelles, vitesse mobile × engagement). Jamais présentées comme une cause.
- **Priorités** : baisse de visites ≥ 20 % (GA4), trafic sans conversion suivie, Lighthouse mobile performance < 50 ou SEO < 80 ; une même priorité client n'est affichée qu'une fois.
- Manque connu : statistiques des posts (portée, interactions) et de la fiche Google Business, non récupérées à ce jour.

## Publications découpées : Rédacteur, Photo, Contrôle et diffusion

Le pipeline qui fonctionne est conservé (préparation par lot un mois à l'avance, photothèque, validation, diffusion). Trois agents se partagent désormais les rôles :

- **Agent Rédacteur Publications** (`publications`, étape `publication_preparation`) : idée, textes natifs par réseau, choix d'une photo réelle de la photothèque. Il ne génère aucune image et ne publie rien.
- **Agent Photo** (`publication-photo`, étape `publication_photo`, `lib/publications/photo-agent/service.ts`) : pour une préparation terminée restée sans photo réelle (aucune trouvée, ou reprise média abandonnée après 3 essais), depuis au moins 30 min, il rédige la description d'une image d'illustration (le sujet, jamais une réalisation du client ; ni texte, ni logo, ni visage) puis la génère (`AI_IMAGE_MODEL`, défaut `gpt-image-1`, coût compté dans le budget IA du client). Au plus 2 images par passage, une proposition en attente par préparation, 3 propositions au plus. L'image reste dans un stockage privé jusqu'à la décision de l'administrateur sur **Publications → Images à valider** (`/publications/images`) : valider l'image seulement (publication « À valider »), valider l'image et la publication, ou refuser. Aucune image générée n'est attachée sans cette décision (contrainte en base : décideur `user_…` obligatoire). L'image attachée porte la provenance « générée par IA ».
- **Brief visuel par client** (`lib/visual-brief/model.ts`, lu par `clientVisualBrief` dans `lib/visual-agent/service.ts`) : métier détecté (couverture, nuisibles, peinture, beauté, numérique…) avec sa direction artistique (sujets, détails matériels, ambiance, interdits, angles d'accroche), ambiance régionale déduite de la zone du client, charte (couleurs, logo), consignes de communication et description factuelle des vraies photos de la photothèque (le style à imiter). Partagé par l'Agent Photo (consigne d'image + suffixe de style, format portrait 1024 × 1536, qualité `AI_IMAGE_QUALITY`, défaut `high`, ~0,25 € l'image) et l'Agent Visuels (accroche selon l'angle du jour, accroches génériques « Attirez… », « Boostez… » refusées).
- **Auto-contrôle des visuels** : l'Agent Photo relit chaque image générée (vision : défauts d'IA, texte, logo, visage, cohérence avec le métier et la région) ; sous 70/100 il régénère une fois avec les défauts cités, puis abandonne (proposition « skipped » motivée). L'Agent Visuels pose une vraie photo de la photothèque en fond quand une photo de bonne qualité, sans visage, correspond à la prestation, puis relit le rendu (lisibilité, hiérarchie, photo cohérente) ; refusé, il refait une mise en page, puis n'envoie rien au Drive. Contrôle impossible (IA indisponible) : comportement d'avant.
