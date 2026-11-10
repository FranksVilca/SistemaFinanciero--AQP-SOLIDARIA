# Quickstart: validar el cumplimiento Zero Trust

Guía de validación. Los detalles de diseño están en [data-model.md](data-model.md) y [contracts/](contracts/).

## Requisitos

- Node.js 24 y `npm ci` en la raíz.
- Docker (para DynamoDB Local).
- Para la validación final: una cuenta de AWS con SAM CLI y credenciales temporales (`aws login` o SSO).

## 1. Calidad estática

```bash
npm run lint
npm run format:check
npm run typecheck
```

Esperado: 0 errores. Prueba negativa: añadir una función de más de 50 líneas o un `any` sin justificación hace fallar el lint.

## 2. Pruebas unitarias e integración

```bash
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
DYNAMODB_ENDPOINT=http://localhost:8000 npm run test:integration --workspace=backend
npm run test
```

Esperado: confirmar donación devuelve 200 y el total del proyecto sube una vez (US1); matriz rol × acción y BOLA rechazadas sin cambiar estado (US3); idempotencia (misma clave: misma donación, otro monto: 409); eventos `DENIED` con actor pseudonimizado (US4).

## 2b. Emulador de AWS (Floci) con IAM activo

```bash
docker compose -f backend/test/floci/docker-compose.yml up -d   # Floci 2.4.0 con IAM y TLS activos (ver el archivo)
npm run test:floci
```

Sin la opción de IAM Floci acepta cualquier operación y las pruebas no demostrarían nada. El TLS propio de Floci hace falta porque su autorizador JWT exige un emisor `https://`. El `docker-compose.yml` activa ambas cosas y las explica.

Esperado (78 pruebas, sin socket de Docker):
- **IAM (T10):** cada handler funciona con la política exacta de su rol en `infra/template.yaml` y todo lo demás recibe `AccessDeniedException`.
- **Cognito (T11, T14):** un usuario sin segundo factor no recibe tokens (`MFA_SETUP`); un ID token da 401 en las rutas protegidas.
- **API Gateway (T02, T11):** desplegado el template, el autorizador JWT rechaza sin token, con token falso, con el payload alterado y con un token de otro pool (401), y rechaza el ID token y los tokens sin el scope de la ruta (403); acepta un token de acceso genuino.
- **Revocación:** revocar el refresh token en el endpoint que el SPA deriva del descubrimiento deja inservibles el refresh y el access token.
- **Despliegue:** `infra/template.yaml` despliega como stack (SAM incluido) en la etapa académica, con y sin las opciones de detección, y en la etapa `production` (sin la función de simulación).

### Extremo a extremo con las Lambdas reales

```bash
docker compose -f backend/test/floci/docker-compose.lambda.yml up -d   # monta el socket de Docker
npm run test:floci:e2e
```

Esperado (13 pruebas; con las funciones de revisión y de administración el stack tiene hoy 16 funciones y el e2e lo comprueba): el template desplegado en Floci, el código real de las funciones (al cerrar esta feature, 10: nueve de la API y el disparador de registro) corriendo en contenedores con su rol IAM (la política en línea del template), usuarios que inician sesión por el login alojado con los scopes del SPA, y el flujo completo: 401 y 403 en el gateway, crear y publicar un proyecto, donar con idempotencia, confirmar, historial, auditoría pseudonimizada y revocación de sesión.

**Seguridad:** montar el socket de Docker da al contenedor control del host Docker. Hazlo solo en una máquina tuya o en un runner efímero de CI.

Límites del emulador: no activa el TOTP en los pools creados por CloudFormation, no aplica la protección de borrado ni PITR a las tablas del stack y su interfaz de inicio de sesión no es la de Cognito (ver `evidence/test-run-report.md`, sección 3).

## 3. Verificaciones del template

```bash
npm run test:infra --workspace=backend
cfn-lint infra/template.yaml
checkov -f infra/template.yaml
```

Esperado: MFA `REQUIRED`; Audit solo con `PutItem`; sin `Delete*` ni comodines; CORS sin `*`; retención de 14 días; throttling por ruta; la prueba de cobertura falla si se agrega una función sin `withAuth` (probarlo a propósito en una rama de prueba).

## 4. Despliegue y pruebas en AWS real (evidencia pendiente)

```bash
sam build -t infra/template.yaml
sam deploy --guided
```

Comprobar y guardar en `evidence/`:

| Prueba | Cómo | Esperado |
|---|---|---|
| Token falso, vencido o ID token (el backend ya rechaza el ID token y se prueba en el emulador; aquí se comprueba el authorizer) | `curl` con `Authorization: Bearer` alterado en una ruta protegida | 401 de la pasarela |
| MFA | Iniciar sesión como gestor sin TOTP configurado | Se exige enrolamiento; no se emiten tokens |
| T10 (ya demostrado en el emulador; confirmación opcional) | Simulador de IAM o credenciales del rol, ver `evidence/t10-access-denied.md` | `AccessDeniedException` |
| Sesión revocada | Revocar el refresh token y llamar a una acción sensible con el access token aún vigente | 401 |
| CSP y login | Iniciar sesión en el dominio de CloudFront | El intercambio de código con Cognito no es bloqueado |
| CORS del API | `curl -i -X OPTIONS <ApiEndpoint>/v1/projects -H "Origin: <FrontendUrl>" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type"` | 204 con `access-control-allow-origin` igual al origen del SPA; con otro origen, sin esa cabecera. Antes de esta comprobación el API respondió 404 (ver T107) |
| Auditoría inmutable | Intentar `UpdateItem` sobre la tabla Audit con un rol de función | `AccessDenied` |
| Recuperación (producción) | Verificar `DeletionProtectionEnabled` y PITR activos | Ambos activos |

## 5. Cierre documental

- `docs/zta-hallazgos-y-mejoras.md`: actualizar el estado de H1–H11 y de los principios 3, 6 y 7.
- `AI_USAGE.md`: sin capacidades inexistentes; todas las herramientas listadas.
- `specs/001-secure-donations/research.md` sección 2: expresión `ADD ... SET` corregida.

## Limpieza

```powershell
./scripts/cleanup.ps1      # vacía los buckets de logs y frontend y ejecuta sam delete
docker rm -f ddb-local
```

Un bucket con objetos impide que `sam delete` termine; por eso se usa el script en vez de `sam delete` directo.
