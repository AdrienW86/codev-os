-- GA4 natif, lecture seule. Extension additive des coffres OAuth existants.
-- Aucune modification des jetons Search Console déjà chiffrés.
alter table public.integration_credential_secrets
  drop constraint if exists integration_credential_secrets_provider_check;
alter table public.integration_credential_secrets
  add constraint integration_credential_secrets_provider_check
  check (provider in ('search-console', 'google-analytics'));

alter table public.integration_oauth_states
  drop constraint if exists integration_oauth_states_provider_check;
alter table public.integration_oauth_states
  add constraint integration_oauth_states_provider_check
  check (provider in ('search-console', 'google-analytics'));

comment on table public.integration_credential_secrets is
  'Jetons OAuth chiffrés AES-256-GCM : Search Console et Google Analytics (domaines AAD séparés, service role uniquement).';
comment on table public.integration_oauth_states is
  'États OAuth à usage unique pour Search Console et Google Analytics, empreinte SHA-256, acteur et fournisseur vérifiés.';
