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
| **Fuentes de Información (Data Sources)** | Amazon DynamoDB, CloudWatch Logs, AWS CloudTrail | Provee estado del recurso para validación de condiciones atómicas y registro inmutable de auditoría. |

---

## 2. Los 7 Principios de NIST SP 800-207 y su Verificación

1. **Todo dato y servicio es un recurso:** Cada endpoint HTTP API y cada tabla DynamoDB tiene una política de acceso IAM explícita sin comodines (`*`).
2. **Comunicación segura sin importar la red:** Cifrado TLS 1.3/1.2 obligatorio en CloudFront y API Gateway. Sin endpoints HTTP abiertos.
3. **Acceso por sesión y por recurso:** Access token $\le 15$ minutos; validación estricta de scopes por ruta y ownership por recurso (T09, T11, T13).
4. **Política dinámica:** La autorización no es binaria ni estática: valida grupos, estado del recurso (p. ej. `BORRADOR` vs `PUBLICADO`), propietario y stage (`academic`).
5. **Monitorear la postura de los activos:** Mitigado en Free plan mediante GitHub Actions CI (análisis estático, lint, audit) y CloudTrail para cambios de infraestructura.
6. **Autenticación y autorización estrictas antes del acceso:** Toda ruta protegida rechaza llamadas sin token o con ID token (T02, T11). TOTP MFA obligatorio en `GESTOR` y `AUDITOR` (T14).
7. **Recolectar información para mejorar:** Logs estructurados en JSON con `requestId`, retención de 14 días y tabla inmutable `AuditEvents`.

---

## 3. Matriz de Amenazas STRIDE

| Amenaza | Riesgo Específico | Control Implementado | Prueba de Verificación |
|---|---|---|---|
| **Spoofing (Suplantación)** | Llamada con ID token o token falso | JWT Authorizer valida firma, issuer y client_id; authorizer scopes rechazan ID tokens | T02, T11 |
| **Tampering (Alteración)** | Manipulación de `amountCents` o estado de donación | Validación Zod estricta en servidor, dinero en enteros, transiciones atómicas con `TransactWriteItems` | T04, T08 |
| **Repudiation (Repudio)** | Negar haber creado o publicado un proyecto | Tabla `AuditEvents` registra actor seudonimizado, acción, recurso y timestamp | HU-10, T046 |
| **Information Disclosure (Filtración)** | Acceso a donaciones privadas de otros usuarios (BOLA) | Validación de ownership `donorSub === jwt.sub` en Lambda y consultas aisladas por GSI | T09, T12 |
| **Denial of Service (Denegación)** | Replays concurrentes para duplicar confirmaciones | `TransactWriteItems` con condición atómica; 10 solicitudes concurrentes dejan 1 éxito y 9 conflictos | T06, T07, T08 |
| **Elevation of Privilege (Escalación)** | Donante intentando publicar o crear proyectos | EnforceAuthz valida `cognito:groups` en backend; botones ocultos en UI son solo conveniencia UX | T03 |
