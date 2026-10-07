#!/bin/bash
# SessionStart hook pour les sessions Claude Code Cloud.
# Installe les dépendances (et rien d'autre) pour que dev, lint, typecheck,
# tests et build fonctionnent dès l'ouverture de la session.
# Générique : réutilisable tel quel sur un autre projet Next.js / Node.
# N'affiche, ne lit ni n'écrit aucun secret ; ne touche à aucun service distant.
set -euo pipefail

# Ne s'exécute que dans le cloud ; en local, chacun gère son environnement.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# Vérifie la version de Node exigée par Next.js 16 (engines.node du paquet next).
required="20.9.0"
current="$(node -p 'process.versions.node')"
if [ "$(printf '%s\n%s\n' "$required" "$current" | sort -V | head -n1)" != "$required" ]; then
  echo "Node $current < $required requis par Next.js" >&2
  exit 1
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export NEXT_TELEMETRY_DISABLED=1' >> "$CLAUDE_ENV_FILE"
fi

# Gestionnaire de paquets détecté via le lockfile.
# "install" plutôt que "ci" : le conteneur est mis en cache après le hook.
if [ -f pnpm-lock.yaml ]; then
  corepack enable >/dev/null 2>&1 || true
  pnpm install
elif [ -f yarn.lock ]; then
  corepack enable >/dev/null 2>&1 || true
  yarn install
elif [ -f bun.lockb ] || [ -f bun.lock ]; then
  bun install
else
  npm install --no-audit --no-fund
fi
