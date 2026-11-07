# Research: Cumplimiento Zero Trust

Cada decisión se tomó leyendo el código y el template actuales. Lo marcado **(verificar)** no pudo comprobarse sin AWS real.

## 1. Corregir H1 (confirmar donación)

- **Decision**: `ADD confirmedAmountCents :amount SET updatedAt = :now` en [simulateDonation.ts:121](../../backend/src/donations/simulateDonation.ts#L121); corregir el mismo texto en `specs/001-secure-donations/research.md` sección 2.
- **Rationale**: `ADD` y `SET` son cláusulas distintas; la coma entre ellas es inválida. Los tests actuales simulan DynamoDB, por eso no lo vieron.
- **Alternatives**: reescribir con `SET confirmedAmountCents = confirmedAmountCents + :amount`; falla si el atributo no existe, y `ADD` lo crea en 0.

## 2. Pruebas de integración

- **Decision**: DynamoDB Local (`amazon/dynamodb-local`) como contenedor de servicio en GitHub Actions y con Docker en local. `dynamo.ts` ya acepta `DYNAMODB_ENDPOINT`.
- **Rationale**: valida expresiones, condiciones y `TransactWriteItems` reales. Es lo mínimo que habría detectado H1.
- **Alternatives**: Floci (se usó en la revisión; más amplio pero menos estándar para CI); LocalStack (más pesado, parte de pago). Mockear el cliente: descartado por constitución VII.
- **Límite**: DynamoDB Local no evalúa IAM; T10 se cubre con aserciones estáticas sobre el template y una prueba manual en AWS real **(verificar)**.

## 3. MFA obligatorio

- **Decision**: `MfaConfiguration: REQUIRED` con `SOFTWARE_TOKEN_MFA` para todo el pool; enrolamiento en el Hosted UI.
- **Rationale**: Cognito aplica MFA por pool, no por grupo. Los tokens de acceso no llevan el claim `amr`, así que el backend no puede comprobar después si hubo MFA.
- **Alternatives**: (a) `OPTIONAL` con un trigger Pre Token Generation: el evento no indica si se usó MFA; (b) dos user pools: duplica identidad y el authorizer JWT de HTTP API admite un solo issuer por authorizer. Se descartan.
- **Efecto**: el donante enrola TOTP una vez; se ajustó el escenario 3 de la historia 2.
- Falta además el recurso `UserPoolDomain` en el template (se declara el parámetro `CognitoDomainPrefix` pero no se usa), sin el cual el Hosted UI no existe. Se añade.

## 4. Envoltorio `withAuth()`

- **Decision**: `withAuth(handlerFn, { action, resourceType, loadResource?, sensitive? })` devuelve el `handler` exportado. Hace: extraer claims → cargar recurso (opcional) → decidir con el PE → revalidar sesión si `sensitive` → ejecutar → auditar éxito o denegado → mapear errores a HTTP. Marca el handler con un símbolo `Symbol.for("aqp.withAuth")`.
- **Rationale**: elimina la copia por handler (VII) y hace imposible exportar una ruta sin autorización. La propiedad del recurso (BOLA) se resuelve con `loadResource`: el handler dice cómo obtener el recurso y el envoltorio compara el dueño.
- **Prueba de cobertura**: lee las líneas `Handler:` de `template.yaml` (regex, el YAML lleva tags de SAM), importa cada módulo y falla si el `handler` no lleva la marca. Las rutas públicas también pasan por `withAuth` con acciones públicas, para que la regla sea uniforme.
- **Alternatives**: Lambda authorizer en API Gateway: no ve el recurso, no resuelve BOLA. Convención de código revisada por personas: lo que ya falló.
- **Corrige además**: `simulateDonation` devuelve 403 sin identidad (debe ser 401, FR-010); `getMyDonations` usa la acción `CreateDonation` (se añade `ViewMyDonations`, FR-009); `enforceAuthz` queda como detalle interno del envoltorio.

## 5. Auditoría

- **Decision**: un único `recordAuditEvent` llamado solo desde `withAuth`. Permisos IAM `dynamodb:PutItem` únicamente; `ConditionExpression: attribute_not_exists(eventType)` por seguridad. Además, una política de recursos sobre la tabla que niega `UpdateItem`/`DeleteItem`/`BatchWriteItem` a todos los roles de las funciones.
- **Actor**: `usr_` + SHA-256 del `sub` truncado. El `sub` es un UUID aleatorio (122 bits), así que el hash no se invierte por fuerza bruta y no hace falta una sal secreta. Se aplica siempre, no por handler.
- **Denegados**: se auditan los 401/403 que decide el backend. Los 401 que emite el authorizer de API Gateway nunca llegan a Lambda; quedan en los **registros de acceso** del API (se añade `AccessLogSettings`).
- **Fallo de escritura**: en éxitos, se registra en logs y la respuesta se mantiene; en denegados, se responde igual la denegación. Regla explícita y probada (edge case de la spec).
- **Alternatives**: otra cuenta de AWS (ideal; fuera de alcance); tabla de solo escritura vía Streams: complejidad sin beneficio hoy.

## 4b. Revalidación de sesión (H9)

- **Decision**: en acciones sensibles (`PublishProject`, `ViewAudit`, `SimulateDonation` con `CONFIRMAR`) llamar a `GET https://<dominio>/oauth2/userInfo` con el access token; solo 200 permite seguir. Timeout corto y falla cerrado. Requiere el `UserPoolDomain` y el scope `openid`, que ya existe.
- **Rationale**: Cognito rechaza access tokens de refresh tokens revocados en userInfo **(verificar en AWS real; Floci no lo emula)**; no requiere el scope `aws.cognito.signin.user.admin`, que daría más poder al token.
- **Alternatives**: `GetUser` (exige ese scope); lista de revocación propia en DynamoDB (otra tabla y sincronización).

## 6. IAM por acción

- **Decision**: reemplazar `DynamoDBCrudPolicy` por sentencias explícitas con las acciones exactas por función (ver [contracts/iam-permissions-matrix.md](contracts/iam-permissions-matrix.md)). Sin `Delete*` ni comodines. `TransactWriteItems` se autoriza con las acciones subyacentes (`PutItem`, `UpdateItem`) sobre cada tabla.
- **Alternatives**: políticas gestionadas de SAM (`DynamoDBWritePolicy`): sin borrado pero con `BatchWriteItem` y sin separar la auditoría.

## 7. Telemetría y límites en el IaC

- **Logs**: un `AWS::Logs::LogGroup` compartido con `RetentionInDays: 14`, asignado a todas las funciones en `Globals` con `LoggingConfig` en formato JSON. Un segundo grupo para los registros de acceso del API.
- **CloudTrail**: un trail de eventos de gestión (primera copia gratuita) hacia un bucket S3 privado con ciclo de vida de 90 días. Si la cuenta ya tiene un trail, el costo es el de una copia adicional; se avisa en la guía. **(verificar costo en la cuenta)**
- **CORS**: origen = dominio de CloudFront; `http://localhost:3000` solo en la etapa académica.
- **Throttling**: `RouteSettings` por ruta; las 3 públicas con límite menor.
- **Callbacks de Cognito**: dominio de CloudFront; localhost solo en la etapa académica.
- **CSP**: `connect-src` solo permite `*.amazonaws.com`; el intercambio de código contra el dominio de Cognito (`*.amazoncognito.com`) quedaría bloqueado. Se añade el dominio de Cognito **(verificar en navegador con el despliegue real)**.

## 8. Protección de datos

- **Decision**: `DeletionProtectionEnabled` y `PointInTimeRecoverySpecification` en Projects, Donations y Audit, activados con una condición de etapa `production` (protección) y parámetro `EnablePitr` (default `true`).
- **Rationale**: la protección de borrado impediría `sam delete` en la etapa académica (constitución V).
- **Alternatives**: protección siempre activa: rompe la limpieza. Backups bajo demanda de AWS Backup: más piezas.

## 9. CI

- **Decision**: trabajos `lint-format` (ESLint + Prettier), `typecheck`, `unit`, `integration` (DynamoDB Local), `iac` (`cfn-lint` + `checkov`), y `deploy` con `needs` de todos ellos, solo en `main` y solo si existe la variable `AWS_DEPLOY_ROLE_ARN` (OIDC, sin llaves).
- **Reglas de calidad**: `complexity: 10`, `max-lines-per-function: 50`, `@typescript-eslint/no-explicit-any: error`. Los 7 `any` existentes se corrigen al tocar esos archivos (gobernanza de la constitución).
- **Checkov**: se acepta un conjunto corto y documentado de omisiones (por ejemplo, claves KMS propias, DLQ de Lambda) justificadas en el propio archivo.

## 10. Cedar y coherencia documental

- **Decision**: eliminar `cedarAdapter.ts`, `getAuthorizer()`, `cedarEquivalence.test.ts` y la dependencia `client-verifiedpermissions`. Conservar `policies/` con un README que diga "fase 2, no aplicado". Corregir `AI_USAGE.md` y marcar el estado de H1–H11 al cerrar.
- **Alternatives**: conectar Verified Permissions ahora: crea Policy Store, latencia y costo, y la spec lo dejó en fase 2.
