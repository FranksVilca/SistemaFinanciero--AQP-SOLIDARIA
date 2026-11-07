# Reporte de Evidencia de Ejecución de Pruebas (T01 - T14)

**Curso:** Tópicos Avanzados en Ingeniería de Software — EPIS, UNSA  
**Fecha:** 2026-11-08 (reemplaza el reporte del 2026-11-06, que se apoyaba en pruebas con DynamoDB simulado)  
**Framework de pruebas:** Vitest 3.2.7 en Node.js v24  
**Base de datos de las pruebas de integración:** DynamoDB Local (`amazon/dynamodb-local`)

---

## 1. Resumen de ejecución

| Suite | Comando | Archivos | Pruebas | Resultado |
|---|---|---|---|---|
| Unitarias (sin base de datos) | `npm run test` | 4 | 33 | PASS |
| Integración (DynamoDB Local) | `npm run test:integration` | 10 | 40 | PASS |
| Infraestructura (`infra/template.yaml`, etapas `academic` y `production`) | `npm run test:infra` | 10 | 163 | PASS |
| Emulador Floci con IAM activo (políticas IAM del template, Cognito con MFA, despliegue del stack) | `npm run test:floci` | 3 | 60 | PASS |
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
| **T02** | Solicitud protegida sin identidad | **PASS** (401) | `test/integration/authzMatrix.test.ts`, `test/integration/idToken.test.ts`, `test/withAuth.test.ts`, `test/authz.test.ts` |
| **T03** | Donante intenta crear proyecto (escalación vertical) | **PASS** (403) | `test/integration/authzMatrix.test.ts`; el rechazo queda auditado en `test/integration/audit.test.ts` |
| **T04** | Monto inválido, clave ausente o no UUID, JSON inválido | **PASS** (400, sin stack) | `test/integration/donationFlow.test.ts` |
| **T05** | Intención de donación válida con `Idempotency-Key` | **PASS** (201, `PENDIENTE_SIMULACION`) | `test/integration/donationFlow.test.ts` |
| **T06** | Reenvío con la misma clave y el mismo cuerpo | **PASS** (misma donación, sin duplicado) | `test/integration/donationFlow.test.ts` |
| **T07** | Misma clave con monto distinto | **PASS** (409) | `test/integration/donationFlow.test.ts` |
| **T08** | 10 confirmaciones concurrentes de la misma donación | **PASS** (1 respuesta 200, 9 respuestas 409, un solo incremento) | `test/integration/idempotencyConcurrency.test.ts` |
| **T09** | Otro donante consulta o simula una donación ajena (BOLA) | **PASS** (403, estado sin cambios) | `test/integration/bola.test.ts` |
| **T10** | Permisos IAM mínimos por función | **PASS en emulador** (Floci con IAM activo: 8 handlers funcionan con su rol y 36 casos reciben `AccessDeniedException`); confirmación en AWS real **pendiente** | `test/floci/iamEnforcement.test.ts`, `test/infra/iamMatrix.test.ts`, `test/infra/auditTable.test.ts`; ver [t10-access-denied.md](t10-access-denied.md) |
| **T11** | ID token o token alterado en lugar de access token | **PASS en backend**: un ID token da 401 en las 6 rutas protegidas, también el emitido por el Cognito emulado. El rechazo por el JWT authorizer de API Gateway está **pendiente de AWS** | `test/integration/idToken.test.ts`, `test/floci/cognito.test.ts`, `test/withAuth.test.ts` |
| **T12** | Gestor consulta historial o acciones privadas de un donante | **PASS** (403) | `test/integration/bola.test.ts`, `test/integration/authzMatrix.test.ts` |
| **T13** | Token revocado usado antes de expirar | **Parcial**: la revalidación contra `userInfo` se prueba con un servidor de prueba (sesión revocada, tiempo agotado y servicio inaccesible dan 401); con Cognito real está **PENDIENTE** | `test/integration/sessionCheck.test.ts`; `docs/threat-model.md` |
| **T14** | Usuario sin segundo factor no obtiene tokens | **PASS en emulador**: con el pool construido desde el template, un donante, un gestor y un auditor sin segundo factor reciben `MFA_SETUP` y ningún token; solo se ofrece TOTP. El Hosted UI real está **pendiente de AWS** | `test/floci/cognito.test.ts`, `test/infra/mfa.test.ts` |

---

## 3. Evidencia pendiente de una cuenta de AWS real

Floci cubrió IAM aplicado, Cognito con MFA obligatorio y el despliegue del stack (ver los niveles de prueba en [docs/nist-800-207-mapping.md](../docs/nist-800-207-mapping.md)). Lo que ningún emulador puede mostrar:

1. **Rechazo de tokens falsos, vencidos o ID token por el JWT authorizer de API Gateway** (T11). Floci no ejecuta el authorizer; el backend ya rechaza el ID token como segunda capa.
2. **Hosted UI de Cognito y el enrolamiento del segundo factor en el navegador** (T14).
3. **Rechazo de una sesión revocada por el `userInfo` real de Cognito** (T13). Se prueba con un servidor de prueba.
4. **Que la política de seguridad de contenido no bloquee el intercambio de código con el dominio de Cognito.**
5. **`DeletionProtectionEnabled` y PITR en producción:** la etapa `production` no se puede desplegar en Floci (su comprobación estática rechaza las ramas `Fn::If` que genera SAM) y solo se verifica con `test/infra`.
6. **`AccessDenied` real de IAM** (T10): el emulador ya lo demostró; la confirmación en AWS real es opcional.

Cada punto tiene su procedimiento en `specs/002-zta-hardening/quickstart.md`, sección 4. No hay credenciales de AWS válidas en el entorno donde se ejecutó este trabajo.

---

## 4. Motor de políticas

El único motor de políticas activo es el módulo embebido `authz` (`EmbeddedPolicyAuthorizer`). Amazon Verified Permissions con Cedar está planificado como fase 2: las políticas de `policies/` son documentación, no se aplican, y el adaptador y la prueba de equivalencia que existían se retiraron por no estar conectados a ningún flujo.
