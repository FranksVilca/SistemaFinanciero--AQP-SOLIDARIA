#!/usr/bin/env bash
# ==============================================================================
# Pruebas de aceptación Zero Trust T01 - T14 contra un despliegue REAL en AWS.
# Plataforma de Donaciones Seguras — Fundación AQP-SOLIDARIA
#
# Las pruebas automáticas locales (DynamoDB Local y template) cubren la lógica; este script comprueba lo que solo
# AWS real puede mostrar: el JWT authorizer de API Gateway y las respuestas con tokens de Cognito.
#
# Variables: API_URL, DONOR_TOKEN, GESTOR_TOKEN, AUDITOR_TOKEN (access tokens), ID_TOKEN (token de identidad).
# Los tokens se obtienen con el Hosted UI de Cognito después de enrolar el segundo factor (TOTP).
# ==============================================================================

set -uo pipefail

API_URL="${API_URL:?Defina API_URL con la salida ApiEndpoint del stack}"
DONOR_TOKEN="${DONOR_TOKEN:-}"
GESTOR_TOKEN="${GESTOR_TOKEN:-}"
AUDITOR_TOKEN="${AUDITOR_TOKEN:-}"
ID_TOKEN="${ID_TOKEN:-}"
PLACEHOLDER_UUID="11111111-1111-4111-8111-111111111111"

failures=0

# check <id> <description> <expected codes separated by "|"> <actual code>
check() {
  local id="$1" description="$2" expected="$3" actual="$4"
  if [[ "|$expected|" == *"|$actual|"* ]]; then
    echo "  [PASS] $id $description (HTTP $actual)"
  else
    echo "  [FAIL] $id $description: esperado $expected, obtenido $actual"
    failures=$((failures + 1))
  fi
}

status_of() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

skip() { echo "  [SKIP] $1 $2"; }

echo "Pruebas de aceptación T01-T14 contra $API_URL"

echo "[T01] Visitante consulta el catálogo público"
check T01 "catálogo público" "200" "$(status_of "$API_URL/v1/projects")"

echo "[T02] Solicitud protegida sin token (la rechaza el authorizer de API Gateway)"
check T02 "donación sin token" "401" "$(status_of -X POST "$API_URL/v1/donations" \
  -H "Content-Type: application/json" -d "{\"projectId\":\"$PLACEHOLDER_UUID\",\"amountCents\":5000}")"

echo "[T03] Donante intenta crear un proyecto (escalación vertical)"
if [ -n "$DONOR_TOKEN" ]; then
  check T03 "donante crea proyecto" "403" "$(status_of -X POST "$API_URL/v1/projects" \
    -H "Authorization: Bearer $DONOR_TOKEN" -H "Content-Type: application/json" \
    -d '{"title":"Proyecto no autorizado","description":"Intento de un donante","goalAmountCents":500000}')"
else skip T03 "falta DONOR_TOKEN"; fi

echo "[T04] Monto inválido"
if [ -n "$DONOR_TOKEN" ]; then
  check T04 "monto 0" "400" "$(status_of -X POST "$API_URL/v1/donations" \
    -H "Authorization: Bearer $DONOR_TOKEN" -H "Idempotency-Key: $(uuidgen 2>/dev/null || echo "$PLACEHOLDER_UUID")" \
    -H "Content-Type: application/json" -d "{\"projectId\":\"$PLACEHOLDER_UUID\",\"amountCents\":0}")"
else skip T04 "falta DONOR_TOKEN"; fi

echo "[T05-T09] Idempotencia, concurrencia y BOLA"
echo "  Cubiertas por test/integration (donationFlow, idempotencyConcurrency, bola) contra DynamoDB Local."

echo "[T10] Permisos IAM mínimos"
echo "  Comprobación estática: test/infra/iamMatrix.test.ts. La denegación real se documenta en evidence/t10-access-denied.md."

echo "[T11] ID token usado como Bearer"
if [ -n "$ID_TOKEN" ]; then
  check T11 "ID token como credencial" "401|403" "$(status_of -X POST "$API_URL/v1/donations" \
    -H "Authorization: Bearer $ID_TOKEN" -H "Content-Type: application/json" \
    -d "{\"projectId\":\"$PLACEHOLDER_UUID\",\"amountCents\":5000}")"
  check T11 "token alterado" "401" "$(status_of -X GET "$API_URL/v1/donations/me" \
    -H "Authorization: Bearer ${DONOR_TOKEN:-x}tampered")"
else skip T11 "falta ID_TOKEN"; fi

echo "[T12] Gestor consulta el historial de donaciones de un donante"
if [ -n "$GESTOR_TOKEN" ]; then
  check T12 "gestor en /donations/me" "403" "$(status_of -X GET "$API_URL/v1/donations/me" \
    -H "Authorization: Bearer $GESTOR_TOKEN")"
else skip T12 "falta GESTOR_TOKEN"; fi

echo "[T13] Sesión revocada en una acción sensible"
echo "  Procedimiento manual: revocar el refresh token del auditor y llamar GET /v1/audit con el access token aún vigente."
if [ -n "$AUDITOR_TOKEN" ]; then
  echo "  Estado actual del token del auditor: HTTP $(status_of -X GET "$API_URL/v1/audit" -H "Authorization: Bearer $AUDITOR_TOKEN") (200 activo, 401 revocado)"
else skip T13 "falta AUDITOR_TOKEN"; fi

echo "[T14] Inicio de sesión sin segundo factor"
echo "  Procedimiento manual: iniciar sesión en el Hosted UI con un usuario sin TOTP; debe pedir el enrolamiento antes de emitir tokens."
echo "  La configuración (MfaConfiguration ON, solo TOTP) la verifica test/infra/mfa.test.ts."

echo
if [ "$failures" -eq 0 ]; then
  echo "Todas las comprobaciones ejecutadas pasaron."
else
  echo "$failures comprobación(es) fallaron."
  exit 1
fi
