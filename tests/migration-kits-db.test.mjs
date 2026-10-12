// Kits d'application manuelle (docs/migration-prNN) — base PostgreSQL locale jetable uniquement, jamais la production.
// Rejoue scripts/migration-kit.mjs --check (application LF et CRLF, inscription, refus des doublons) et vérifie que les
// scripts versionnés sont exactement ceux générés depuis les migrations officielles.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync,readdirSync,existsSync} from "node:fs";
import {test} from "node:test";

const url = process.env.MIGRATION_KIT_DATABASE_URL;
const kits = readdirSync(new URL("../docs/", import.meta.url)).filter((d) => /^migration-pr\d+$/.test(d) && existsSync(new URL(`../docs/${d}/kit.json`, import.meta.url)));
const files = (d) => ["apply_sql_editor.sql", "sync_migration_history.sql", "verify.sql"].map((f) => readFileSync(new URL(`../docs/${d}/${f}`, import.meta.url), "utf8"));

test("migration kits are reproducible and pass LF/CRLF application, history sync and duplicate refusal", {skip: !url ? "MIGRATION_KIT_DATABASE_URL absent: local SQL replay not executed." : false}, () => {
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "loopback only");
  const before = Object.fromEntries(kits.map((d) => [d, files(d)]));
  const r = spawnSync(process.execPath, ["scripts/migration-kit.mjs", "--check"], {cwd: new URL("..", import.meta.url), env: process.env, encoding: "utf8"});
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const d of kits) assert.deepEqual(files(d), before[d], `${d} : scripts versionnés différents de la génération`);
  assert.equal((r.stdout.match(/LF et CRLF appliqués, inscrits, doublons refusés/g) ?? []).length, kits.length);
});

test("migration kits embed the official migration byte for byte", () => {
  for (const d of kits) {
    const kit = JSON.parse(readFileSync(new URL(`../docs/${d}/kit.json`, import.meta.url), "utf8"));
    const migration = readFileSync(new URL(`../supabase/migrations/${kit.file}`, import.meta.url), "utf8");
    const [apply, sync] = files(d);
    assert.ok(/-- 2\. Migration du dépôt, octet pour octet -+\n/.test(apply) && apply.split(/-- 2\. Migration du dépôt, octet pour octet -+\n/)[1].startsWith(migration), `${d} : migration recopiée à l'identique`);
    const b64 = sync.match(/decode\('\n([\s\S]*?)\n', 'base64'\)/)[1].replace(/\n/g, "");
    assert.equal(Buffer.from(b64, "base64").toString("utf8"), migration, `${d} : texte d'historique = fichier officiel`);
    assert.doesNotMatch(apply + sync, /PUBLICATIONS_SCHEDULED_DELIVERY|emergency_stop\s*=\s*false|update public\.publication_settings/);
  }
});
