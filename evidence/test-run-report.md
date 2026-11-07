# Reporte de Evidencia de Ejecución de Pruebas (T01 - T14)

**Curso:** Tópicos Avanzados en Ingeniería de Software — EPIS, UNSA  
**Fecha:** 2026-11-08 (reemplaza el reporte del 2026-11-06, que se apoyaba en pruebas con DynamoDB simulado)  
**Framework de pruebas:** Vitest 3.2.7 en Node.js v24  
**Base de datos de las pruebas de integración:** DynamoDB Local (`amazon/dynamodb-local`)

---

## 1. Resumen de ejecución

| Suite | Comando | Archivos | Pruebas | Resultado |
|---|---|---|---|---|
| Unitarias (sin base de datos) | `npm run test` | 4 | 30 | PASS |
| Integración (DynamoDB Local) | `npm run test:integration` | 9 | 39 | PASS |
| Infraestructura (`infra/template.yaml`, etapas `academic` y `production`) | `npm run test:infra` | 8 | 145 | PASS |
| `cfn-lint` sobre `infra/template.yaml` | `cfn-lint` | — | — | PASS (sin hallazgos) |
| `checkov` (omisiones justificadas en `.checkov.yaml`) | `checkov --config-file .checkov.yaml` | — | 38 verificaciones | PASS |
| ESLint (complejidad ≤ 10, función ≤ 50 líneas, sin `any`) | `npm run lint` | — | — | 0 errores; 16 advertencias en el frontend (ver `specs/002-zta-hardening/followups.md`) |
| Prettier | `npm run format:check` | — | — | PASS |

Por qué cambió la suite: las 37 pruebas anteriores simulaban DynamoDB y no detectaron que confirmar una donación devolvía HTTP 500 (expresión de actualización inválida, hallazgo H1). Las pruebas de integración actuales ejecutan los handlers contra una base de datos real y reproducen ese fallo si se reintroduce (ver [ci-negative-checks.md](ci-negative-checks.md)).

---

## 2. Matriz de cobertura y trazabilidad con T01 - T14

| ID | Escenario | Estado | Evidencia |
|---|---|:---:|---|
| **T01** | Visitante consulta proyectos públicos; los borradores quedan excluidos y no se filtra identidad de donantes | **PASS** | `test/integration/projects.test.ts` |
| **T02** | Solicitud protegida sin identidad | **PASS** (401) | `test/integration/authzMatrix.test.ts`, `test/withAuth.test.ts`, `test/authz.test.ts` |
| **T03** | Donante intenta crear proyecto (escalación vertical) | **PASS** (403) | `test/integration/authzMatrix.test.ts`; el rechazo queda auditado en `test/integration/audit.test.ts` |
| **T04** | Monto inválido, clave ausente o no UUID, JSON inválido | **PASS** (400, sin stack) | `test/integration/donationFlow.test.ts` |
| **T05** | Intención de donación válida con `Idempotency-Key` | **PASS** (201, `PENDIENTE_SIMULACION`) | `test/integration/donationFlow.test.ts` |
| **T06** | Reenvío con la misma clave y el mismo cuerpo | **PASS** (misma donación, sin duplicado) | `test/integration/donationFlow.test.ts` |
| **T07** | Misma clave con monto distinto | **PASS** (409) | `test/integration/donationFlow.test.ts` |
| **T08** | 10 confirmaciones concurrentes de la misma donación | **PASS** (1 respuesta 200, 9 respuestas 409, un solo incremento) | `test/integration/idempotencyConcurrency.test.ts` |
| **T09** | Otro donante consulta o simula una donación ajena (BOLA) | **PASS** (403, estado sin cambios) | `test/integration/bola.test.ts` |
| **T10** | Permisos IAM mínimos por función | **Parcial**: la comprobación estática PASA; la denegación real en AWS está **PENDIENTE** | `test/infra/iamMatrix.test.ts`, `test/infra/auditTable.test.ts`; procedimiento en [t10-access-denied.md](t10-access-denied.md) |
| **T11** | ID token o token alterado en lugar de access token | **PENDIENTE** (requiere API Gateway y Cognito reales). La configuración de audiencia y scopes se verifica en `test/infra/mfa.test.ts` | `evidence/` tras el despliegue |
| **T12** | Gestor consulta historial o acciones privadas de un donante | **PASS** (403) | `test/integration/bola.test.ts`, `test/integration/authzMatrix.test.ts` |
| **T13** | Token revocado usado antes de expirar | **Parcial**: la revalidación contra `userInfo` se prueba con un servidor de prueba (sesión revocada, tiempo agotado y servicio inaccesible dan 401); con Cognito real está **PENDIENTE** | `test/integration/sessionCheck.test.ts`; `docs/threat-model.md` |
| **T14** | Usuario sin segundo factor no obtiene tokens | **Parcial**: `MfaConfiguration: ON` con solo TOTP se verifica en el template; el comportamiento del inicio de sesión está **PENDIENTE** en Cognito real | `test/infra/mfa.test.ts` |

---

## 3. Evidencia pendiente de una cuenta de AWS real

No puede producirse con DynamoDB Local ni con un emulador:

1. Rechazo de tokens falsos, vencidos o ID token por el JWT authorizer de API Gateway (T11).
2. Inicio de sesión con segundo factor obligatorio en Cognito (T14) y enrolamiento de TOTP.
3. `AccessDeniedException` por permisos IAM insuficientes (T10).
4. Rechazo de una sesión revocada por el endpoint `userInfo` de Cognito (T13).
5. Que la política de seguridad de contenido (CSP) no bloquee el intercambio de código con el dominio de Cognito.
6. `DeletionProtectionEnabled` y PITR activos en producción.

Cada punto tiene su procedimiento en `specs/002-zta-hardening/quickstart.md`, sección 4.

---

## 4. Motor de políticas

El único motor de políticas activo es el módulo embebido `authz` (`EmbeddedPolicyAuthorizer`). Amazon Verified Permissions con Cedar está planificado como fase 2: las políticas de `policies/` son documentación, no se aplican, y el adaptador y la prueba de equivalencia que existían se retiraron por no estar conectados a ningún flujo.
