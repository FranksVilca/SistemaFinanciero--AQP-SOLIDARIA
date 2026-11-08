#!/usr/bin/env bash
# Builds the SPA against a deployed stack and publishes it: the files go to the stack's private bucket with the cache
# headers that make a new version visible at once, and the pages that name the files are invalidated in CloudFront.
#
#   bash infra/scripts/publish-frontend.sh             # build, upload, invalidate
#   bash infra/scripts/publish-frontend.sh --dry-run   # build and list what would be uploaded; changes nothing
#
# Needs the AWS CLI, Node, and credentials for the account of the stack (locally: AWS_PROFILE; in CI: the OIDC role).
# Everything it needs to know comes from the outputs of the stack, so nothing is copied by hand.
#
# Optional: STACK_NAME (default aqp-solidaria-academic), AWS_REGION (default us-east-1), and FRONTEND_BUCKET /
# DISTRIBUTION_ID to use instead of the stack outputs (for a stack deployed before those outputs existed).
set -euo pipefail

STACK_NAME="${STACK_NAME:-aqp-solidaria-academic}"
REGION="${AWS_REGION:-us-east-1}"
DRY_RUN=""
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN="--dryrun"; fi

# The value of an output of the stack, or an empty string when the stack has no such output.
output() {
  local value
  value="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text)"
  if [ "$value" = "None" ]; then value=""; fi
  printf '%s' "$value"
}

require() { # name value
  if [ -z "$2" ]; then
    echo "The stack $STACK_NAME has no output '$1'. Deploy the current template first (sam deploy)." >&2
    exit 1
  fi
}

API_ENDPOINT="$(output ApiEndpoint)"
USER_POOL_ID="$(output UserPoolId)"
CLIENT_ID="$(output UserPoolClientId)"
BUCKET="${FRONTEND_BUCKET:-$(output FrontendBucketName)}"
DISTRIBUTION="${DISTRIBUTION_ID:-$(output CloudFrontDistributionId)}"
require ApiEndpoint "$API_ENDPOINT"
require UserPoolId "$USER_POOL_ID"
require UserPoolClientId "$CLIENT_ID"
require FrontendBucketName "$BUCKET"
require CloudFrontDistributionId "$DISTRIBUTION"

echo "Building the frontend for $STACK_NAME ($REGION)"
VITE_API_BASE_URL="$API_ENDPOINT/v1" \
VITE_COGNITO_AUTHORITY="https://cognito-idp.$REGION.amazonaws.com/$USER_POOL_ID" \
VITE_COGNITO_CLIENT_ID="$CLIENT_ID" \
  npm run build --workspace=frontend

# The files have the hash of their content in the name, so they never change: the browser may keep them for a year.
# index.html is the page that names them, so it must be asked for again every time.
echo "Uploading to s3://$BUCKET ${DRY_RUN:+(dry run)}"
aws s3 sync frontend/dist "s3://$BUCKET/" --region "$REGION" --delete --exclude index.html \
  --cache-control "public,max-age=31536000,immutable" $DRY_RUN
aws s3 cp frontend/dist/index.html "s3://$BUCKET/index.html" --region "$REGION" \
  --cache-control "no-cache" $DRY_RUN

if [ -n "$DRY_RUN" ]; then
  echo "Dry run: nothing was uploaded or invalidated."
  exit 0
fi

# CloudFront keeps its own copy of the page, under "/" and under "/index.html".
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths "/" "/index.html" >/dev/null
echo "Published: $(output FrontendUrl)"
