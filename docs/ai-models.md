# Modèles IA par agent

Chaque agent du harness appartient à une famille. Le modèle est choisi par famille dans `lib/ai/models.ts`, au
moment de chaque appel.

**Activation client par client** : Claude ne sert que les clients cochés dans la fiche client → Agents → « Modèle des
agents » (table `client_ai_settings`, lue avec un cache d'une minute, `lib/ai/client-routing.ts`). Les autres clients
restent sur OpenAI. `AGENTS_AI_PROVIDER=anthropic` force Claude pour tous les clients.

| Famille | Agents | Modèle (clé Anthropic + client activé) | Réflexion |
|---|---|---|---|
| Rédaction | Publications, Blog, Visuels, Vidéo, Newsletter, Copywriter | Claude Opus 5.5 | high |
| Vision | Photothèque (observation des photos) | Claude Opus 5.5, image 1280 px | high |
| Contrôle | Vérification des faits, relecture éditoriale (lot 4) | Claude Opus 5.5 | max |
| Stratégie | Chef de projet, Rapport, SEO, Google Ads, Monitoring, Prospection, Veille, planification | Claude Opus 5.5 | high |

Sans `ANTHROPIC_API_KEY`, tout reste sur OpenAI (`gpt-4.1-mini-2025-04-14`), comme avant. Un appel non rattaché à
un agent (ancien parcours Publications v1) reste sur OpenAI tant que sa clé existe. La transcription vocale reste sur
OpenAI.

L'assistant serveur (`selectAIProvider`) garde OpenAI d'abord ; les appels faits pour un client activé (analyse
Google Ads, conversation SEO, légende WhatsApp) passent sur Claude via `meteredProvider`. L'assistant de l'interface,
sans client, ne change pas (sauf `AI_PROVIDER=anthropic`).

## Réglages facultatifs (Vercel → Settings → Environment Variables)

- `AGENTS_AI_PROVIDER=openai|anthropic` : force un fournisseur pour tous les agents.
- `AI_MODEL_WRITING`, `AI_MODEL_VISION`, `AI_MODEL_REVIEW`, `AI_MODEL_STRATEGY` : autre modèle Claude pour une famille
  (par exemple `claude-fable-5-2` pour la stratégie : plus fort, mais un appel peut durer plusieurs minutes).
- `AI_EFFORT_<FAMILLE>` : `low`, `medium`, `high`, `xhigh` ou `max`.
- `AI_MODEL_OPENAI` : modèle OpenAI des agents quand Anthropic n'est pas utilisé.

Une valeur invalide est ignorée.

## Détails techniques

- Sorties structurées Claude via `output_config.format` ; les contraintes non prises en charge (longueurs, bornes,
  tailles de tableau) sont retirées du schéma envoyé, chaque appelant validant déjà la sortie.
- Pas de température (refusée par les modèles Claude actuels). Réflexion adaptative toujours active : le plafond de
  sortie est 4 × celui demandé (8 000 à 32 000 jetons).
- Refus de sécurité : repli serveur `fallbacks: "default"` ; un refus final ou une sortie tronquée échoue proprement,
  avec le coût engagé joint à l'erreur.
- Appel d'outil forcé refusé par Opus 5.5 : « auto », un seul appel par tour ; la réflexion est renvoyée telle quelle
  avec l'appel d'outil au tour suivant.
- Coût estimé : tarifs publics (Opus 5.5 : 4 $ / 20 $ par million de jetons) × 1,25 ; modèle inconnu au tarif le plus
  élevé.

## Ordre de mise en service

1. Appliquer la migration `20261208000000_agents_model_routing` (plafond d'une préparation Publications porté de
   0,10 € à 2 €, table `client_ai_settings`). Sans elle, aucun client ne passe sur Claude.
2. Ajouter `ANTHROPIC_API_KEY` dans Vercel (Production), puis redéployer.
3. Fiche client → Agents → « Modèle des agents » : Claude Opus 5.5 pour les clients choisis.
4. Relever les budgets de ces clients : plafond IA du client (Blog, Visuels, Vidéo, Google Ads, SEO ; migration
   `20261206000000_ai_usage_budget` requise), budget mensuel de l'Agent Publications, budget IA de la Photothèque.
