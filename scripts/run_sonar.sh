#!/usr/bin/env bash
set -e

if [[ -z "${SONAR_TOKEN_POC_AGENT4_TS}" ]]; then
  echo "ERROR: SONAR_TOKEN_POC_AGENT4_TS is not set. Add it to your shell profile." >&2
  exit 1
fi

echo "→ Running tests with coverage..."
npm test -- --coverage

echo "→ Running SonarQube analysis..."
npx sonar-scanner \
  -Dsonar.token="${SONAR_TOKEN_POC_AGENT4_TS}"

echo "→ Done. Open http://localhost:9000/dashboard?id=poc-agent4-replit-ts"
