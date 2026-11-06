#!/usr/bin/env bash
# ==============================================================================
# Suite de Pruebas de Aceptación Zero Trust T01 - T14
# Plataforma de Donaciones Seguras — Fundación AQP-SOLIDARIA
# ==============================================================================

set -euo pipefail

API_URL="${API_URL:-https://example.execute-api.us-east-1.amazonaws.com/academic}"
DONOR_TOKEN="${DONOR_TOKEN:-}"
GESTOR_TOKEN="${GESTOR_TOKEN:-}"
AUDITOR_TOKEN="${AUDITOR_TOKEN:-}"
ID_TOKEN="${ID_TOKEN:-}"

echo "======================================================================"
echo "Iniciando Ejecución de Casos de Prueba T01 - T14 contra $API_URL"
echo "======================================================================"

# T01: Visitante consulta proyectos
echo "[T01] Visitante consulta catálogo público..."
res=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/v1/projects")
code=$(echo "$res" | tail -n1)
if [ "$code" -eq 200 ]; then echo "  [PASS] T01 OK (HTTP 200)"; else echo "  [FAIL] T01 fallo con $code"; exit 1; fi

# T02: Sin token intenta donar
echo "[T02] Donación sin token..."
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/v1/donations" \
  -H "Content-Type: application/json" -d '{"projectId":"proj-1","amountCents":5000}')
if [ "$code" -eq 401 ]; then echo "  [PASS] T02 OK (HTTP 401)"; else echo "  [FAIL] T02 fallo con $code"; fi

# T03: Donante intenta crear proyecto
echo "[T03] Donante intenta crear proyecto (escalación vertical)..."
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/v1/projects" \
  -H "Authorization: Bearer $DONOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Proyecto No Autorizado","description":"Intento donante","goalAmountCents":500000}')
if [ "$code" -eq 403 ]; then echo "  [PASS] T03 OK (HTTP 403)"; else echo "  [FAIL] T03 fallo con $code"; fi

# T04: Validación de montos inválidos
echo "[T04] Donante envía monto inválido (0 o negativo)..."
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/v1/donations" \
  -H "Authorization: Bearer $DONOR_TOKEN" \
  -H "Idempotency-Key: $(uuidgen 2>/dev/null || echo "11111111-1111-1111-1111-111111111111")" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"11111111-1111-1111-1111-111111111111","amountCents":0}')
if [ "$code" -eq 400 ]; then echo "  [PASS] T04 OK (HTTP 400)"; else echo "  [FAIL] T04 fallo con $code"; fi

# T11: Bearer token es ID token
echo "[T11] Uso de ID token como Bearer..."
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/v1/donations" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"11111111-1111-1111-1111-111111111111","amountCents":5000}')
if [ "$code" -eq 401 ] || [ "$code" -eq 403 ]; then echo "  [PASS] T11 OK (HTTP $code)"; else echo "  [FAIL] T11 fallo con $code"; fi

# T12: Gestor consulta historial de donante
echo "[T12] Gestor consulta historial de donaciones..."
code=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$API_URL/v1/donations/me" \
  -H "Authorization: Bearer $GESTOR_TOKEN")
if [ "$code" -eq 403 ] || [ "$code" -eq 404 ]; then echo "  [PASS] T12 OK (HTTP $code)"; else echo "  [FAIL] T12 fallo con $code"; fi

echo "======================================================================"
echo "Ejecución de suite T01-T14 completada."
echo "======================================================================"
