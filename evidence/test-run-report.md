# Reporte de Evidencia de Ejecución de Pruebas (T01 - T14)

**Curso:** Tópicos Avanzados en Ingeniería de Software — EPIS, UNSA  
**Fecha de ejecución:** 2026-11-06 (ejecución local, rama `fix/zero-trust-audit`)  
**Entorno:** Vitest 3.2.7, Node.js v26.11.1 (local; CI usa Node.js 24), Docker con `amazon/dynamodb-local`  
**Resultado global:** unitarias 117/117 backend + 15/15 frontend; integración 6/6 contra DynamoDB Local.

Este reporte solo declara como ejecutado lo que aparece en las salidas de la sección 1. Las pruebas que requieren la cuenta AWS desplegada (API Gateway, Cognito, IAM real) figuran como **pendiente de evidencia en despliegue**.

---

## 1. Salidas reales de ejecución

### 1.1 Suite unitaria (`npm test`)

DynamoDB se reemplaza por mocks; las pruebas de plantilla analizan `infra/template.yaml` de forma estática.

```text
 RUN  v3.2.7 <repo>/backend
 ✓ test/authz.test.ts (13 tests) 15ms
 ✓ test/bola.test.ts (2 tests) 14ms
 ✓ test/audit.test.ts (4 tests) 21ms
 ✓ test/donationState.test.ts (4 tests) 22ms
 ✓ test/projects.test.ts (4 tests) 19ms
 ✓ test/concurrency.test.ts (1 test) 22ms
 ✓ test/ownership.test.ts (6 tests) 29ms
 ✓ test/idempotency.test.ts (3 tests) 22ms
 ✓ test/mfa.test.ts (26 tests) 27ms
 ✓ test/projectManagement.test.ts (6 tests) 33ms
 ✓ test/leastPrivilege.test.ts (25 tests) 48ms
 ✓ test/donationValidation.test.ts (4 tests) 8ms
 ✓ test/response.test.ts (10 tests) 5ms
 ✓ test/cedarEquivalence.test.ts (4 tests) 3ms
 ✓ test/tokenRevocation.test.ts (5 tests) 5ms
 Test Files  15 passed (15)
      Tests  117 passed (117)

 RUN  v3.2.7 <repo>/frontend
 ✓ test/logoutChain.test.ts (15 tests) 8ms
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

### 1.2 Suite de integración (`npm run test:integration`)

Handlers reales contra DynamoDB Local; las tablas se crean con los mismos `KeySchema`, `AttributeDefinitions` y GSI declarados en `infra/template.yaml`.

```bash
npm run dynamodb:local
DYNAMODB_ENDPOINT=http://localhost:8000 npm run test:integration
npm run dynamodb:local:stop
```

```text
 RUN  v3.2.7 <repo>/backend
[integration] DynamoDB Local at http://localhost:8000: created aqp-it-projects, aqp-it-donations, aqp-it-idempotency, aqp-it-audit
 ✓ test/integration/ownership.integration.test.ts (2 tests) 77ms
[T08] status codes: {"200":1,"409":9}
 ✓ test/integration/concurrency.integration.test.ts (2 tests) 149ms
[T06] status codes: {"201":5}
 ✓ test/integration/idempotency.integration.test.ts (2 tests) 116ms
 Test Files  3 passed (3)
      Tests  6 passed (6)
```

Sin `DYNAMODB_ENDPOINT` la suite se omite y lo indica: `[integration] DYNAMODB_ENDPOINT is not set: skipping DynamoDB Local integration tests.` En CI (`.github/workflows/ci.yml`) el job `validate` levanta `amazon/dynamodb-local` como contenedor de servicio y ejecuta este mismo comando.

---

## 2. Matriz T01 - T14

Tipos de evidencia: **Unitaria** (handler o función con DynamoDB simulado), **Integración** (handler real contra DynamoDB Local), **IaC estática** (análisis de `infra/template.yaml`), **Pendiente despliegue** (requiere la pila desplegada en AWS; no ejecutada).

| ID | Escenario | Evidencia automatizada | Pendiente de despliegue |
|---|---|---|---|
| **T01** | Visitante consulta proyectos (200, sin borradores) | Unitaria: `backend/test/projects.test.ts` (handler `listProjects` devuelve solo `PUBLICADO`) | Llamada real `GET /v1/projects` sin token |
| **T02** | Sin token intenta donar (401) | Unitaria: `backend/test/authz.test.ts` (`enforceAuthz` sin principal → 401) | 401 emitido por el JWT Authorizer de API Gateway |
| **T03** | Donante intenta crear proyecto (403) | Unitaria: `backend/test/projectManagement.test.ts`, `authz.test.ts`, `cedarEquivalence.test.ts` | Llamada real con token `DONANTE` (además, la ruta exige el authorizer de staff) |
| **T04** | Monto 0, 100001 o no entero (400) | Unitaria: `backend/test/donationValidation.test.ts` (esquema Zod) | — |
| **T05** | Intención válida (201, pendiente, sin cargo) | Unitaria: `backend/test/idempotency.test.ts` | — |
| **T06** | Misma clave y payload (una sola donación) | Unitaria: `idempotency.test.ts`. **Integración**: `backend/test/integration/idempotency.integration.test.ts` (5 solicitudes concurrentes con la misma clave → 5 × 201 con el mismo `donationId`, 1 donación almacenada) | — |
| **T07** | Misma clave, payload distinto (409) | Unitaria: `idempotency.test.ts`. **Integración**: `idempotency.integration.test.ts` (409 y sin donación nueva) | — |
| **T08** | 10 confirmaciones concurrentes (un solo incremento) | **Integración**: `backend/test/integration/concurrency.integration.test.ts` (1 × 200, 9 × 409, `confirmedAmountCents` incrementado una sola vez, estado `CONFIRMADA_SIMULADA`; variante con las 10 lecturas forzadas a `PENDIENTE` para que solo la condición de `TransactWriteItems` decida). La prueba unitaria `concurrency.test.ts` solo valida el mapeo a 409, porque el mock decide el ganador | — |
| **T09** | Donante consulta o simula donación ajena (403/404 sin filtración) | Unitaria de handler: `backend/test/ownership.test.ts` (`simulateDonation` ajeno → 403, cuerpo solo `code`/`message`/`requestId`, sin escritura; `getMyDonations` consulta con el `sub` del token e ignora `sub`/`donorSub` enviados por el cliente). **Integración**: `ownership.integration.test.ts`. Política: `authz.test.ts`, `cedarEquivalence.test.ts`. No existe handler de consulta de una donación individual | — |
| **T10** | Lambda de listado intenta escribir (`AccessDenied`) | IaC estática: `backend/test/leastPrivilege.test.ts` (las funciones de solo lectura no tienen acciones de escritura ni `*CrudPolicy`; cada llamada DynamoDB del código está cubierta por la política de su función) | `AccessDenied` real: ver sección 3 |
| **T11** | ID token o token alterado como Bearer (401) | Unitaria parcial: `authz.test.ts` (evento sin claims del authorizer no produce principal) | Rechazo real de ID token y token alterado por el JWT Authorizer (validación de firma y scopes) |
| **T12** | Gestor consulta historial de donante (403/404) | Unitaria: `backend/test/bola.test.ts`, `authz.test.ts`, `cedarEquivalence.test.ts`. IaC estática: `mfa.test.ts` (la ruta usa el authorizer de donantes) | Llamada real con token de staff |
| **T13** | Token revocado usado antes de expirar (aceptado hasta expirar; rechazado después) | IaC estática: `backend/test/tokenRevocation.test.ts` (access e ID token ≤ 15 min en ambos clientes, `EnableTokenRevocation: true`). **No** se automatiza un rechazo antes de `exp`: el JWT Authorizer no consulta revocación (limitación documentada) | Procedimiento en `docs/threat-model.md`, sección 4 |
| **T14** | GESTOR sin segundo factor no obtiene tokens | IaC estática: `backend/test/mfa.test.ts` (`StaffUserPool` con `MfaConfiguration: ON` y solo TOTP; `GESTOR`/`AUDITOR` en ese pool; rutas con `StaffJwtAuthorizer`) | Inicio de sesión real sin TOTP |

---

## 3. T10: verificación de `AccessDenied` tras el despliegue (pendiente)

La prueba estática no sustituye la evaluación de IAM. Tras `sam deploy` (pila `aqp-solidaria-academic`), simular el rol real de `ListProjectsFunction`:

```bash
STACK=aqp-solidaria-academic
FN=$(aws cloudformation describe-stack-resource --stack-name "$STACK" \
  --logical-resource-id ListProjectsFunction \
  --query StackResourceDetail.PhysicalResourceId --output text)
ROLE_ARN=$(aws lambda get-function-configuration --function-name "$FN" --query Role --output text)
TABLE_ARN=$(aws dynamodb describe-table --table-name aqp-projects-academic --query Table.TableArn --output text)

aws iam simulate-principal-policy \
  --policy-source-arn "$ROLE_ARN" \
  --action-names dynamodb:PutItem dynamodb:UpdateItem dynamodb:DeleteItem dynamodb:BatchWriteItem dynamodb:GetItem dynamodb:Query \
  --resource-arns "$TABLE_ARN" \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output table
```

Resultado esperado: `implicitDeny` para `PutItem`, `UpdateItem`, `DeleteItem` y `BatchWriteItem`; `allowed` para `GetItem` y `Query`. Repetir con `GetProjectFunction`, `GetProjectStatsFunction`, `GetMyDonationsFunction` (tabla `aqp-donations-academic`) y `GetAuditEventsFunction` (tabla `aqp-audit-academic`).

---

## 4. Equivalencia Cedar / Amazon Verified Permissions (HU-12)

`backend/test/cedarEquivalence.test.ts` compara el evaluador embebido (`EmbeddedPolicyAuthorizer`) con el adaptador Cedar (`VerifiedPermissionsAuthorizer`) usando un cliente simulado: ambos deniegan T03, T09 y T12 y permiten las operaciones legítimas. La evaluación contra un Policy Store real de Verified Permissions requiere despliegue.
