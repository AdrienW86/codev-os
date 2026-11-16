-- Google Analytics 4 : connexion OAuth (compte Google de l'agence), sur le même modèle que Search Console.
-- Seul changement : les tables de jetons chiffrés et d'états OAuth acceptent aussi le fournisseur 'google-analytics'.
-- Aucune donnée existante n'est modifiée ; les lignes 'search-console' restent valides.
--
-- Modèle (aucune nouvelle table) :
--  * client_connections (existant) : une ligne GLOBALE provider='google-analytics' (client_id null, scope='global')
--    porte l'état de la connexion et la référence opaque du jeton ; les lignes par client portent la propriété GA4
--    associée dans metadata.property (identifiant numérique).
--  * integration_credential_secrets : jeton de rafraîchissement chiffré (domaine de chiffrement 'google-analytics').
--  * integration_oauth_states : états OAuth à usage unique.
--  * metric_snapshots (existant) : instantanés provider 'google-analytics', metric_key 'ga4'.

alter table public.integration_credential_secrets drop constraint if exists integration_credential_secrets_provider_check;
alter table public.integration_credential_secrets add constraint integration_credential_secrets_provider_check check(provider in('search-console','google-analytics'));

alter table public.integration_oauth_states drop constraint if exists integration_oauth_states_provider_check;
alter table public.integration_oauth_states add constraint integration_oauth_states_provider_check check(provider in('search-console','google-analytics'));
