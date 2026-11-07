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
| **Policy Administrator (PA)** | Amazon Cognito User Pools (donantes y staff) | Emite, renueva y revoca tokens de sesión (Authorization Code + PKCE). El pool de staff (`GESTOR`, `AUDITOR`) exige MFA TOTP (`MfaConfiguration: ON`); el de donantes lo deja opcional. |
| **Fuentes de Información (Data Sources)** | Amazon DynamoDB, CloudWatch Logs, AWS CloudTrail | Provee estado del recurso para validación de condiciones atómicas y registro inmutable de auditoría. |

---

## 2. Los 7 Principios de NIST SP 800-207 y su Verificación

1. **Todo dato y servicio es un recurso:** Cada endpoint HTTP API y cada tabla DynamoDB tiene una política de acceso IAM explícita sin comodines (`*`).
2. **Comunicación segura sin importar la red:** Cifrado TLS 1.3/1.2 obligatorio en CloudFront y API Gateway. Sin endpoints HTTP abiertos. CORS del HTTP API restringido al origen de CloudFront y a `http://localhost:3000` (desarrollo); las Lambdas no emiten cabeceras CORS propias.
3. **Acceso por sesión y por recurso:** Access token $\le 15$ minutos; validación estricta de scopes por ruta y ownership por recurso (T09, T11). La revocación no se aplica en el API antes de la expiración del access token (limitación documentada en la sección 4, T13).
4. **Política dinámica:** La autorización no es binaria ni estática: valida grupos, estado del recurso (p. ej. `BORRADOR` vs `PUBLICADO`), propietario y stage (`academic`).
5. **Monitorear la postura de los activos:** Mitigado en Free plan mediante GitHub Actions CI (análisis estático, lint, audit) y CloudTrail para cambios de infraestructura.
6. **Autenticación y autorización estrictas antes del acceso:** Toda ruta protegida rechaza llamadas sin token o con ID token (T02, T11). TOTP MFA obligatorio en `GESTOR` y `AUDITOR` mediante un User Pool de staff separado con su propio JWT Authorizer (T14 valida la plantilla; la verificación del desafío MFA requiere despliegue).
7. **Recolectar información para mejorar:** Logs estructurados en JSON con `requestId`, retención de 14 días y tabla `AuditEvents` de solo inserción: los escritores solo tienen `dynamodb:PutItem` con `attribute_not_exists` (no sobrescriben eventos), el lector solo `dynamodb:Query`, ninguna función tiene permisos de actualización o borrado y la tabla tiene `DeletionProtectionEnabled`.

---

## 3. Matriz de Amenazas STRIDE

| Amenaza | Riesgo Específico | Control Implementado | Prueba de Verificación |
|---|---|---|---|
| **Spoofing (Suplantación)** | Llamada con ID token o token falso | JWT Authorizer valida firma, issuer y client_id; authorizer scopes rechazan ID tokens | T02, T11 |
| **Tampering (Alteración)** | Manipulación de `amountCents` o estado de donación | Validación Zod estricta en servidor, dinero en enteros, transiciones atómicas con `TransactWriteItems` | T04, T08 |
| **Repudiation (Repudio)** | Negar haber creado o publicado un proyecto | Tabla `AuditEvents` registra actor seudonimizado (`usr_` + hash SHA-256 del `sub`), acción, recurso y timestamp; escritura append-only por IAM y condición `attribute_not_exists` | HU-10, T046 |
| **Information Disclosure (Filtración)** | Acceso a donaciones privadas de otros usuarios (BOLA) | Validación de ownership `donorSub === jwt.sub` en Lambda y consultas aisladas por GSI. Los errores no controlados devuelven un mensaje genérico con `requestId`; el detalle solo va a CloudWatch Logs | T09, T12 |
| **Denial of Service (Denegación)** | Replays concurrentes para duplicar confirmaciones | `TransactWriteItems` con condición atómica; 10 solicitudes concurrentes dejan 1 éxito y 9 conflictos | T06, T07, T08 |
| **Elevation of Privilege (Escalación)** | Donante intentando publicar o crear proyectos | EnforceAuthz valida `cognito:groups` en backend; botones ocultos en UI son solo conveniencia UX | T03 |
| **Spoofing / Elevation (sesión revocada)** | Reutilización de un access token robado o revocado antes de su expiración | Access e ID token de $\le 15$ minutos y `EnableTokenRevocation: true` en ambos clientes (validado por `backend/test/tokenRevocation.test.ts`). **Riesgo residual aceptado**: el API no rechaza el token revocado hasta su `exp` | T13 |

---

## 4. Limitación documentada: revocación de tokens (T13, CA-03.4)

**Comportamiento esperado y real.** El JWT Authorizer de API Gateway HTTP API valida la firma (JWKS de Cognito), `iss`, `aud`/`client_id`, `exp` y los scopes de la ruta. No consulta a Cognito si el token fue revocado. Por tanto:

- Tras `RevokeToken` o el cierre de sesión en Hosted UI, Cognito invalida el **refresh token** y deja de emitir tokens nuevos para esa sesión.
- El **access token** ya emitido sigue siendo aceptado por el API hasta su expiración. La ventana de exposición máxima es `AccessTokenValidity` = 15 minutos (`IdTokenValidity` = 15 minutos), en ambos clientes (`CognitoUserPoolClient` y `StaffUserPoolClient`).
- Ningún test automatizado afirma que el API rechace un token revocado antes de su expiración. Lo que se automatiza es el límite de la ventana: `backend/test/tokenRevocation.test.ts` verifica en `infra/template.yaml` la validez $\le 15$ minutos (considerando `TokenValidityUnits`) y `EnableTokenRevocation: true`.

**Mitigaciones fuera de alcance del MVP:** un Lambda Authorizer que consulte una lista de revocación (`jti` revocados) o validación con `GetUser`, a costa de latencia y llamadas adicionales.

**Verificación tras el despliegue (pendiente de evidencia):**

```bash
# 1. Obtener un access token de donante (Hosted UI + PKCE) y guardarlo en ACCESS_TOKEN y el refresh token en REFRESH_TOKEN.
# 2. Revocar la sesión.
aws cognito-idp revoke-token --token "$REFRESH_TOKEN" --client-id "$USER_POOL_CLIENT_ID"
# 3. Antes de 15 minutos: el API todavía acepta el access token (esperado: 200, limitación documentada).
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $ACCESS_TOKEN" "$API_URL/v1/donations/me"
# 4. El refresh token revocado ya no emite tokens (esperado: invalid_grant).
curl -s -X POST "$HOSTED_UI_DOMAIN/oauth2/token" -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token&client_id=$USER_POOL_CLIENT_ID&refresh_token=$REFRESH_TOKEN"
# 5. Pasados 15 minutos desde la emisión: el API rechaza el access token (esperado: 401).
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $ACCESS_TOKEN" "$API_URL/v1/donations/me"
```
