# Análisis de la rama `feat/donation-velocity-limits` y mejoras pendientes

Documento de trabajo. Reúne el análisis hecho sobre la rama frente a `main`, el estado del throttling y la observabilidad, y las reglas de negocio que faltan. **No hay nada implementado a partir de este documento**: es la lista de lo que conviene hacer, con el motivo y la forma de verificarlo.

- Fecha del análisis: 2026-11-09.
- Rama analizada: `feat/donation-velocity-limits` (2 commits sobre `main`: `888a97a` y `e2ca36d`; 29 archivos, +1283/-73).
- Método: lectura completa del diff, del código de `main` que lo rodea, de `infra/template.yaml` y de la documentación de AWS.
- **No se ejecutaron los tests ni el typecheck**: `node_modules` no estaba instalado y no se instaló. Todo lo que sigue sale de leer el código y la documentación. Lo no verificado está en la sección 9.

---

## 1. Resumen

| Tema | Conclusión |
|---|---|
| ¿Hace falta un load balancer? | No. API Gateway y Lambda ya cumplen ese papel. |
| ¿WAF? | No aplica: un HTTP API no admite WAF y el proyecto ya lo excluyó. |
| Throttling de API Gateway | Ya existe, pero es **global por ruta**, no por usuario. |
| La rama de velocidad | Aporta, de forma parcial: cubre el límite **por usuario** que faltaba. Diseño técnico correcto, con huecos de producto. |
| Hallazgos nuevos (no estaban en la rama ni en `main`) | El modal miente sobre el estado, el auditor no ve los datos nuevos, IAM da más de lo que dice, y **no existe cierre de campaña**. |

---

## 2. Arquitectura: load balancer, WAF y costos

### 2.1 Load balancer
No hace falta. La arquitectura es serverless (SAM, HTTP API, Lambda, DynamoDB):
- API Gateway es un punto de entrada administrado, multi-AZ y con escalado automático.
- Lambda escala con una instancia por request concurrente.
- Un ALB cobra tarifa fija por hora aunque no tenga tráfico.

Solo tendría sentido si el backend pasara a contenedores (ECS/Fargate) o se necesitaran conexiones persistentes. En ese caso iría **detrás** de API Gateway mediante VPC Link. Delante del API lo que se pone es CloudFront (CDN), no un balanceador.

### 2.2 WAF (corrección a una recomendación anterior)
Se llegó a sugerir WAF delante del API. **Es incorrecto para esta arquitectura**:
- Un HTTP API no se integra con AWS WAF ([design.md:160](../design.md#L160), [free-plan-guide.md](free-plan-guide.md)). Solo se podría con CloudFront o cambiando a REST API.
- Los planes planos de CloudFront que incluyen WAF no están disponibles en cuentas del plan gratuito.
- WAF no tiene capa gratuita (cobra Web ACL, reglas y requests desde el primer día).

No se recomienda. Ya está declarado como fuera de alcance en `docs/zta-hallazgos-y-mejoras.md` y `.checkov.yaml` (CKV_AWS_68).

### 2.3 Costos de los servicios de observabilidad (verificar precios vigentes en la calculadora de AWS)
- **SNS:** 1 millón de publicaciones/mes gratis; email: primeras 1,000 al mes gratis. Evitar SMS (se cobra por mensaje). Al suscribir un email hay que confirmar el enlace que llega, o no se reciben alertas.
- **CloudWatch:** las primeras 10 alarmas estándar son gratis; después, unos US$0.10 por alarma al mes.
- **AWS Budgets:** los dos primeros budgets son gratis. Solo avisa, no bloquea.
- La constitución del proyecto menciona una alerta de Budget "desde el día 1", pero **`infra/template.yaml` no define ningún `AWS::Budgets::Budget`** (comprobado por búsqueda). Está pendiente o se creó a mano en la consola.

---

## 3. Throttling y rate limiting actuales

Configuración en [infra/template.yaml:499-511](../infra/template.yaml#L499-L511):

| Ámbito | Rate (req/s) | Burst |
|---|---|---|
| Por defecto, todas las rutas | 25 | 50 |
| `GET /v1/projects`, `GET /v1/projects/{id}`, `GET /v1/projects/{id}/stats` | 10 | 20 |

Hechos verificados en la documentación de AWS (`http-api-throttling`):
- Es un *token bucket*: **rate** = tokens repuestos por segundo; **burst** = tamaño del cubo. Sin tokens, 429 sin invocar la Lambda.
- El throttle es **de mejor esfuerzo**: son objetivos, no techos garantizados.
- El límite por ruta sustituye al del stage pero **no puede superar el de la cuenta**.
- Es **global por ruta**: un solo cliente abusivo puede agotar la cuota de todos. Los HTTP API no tienen usage plans por cliente (eso es de REST API).

**Decisión: no tocar `POST /v1/donations`.** Bajar su límite global dejaría que un abusador deje sin cupo a todos los donantes, que es justo lo que el control por donante de la rama resuelve.

### 3.1 CloudWatch, Budgets y SNS (cómo se usarían)
- **Logs Insights** sobre el log group de access logs (ya existe `ApiAccessLogGroup`), por ejemplo `filter status = 429 | stats count() by sourceIp`.
- **Métricas** automáticas de API Gateway y Lambda (`Count`, `4xx`, `5xx`, `Latency`, `Errors`, `Throttles`).
- **Alarmas** + tópico SNS por email para: picos de 4xx/5xx del API, errores de Lambda, y la métrica de Cognito `SignUpThrottles`.
- El template **no define alarmas ni tópicos SNS todavía**. Antes de crearlas, ver el punto 4.4 (los 429/503 hoy se registran como errores).

---

## 4. Rama `feat/donation-velocity-limits`

### 4.1 Qué agrega
Controles antiabuso **por donante** al crear una donación:
- Máximo **5 donaciones nuevas por minuto** (ventana fija UTC). La sexta recibe 429 y se audita `DONATION_RATE_LIMITED`.
- Revisión **horaria**: si el total de la hora supera **S/ 5,000**, o hay **3 donaciones de al menos S/ 900** (90% del máximo), la donación queda `EN_REVISION` y se audita `SUSPICIOUS_VELOCITY`.
- `EN_REVISION` no se puede confirmar ni rechazar (409) y nunca suma al proyecto.
- Umbrales como parámetros de la plantilla (`VelocityMaxPerMinute`, `VelocityReviewThresholdCents`, `VelocityStructuringCount`).
- Contadores en la tabla de idempotencia (`velocity#...`), en la **misma transacción** que la donación. Reintentos idempotentes y peticiones con 429 no escriben nada.
- Reintentos con backoff exponencial y jitter completo (máx. 8 intentos y 3 s); al agotarse, 503 con `Retry-After`.

### 4.2 Lo que sí aporta
1. **Cubre el hueco del throttling por usuario** sin pagar WAF.
2. **Diseño técnico correcto:** contadores atómicos en la misma transacción; ventana horaria con concurrencia optimista y lectura consistente; la clasificación de cancelaciones por ítem coincide con la documentación de DynamoDB (el SDK no reintenta `TransactionCanceledException` y `CancellationReasons` viene en el orden de los ítems).
3. **Seguridad:** IAM acotado a una tabla (ver 4.3.3 para el matiz), test de infra que lo verifica, eventos de auditoría sin datos personales (`details` solo numérico).
4. **Documentado con honestidad** en `docs/threat-model.md` (límites: ventanas fijas, control por cuenta, sin flujo de revisión).

### 4.3 Hallazgos y cambios propuestos

#### 4.3.1 El modal de donación afirma un estado falso — **prioridad alta, esfuerzo bajo**
[frontend/src/components/DonationModal.tsx:85](../frontend/src/components/DonationModal.tsx#L85) escribe a mano "registrada en estado PENDIENTE_SIMULACION" y manda a pulsar "Simular Aprobación". Si la donación quedó `EN_REVISION`, es falso y simularla devuelve 409.
- **Cambio:** usar `result.status` de la respuesta y mostrar un texto específico para `EN_REVISION` (retenida por controles antifraude; no se suma al proyecto ni puede simularse).

#### 4.3.2 El auditor no ve los datos que la rama añadió — **prioridad alta, esfuerzo bajo**
Los eventos nuevos guardan `reason` y `details` (total horario, umbral, conteos) y `getAuditEvents` devuelve el ítem completo. Pero [frontend/src/pages/AuditorPage.tsx:7-16](../frontend/src/pages/AuditorPage.tsx#L7-L16) no declara esos campos y la tabla no muestra tipo de evento, `reason` ni `details`. Una donación retenida aparece como "CreateDonation … SUCCESS", igual que una normal; solo el filtro desplegable las distingue.
- **Cambio:** declarar `eventType`, `reason`, `details` en la interfaz; añadir columnas de tipo de evento y motivo, y mostrar `details`.

#### 4.3.3 IAM concede más de lo que la documentación promete — **prioridad media, esfuerzo bajo-medio**
[iam-permissions-matrix.md](../specs/002-zta-hardening/contracts/iam-permissions-matrix.md) dice "U (solo contadores `velocity#`)", pero la política en [infra/template.yaml:694-697](../infra/template.yaml#L694-L697) da `dynamodb:UpdateItem` sobre **toda** la tabla de idempotencia. Solo el código acota el alcance.
- **Cambio propuesto:** añadir una condición `dynamodb:LeadingKeys` con `StringLike` `velocity#*`. La documentación de AWS confirma que `LeadingKeys` restringe por valor de clave de partición; **el uso de comodín con `StringLike` no se confirmó en la documentación y hay que probarlo**.
- Ajustar `backend/test/infra/velocityControls.test.ts` y correr `backend/test/floci/iamEnforcement.test.ts`.

#### 4.3.4 Los 429 y 503 se registran como errores — **prioridad media, esfuerzo bajo**
[backend/src/authz/withAuth.ts](../backend/src/authz/withAuth.ts) llama a `logError("Request failed")` para toda excepción, incluidos los resultados esperados (429, 503). Si se añaden alarmas por errores, el comportamiento normal de un usuario las dispararía.
- **Cambio:** registrar los `AppError` esperados (429, 503) como `warn`.

#### 4.3.5 Comportamiento no cubierto por tests ni documentado — **prioridad media, esfuerzo bajo**
`assessDonation` suma todo lo anterior de la hora. Tras superar el umbral, **todas las donaciones siguientes de esa hora quedan `EN_REVISION`**, incluso una de S/ 1. Con 3 donaciones de al menos S/ 900, cualquier donación posterior de la hora también queda retenida.
- **Cambio:** un test que fije el comportamiento y una línea en `docs/threat-model.md`.
- **Decisión pendiente** (ver 7): si se prefiere marcar solo la donación que cruza el umbral, es un cambio pequeño en `assessDonation` pero cambia la semántica (de detector de estado a detector de cruce).

### 4.4 Problemas de lógica de las reglas (para documentar; cambiarlas solo con decisión)

1. **Las dos reglas no hacen lo que se esperaría.** La de "3 donaciones ≥ S/ 900" salta con S/ 2,700 acumulados, mucho antes que los S/ 5,000 de la otra. Así, la de S/ 5,000 solo se alcanza con donaciones menores a S/ 900. La de "cercanas al máximo" penaliza al donante generoso, no a quien fracciona. El tope de S/ 1,000 es una validación del API, no un umbral de reporte, de modo que esto es una heurística propia del proyecto.
2. **El fraccionamiento real no se detecta.** Los contadores se reinician cada hora: S/ 5,000 cada hora o S/ 20,000 en 4 horas nunca se marca. No hay vista diaria ni semanal.
3. **Lo marcado no se bloquea.** Una donación retenida solo no suma al proyecto; el donante puede seguir creando. En el stage académico, además, el propio donante confirma o rechaza sus donaciones con el botón de simulación.
4. **Clave de idempotencia en la UI (ya existía en `main`).** El modal genera un `crypto.randomUUID()` nuevo en cada envío ([DonationModal.tsx:41](../frontend/src/components/DonationModal.tsx#L41)). `docs/api.yaml` dice que tras un 503 se puede repetir "con la misma Idempotency-Key", pero la UI nunca la reutiliza. Tras un 503 no pasa nada (no se escribió nada); el riesgo real es un duplicado si la donación se crea pero se pierde la respuesta.
5. **Las retenidas cuentan** en el límite por minuto y en el total horario. Correcto, pero no está dicho en ningún sitio.

### 4.5 `EN_REVISION` no tiene salida
Nadie puede liberar ni rechazar esas donaciones. `docs/threat-model.md` ya lo declara ("no existe todavía un flujo para que un revisor la libere o la rechace").

**No se recomienda construir el flujo ahora.** Razones verificadas en el código:
- **El auditor no puede ser el revisor:** [evaluateAuthz.ts:45](../backend/src/authz/evaluateAuthz.ts#L45) prohíbe combinar el rol AUDITOR con otros; el sistema se basa en que el auditor observa y no actúa.
- **No hay cómo listar las retenidas:** la tabla de donaciones solo tiene el índice `donorSub-createdAt`. Listar `EN_REVISION` exigiría un índice nuevo o un `Scan`.
- Un revisor real implica un rol nuevo (grupo de Cognito, scope, matriz de autorización, tests).

**Alternativa recomendada:** corregir el modal (4.3.1), mostrar en el historial por qué está retenida (ya existe el texto) y mantener la resolución como **fase 2** documentada. La tabla de auditoría ya registra `SUSPICIOUS_VELOCITY` con el id de la donación, así que el auditor puede ver qué se retuvo (una vez resuelto el 4.3.2).

### 4.6 Riesgos anotados, sin cambio propuesto
- **Auditoría sin tope:** cada petición rechazada con 429 escribe un evento en la tabla de auditoría. Limitado solo por el throttling global (25 req/s), un abusador puede inflar el registro y esconder eventos reales. Para este proyecto: documentar, no resolver.
- **Registro de cuentas abierto:** `AllowAdminCreateUserOnly: false` ([template.yaml:331-332](../infra/template.yaml#L331-L332)). El control es por `sub`, así que varias cuentas lo evaden. **Matiz:** el pool tiene MFA TOTP obligatorio y verificación de email, y usa el email por defecto de Cognito, que según la documentación tiene un tope diario por pool. Eso encarece el ataque, aunque los emails desechables siguen sirviendo. La cuota exacta no se verificó. Ya está declarado en `threat-model.md`; solo falta el matiz.
- **Ventana fija:** hasta 10 donaciones en el borde entre dos minutos. Ya documentado.
- **Complejidad de `createDonation.ts`:** pasó de unas 50 a unas 250 líneas. Es correcto y coincide con la documentación; si se quiere simplificar, mover el bucle de reintentos a un módulo propio. Prioridad baja; medir la contención real antes de ajustar `MAX_ATTEMPTS` y `RETRY_BUDGET_MS`.
- **Fragilidad posible de un test:** `backend/test/integration/velocity.test.ts` exige exactamente 5 respuestas 201 y 5 respuestas 429 con 10 peticiones simultáneas de un donante. Con 8 intentos y 3 s, un 503 por contención es improbable pero posible. Solo se descarta ejecutándolo varias veces.
- **Los tests unitarios usan `FakeDynamo`** (una reimplementación de 158 líneas): validan la clasificación, no el comportamiento real de DynamoDB. Eso lo cubre el test de integración con DynamoDB Local.

---

## 5. Reglas de negocio que faltan (ya existían en `main`)

**No hay ninguna noción de fin de campaña.** Esta rama no lo cambia; se detectó al revisar el dominio completo.

- Los estados del proyecto son solo `BORRADOR` y `PUBLICADO` ([requirements.md:169](../requirements.md#L169)).
- No existe fecha límite ni campo parecido.
- Crear una donación solo valida: que el proyecto exista, que el donante no sea su creador y que esté `PUBLICADO` ([createDonation.ts:61-73](../backend/src/donations/createDonation.ts#L61-L73)). **Nunca compara el total con `goalAmountCents`.**
- Confirmar una donación ([simulateDonation.ts](../backend/src/donations/simulateDonation.ts)) tampoco compara con la meta.
- El gestor no puede cerrar ni despublicar un proyecto.

**Consecuencia:** se puede donar mucho más que la meta. Una sola donación tiene tope de S/ 1,000, pero con muchas, de varios donantes, un proyecto de meta S/ 2,000 puede reunir S/ 1,000,000. La interfaz lo oculta con `Math.min(100, ...)` en [ProjectCard.tsx:11](../frontend/src/components/ProjectCard.tsx#L11), [ProjectDetailPage.tsx:25](../frontend/src/pages/ProjectDetailPage.tsx#L25) y [getProjectStats.ts:22](../backend/src/projects/getProjectStats.ts#L22): muestra "100%" y sigue aceptando donaciones.

**Decisiones de dominio pendientes** (ver sección 7).

---

## 6. Plan de trabajo propuesto

Orden sugerido. "Esta rama" significa que conviene hacerlo antes de fusionar `feat/donation-velocity-limits`.

| # | Cambio | Dónde | Esfuerzo | Valor |
|---|---|---|---|---|
| 1 | Usar el estado real y explicar `EN_REVISION` en el modal | `DonationModal.tsx` (esta rama) | Bajo | Alto |
| 2 | Mostrar tipo de evento, motivo y `details` al auditor | `AuditorPage.tsx` (esta rama) | Bajo | Alto |
| 3 | Test que fije "una vez marcado, todo marcado" + documentarlo | `test/donations`, `threat-model.md` (esta rama) | Bajo | Medio |
| 4 | Registrar 429/503 como `warn` | `withAuth.ts` (esta rama) | Bajo | Medio |
| 5 | Acotar IAM con `LeadingKeys` `velocity#*` (probar el comodín) | `template.yaml`, tests de infra y floci (esta rama) | Bajo-medio | Medio |
| 6 | Documentar los problemas de lógica de 4.4 y el matiz de las cuentas | `docs/threat-model.md` | Mínimo | Medio |
| 7 | Resolver el cierre de campaña (sección 5) | Dominio completo | Medio-alto | Alto, **depende de decisión** |
| 8 | Alarmas CloudWatch + SNS por email, y `AWS::Budgets::Budget` | `template.yaml` | Bajo | Medio; **hacerlo después del 4** |
| 9 | Extraer el bucle de reintentos a un módulo | `createDonation.ts` | Bajo | Bajo |

### Descartado, con motivo
- **WAF:** no se asocia a un HTTP API y está fuera del plan gratuito.
- **Load balancer:** innecesario con Lambda.
- **Bajar el throttling de `POST /v1/donations`:** es global, dejaría sin cupo a todos los donantes.
- **`ExposeHeaders` para `Retry-After`:** el cliente ya muestra el mensaje del servidor, que incluye el tiempo de espera. [apiClient.ts:38](../frontend/src/services/apiClient.ts#L38) usa `message` del cuerpo y el modal lo muestra, así que el usuario ya ve el texto en español de 429 y 503. La única excepción es el 429 de API Gateway, que llega en inglés.
- **Flujo de revisión por el auditor:** rompe la separación de funciones (ver 4.5).
- **Pasar a ventana deslizante:** complica la transacción para poco beneficio.

---

## 7. Decisiones que debe tomar quien define los requisitos

1. **Regla de "una vez marcado, todo marcado" (4.3.5):** ¿se mantiene, o solo se marca la donación que cruza el umbral?
2. **Revisión de `EN_REVISION`:** ¿basta con documentarla como fase 2, o el curso exige el flujo completo? Si se construye, hay que decidir el revisor (un rol nuevo, o el gestor del proyecto) y cómo listar las retenidas (índice por estado o consulta sobre los eventos de auditoría).
3. **Cierre de campaña (sección 5):**
   - **Variante A, cierre automático al alcanzar la meta:** rechazar nuevas donaciones cuando lo confirmado alcance la meta. Hay que decidir si cuentan las pendientes. Si no cuentan, se sobrefinancia igual. Si cuentan, las pendientes que luego se rechazan dejan la campaña bloqueada sin haber alcanzado nada.
   - **Variante B, permitir sobrefinanciar y solo avisar:** válido si se declara. Es lo que hacen muchas plataformas.
   - **Variante C, fecha límite o cierre manual por el gestor:** exige un estado `CERRADO`, un endpoint o un campo `endsAt`, y su validación al donar.
   - **Para el proyecto académico:** puede bastar con documentar que no hay cierre y que la meta es solo informativa. Si el curso evalúa reglas de negocio, probablemente quieran ver al menos la validación contra la meta.
   - **Recomendación del análisis:** variante A contando solo lo confirmado, más un estado `CERRADO` automático. Es una regla de dominio y no corresponde decidirla desde el código.
4. **Idempotencia en la UI (4.4.4):** ¿se conserva la clave entre reintentos de un mismo envío para cubrir la pérdida de la respuesta?

---

## 8. Cómo verificar cada cambio

- **Todos los de backend:** `npm test` y `npm run typecheck` en `backend/`; `npm run test:infra` para la plantilla; `npm run test:integration` (DynamoDB Local); `npm run test:floci` para IAM.
- **Cambio de IAM (5):** confirmar que el comodín de `LeadingKeys` funciona con DynamoDB Local o floci, y con un `sam deploy` en una cuenta de pruebas.
- **Modal y auditor (1 y 2):** probar a mano con un donante que supere el umbral (por ejemplo, 6 donaciones de S/ 899 en distintos minutos) y verificar que el modal, el historial y la vista del auditor coinciden.
- **Test de concurrencia:** ejecutar `velocity.test.ts` varias veces seguidas para descartar fragilidad por contención.

---

## 9. Lo que no se verificó

- Ningún test ni typecheck de la rama: las dependencias no estaban instaladas y no se instalaron.
- El uso de comodín con `StringLike` en `dynamodb:LeadingKeys` (la clave existe según la documentación, el comodín no se confirmó).
- La cuota exacta de emails diarios del email por defecto de Cognito.
- Los precios actuales de WAF, SNS, CloudWatch y Budgets: se citan de memoria y pueden haber cambiado.
- El comportamiento real bajo contención alta de 10 peticiones simultáneas de un donante.

## 10. Fuentes consultadas

Documentación de AWS: throttling de HTTP API (`apigateway/.../http-api-throttling.html`), transacciones de DynamoDB (`dynamodb/.../transaction-apis.html`, `API_CancellationReason.html`), condiciones de IAM para DynamoDB (`specifying-conditions.html`), email por defecto de Cognito (`cognito/.../user-pool-email.html`), CORS de HTTP API (`AWS::ApiGatewayV2::Api Cors`).

Código y documentos del repositorio: `infra/template.yaml`, `backend/src/donations/{createDonation,velocity,simulateDonation,getMyDonations}.ts`, `backend/src/authz/{withAuth,evaluateAuthz}.ts`, `backend/src/audit/{recordAuditEvent,getAuditEvents}.ts`, `frontend/src/{components/DonationModal,components/SimulationControls,pages/AuditorPage,pages/DonorHistoryPage,services/apiClient}.tsx`, `docs/threat-model.md`, `docs/free-plan-guide.md`, `design.md`, `requirements.md`, `.checkov.yaml`.
