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
| Emulador (Floci, con IAM activo) | Políticas IAM reales del template, Cognito con MFA y despliegue del stack | `npm run test:floci` |
| AWS real | JWT authorizer de API Gateway, Cognito real, `AccessDenied` real | pendiente: [quickstart.md](../specs/002-zta-hardening/quickstart.md), sección 4 |

## Componentes de la arquitectura

| Componente NIST | Implementación | Evidencia |
|---|---|---|
| **PA** (Policy Administrator): identidad y sesión | Amazon Cognito: MFA TOTP obligatorio, Authorization Code + PKCE, tokens de 15 minutos | `backend/test/infra/mfa.test.ts`, `backend/test/floci/cognito.test.ts` |
| **PEP** (Policy Enforcement Point) | API Gateway con JWT authorizer y scopes por ruta; CloudFront con cabeceras de seguridad; `withAuth()` en cada función | `backend/test/infra/telemetryAndEdge.test.ts`, `backend/test/infra/withAuthCoverage.test.ts` |
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
| `backend/test/infra/networkSecurity.test.ts` | `redirect-to-https`, HSTS ≥ 180 días, CSP sin orígenes comodín, bucket privado con política OAC y rechazo de tráfico sin TLS |
| `backend/test/infra/telemetryAndEdge.test.ts` | CORS limitado al dominio propio (localhost solo en la etapa académica) |
| `backend/test/floci/stackDeployment.test.ts` | El stack con la política del bucket despliega |

**Estado: Cumple (real pendiente)** — falta comprobar en un navegador que la CSP no bloquea el intercambio de código con el dominio de Cognito. Límite conocido: el certificado por defecto de CloudFront no permite fijar TLS 1.2 como mínimo (`.checkov.yaml`).

## Principio 3 — Acceso por sesión y por recurso

**Control.** Tokens de acceso de 15 minutos; solo se aceptan access tokens (nunca ID tokens); la propiedad del recurso se comprueba en cada solicitud (BOLA); las acciones sensibles revalidan la sesión contra Cognito y fallan cerrado.

| Evidencia | Qué comprueba |
|---|---|
| `backend/test/integration/bola.test.ts` | Otro donante o un gestor no pueden actuar sobre una donación ajena; el estado no cambia |
| `backend/test/integration/sessionCheck.test.ts` | Una sesión revocada, un servicio inaccesible o una respuesta tardía dan 401 en publicar, auditar y confirmar |
| `backend/test/integration/idToken.test.ts`, `backend/test/floci/cognito.test.ts` | Un ID token (también uno emitido por el Cognito emulado) da 401 en todas las rutas protegidas |
| `backend/test/infra/mfa.test.ts` | Tokens de acceso e identidad de 15 minutos como máximo |

**Estado: Cumple (real pendiente)** — la revocación contra el `userInfo` de Cognito real y el rechazo del ID token por el authorizer de API Gateway están pendientes de AWS.

## Principio 4 — El acceso lo decide una política dinámica

**Control.** Cada solicitud se evalúa con rol, grupo, acción, propietario del recurso y estado del recurso (por ejemplo, no se dona a un proyecto en borrador ni se transiciona una donación terminal). El motor falla cerrado.

| Evidencia | Qué comprueba |
|---|---|
| `backend/test/authz.test.ts` | Decisiones por rol y propietario, con el motivo de la denegación; un fallo del motor deniega |
| `backend/test/integration/authzMatrix.test.ts` | Matriz rol × acción: todo lo no permitido da 401/403 sin cambiar datos |
| `backend/test/integration/donationFlow.test.ts` | Reglas de estado (409) e idempotencia |

**Estado: Cumple en lo básico (declarado)** — la política no usa postura del dispositivo ni riesgo de sesión, que NIST menciona como atributos opcionales.

## Principio 5 — Monitorear la integridad y la postura de los activos

**Control.** Logs estructurados con retención de 14 días, registros de acceso del API, CloudTrail definido en el IaC, y GuardDuty y Security Hub como parámetros opcionales (pruebas de 30 días). El CI analiza el template (`cfn-lint`, `checkov`) y bloquea el despliegue si algo falla.

| Evidencia | Qué comprueba |
|---|---|
| `backend/test/infra/telemetryAndEdge.test.ts` | Retención ≤ 14 días, trail con bucket privado, registros de acceso |
| `backend/test/infra/detection.test.ts` | GuardDuty y Security Hub apagados por defecto y sin dependencias cruzadas |
| `backend/test/floci/stackDeployment.test.ts` | Las opciones de detección despliegan |
| `.github/workflows/ci.yml`, `.checkov.yaml` | Compuertas del CI y omisiones justificadas |

**Estado: Parcial (declarado)** — no hay postura del dispositivo ni evaluación continua del riesgo de la sesión; GuardDuty y Security Hub dependen del tipo de cuenta (`docs/free-plan-guide.md`).

## Principio 6 — Autenticación y autorización dinámicas y estrictas antes del acceso

**Control.** MFA TOTP obligatorio antes de emitir tokens; JWT authorizer con scopes por ruta; `withAuth()` aplica rol, propietario y sesión antes de ejecutar la lógica; los errores nunca revelan si un recurso existe a quien no tiene el rol.

| Evidencia | Qué comprueba |
|---|---|
| `backend/test/floci/cognito.test.ts` | Contra un Cognito emulado construido con la configuración del template: sin segundo factor no hay tokens (`MFA_SETUP`), con él sí, y solo TOTP |
| `backend/test/infra/mfa.test.ts` | `MfaConfiguration: ON`, solo TOTP, sin SMS, scopes en toda ruta protegida |
| `backend/test/withAuth.test.ts` | 401 sin identidad, 403 sin rol, 404 solo tras pasar el rol, sin filtrar detalles internos |

**Estado: Cumple (real pendiente)** — el rechazo de tokens falsos o vencidos por API Gateway y el flujo de inicio de sesión real no pueden emularse.

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
