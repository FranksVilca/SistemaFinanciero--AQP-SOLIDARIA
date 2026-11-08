# Zero Trust en AQP-SOLIDARIA: hallazgos, faltantes y mejoras

Documento de trabajo con todo lo detectado al revisar la arquitectura y el código frente a Zero Trust (NIST SP 800-207): qué se cumple, qué falta, qué mejorar y qué opciones de diseño hay. Está escrito a partir de una revisión del repositorio y de pruebas ejecutadas contra un emulador de AWS.

## 0. Estado de cierre (2026-11-08)

Las secciones 1 a 13 describen la **revisión inicial**. Este apartado recoge el estado tras implementar `specs/002-zta-hardening/`. "Pendiente de AWS" significa que el comportamiento solo puede comprobarse en una cuenta real; el procedimiento está en `specs/002-zta-hardening/quickstart.md`, sección 4, y el estado en `evidence/test-run-report.md`.

| Hallazgo | Estado | Evidencia |
|---|---|---|
| H1 Confirmar donación devuelve 500 | **Resuelto** | `simulateDonation.ts`; `test/integration/confirmDonation.test.ts`; reintroducir el error rompe el CI (`evidence/ci-negative-checks.md`) |
| H2 MFA no obligatorio | **Resuelto en el template** (`MfaConfiguration: ON`, solo TOTP, para todo el pool); inicio de sesión real **pendiente de AWS** | `test/infra/mfa.test.ts` |
| H3 Autorización manual en cada handler | **Resuelto** | `backend/src/authz/withAuth.ts`; `test/infra/withAuthCoverage.test.ts` falla si una ruta del template no lo usa |
| H4 Verified Permissions y Cedar sin uso | **Resuelto (declaración corregida)**: se retiró el código muerto; Cedar queda como fase 2 | `policies/README.md`, `AI_USAGE.md` |
| H5 Auditoría débil | **Resuelto**: se auditan las denegaciones de rutas protegidas y los éxitos de acciones que cambian estado, el actor siempre va pseudonimizado, un único punto de escritura, solo `PutItem` más una política de recursos que niega editar o borrar. Los 401 de la pasarela quedan en sus registros de acceso | `test/integration/audit.test.ts`, `test/infra/auditTable.test.ts` |
| H6 Permisos IAM amplios | **Resuelto**: acciones exactas por función, sin borrado ni comodines; denegación real **pendiente de AWS** (T10) | `test/infra/iamMatrix.test.ts`, `evidence/t10-access-denied.md` |
| H7 Telemetría ausente del IaC | **Resuelto en el template**: logs de 14 días, registros de acceso del API, CloudTrail (parámetro); despliegue real **pendiente de AWS** | `test/infra/telemetryAndEdge.test.ts`, `cfn-lint` |
| H8 CORS, throttling y callbacks | **Resuelto en el template**: CORS al dominio de CloudFront (localhost solo en la etapa académica), límite por ruta pública, callbacks de producción, CSP con el dominio de Cognito; **pendiente de AWS** comprobar el inicio de sesión desplegado | `test/infra/telemetryAndEdge.test.ts` |
| H9 Token robado vigente 15 min | **Mitigado**: las acciones sensibles (publicar, ver auditoría, confirmar una donación) revalidan la sesión contra Cognito **y releen los grupos de la persona** (quitar un rol surte efecto en el acto) y fallan cerrado. Las demás acciones siguen expuestas hasta 15 minutos salvo que se terminen las sesiones (`docs/operations-notes.md`); con Cognito real **pendiente de AWS** | `test/integration/sessionCheck.test.ts`, `test/floci/roleRevalidation.test.ts` |
| H10 Detalles de código | **Resuelto en el backend** (acción `ViewMyDonations`, logs sin `donorSub` ni monto, sin `any`, constantes con nombre); el frontend queda registrado | `specs/002-zta-hardening/followups.md` |
| H11 Pruebas con DynamoDB simulado | **Resuelto**: 39 pruebas de integración contra DynamoDB Local; se retiraron las pruebas con simulaciones | `backend/test/integration/` |

Actualización posterior: un emulador de AWS (Floci, con IAM activo) permitió demostrar `AccessDenied` real de IAM con las políticas del template (T10), el MFA obligatorio de Cognito (T14) y el rechazo del ID token (T11) sin cuenta de AWS. Esa suite encontró además un error del template (la política de `Query` sobre índices era demasiado estrecha) y la revisión del principio 2 destapó que el bucket del frontend no tenía política para CloudFront; ambos están corregidos. Suites al 2026-11-09: 33 unitarias, 40 de integración, 165 de infraestructura, 78 del emulador y 11 de extremo a extremo con las Lambdas reales en contenedores. El autorizador JWT de API Gateway, desplegado desde el template, rechaza sin token, con token falso, con payload alterado, de otro pool y vencido (401), rechaza el ID token y los tokens sin el scope de la ruta (403) y acepta uno con los scopes del SPA. Además se encontró y corrigió un fallo del frontend: el cierre de sesión no revocaba el refresh token porque llamaba a un endpoint inexistente. Lo que sigue exigiendo AWS real: el Hosted UI de Cognito en un navegador, los efectos de la protección de borrado y PITR en `production` y una pasada de confirmación de que el emulador se comporta como AWS.

### Principios de NIST SP 800-207

El mapeo completo, con la evidencia de cada principio y una prueba que verifica que cada archivo citado existe, está en [nist-800-207-mapping.md](nist-800-207-mapping.md). Resumen:

| # | Principio | Estado | Nota |
|---|---|---|---|
| 3 | Acceso por sesión y por recurso | **Cumple en el código** | Propiedad por recurso probada y revalidación de sesión en acciones sensibles; comprobación con Cognito real pendiente |
| 5 | Monitorear la postura de los activos | **Parcial (declarado)** | Logs, CloudTrail y GuardDuty/Security Hub opcionales con prueba de 30 días; sin postura de dispositivo |
| 6 | Autenticación y autorización estrictas | **Cumple en el template** | MFA obligatorio y `withAuth` en toda ruta; MFA, authorizer e ID token reales pendientes de AWS |
| 7 | Recolectar información para mejorar | **Cumple** | Auditoría de denegaciones y éxitos, pseudonimizada y de solo inserción; logs con `requestId` |

### Qué sigue fuera

Verified Permissions (fase 2), WAF, SMS MFA, varias cuentas con Organizations, postura del dispositivo y passkeys. Motivos en `docs/free-plan-guide.md`.

---

## 1. Veredicto

**La arquitectura actual cubre ZTA en un nivel básico, con deficiencias corregibles.**

- Aplica los principios centrales: no confiar en la red, verificar cada solicitud, mínimo privilegio y protección de los datos de otros usuarios (BOLA). Esto se comprobó ejecutando el código, no solo leyéndolo.
- Tiene los tres componentes del modelo NIST: **PA** (Cognito), **PEP** (API Gateway con JWT y scopes) y **PE** (módulo `authz` dentro de las Lambdas).
- Las deficiencias no son de concepto, sino de piezas sin terminar: un bug que rompe el flujo principal, MFA opcional, auditoría débil, un motor de políticas que no se usa y telemetría ausente del IaC.
- Para el alcance de un curso es defendible como MVP. Como ZTA robusta, no.

## 2. Cómo se evaluó y qué no se pudo probar

**Qué se hizo**
- Se desplegó `infra/template.yaml` en **Floci** (emulador de AWS, `floci/floci`) y el stack llegó a `CREATE_COMPLETE`: 4 tablas DynamoDB, User Pool de Cognito con 3 grupos, HTTP API, 9 Lambdas, S3 y CloudFront.
- Se compiló el backend (`npm run build`) y se ejecutaron los 37 tests existentes (11 archivos, todos pasan).
- Se ejecutaron los handlers compilados contra las tablas de Floci con **35 verificaciones** de Zero Trust (roles, BOLA, idempotencia, validación, auditoría).

**Qué no se pudo probar**
- Que API Gateway rechace tokens falsos, vencidos o un ID token (Floci no ejecuta el JWT authorizer).
- La configuración real de Cognito: MFA por grupo, scopes y flujo de login.
- `AccessDenied` por permisos IAM insuficientes (prueba T10).
- Las Lambdas desplegadas en Floci (no alcanza Docker desde dentro del contenedor, y el código desplegado era un marcador porque `backend/dist` no existía).
- CORS real, y los límites y estado de CloudFront.

## 3. Estado frente a los 7 principios de NIST SP 800-207

| # | Principio | Estado | Evidencia |
|---|---|---|---|
| 1 | Todo dato y servicio es un recurso | Cumple | Cada endpoint y tabla tiene política explícita; rol IAM por función |
| 2 | Comunicación segura sin importar la red | Cumple (sin probar en AWS real) | HTTPS en CloudFront y API Gateway |
| 3 | Acceso por sesión y por recurso | **Parcial** | Token de 15 min y propiedad por recurso probada; pero el authorizer valida el JWT localmente y un token robado vale hasta que expire |
| 4 | Política dinámica | Cumple en lo básico | Decisión por solicitud con rol, grupo, propietario y estado del recurso |
| 5 | Monitorear la postura de los activos | **Parcial (declarado)** | Sin postura de dispositivo; CloudTrail y logs no están en el template |
| 6 | Autenticación y autorización estrictas antes del acceso | **Parcial** | JWT + scopes + `authz` cumplen; el MFA no es obligatorio en el template |
| 7 | Recolectar información para mejorar | **Parcial** | Logs JSON con `requestId`; auditoría solo de éxitos y sin cierre del ciclo hacia las políticas |

## 4. Lo que sí se cumple (comprobado)

- Sin identidad, los 5 handlers protegidos responden 401 (`simulateDonation` responde 403).
- Separación de roles: el donante no crea ni publica proyectos; el gestor no dona; solo el auditor ve la auditoría; un grupo parecido (`GESTOR_FAKE`, `gestor`) no otorga el rol.
- BOLA bloqueada: otro donante o un gestor no puede confirmar una donación ajena, y el historial de cada donante solo contiene lo suyo. El estado no cambia tras los ataques.
- Idempotencia: la misma clave devuelve la misma donación; la misma clave con otro monto da 409; la clave está aislada por usuario.
- Validación: monto negativo, `Idempotency-Key` ausente o que no es UUID y JSON inválido dan 400, sin filtrar el stack trace.
- Estados: no se dona a un proyecto en borrador y no se publica dos veces (409).
- Infraestructura: solo 3 GET públicos usan `Authorizer: NONE`, las 6 rutas protegidas declaran `AuthorizationScopes`, y cada función tiene su propio rol IAM con solo sus tablas.
- La SPA guarda los tokens solo en memoria (`InMemoryWebStorage`).

## 5. Hallazgos y brechas, por severidad

### Alta

**H1. Confirmar una donación devuelve 500.**
- Dónde: [simulateDonation.ts:121](../backend/src/donations/simulateDonation.ts#L121).
- Causa: la expresión `ADD confirmedAmountCents :amount, updatedAt = :now` es inválida en DynamoDB. Debe ser `ADD confirmedAmountCents :amount SET updatedAt = :now`.
- Por qué pasó desapercibido: los tests unitarios simulan DynamoDB. Con el corrector aplicado en una copia temporal, confirmar y el rechazo de un segundo cambio de estado pasaron.
- Origen: la misma línea aparece escrita igual en [research.md](../specs/001-secure-donations/research.md) (sección 2), así que el error nació en el diseño y el código lo copió.

**H2. MFA no es obligatorio.**
- Dónde: `infra/template.yaml`, User Pool con `MfaConfiguration: "OPTIONAL"`. Las descripciones de los grupos dicen "MFA TOTP obligatorio" para GESTOR y AUDITOR, pero no se vio dónde se exige.
- Impacto: un gestor o auditor puede iniciar sesión solo con contraseña. Contradice lo declarado en los documentos (CA-11.1) y en el diagrama.

### Media

**H3. La autorización depende de que cada función se acuerde de llamarla.**
- Cada handler llama a `enforceAuthz()` a mano. Si una función nueva lo olvida, queda abierta y nada avisa.

**H4. Verified Permissions y Cedar no se usan.**
- `getAuthorizer()` ([evaluateAuthz.ts](../backend/src/authz/evaluateAuthz.ts)) usa `require` dentro de un módulo ESM, falla y cae en silencio al autorizador embebido. Se comprobó: con `POLICY_ENGINE=verified_permissions` sigue usando `EmbeddedPolicyAuthorizer`.
- Ningún handler llama a `getAuthorizer()`, y el template no crea ningún Policy Store.
- Los archivos de [policies/](../policies/) son documentación, no se aplican.
- [AI_USAGE.md](../AI_USAGE.md) declara un "adaptador Cedar", que existe como código muerto.

**H5. Auditoría débil.**
- Solo se registran eventos exitosos; los 401 y 403 no dejan rastro en la tabla de auditoría (solo en logs).
- `createProject` y `publishProject` guardan el `sub` en crudo en `actorRef`. El modelo de datos pide un seudónimo, y existe [logAuditEvent.ts](../backend/src/audit/logAuditEvent.ts), que pseudonimiza, pero no se usa.
- `createProject`, `publishProject`, `createDonation` y `simulateDonation` tienen `DynamoDBCrudPolicy` sobre `AuditTable`. Eso permite editar y borrar eventos, aunque la documentación los llama "registros inmutables".

**H6. Permisos IAM más amplios de lo necesario.**
- `DynamoDBCrudPolicy` incluye borrar. Varias funciones solo necesitan insertar, leer o actualizar.

**H7. Telemetría ausente del IaC.**
- El template no define `LogGroup` con retención (el requisito pide ≤ 14 días) ni CloudTrail. Si existen, se configuraron a mano y no son reproducibles.

**H8. CORS y límite de peticiones.**
- La HTTP API tiene `AllowOrigins: "*"`.
- Los 3 GET públicos no tienen throttling por ruta.
- Los `CallbackURLs` y `LogoutURLs` de Cognito apuntan solo a `localhost`, así que el login no funcionaría desplegado.

### Baja

**H9. Un token robado sigue vigente hasta 15 minutos.**
- Es una limitación declarada (design.md, sección de revocación). Se puede mitigar acortando la vida del token en roles privilegiados o revalidando la sesión en acciones sensibles.

**H10. Detalles menores de código.**
- `getMyDonations` usa la acción `CreateDonation` para exigir el rol de donante, lo que confunde la intención.
- Los logs incluyen el `donorSub` y el monto.
- Hay 7 usos de `any` y valores literales sin nombre (por ejemplo `86400`).

**H11. Pruebas con DynamoDB simulado.**
- Los 37 tests no habrían detectado H1. La matriz de la sección 4 debería convertirse en pruebas permanentes con un DynamoDB emulado.

## 6. Mejoras propuestas, en orden de trabajo

| # | Mejora | Resuelve | Esfuerzo |
|---|---|---|---|
| 1 | Corregir la expresión `ADD ... SET` | H1 | Una línea |
| 2 | MFA obligatorio para gestor y auditor en el template | H2 | Bajo |
| 3 | Envoltorio `withAuth(handler, { action })` como única forma de exportar un handler, más una prueba que falle si una ruta no lo usa | H3 | Medio |
| 4 | Roles IAM con solo las acciones necesarias; tabla `Audit` con solo `PutItem` | H5, H6 | Bajo |
| 5 | Auditoría: registrar denegados, pseudonimizar siempre el actor y centralizar la escritura en un solo punto | H5 | Medio |
| 6 | `LogGroup` con retención de 14 días y CloudTrail en el template | H7 | Bajo |
| 7 | CORS limitado al dominio propio, throttling por ruta y `CallbackURLs` de producción | H8 | Bajo |
| 8 | Pruebas de integración con DynamoDB emulado en el CI, convirtiendo la matriz de roles, BOLA e idempotencia en pruebas permanentes | H11 | Medio |
| 9 | `cfn-lint` y `checkov` sobre el template en el CI | Permisos amplios | Bajo |
| 10 | Conectar Verified Permissions, o eliminar el código Cedar muerto y dejar de declararlo como hecho | H4 | Alto / Bajo |
| 11 | Revalidar la sesión en acciones sensibles o acortar la vida del token en roles privilegiados | H9 | Medio |
| 12 | Protección contra borrado y recuperación a un punto en el tiempo (PITR) en donaciones y auditoría | Integridad de datos | Bajo |

**Matiz sobre el punto 3:** la propiedad del recurso (BOLA) necesita datos que solo conoce la función (por ejemplo, el `donorSub` de la donación). Un envoltorio que corre antes del handler decide rol, scopes y acción; para el propietario, el handler debe indicar cómo cargar el recurso, y el envoltorio compara el dueño.

## 7. Mejores opciones de diseño

### 7.1 Motor de políticas (PE)
- **Hoy:** reglas en TypeScript dentro de cada Lambda. Simple, barato, sin latencia de red.
- **Debilidad:** decisión y ejecución en el mismo proceso; NIST prefiere un motor independiente.
- **Opciones:** (1) `withAuth()` obligatorio, (2) Lambda authorizer en el API Gateway para el control por ruta, (3) **Verified Permissions con Cedar**, que da políticas centrales, versionadas y auditables. La tercera es la más ZTA, y es la extensión que el diseño reserva (HU-12).

### 7.2 Auditoría
- Separarla en su propia frontera y que sea append-only. La mejora barata son permisos de solo escritura sobre la misma tabla; el nivel ideal es otra cuenta de AWS (Organizations), de modo que ni un compromiso total de la cuenta de la aplicación alcance la evidencia.

### 7.3 Base de datos: DynamoDB frente a RDS/Aurora
- **Por qué DynamoDB aquí** (según plan.md y research.md): idempotencia y concurrencia atómicas con `TransactWriteItems` (prueba T08), permisos por tabla con IAM, acceso por clave sin escaneos y encaje en el Free plan sin servidores. Ningún documento compara con RDS; esa comparación es una inferencia.
- **Qué se pierde:** no hay SQL ni `JOIN`, ni integridad referencial; la consistencia entre `Donations` y `Projects` la mantiene el código con transacciones, y los reportes ad hoc exigen índices.
- **Cuándo cambiaría la decisión:** con dinero real, reportes financieros complejos o conciliación con un procesador, convendría valorar un relacional para el libro de donaciones, o exportar los eventos a S3 + Athena.
- Las tablas de DynamoDB son independientes entre sí, sin esquema común ni claves foráneas; solo comparten cuenta y región.

### 7.4 ¿Multiservicios?
- Para esta plataforma no conviene un microservicio por entidad. Proyectos y donaciones deben seguir juntos por su transacción atómica.
- Con dinero real sí convendría separar pocas piezas: **pagos** (procesador externo con webhooks firmados, sin tocar datos de tarjeta), **auditoría** (frontera propia) y **notificaciones** (cola asíncrona). La identidad ya está separada (Cognito).

### 7.5 ¿Una Lambda o nueve?
- Nueve funciones no es por costo (el precio es casi igual). Es por mínimo privilegio: si se compromete `listProjects`, solo puede leer proyectos. Un backend único tendría un solo conjunto de permisos con los de la función más poderosa.
- El código es uno solo (`backend/src`), y `authz` es un módulo compartido que se empaqueta dentro de cada función, no un servicio.

### 7.6 Lo que añadiría un producto real y el Free plan no cubre
Revisado contra la documentación de AWS el 2026-11-08:
- Varias cuentas de AWS (producción, auditoría, logging) con Organizations. **Unirse a Organizations convierte una cuenta del plan gratuito en plan de pago.**
- WAF delante de CloudFront y del API Gateway: no se asocia a una HTTP API, y los planes planos de CloudFront que lo incluyen no están disponibles en cuentas del plan gratuito.
- **GuardDuty** tiene 30 días de prueba por región; **Security Hub** tiene planes propios (su prueba no se confirmó). Se ofrecen como parámetros del template, apagados por defecto, y su disponibilidad depende del tipo de cuenta.
- CloudTrail de la organización.
- Postura del dispositivo y evaluación continua del riesgo de sesión (ZTNA).
- Passkeys (WebAuthn) en lugar de contraseña más TOTP.

## 8. Inconsistencias entre los documentos y el código

| Lo que dicen los documentos | Lo que hay |
|---|---|
| MFA obligatorio para gestor y auditor (CA-11.1, descripciones de grupo) | `MfaConfiguration: OPTIONAL` en el template |
| `actorRef` es un seudónimo (modelo de datos) | `createProject` y `publishProject` guardan el `sub` en crudo |
| Auditoría como "registros inmutables" (plan.md) | Cuatro funciones con permiso de editar y borrar la tabla |
| Adaptador Cedar para Verified Permissions (AI_USAGE.md) | Código muerto: nadie lo llama y no hay Policy Store |
| Retención de logs ≤ 14 días y CloudTrail (requisitos) | No definidos en `infra/template.yaml` |
| `AI_USAGE.md` debe declarar toda herramienta de IA (design.md, sección 10) | Solo menciona Antigravity / Gemini; si se usaron otras, faltan |
| El sistema se presenta como Zero Trust completo | Es un MVP con RBAC y propiedad por recurso; la limitación del principio 5 sí está declarada |

## 9. Calidad de código

La constitución se enmendó a la **versión 2.1.0** ([constitution.md](../.specify/memory/constitution.md)) con el principio VII (código mantenible, legible e idiomático). Quedan pendientes en las herramientas:
- ESLint solo usa las reglas recomendadas y `no-unused-vars` como aviso. Faltan las reglas de complejidad, tamaño de función y `no-explicit-any`.
- Prettier es una dependencia de desarrollo pero no tiene configuración ni paso en el CI.
- El CI ejecuta lint, typecheck y tests, pero no despliega ni prueba contra DynamoDB real.

## 10. Diagramas y documentos relacionados

| Archivo | Qué es |
|---|---|
| [zta-architecture.png](diagrams/zta-architecture.png) | Arquitectura **actual** (D2) |
| [zta-architecture-target.png](diagrams/zta-architecture-target.png) | Arquitectura **mejorada** con las correcciones propuestas (marcadas con ★) |
| [zta-architecture-ideal.png](diagrams/zta-architecture-ideal.png) | Arquitectura **ideal** desde cero, con etiquetas IGUAL, CAMBIA y NUEVO |
| [arquitectura-comparacion.md](arquitectura-comparacion.md) | Tabla comparativa de las tres versiones |

Los diagramas se regeneran con `d2 --layout=tala --pad 30 <archivo>.d2 <archivo>.png` desde `docs/diagrams`. Los iconos de AWS se descargan de `icons.terrastruct.com`, así que hace falta internet. Los diagramas mejorado e ideal describen lo que debería existir: nada de lo marcado como nuevo o cambiado está implementado.

## 11. Evidencias esperadas de la entrega y estado

| Evidencia | Estado |
|---|---|
| 401 sin token o con ID token | 401 sin identidad probado en los handlers; el ID token está diseñado con `AuthorizationScopes`, pero no se probó (requiere Cognito y API Gateway reales) |
| 403 por rol insuficiente; 403/404 ante BOLA | Probado |
| 400 y 409 por validación e idempotencia | Probado |
| `AccessDenied` ante permisos IAM insuficientes (T10) | **No probado** |
| Mapeo de controles a NIST SP 800-207 | Existe (design.md, sección 6); este documento lo actualiza con el estado real |
| Declaración de uso de IA (`AI_USAGE.md`) | Existe; revisar que incluya todas las herramientas usadas |

## 12. Cómo responder las preguntas de la sustentación

- **¿Dónde está el PEP y qué ocurre si falla?** En el JWT authorizer de API Gateway. Si se omite, `authz` en Lambda es una segunda defensa por rol y propiedad, y devuelve 401 sin identidad. Si falla el PE, el diseño es fail-closed: `authorize()` captura cualquier excepción del motor y deniega con el motivo `ENGINE_ERROR` (y también la revalidación de sesión falla cerrada); hoy solo existe el autorizador embebido, Cedar es fase 2.
- **¿Qué principio de NIST cubre solo parcialmente?** El principio 5 (postura de los activos), que el diseño declara como parcial. También quedan parciales el 3, el 6 y el 7 por los motivos de la sección 3.
- **¿Cómo detectarías una autorización incorrecta generada por IA?** Con pruebas negativas (matriz rol × acción y BOLA), pruebas de integración contra un DynamoDB real o emulado, revisión por una persona distinta de quien generó el código, y comparando lo declarado con lo ejecutado, que es lo que reveló el código Cedar muerto.
- **¿Qué cambia si el token robado sigue vigente 15 minutos?** El atacante puede hacer lo que permita el rol y los scopes del usuario hasta que expire; un donante solo toca sus propias donaciones. Se mitiga con vida corta, revocación del refresh token, tokens en memoria y CSP, y se mejora revalidando la sesión en acciones sensibles.

## 13. Orden de trabajo sugerido

1. **H1 y H2:** son pocos cambios y de mayor impacto (el flujo principal funciona y el MFA coincide con lo declarado).
2. **`withAuth()` y su prueba** (H3).
3. **Permisos IAM estrechos y auditoría** con solo `PutItem`, denegados y actor pseudonimizado (H5, H6).
4. **Retención de logs, CloudTrail, CORS y throttling** en el template (H7, H8).
5. **Pruebas de integración y `cfn-lint`** en el CI (H11).
6. **Decidir sobre Cedar**: conectarlo de verdad o retirar el código muerto y corregir lo que declara `AI_USAGE.md` (H4).
7. Lo demás (revalidación de sesión, PITR) según el tiempo disponible.
