#!/usr/bin/env bash
# Local API: Lambdas via `sam local start-api` backed by DynamoDB Local on a shared Docker network.
# The HTTP API JWT authorizers are not emulated by SAM locally, so only public routes
# (GET /v1/projects...) work here; protected routes need the deployed Cognito + API Gateway.
set -euo pipefail

NETWORK="aqp-dev"
CONTAINER="aqp-dynamodb-local"
# Keep in sync with .github/workflows/ci.yml and the dynamodb:local script in package.json.
IMAGE="amazon/dynamodb-local@sha256:6ada631ec7aa5fc83446855eb17233e3dad184fec47477e8140c6c569cfe0c86"
ENV_FILE=".aws-sam/dev-env.json"
PORT="${PORT:-3100}"

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
# -sharedDb: one database regardless of the credentials SAM injects into each Lambda container.
docker run --rm -d --name "$CONTAINER" --network "$NETWORK" -p 8000:8000 "$IMAGE" \
  -jar DynamoDBLocal.jar -inMemory -sharedDb >/dev/null

npm run build --workspace=backend
npx --workspace=backend tsx scripts/devLocal.ts \
  "http://localhost:8000" "http://$CONTAINER:8000" "$PWD/$ENV_FILE"

sam build -t infra/template.yaml
sam local start-api -t .aws-sam/build/template.yaml \
  --docker-network "$NETWORK" --env-vars "$ENV_FILE" --port "$PORT" --warm-containers LAZY
