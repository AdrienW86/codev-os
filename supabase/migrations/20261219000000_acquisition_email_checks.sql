-- Prospection e-mail, PR 2 : vérification des adresses avant envoi (syntaxe, domaine jetable, faute de frappe, MX).
-- Additif et idempotent. Résultat conservé sur la fiche ; une adresse n'est envoyée que vérifiée il y a moins de 30 jours.

alter table public.acquisition_prospects
  add column if not exists email_check_status text
    check (email_check_status is null or email_check_status in ('valid','invalid_syntax','disposable','typo','no_mx','unknown')),
  add column if not exists email_check_detail text check (email_check_detail is null or char_length(email_check_detail) <= 200),
  add column if not exists email_checked_at timestamptz;

notify pgrst, 'reload schema';
