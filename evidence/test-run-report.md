# Reporte de Evidencia de Ejecución de Pruebas (T01 - T14)

**Curso:** Tópicos Avanzados en Ingeniería de Software — EPIS, UNSA  
**Fecha:** 2026-11-09 (reemplaza el reporte del 2026-11-06, que se apoyaba en pruebas con DynamoDB simulado)  
**Framework de pruebas:** Vitest 3.2.7 en Node.js v24  
**Base de datos de las pruebas de integración:** DynamoDB Local (`amazon/dynamodb-local`)

---

## 1. Resumen de ejecución

| Suite | Comando | Archivos | Pruebas | Resultado |
|---|---|---|---|---|
| Unitarias (sin base de datos) | `npm run test` | 8 | 62 | PASS |
| Integración (DynamoDB Local) | `npm run test:integration` | 12 | 62 | PASS |
| Infraestructura (`infra/template.yaml`, etapas `academic` y `production`) | `npm run test:infra` | 16 | 226 | PASS |
| Emulador Floci con IAM y TLS activos, sin socket de Docker (políticas IAM del template, Cognito con MFA, autorizador JWT de API Gateway, revocación del refresh token, despliegue del stack) | `npm run test:floci` | 7 | 101 | PASS |
| **Extremo a extremo** en Floci con el socket de Docker (gateway, autorizador con scopes, Lambdas reales con su rol IAM, DynamoDB, auditoría, revocación de sesión) | `npm run test:floci:e2e` | 1 | 13 | PASS |
| **Navegador real** (Edge o Chrome con Playwright) contra todo el sistema en Floci, una vez sobre el build con la CSP del template y otra sobre el servidor de desarrollo de Vite: login PKCE, tokens fuera del almacenamiento web, donación y aprobación, cierre de sesión con revocación y fin de la sesión del Hosted UI (otra cuenta puede entrar después), roles, auditoría de una donación denegada, CORS, CSP, aviso con certificado no confiable | `npm run test:browser` | 1 | 34 | PASS |
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
| **T02** | Solicitud protegida sin token o sin identidad | **PASS** (401). Camino completo con las Lambdas reales: las rutas protegidas responden 401 sin token. Además, en el **autorizador JWT de API Gateway emulado**: 401 con un token falso, con el payload alterado después de firmarlo, con un token de otro pool de usuarios y con un token **vencido**. En el backend (`withAuth`), 401 sin identidad | `test/floci/e2e/fullStack.test.ts`, `test/floci/apiAuthorizer.test.ts`, `test/integration/authzMatrix.test.ts`, `test/integration/idToken.test.ts`, `test/withAuth.test.ts` |
| **T03** | Donante intenta crear proyecto (escalación vertical) | **PASS** (403) | `test/integration/authzMatrix.test.ts`; el rechazo queda auditado en `test/integration/audit.test.ts` |
| **T04** | Monto inválido, clave ausente o no UUID, JSON inválido | **PASS** (400, sin stack) | `test/integration/donationFlow.test.ts` |
| **T05** | Intención de donación válida con `Idempotency-Key` | **PASS** (201, `PENDIENTE_SIMULACION`) | `test/integration/donationFlow.test.ts` |
| **T06** | Reenvío con la misma clave y el mismo cuerpo | **PASS** (misma donación, sin duplicado) | `test/integration/donationFlow.test.ts` |
| **T07** | Misma clave con monto distinto | **PASS** (409) | `test/integration/donationFlow.test.ts` |
| **T08** | 10 confirmaciones concurrentes de la misma donación | **PASS** (1 respuesta 200, 9 respuestas 409, un solo incremento) | `test/integration/idempotencyConcurrency.test.ts` |
| **T09** | Otro donante consulta o simula una donación ajena (BOLA) | **PASS** (403, estado sin cambios) | `test/integration/bola.test.ts` |
| **T10** | Permisos IAM mínimos por función | **PASS en emulador** (Floci con IAM activo: 8 handlers funcionan con su rol y 36 casos reciben `AccessDeniedException`); confirmación en AWS real **pendiente** | `test/floci/iamEnforcement.test.ts`, `test/infra/iamMatrix.test.ts`, `test/infra/auditTable.test.ts`; ver [t10-access-denied.md](t10-access-denied.md) |
| **T11** | ID token o token alterado en lugar de access token | **PASS en las dos capas.** Gateway emulado (con los scopes del template aplicados): el ID token y un token sin el scope de la ruta reciben 403, un token con los scopes del SPA es aceptado, y los alterados, de otro pool o vencidos reciben 401. Backend, con las Lambdas reales: un ID token que el gateway deja pasar recibe 401 de `withAuth` | `test/floci/apiAuthorizer.test.ts`, `test/floci/e2e/fullStack.test.ts`, `test/integration/idToken.test.ts`, `test/floci/cognito.test.ts` |
| **T12** | Gestor consulta historial o acciones privadas de un donante | **PASS** (403) | `test/integration/bola.test.ts`, `test/integration/authzMatrix.test.ts` |
| **T13** | Token revocado usado antes de expirar | **PASS en emulador**: de extremo a extremo, tras `AdminUserGlobalSignOut` el auditor recibe 401 en una acción sensible con su token aún vigente, y tras revocar el refresh token el refresh da `invalid_grant` y el access token deja de valer. Con un servidor de prueba, un servicio inaccesible o lento también da 401 | `test/floci/e2e/fullStack.test.ts`, `test/floci/refreshRevocation.test.ts`, `test/integration/sessionCheck.test.ts` |
| **T14** | Usuario sin segundo factor no obtiene tokens | **PASS en emulador**: con el pool construido desde el template, un donante, un gestor y un auditor sin segundo factor reciben `MFA_SETUP` y ningún token; solo se ofrece TOTP. El Hosted UI real está **pendiente de AWS** | `test/floci/cognito.test.ts`, `test/infra/mfa.test.ts` |

---

## 3. Evidencia pendiente de una cuenta de AWS real

Con el emulador (Floci con IAM, TLS y el socket de Docker) se demostró casi todo el camino sin cuenta de AWS: IAM aplicado, Cognito con MFA obligatorio, el autorizador JWT con scopes y token vencido, las Lambdas reales con su rol, la auditoría y la revocación de sesión y de refresh token (ver los niveles de prueba en [docs/nist-800-207-mapping.md](../docs/nist-800-207-mapping.md)). Lo que queda, con el motivo:

1. **Hosted UI de Cognito real** (las páginas de inicio de sesión y de enrolamiento del TOTP, y su aspecto con la personalización CSS de la plantilla, `CognitoHostedUiBranding`). El emulador sirve un formulario simplificado sin estilos y no soporta `SetUICustomization`. El recorrido del SPA en un navegador real (login, cierre de sesión, CSP y CORS) **ya está demostrado contra el emulador** con `npm run test:browser`; lo que queda es el dominio real de Cognito, que incluye comprobar que acepta el CSS de la plantilla.
2. **`DeletionProtectionEnabled` y PITR en `production`.** Floci implementa la protección de borrado por la API de DynamoDB, pero su CloudFormation ignora esas dos propiedades al crear las tablas; solo se verifican en el template con `backend/test/infra/dataProtection.test.ts`. La etapa `production` se despliega en Floci sin la función de simulación (lo que esa etapa produce) porque la comprobación estática de Floci rechaza las ramas `Fn::If` del template completo; CloudFormation real las acepta.
3. **Una pasada de confirmación en AWS real.** Toda la evidencia anterior supone que el emulador se comporta como AWS; Floci no es AWS (por ejemplo firma los tokens con otro emisor y no copia los scopes de las rutas SAM, y las pruebas lo corrigen). Basta una ejecución de `specs/002-zta-hardening/quickstart.md`, sección 4, para confirmar el paralelismo.
4. **`AccessDenied` real de IAM** (T10): el emulador ya lo demostró; la confirmación es opcional.

Particularidades de Floci que las pruebas corrigen o sortean (documentadas en `backend/test/floci/docker-compose.yml`, `backend/test/floci/helpers/gateway.ts` y `backend/test/floci/apiAuthorizer.test.ts`): firma sus tokens con el emisor `https://localhost:4566/<pool>` (hay que activar su TLS, porque el autorizador exige HTTPS), no copia los `AuthorizationScopes` de las rutas SAM (se aplican desde el template antes de probarlos), no activa el segundo factor en los pools creados por CloudFormation y no permite tiempos de vida de token menores que 5 minutos salvo que se desactive `FLOCI_SERVICES_COGNITO_ENFORCE_TOKEN_VALIDITY_LIMITS`.

Cada punto tiene su procedimiento en `specs/002-zta-hardening/quickstart.md`, sección 4. No hay credenciales de AWS válidas en el entorno donde se ejecutó este trabajo.

---

## 4. Motor de políticas

El único motor de políticas activo es el módulo embebido `authz` (`EmbeddedPolicyAuthorizer`). Amazon Verified Permissions con Cedar está planificado como fase 2: las políticas de `policies/` son documentación, no se aplican, y el adaptador y la prueba de equivalencia que existían se retiraron por no estar conectados a ningún flujo.
