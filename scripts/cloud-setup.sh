#!/usr/bin/env bash
# Préparation d'une session Claude Code Cloud pour codev-os.
# Idempotent, sans secret, sans accès à une base distante ni à la production.
set -euo pipefail

cd "$(dirname "$0")/.."

NODE_MAJOR_EXPECTED="$(cut -d. -f1 < .nvmrc)"
NODE_MAJOR_ACTUAL="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR_ACTUAL" != "$NODE_MAJOR_EXPECTED" ]; then
  echo "Avertissement : Node $NODE_MAJOR_EXPECTED attendu (.nvmrc), Node $NODE_MAJOR_ACTUAL détecté." >&2
fi

# Installation reproductible depuis package-lock.json (npm est le gestionnaire du projet).
npm ci --no-audit --no-fund

echo "Environnement prêt. Commandes : npm run lint | npm run typecheck | npm run build | npm run dev"
