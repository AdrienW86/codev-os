-- E2E UNIQUEMENT : base locale jetable codev_e2e. Jamais appliqué à un projet distant.
insert into public.clients (id, name, company_name, activity, email, website) values
  ('11111111-1111-4111-8111-111111111111', 'Jrenov', 'Jrenov SAS', 'Rénovation', 'contact@jrenov.example', 'https://jrenov.example'),
  ('22222222-2222-4222-8222-222222222222', 'Boulangerie Martin', 'Martin & Fils', 'Boulangerie', 'bonjour@boulangerie-martin.example', 'https://boulangerie-martin.example');

insert into public.client_services (client_id, service_type, status, service_key, lifecycle) values
  ('11111111-1111-4111-8111-111111111111', 'Maintenance', 'active', 'maintenance', 'active'),
  ('11111111-1111-4111-8111-111111111111', 'SEO', 'active', 'seo', 'to_configure'),
  ('22222222-2222-4222-8222-222222222222', 'Site web', 'active', 'website', 'active');

-- Agent Rapport rattaché à tous les clients (comme le fait ensureGlobalAgents) ; Monitoring activé pour le parcours incident.
insert into public.agent_client_assignments (agent_id, client_id, enabled, source)
  select a.id, c.id, true, 'global' from public.agents a cross join public.clients c where a.agent_type = 'report'
  on conflict do nothing;
update public.agents set enabled = true, status = 'Actif' where agent_type = 'monitoring';
-- Équivalent de l'activation des services Maintenance (Jrenov) et Site web (Boulangerie Martin).
insert into public.agent_client_assignments (agent_id, client_id, enabled, source, service_key)
  select a.id, v.client_id, true, 'service', v.service_key from public.agents a
  cross join (values ('11111111-1111-4111-8111-111111111111'::uuid, 'maintenance'), ('22222222-2222-4222-8222-222222222222'::uuid, 'website')) as v(client_id, service_key)
  where a.agent_type = 'monitoring'
  on conflict do nothing;

insert into public.tasks (client_id, title, status, priority, due_date, assignee_type) values
  ('11111111-1111-4111-8111-111111111111', 'Relancer le devis cuisine', 'À faire', 'Haute', current_date - 2, 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'Mettre à jour les horaires de Noël', 'En cours', 'Moyenne', current_date, 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'Photos de la nouvelle vitrine', 'Terminé', 'Basse', current_date - 5, 'admin');
