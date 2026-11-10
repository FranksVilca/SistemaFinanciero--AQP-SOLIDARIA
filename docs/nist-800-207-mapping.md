# Mapeo de controles a NIST SP 800-207 (Zero Trust Architecture)

Cada principio de NIST SP 800-207 con el control que lo implementa, la evidencia que lo comprueba y su estado. Una prueba (`backend/test/…`) verifica que cada archivo citado aquí existe, para que el mapeo no se desfase del código.

**Cómo leer el estado**

- **Cumple**: el control existe y una prueba automatizada falla si desaparece.
- **Cumple (real pendiente)**: ídem, y además hay un comportamiento que solo puede comprobarse en una cuenta de AWS real (ver [evidence/test-run-report.md](../evidence/test-run-report.md), sección 3).
- **Parcial (declarado)**: el principio no se cubre por completo y la limitación está declarada.

**Niveles de prueba** (de más cercano al código a más cercano a AWS):

| Nivel | Qué ejecuta | Comando |
|---|---|---|
| Unitaria | Lógica sin base de datos | `npm run test` |
| Integración | Handlers contra DynamoDB Local | `npm run test:integration` |
| Infraestructura | Aserciones sobre `infra/template.yaml`, etapas `academic` y `production` | `npm run test:infra` |
| Emulador (Floci, con IAM y TLS activos) | Políticas IAM reales del template, Cognito con MFA, autorizador JWT de API Gateway, revocación del refresh token y despliegue del stack | `npm run test:floci` |
| Extremo a extremo (Floci con el socket de Docker) | Gateway con scopes, Lambdas reales con su rol IAM, DynamoDB, auditoría y revocación de sesión, todo desplegado desde el template | `npm run test:floci:e2e` |
| AWS real | Lo que el emulador no puede mostrar: la interfaz real de Cognito en un navegador, los efectos de la protección de borrado y de PITR en `production`, y una pasada de confirmación de que el emulador se comporta como AWS | pendiente: [quickstart.md](../specs/002-zta-hardening/quickstart.md), sección 4 |

## Componentes de la arquitectura

| Componente NIST | Implementación | Evidencia |
|---|---|---|
| **PA** (Policy Administrator): identidad y sesión | Amazon Cognito: MFA TOTP obligatorio, Authorization Code + PKCE, tokens de 15 minutos | `backend/test/infra/mfa.test.ts`, `backend/test/floci/cognito.test.ts` |
| **PEP** (Policy Enforcement Point) | API Gateway con JWT authorizer y scopes por ruta; CloudFront con cabeceras de seguridad; `withAuth()` en cada función | `backend/test/floci/apiAuthorizer.test.ts`, `backend/test/infra/telemetryAndEdge.test.ts`, `backend/test/infra/withAuthCoverage.test.ts` |
| **PE** (Policy Engine) | Módulo `authz` embebido (`backend/src/authz/evaluateAuthz.ts`), fail-closed; Verified Permissions con Cedar es la fase 2 (`policies/README.md`) | `backend/test/authz.test.ts`, `backend/test/withAuth.test.ts` |
| Fuentes de datos (CDM, logs, CloudTrail) | Tabla de auditoría, logs de 14 días, CloudTrail, registros de acceso del API | `backend/test/integration/audit.test.ts`, `backend/test/infra/telemetryAndEdge.test.ts` |

## Principio 1 — Todo dato y servicio es un recurso

**Control.** Cada endpoint y cada tabla tiene una política explícita; cada función tiene su propio rol IAM con solo las acciones de su contrato (`specs/002-zta-hardening/contracts/iam-permissions-matrix.md`), sin comodines ni borrado.

| Evidencia | Qué comprueba |
|---|---|
| `backend/test/infra/iamMatrix.test.ts` | Las acciones de cada función en `infra/template.yaml` son exactamente las del contrato, en ambas etapas |
| `backend/test/floci/iamEnforcement.test.ts` | Con IAM aplicado por el emulador, cada handler funciona con su rol mínimo y todo lo demás recibe `AccessDeniedException` |
| `backend/test/infra/withAuthCoverage.test.ts` | Ninguna ruta del template puede publicarse sin `withAuth()` |

**Estado: Cumple (real pendiente)** — la denegación real en AWS está pendiente (`evidence/t10-access-denied.md`).

## Principio 2 — Comunicación segura sin importar la ubicación de red

**Control.** Todo el tráfico es HTTPS: CloudFront redirige a HTTPS con HSTS y una política de seguridad de contenido; el bucket del frontend es privado y solo lo lee esta distribución (OAC); los buckets rechazan el tráfico sin cifrar.

| Evidencia | Qué comprueba |
|---|---|
| `backend/test/infra/networkSecurity.test.ts` | `redirect-to-https`, HSTS ≥ 180 días, CSP sin orígenes comodín que además deja pasar todo lo que pide el SPA (descubrimiento, token, revocación, API), bucket privado con política OAC y rechazo de tráfico sin TLS |
| `backend/test/infra/telemetryAndEdge.test.ts` | CORS limitado al dominio propio (localhost solo en la etapa académica) |
| `backend/test/floci/stackDeployment.test.ts` | El stack con la política del bucket despliega |
| `backend/test/infra/corsAsSamReadsIt.test.ts`, `infra/scripts/check_sam_cors.py` (CI) | El CORS llega a API Gateway como SAM lo traduce: lista simple de orígenes, solo CloudFront (y localhost en la etapa académica), sin comodín. Un `!If` que envolvía toda la lista hacía que SAM escribiera un CORS inválido que API Gateway ignoraba y el API desplegado no respondía al preflight; el script falla con esa plantilla |
| `backend/test/browser/spa.test.ts` | En un navegador real, el SPA servido con la CSP del template completa el login, las llamadas a la API y la revocación sin violaciones de CSP ni errores de consola; CORS responde al origen del SPA y bloquea otro origen |

**Estado: Cumple (real pendiente)** — la CSP y el CORS se comprobaron en un navegador contra el emulador; falta hacerlo contra el dominio real de Cognito. Límite conocido: el certificado por defecto de CloudFront no permite fijar TLS 1.2 como mínimo (`.checkov.yaml`).

## Principio 3 — Acceso por sesión y por recurso

**Control.** Tokens de acceso de 15 minutos; solo se aceptan access tokens (nunca ID tokens); la propiedad del recurso se comprueba en cada solicitud (BOLA); las acciones sensibles revalidan la sesión contra Cognito y fallan cerrado.

| Evidencia | Qué comprueba |
|---|---|
| `backend/test/integration/bola.test.ts` | Otro donante o un gestor no pueden actuar sobre una donación ajena; el estado no cambia |
| `backend/test/integration/sessionCheck.test.ts` | Una sesión revocada, un servicio inaccesible o una respuesta tardía dan 401 en publicar, auditar y confirmar |
| `backend/test/integration/idToken.test.ts`, `backend/test/floci/cognito.test.ts` | Un ID token (también uno emitido por el Cognito emulado) da 401 en todas las rutas protegidas |
| `backend/test/floci/apiAuthorizer.test.ts` | El autorizador de API Gateway emulado rechaza el token alterado, el de otro pool y el vencido (401) y el que no trae el scope de la ruta (el ID token recibe 403); acepta uno con los scopes del SPA |
| `backend/test/floci/refreshRevocation.test.ts` | Revocar el refresh token en el endpoint que el SPA deriva del descubrimiento deja inservibles el refresh y el access token |
| `backend/test/floci/e2e/fullStack.test.ts` | De extremo a extremo con las Lambdas reales: una sesión revocada recibe 401 en una acción sensible con su token todavía vigente |
| `backend/test/infra/mfa.test.ts` | Tokens de acceso e identidad de 15 minutos como máximo |
| `backend/test/integration/sessionCheck.test.ts`, `backend/test/floci/roleRevalidation.test.ts`, `backend/test/floci/e2e/fullStack.test.ts` | Quitar el rol a una persona cuyo token sigue vigente: las acciones sensibles releen sus grupos en Cognito y responden 403 con el motivo `ROLE_REVOKED`; si no se pueden leer, también (falla cerrada). En el emulador la lectura se hace con las credenciales IAM de la propia función, y las que no deben hacerla reciben `AccessDenied` |
| `backend/test/integration/addDonorToGroup.test.ts`, `backend/test/infra/identityTrigger.test.ts`, `backend/test/floci/assignDonor.test.ts`, `backend/test/floci/e2e/fullStack.test.ts` | Ciclo de vida de la identidad: quien se registra recibe solo `DONANTE` (nunca `GESTOR` ni `AUDITOR`), solo ante el registro nuevo y no ante una recuperación de contraseña, y queda auditado; el disparador solo puede añadir un usuario a un grupo del pool y las demás funciones reciben `AccessDenied` si lo intentan |
| `backend/test/infra/roleRevalidation.test.ts` | Solo las funciones sensibles tienen `cognito-idp:AdminListGroupsForUser`, y solo sobre el pool del stack; las dos de administración tienen además solo las acciones de Cognito que su trabajo necesita (listar, leer, añadir y quitar de un grupo) |
| `backend/test/roleRules.test.ts`, `backend/test/admin/*.test.ts`, `backend/test/floci/adminRoles.test.ts` | Separación de funciones: qué roles pueden convivir, y que el ADMIN no cambia sus propios roles ni los de AUDITOR o ADMIN, con cada cambio auditado y probado contra un Cognito emulado con IAM activo |
| `backend/test/browser/spa.test.ts` | Los tokens no llegan a `localStorage` ni `sessionStorage`; al salir se revoca el refresh token **y se cierra la sesión del Hosted UI** (sin eso, la siguiente persona que usara el navegador entraba como la anterior sin credenciales); un rol no ve las pantallas ni los botones de otro y la API rechaza el intento forzado y lo audita con el proyecto afectado |

**Límite declarado.** Las acciones que no son sensibles (donar, ver el propio historial) no revalidan la sesión ni los grupos: un token robado, o de alguien a quien se le quitó un rol, sirve hasta 15 minutos para eso; la propiedad por recurso limita el daño a las donaciones de esa persona. Para cortarlo antes hay que terminar sus sesiones (`docs/operations-notes.md`, sección 4).

**Estado: Cumple (real pendiente)** — todo lo anterior está demostrado en el emulador; solo falta la pasada de confirmación en AWS real (`evidence/test-run-report.md`, sección 3).

## Principio 4 — El acceso lo decide una política dinámica

**Control.** Cada solicitud se evalúa con rol, grupo, acción, propietario del recurso y estado del recurso (por ejemplo, no se dona a un proyecto en borrador ni se transiciona una donación terminal). El motor falla cerrado.

| Evidencia | Qué comprueba |
|---|---|
| `backend/test/authz.test.ts` | Decisiones por rol y propietario, con el motivo de la denegación; un fallo del motor deniega |
| `backend/test/integration/authzMatrix.test.ts` | Matriz rol × acción: todo lo no permitido da 401/403 sin cambiar datos |
| `backend/test/integration/donationFlow.test.ts` | Reglas de estado (409) e idempotencia |
| `backend/test/integration/separationOfDuties.test.ts`, `backend/test/authz.test.ts` | Separación de funciones: `AUDITOR` no se combina con otro rol (403, motivo `SEPARATION_OF_DUTIES`); conflicto de intereses: quien creó un proyecto no puede donarle (403, motivo `CONFLICT_OF_INTEREST`); ambos quedan auditados y la vista pública nunca muestra quién creó un proyecto |

**Estado: Cumple en lo básico (declarado)** — la política no usa postura del dispositivo ni riesgo de sesión, que NIST menciona como atributos opcionales.

## Principio 5 — Monitorear la integridad y la postura de los activos

**Control.** Logs estructurados con retención de 14 días, registros de acceso del API, CloudTrail definido en el IaC, y GuardDuty y Security Hub como parámetros opcionales (pruebas de 30 días). El CI analiza el template (`cfn-lint`, `checkov`) y bloquea el despliegue si algo falla.

| Evidencia | Qué comprueba |
|---|---|
| `backend/test/infra/telemetryAndEdge.test.ts` | Retención ≤ 14 días, trail con bucket privado, registros de acceso |
| `backend/test/infra/detection.test.ts` | GuardDuty y Security Hub apagados por defecto y sin dependencias cruzadas |
| `backend/test/floci/stackDeployment.test.ts` | Las opciones de detección despliegan |
| `.github/workflows/ci.yml`, `.checkov.yaml` | Compuertas del CI y omisiones justificadas |
| `.github/workflows/ci.yml` (etapa `dependency-audit`) | `npm audit` bloquea el despliegue ante una vulnerabilidad alta o crítica en una dependencia de producción (encontró una en `zod`, ya corregida); las de las herramientas de desarrollo solo se reportan |

**Estado: Parcial (declarado)** — no hay postura del dispositivo ni evaluación continua del riesgo de la sesión; GuardDuty y Security Hub dependen del tipo de cuenta (`docs/free-plan-guide.md`).

## Principio 6 — Autenticación y autorización dinámicas y estrictas antes del acceso

**Control.** MFA TOTP obligatorio antes de emitir tokens; JWT authorizer con scopes por ruta; `withAuth()` aplica rol, propietario y sesión antes de ejecutar la lógica; los errores nunca revelan si un recurso existe a quien no tiene el rol.

| Evidencia | Qué comprueba |
|---|---|
| `backend/test/floci/cognito.test.ts` | Contra un Cognito emulado construido con la configuración del template: sin segundo factor no hay tokens (`MFA_SETUP`), con él sí, y solo TOTP |
| `backend/test/floci/apiAuthorizer.test.ts` | Desplegado el template: las 6 rutas protegidas devuelven 401 sin token, con un token falso, con el payload alterado, con un token de otro pool y con uno vencido; las 3 públicas no piden token |
| `backend/test/floci/e2e/fullStack.test.ts` | El flujo completo con las Lambdas reales: 403 por rol y por propietario, 400 y 409 por validación e idempotencia, y 401 con un ID token que el gateway dejó pasar |
| `backend/test/infra/mfa.test.ts` | `MfaConfiguration: ON`, solo TOTP, sin SMS, scopes en toda ruta protegida |
| `backend/test/withAuth.test.ts` | 401 sin identidad, 403 sin rol, 404 solo tras pasar el rol, sin filtrar detalles internos |

**Estado: Cumple (real pendiente)** — el rechazo de tokens falsos, alterados, de otro pool, vencidos y sin scope, y el flujo con las Lambdas reales, están demostrados en el emulador; falta el Hosted UI real en un navegador y la pasada de confirmación en AWS.

## Principio 7 — Recolectar información para mejorar la postura

**Control.** Auditoría de las denegaciones de rutas protegidas y de los éxitos de acciones que cambian estado, con el actor pseudonimizado, un único punto de escritura y solo inserción (política IAM y política de recursos); logs con `requestId` sin datos personales; CloudTrail para los cambios de la cuenta.

| Evidencia | Qué comprueba |
|---|---|
| `backend/test/integration/audit.test.ts` | Denegaciones y éxitos registrados, ningún identificador crudo, consulta solo para el auditor |
| `backend/test/infra/auditTable.test.ts` | Clave por día y política de recursos que niega editar o borrar |
| `backend/test/logger.test.ts` | Los logs no contienen tokens, identificadores, correos ni montos |

**Estado: Cumple** — los 401 que emite el authorizer de API Gateway no llegan a la función: quedan en los registros de acceso del API, no en la tabla de auditoría. Realimentar las políticas con lo observado es un proceso humano (`docs/zta-hallazgos-y-mejoras.md`), no automático.

## Resumen

| # | Principio | Estado |
|---|---|---|
| 1 | Todo dato y servicio es un recurso | Cumple (real pendiente) |
| 2 | Comunicación segura sin importar la red | Cumple (real pendiente) |
| 3 | Acceso por sesión y por recurso | Cumple (real pendiente) |
| 4 | Política dinámica | Cumple en lo básico (declarado) |
| 5 | Monitorear la postura de los activos | **Parcial (declarado)** |
| 6 | Autenticación y autorización estrictas | Cumple (real pendiente) |
| 7 | Recolectar información para mejorar | Cumple |

Fuera de alcance, y declarado: postura del dispositivo, evaluación continua de riesgo, ZTNA, Verified Permissions (fase 2), WAF, varias cuentas y passkeys. Motivos en `docs/free-plan-guide.md`.
