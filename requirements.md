# Requerimientos — Plataforma de Donaciones Seguras (2026)

**Curso:** Tópicos Avanzados en Ingeniería de Software — EPIS, UNSA
**Versión:** 2.0 | **Fecha:** 2026-11-02 | **Caso:** Fundación peruana ficticia «Fundación AQP-SOLIDARIA»
**Enfoque:** aplicación cloud-native serverless con modelo de seguridad Zero Trust (NIST SP 800-207)
**Duración:** 1 semana calendario (7 días) | **Equipo:** 4 a 5 integrantes | **Cuenta:** AWS Free plan (una por equipo)
**Diseño asociado:** [design.md](./design.md)

> **Cambios respecto a v1.0:** cuenta AWS Free plan en lugar de AWS Academy; duración de una semana; MFA obligatorio para roles privilegiados; tokens de vida corta y limitación de revocación documentada; mapeo explícito a NIST SP 800-207; PKCE obligatorio; validación de `client_id` y scopes; endpoint de simulación limitado al stage académico; idempotencia atómica; HU-09 pasa a MVP; nueva extensión con Amazon Verified Permissions; archivo renombrado a `requirements.md`.

## 1. Contexto, alcance y principios

Una fundación peruana administra proyectos sociales (educación, alimentación y salud comunitaria) y necesita publicar sus campañas y recibir **intenciones de donación** verificables y auditables. La evaluación académica utilizará **donaciones simuladas**, no fondos reales: está prohibido solicitar o almacenar números de tarjeta, CVV, credenciales bancarias o realizar cargos. La integración de pago real, conciliación financiera, comprobantes tributarios y verificación legal de una fundación quedan **fuera de alcance**.

**Objetivos pedagógicos:** diseñar experiencias para donantes, modelar estados de donación, aplicar autenticación y autorización en servidor, prevenir alteraciones y duplicados, auditar acciones y **demostrar controles Zero Trust mediante pruebas negativas**. Se usa una SPA React y backend AWS Lambda; **Zero Trust es el modelo de seguridad**, no un sustituto de la arquitectura de aplicación.

**Principios Zero Trust aplicados (NIST SP 800-207):** ninguna solicitud es confiable por su origen de red; cada solicitud protegida se autentica y autoriza por recurso; privilegio mínimo en usuarios y en cargas de trabajo; asumir brecha (limitar impacto y registrar evidencia).

**Fuera de alcance declarado (limitaciones Zero Trust):** verificación de postura del dispositivo, evaluación continua de riesgo de sesión, ZTNA (AWS Verified Access) y detección gestionada (GuardDuty/Security Hub), por no estar disponibles en el AWS Free plan. Estas limitaciones deben explicarse en el informe.

### Roles y matriz de permisos

| Función | Visitante | Donante | Gestor | Auditor |
|---|:---:|:---:|:---:|:---:|
| Ver proyectos publicados y totales agregados | Sí | Sí | Sí | Sí |
| Crear intención de donación simulada | No | Sí | No | No |
| Simular confirmación de donación propia (solo stage académico) | No | Sí | No | No |
| Ver historial propio | No | Sí | No | No |
| Crear/editar/publicar proyectos | No | No | Sí | No |
| Consultar eventos de auditoría | No | No | No | Sí |
| **MFA obligatorio** | — | Opcional | **Sí** | **Sí** |

Los roles se representan como **grupos de Cognito** (`DONANTE`, `GESTOR`, `AUDITOR`) y se leen del claim `cognito:groups` del access token. Los permisos se verifican **siempre en backend**, nunca solo ocultando botones. Usuarios y proyectos son ficticios.

## 2. Épicas e historias de usuario

Prioridad: **MVP** = obligatorio; **Extensión** = puntos adicionales, no necesaria para nota máxima. Cada criterio tiene identificador para trazabilidad.

### EP-01. Descubrimiento de proyectos

**HU-01 — Listar proyectos (MVP).** Como visitante quiero explorar proyectos sociales abiertos para elegir una causa.

- **CA-01.1:** Dado que existen proyectos PUBLICADO, al acceder al catálogo se muestran nombre, finalidad, meta en PEN y suma **confirmada simulada**.
- **CA-01.2:** Un proyecto BORRADOR no aparece en el catálogo público.
- **CA-01.3:** Si no hay proyectos publicados, se presenta un estado vacío comprensible sin errores técnicos.

**HU-02 — Consultar detalle (MVP).** Como visitante quiero conocer el detalle y progreso de un proyecto antes de donar.

- **CA-02.1:** Se visualiza identificador, descripción, objetivo, estado y monto acumulado sin datos personales de donantes.
- **CA-02.2:** Un identificador inexistente o un proyecto no publicado devuelve HTTP 404 al visitante, sin revelar contenido.

### EP-02. Identidad y acceso

**HU-03 — Iniciar y cerrar sesión (MVP).** Como donante quiero autenticarme para que mis acciones tengan una identidad verificable.

- **CA-03.1:** El inicio de sesión usa Amazon Cognito (managed login u hosted UI) con **Authorization Code + PKCE obligatorio**; no se usa el flujo implícito.
- **CA-03.2:** Una ruta protegida sin token, con token expirado, alterado, de otro app client o con un **ID token** en lugar de access token devuelve HTTP 401.
- **CA-03.3:** El access token tiene una vigencia **≤ 15 minutos** (mínimo de Cognito: 5 min). Al cerrar sesión, la SPA elimina los tokens de memoria y revoca el refresh token (`/oauth2/revoke` o `RevokeToken`).
- **CA-03.4:** Se documenta y demuestra la limitación: el JWT authorizer de API Gateway valida firma y expiración localmente, por lo que un access token revocado sigue siendo aceptado hasta expirar; la ventana de exposición queda acotada por CA-03.3.

**HU-04 — Control de roles (MVP).** Como responsable de la fundación quiero que solo las personas autorizadas realicen operaciones sensibles.

- **CA-04.1:** Un donante no puede crear, modificar ni publicar proyectos; el API responde HTTP 403.
- **CA-04.2:** Un gestor no puede consultar el historial privado de un donante; el API responde HTTP 403 o 404 sin filtrar información.
- **CA-04.3:** El backend obtiene identidad (`sub`) y roles (`cognito:groups`) exclusivamente de claims verificados, nunca de campos enviados por el cliente.

**HU-11 — MFA para roles privilegiados (MVP).** Como responsable de seguridad quiero un segundo factor para cuentas con privilegios.

- **CA-11.1:** Los usuarios de los grupos GESTOR y AUDITOR tienen MFA TOTP (app autenticadora) configurado; no se usa MFA por SMS.
- **CA-11.2:** Se evidencia (captura o prueba) que un usuario GESTOR no completa el inicio de sesión sin el segundo factor.

### EP-03. Donaciones simuladas

**HU-05 — Registrar intención de donación (MVP).** Como donante autenticado quiero registrar un monto destinado a un proyecto para seguir mi aporte de prueba.

- **CA-05.1:** Dado un proyecto PUBLICADO, un importe válido en PEN (mínimo S/ 1.00, máximo S/ 1,000.00, máximo dos decimales; se envía como `amountCents` entero entre 100 y 100000) y una cabecera `Idempotency-Key` (UUID), se crea un registro `PENDIENTE_SIMULACION` y HTTP 201.
- **CA-05.2:** Monto cero, negativo, no entero, fuera de límites o ausencia de `Idempotency-Key` devuelve HTTP 400; proyecto inexistente 404; proyecto no PUBLICADO 409. Ninguno modifica el acumulado.
- **CA-05.3:** El `donorSub` se obtiene de la identidad autenticada, nunca del cuerpo de la solicitud.
- **CA-05.4:** Reenviar la misma clave con la misma carga devuelve el mismo resultado sin crear otra donación; reutilizarla con carga distinta devuelve HTTP 409. El registro de la clave y la donación se escriben de forma atómica.
- **CA-05.5:** No se solicitan datos de tarjeta, CVV, cuenta bancaria, DNI ni datos de pago reales.

**HU-06 — Simular confirmación (MVP).** Como donante quiero comprobar el resultado de mi contribución en un flujo de prueba.

- **CA-06.1:** El endpoint de simulación permite pasar una donación **propia** de `PENDIENTE_SIMULACION` a `CONFIRMADA_SIMULADA` o `RECHAZADA_SIMULADA`, y **solo se despliega en el stage académico** (condición en la plantilla SAM); en otro stage la ruta no existe.
- **CA-06.2:** Solo la primera transición válida modifica el monto confirmado; solicitudes repetidas o concurrentes no alteran el total (HTTP 409 en transición inválida).
- **CA-06.3:** Una donación rechazada no incrementa cifras agregadas.
- **CA-06.4:** La UI muestra **«Simulación académica: no se ha realizado ningún cobro»**.

**HU-07 — Ver historial propio (MVP).** Como donante quiero consultar mis donaciones simuladas para verificar su estado.

- **CA-07.1:** El historial muestra solo registros del `sub` autenticado, con fecha, importe, proyecto y estado.
- **CA-07.2:** Consultar una donación de otro usuario devuelve 403 o 404 sin revelar datos (prueba BOLA).

### EP-04. Gestión y transparencia

**HU-08 — Gestionar proyectos (MVP).** Como gestor quiero registrar y publicar proyectos para habilitar donaciones simuladas.

- **CA-08.1:** Solo GESTOR crea proyectos con título, descripción, objetivo PEN positivo y estado BORRADOR.
- **CA-08.2:** Solo GESTOR publica un proyecto válido; un BORRADOR no acepta donaciones; publicar uno ya publicado devuelve 409.
- **CA-08.3:** Toda creación/publicación registra un evento de auditoría con actor, fecha, acción y resultado.

**HU-09 — Indicadores agregados (MVP).** Como visitante quiero conocer los montos confirmados para comprender el avance de cada campaña.

- **CA-09.1:** La suma excluye pendientes y rechazadas; los montos se muestran en formato PEN.
- **CA-09.2:** La vista pública no expone identificadores de donantes ni registros individuales.

**HU-10 — Consultar auditoría (Extensión).** Como auditor quiero consultar acciones críticas para investigar desviaciones.

- **CA-10.1:** Solo AUDITOR (con MFA) obtiene eventos de auditoría, con filtros por tipo y fecha.
- **CA-10.2:** Los eventos incluyen `timestamp`, `requestId`, actor seudonimizado, recurso, acción y resultado; nunca tokens, claves ni datos financieros.

**HU-12 — Autorización externalizada (Extensión).** Como arquitecto quiero separar la decisión de autorización del código de negocio, alineado con el Policy Engine de NIST.

- **CA-12.1:** Las reglas de HU-04, HU-07 y HU-08 se expresan en Cedar y se evalúan con Amazon Verified Permissions (`IsAuthorized`) desde Lambda.
- **CA-12.2:** Las pruebas T03, T09 y T12 pasan igual con el motor externo; se compara en el informe la autorización embebida frente a la externalizada.

## 3. Requerimientos no funcionales como historias verificables

**RNF-HU-01 — Confidencialidad en tránsito (MVP).** Como responsable de seguridad quiero que todas las comunicaciones usen HTTPS.
- **CA-NF01.1:** Frontend (CloudFront) y API (API Gateway) usan TLS; no hay interfaz servida por HTTP.
- **CA-NF01.2:** No aparecen secretos, JWT ni datos personales en logs ni en el repositorio GitHub.

**RNF-HU-02 — Zero Trust e identidad (MVP).** Como responsable de seguridad quiero que cada solicitud protegida sea autenticada y autorizada sin confianza implícita.
- **CA-NF02.1:** El JWT authorizer valida emisor (user pool), firma, expiración y `client_id` (los access tokens de Cognito no incluyen `aud`); las rutas protegidas exigen scopes, de modo que un ID token no sirve como credencial.
- **CA-NF02.2:** Lambda valida rol, propietario del recurso y reglas de negocio en cada solicitud; no se confía en roles, montos ni IDs enviados por el navegador.
- **CA-NF02.3:** El informe incluye la tabla de mapeo de controles a los 7 principios de NIST SP 800-207 y a los componentes PE/PA/PEP (ver design.md §6).

**RNF-HU-03 — Mínimo privilegio (MVP).** Como administrador cloud quiero reducir el impacto de una función comprometida.
- **CA-NF03.1:** Cada función Lambda tiene su propio rol con solo las acciones DynamoDB y tablas que necesita (por ejemplo, la función de listado no puede escribir).
- **CA-NF03.2:** No hay credenciales AWS persistentes en código ni en CI; no hay `Action: "*"` ni `Resource: "*"` injustificados.
- **CA-NF03.3:** Ningún integrante usa el usuario root para trabajar; cada uno tiene un usuario IAM con MFA y sin llaves de acceso de larga duración.

**RNF-HU-04 — Integridad e idempotencia (MVP).** Como responsable financiero quiero evitar aportes duplicados y saldos incorrectos.
- **CA-NF04.1:** Un mismo evento de confirmación no se contabiliza dos veces, incluso ante solicitudes concurrentes (se demuestra con al menos 10 solicitudes paralelas).
- **CA-NF04.2:** Transiciones y acumulado se actualizan con `TransactWriteItems` condicionado; se documenta la decisión.

**RNF-HU-05 — Rendimiento (MVP).** Como donante quiero que la consulta de proyectos sea fluida.
- **CA-NF05.1:** Con 50 proyectos, el 95% de respuestas GET del backend (excluyendo cold start) completa en ≤ 1.5 s desde un cliente cercano a la región.
- **CA-NF05.2:** Se registran método, herramienta y condiciones de medición.

**RNF-HU-06 — Accesibilidad y usabilidad (MVP).** Como visitante quiero usar el sistema desde móvil y teclado.
- **CA-NF06.1:** Catálogo, detalle, donación y confirmación son usables a 375 px de ancho.
- **CA-NF06.2:** Formularios con etiquetas, mensajes accesibles y foco visible; se evalúan criterios WCAG 2.2 AA aplicables.

**RNF-HU-07 — Observabilidad y trazabilidad (MVP).** Como auditor técnico quiero reconstruir resultados sin exponer secretos.
- **CA-NF07.1:** Logs JSON con `requestId`, acción, resultado, código HTTP y duración; retención de logs ≤ 14 días.
- **CA-NF07.2:** Se muestran en CloudWatch al menos un caso exitoso y uno rechazado (401/403); CloudTrail evidencia los cambios de infraestructura.

**RNF-HU-08 — Calidad y mantenibilidad (MVP).** Como equipo quiero un producto verificable y reproducible.
- **CA-NF08.1:** Pruebas automáticas de validaciones, autorización, idempotencia y transiciones; CI en GitHub Actions ejecuta lint, typecheck, tests y build en cada PR.
- **CA-NF08.2:** Infraestructura en AWS SAM; README con despliegue y eliminación de recursos (`sam delete`).

**RNF-HU-09 — Presupuesto y cuenta (MVP).** Como estudiante quiero evitar cargos inesperados.
- **CA-NF09.1:** La cuenta es AWS **Free plan**; se usa una sola región; se configura una alerta en AWS Budgets; antes de desplegar se verifica que cada servicio esté en la lista del Free plan.
- **CA-NF09.2:** Al cierre se ejecuta el procedimiento de limpieza y se verifica que no queden recursos.

**RNF-HU-10 — Protección de datos (MVP).** Como titular de datos quiero que se minimice su tratamiento.
- **CA-NF10.1:** Solo identidades y proyectos de prueba; solo atributos imprescindibles (correo de prueba y `sub`).
- **CA-NF10.2:** La aplicación informa que es prototipo académico; un despliegue real exigiría evaluación legal peruana (Ley N.º 29733), privacidad y retención.

**RNF-HU-11 — Seguridad del navegador (MVP).** Como responsable de seguridad quiero reducir el impacto de un XSS.
- **CA-NF11.1:** Los tokens se mantienen en memoria (no en `localStorage`); cualquier alternativa se justifica en el informe.
- **CA-NF11.2:** CloudFront entrega cabeceras de seguridad (CSP restrictiva, HSTS, `X-Content-Type-Options`, `Referrer-Policy`) mediante una response headers policy.

## 4. Modelo de datos lógico mínimo

- `Project`: `projectId`, `title`, `description`, `goalAmountCents`, `confirmedAmountCents`, `currency=PEN`, `status` (`BORRADOR`, `PUBLICADO`), `createdAt`, `updatedAt`.
- `Donation`: `donationId`, `projectId`, `donorSub`, `amountCents`, `currency=PEN`, `status` (`PENDIENTE_SIMULACION`, `CONFIRMADA_SIMULADA`, `RECHAZADA_SIMULADA`), `createdAt`, `updatedAt`.
- `IdempotencyRecord`: `pk = donorSub#createDonation#idempotencyKey`, `payloadHash`, `donationId`, `responseStatus`, `expiresAt` (TTL).
- `AuditEvent`: `eventId`, `timestamp`, `requestId`, `actorRef` (seudónimo), `action`, `resourceRef`, `outcome`.

**Invariantes:** montos en centavos enteros; una clave de idempotencia por usuario y operación; confirmación registrada una sola vez; historial limitado al propietario; transición solo de pendiente a un estado terminal.

## 5. Priorización y criterios de terminado (Definition of Done)

**MVP obligatorio:** HU-01 a HU-09, HU-11 y RNF-HU-01 a RNF-HU-11. **Extensión:** HU-10 y HU-12. Se admite simplificar la interfaz, **no** eliminar controles de seguridad. No se sustituirá Cognito por un JWT autoemitido ni por un login ficticio presentado como Zero Trust.

Entregado cuando: (a) demo con usuarios de prueba de los cuatro roles; (b) pruebas T01–T14 ejecutadas con evidencia; (c) logs sin secretos; (d) README con despliegue, limpieza y restricciones de la cuenta; (e) GitHub con PR revisados y CI en verde; (f) tabla de mapeo NIST; (g) `AI_USAGE.md` completo; (h) recursos AWS eliminados tras la evaluación.

## 6. Casos de prueba de aceptación mínimos

| ID | Escenario | Esperado | Trazabilidad |
|---|---|---|---|
| T01 | Visitante consulta proyectos | 200, sin borradores | CA-01.1, CA-01.2 |
| T02 | Sin token intenta donar | 401 | CA-03.2 |
| T03 | Donante intenta crear proyecto | 403 | CA-04.1 |
| T04 | Donante envía 0, 100001 o valor no entero | 400 | CA-05.2 |
| T05 | Donante crea intención válida | 201, pendiente, sin cargo | CA-05.1 |
| T06 | Repite clave y payload idénticos | Mismo resultado, una sola donación | CA-05.4 |
| T07 | Repite clave con payload distinto | 409 | CA-05.4 |
| T08 | 10 confirmaciones concurrentes de la misma donación | Un solo incremento | CA-06.2, CA-NF04.1 |
| T09 | Donante consulta donación ajena | 403/404 sin filtración | CA-07.2 |
| T10 | Lambda de listado intenta escribir en DynamoDB (prueba controlada o IAM Policy Simulator) | `AccessDenied` y error controlado | CA-NF03.1 |
| T11 | Usa un ID token o token alterado como Bearer | 401 | CA-03.2, CA-NF02.1 |
| T12 | Gestor consulta historial de un donante | 403/404 | CA-04.2 |
| T13 | Token revocado usado antes de expirar | Aceptado hasta expirar (limitación documentada); rechazado después | CA-03.4 |
| T14 | Usuario GESTOR inicia sesión sin segundo factor | No obtiene tokens | CA-11.2 |

## 7. Trazabilidad y entrega

Los identificadores HU/CA/RNF-HU deben aparecer en al menos un test y en el informe técnico. Entregables: repositorio GitHub, `requirements.md`, `design.md`, README, OpenAPI, evidencias de pruebas, URL demo HTTPS (activa durante la evaluación), informe técnico y `AI_USAGE.md`. Plazo: **una semana calendario** desde la publicación del caso; la fecha exacta la establece el docente.

## 8. Referencias

- NIST SP 800-207 — Zero Trust Architecture: https://csrc.nist.gov/pubs/sp/800/207/final
- NIST SP 800-207A — ZTA para aplicaciones cloud-native: https://csrc.nist.gov/pubs/sp/800/207/a/final
- NIST SP 1800-35 (2025) — Implementación ZTA: https://csrc.nist.gov/pubs/sp/1800/35/final
- CISA Zero Trust Maturity Model v2.0: https://www.cisa.gov/resources-tools/resources/zero-trust-maturity-model
- OWASP API Security Top 10: https://owasp.org/API-Security/
- API Gateway JWT authorizers: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html
- Cognito — revocación de tokens: https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html
- Servicios incluidos en el AWS Free plan: https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html

> Nota: especificación de prototipo académico; no constituye evaluación de cumplimiento legal ni PCI DSS para recaudación de fondos reales.
