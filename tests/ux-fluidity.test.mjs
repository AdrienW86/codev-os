// Fluidité : agents en lignes repliables chargées en flux, cache de navigation court, file « À traiter » enrichie.
import test from "node:test";
import assert from "node:assert/strict";
import { src } from "./helpers/ts-load.mjs";

test("client page: content agents shown as compact rows (state and rhythm), detail on tap, streamed with Suspense", () => {
  const page = src("app/(cockpit)/clients/[id]/page.tsx");
  for (const title of ["Agent Visuels", "Agent Vidéo", "Agent Blog"])
    assert.match(page, new RegExp(`<Suspense fallback=\\{<AgentRowPending title="${title}" />\\}>`), title);
  assert.match(page, /<details className="group py-1" data-agent-row=\{title\}>/);
  assert.match(page, /data-agents-panel="true"/);
});

test("navigation: visited dynamic pages reused for 30 s; server actions still invalidate", () => {
  assert.match(src("next.config.ts"), /experimental: \{ staleTimes: \{ dynamic: 30 \} \}/);
});

test("à traiter: upcoming blog articles listed with a link to review or cancel; errors offer Réessayer / Vérifier inline", () => {
  const page = src("app/(cockpit)/publications/supervision/page.tsx");
  assert.match(page, /upcomingBlogArticles\(\)/); assert.match(page, /data-blog-upcoming="true"/); assert.match(page, /href=\{`\/blog\/\$\{a\.id\}`\}/);
  assert.match(page, /<ProblemActions publicationId=\{p\.id\} deliveryId=\{p\.errorDelivery\.id\}/);
  const upcoming = src("lib/blog-agent/upcoming.ts");
  assert.match(upcoming, /\.eq\('status','scheduled'\)/); assert.match(upcoming, /catch\{return \[\];\}/, "never breaks the supervision page");
  assert.match(src("lib/publications/review-cards.ts"), /&&!p\.archived_at&&/);
});
