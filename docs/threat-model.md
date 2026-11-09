# Modelo de Amenazas y Mapeo Zero Trust (NIST SP 800-207)

**Proyecto:** Plataforma de Donaciones Seguras (2026)  
**Entidad:** Fundación AQP-SOLIDARIA  
**Norma de Referencia:** NIST SP 800-207 (Zero Trust Architecture) + STRIDE  

---

## 1. Mapeo Arquitectónico a NIST SP 800-207

| Componente NIST | Implementación en la Plataforma | Función y Mecanismo |
|---|---|---|
| **Policy Enforcement Point (PEP)** | Amazon API Gateway (HTTP API) + AWS CloudFront | Valida criptográficamente el JWT (firma, emisor, expiración, client_id) y exige OAuth scopes antes de invocar cómputo. CloudFront aplica CSP y HSTS. |
| **Policy Decision Point (PDP) / Policy Engine (PE)** | Módulo `authz` en AWS Lambda (MVP) / Amazon Verified Permissions con Cedar (HU-12) | Evalúa dinámicamente si el `sub` y `cognito:groups` del solicitante tienen permiso sobre el recurso específico y valida ownership. |
| **Policy Administrator (PA)** | Amazon Cognito User Pool | Emite, renueva y revoca tokens de sesión (Authorization Code + PKCE), administra MFA TOTP para roles con privilegios. |
| **Fuentes de Información (Data Sources)** | Amazon DynamoDB, CloudWatch Logs, AWS CloudTrail | Provee estado del recurso para validación de condiciones atómicas y registro de auditoría de solo inserción (ninguna función puede editarlo ni borrarlo). |

---

## 2. Los 7 Principios de NIST SP 800-207 y su Verificación

1. **Todo dato y servicio es un recurso:** Cada endpoint HTTP API y cada tabla DynamoDB tiene una política de acceso IAM explícita sin comodines (`*`).
2. **Comunicación segura sin importar la red:** Cifrado TLS 1.3/1.2 obligatorio en CloudFront y API Gateway. Sin endpoints HTTP abiertos.
3. **Acceso por sesión y por recurso:** Access token $\le 15$ minutos; validación estricta de scopes por ruta y ownership por recurso (T09, T11, T13).
4. **Política dinámica:** La autorización no es binaria ni estática: valida grupos, estado del recurso (p. ej. `BORRADOR` vs `PUBLICADO`), propietario y stage (`academic`).
5. **Monitorear la postura de los activos:** Mitigado en Free plan mediante GitHub Actions CI (análisis estático, lint, audit) y CloudTrail para cambios de infraestructura.
6. **Autenticación y autorización estrictas antes del acceso:** Toda ruta protegida rechaza llamadas sin token o con ID token (T02, T11). TOTP MFA obligatorio para todo el pool (T14, comprobado en el template; el inicio de sesión real queda pendiente de AWS). Un token robado vale hasta su vencimiento (15 min) salvo en acciones sensibles, que revalidan la sesión contra Cognito (T13).
7. **Recolectar información para mejorar:** Logs estructurados en JSON con `requestId`, retención de 14 días, y tabla de auditoría de solo inserción con el actor pseudonimizado que registra las denegaciones de rutas protegidas y los éxitos de acciones que cambian estado. Los rechazos 401 de la pasarela quedan en los registros de acceso del API.

---

## 3. Matriz de Amenazas STRIDE

| Amenaza | Riesgo Específico | Control Implementado | Prueba de Verificación |
|---|---|---|---|
| **Spoofing (Suplantación)** | Llamada con ID token o token falso | JWT Authorizer valida firma, issuer y client_id; authorizer scopes rechazan ID tokens | T02, T11 |
| **Tampering (Alteración)** | Manipulación de `amountCents` o estado de donación | Validación Zod estricta en servidor, dinero en enteros, transiciones atómicas con `TransactWriteItems` | T04, T08 |
| **Repudiation (Repudio)** | Negar haber creado o publicado un proyecto | Tabla `AuditEvents` registra actor seudonimizado, acción, recurso y timestamp | HU-10, T046 |
| **Information Disclosure (Filtración)** | Acceso a donaciones privadas de otros usuarios (BOLA) | Validación de ownership `donorSub === jwt.sub` en Lambda y consultas aisladas por GSI | T09, T12 |
| **Denial of Service (Denegación)** | Replays concurrentes para duplicar confirmaciones | `TransactWriteItems` con condición atómica; 10 solicitudes concurrentes dejan 1 éxito y 9 conflictos | T06, T07, T08 |
| **Denial of Service / fraude** | Bot que registra ráfagas de donaciones; fraccionamiento de un monto grande en donaciones pequeñas | Contadores atómicos por donante en la tabla de idempotencia: máximo 5 donaciones nuevas por minuto (HTTP 429, evento `DONATION_RATE_LIMITED`) y revisión horaria: más de S/ 5,000 o 3 donaciones de al menos el 90% del máximo dejan la donación `EN_REVISION` (evento `SUSPICIOUS_VELOCITY`), que no puede confirmarse | `test/integration/velocity.test.ts`, `test/donations/` |
| **Tampering / Elevation of Privilege** | Revisor que aprueba su propia donación o la de un proyecto que creó; dos revisores que deciden a la vez | Cuatro ojos: rol REVISOR (MFA, acción sensible con revalidación de sesión y grupos), 403 `CONFLICT_OF_INTEREST` si es el donante o el creador (`createdBy`); AUDITOR no se combina con REVISOR; escritura condicional `status = EN_REVISION` (una sola decisión gana, la otra recibe 409); `REVIEW_DECISION` auditado | `test/reviews/`, `test/integration/reviews.test.ts` |
| **Elevation of Privilege (Escalación)** | Donante intentando publicar o crear proyectos | EnforceAuthz valida `cognito:groups` en backend; botones ocultos en UI son solo conveniencia UX | T03 |

## Límites de los controles de velocidad

- Las ventanas son fijas (minuto y hora UTC): en el borde de una ventana un donante puede registrar hasta el doble del límite en poco tiempo (5 al final de un minuto y 5 al inicio del siguiente).
- Los controles son por cuenta (`sub`): no detectan a una misma persona que reparte las donaciones entre varias cuentas.
- Los umbrales (5 por minuto, S/ 5,000 por hora, 3 donaciones cercanas al máximo) son ejemplos académicos y se cambian con parámetros de la plantilla.
- `EN_REVISION` retiene la donación hasta que un REVISOR la aprueba o la rechaza (HU-13); si nadie la revisa en `ReviewExpiryDays` (7 días), el job diario la rechaza como `RECHAZADA_REVISION`. El reporte a la UIF-Perú u otra autoridad queda fuera del alcance.
- Separación de funciones de la revisión: AUDITOR no se combina con ningún rol. REVISOR sí puede ser GESTOR o DONANTE; el conflicto se bloquea por donación (propia o de un proyecto propio), no por rol. Dos revisores coludidos siguen pudiendo aprobarse mutuamente: lo mitiga la auditoría (`REVIEW_DECISION`), no el sistema.
