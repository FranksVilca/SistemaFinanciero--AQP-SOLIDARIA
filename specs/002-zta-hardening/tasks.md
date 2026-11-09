---

description: "Lista de tareas para el cumplimiento Zero Trust (arquitectura objetivo)"
---

# Tasks: Cumplimiento Zero Trust de la plataforma (arquitectura objetivo)

**Input**: documentos de diseño en `/specs/002-zta-hardening/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: incluidos. La constitución (principio IV) exige pruebas negativas automatizadas y el principio VII prohíbe sustituir con simulaciones el comportamiento verificado.

**Organization**: agrupadas por historia de usuario. Las historias P1 se pueden entregar solas como MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede ejecutar en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de `spec.md` a la que pertenece (US1…US10)
- Todas las rutas son relativas a la raíz del repositorio
- `infra/template.yaml` es un archivo compartido: las tareas que lo editan **nunca** llevan [P] entre sí

## Reglas de código para toda tarea (constitución VII)

Identificadores y comentarios en inglés, mensajes al usuario en español; funciones ≤ 50 líneas y complejidad ≤ 10; sin `any` ni valores literales con significado (usar `backend/src/shared/constants.ts`); errores tipados de `backend/src/shared/errors.ts`; sin código muerto. Todo archivo tocado queda conforme en las partes que se modifican.

---

## Phase 1: Setup

**Purpose**: scripts, configuración y dependencias que usan todas las historias

- [X] T001 Add scripts `test:integration` and `test:infra` and the `yaml` dev dependency to `backend/package.json`; create `backend/vitest.config.ts` so `npm run test` runs only unit tests (excludes `test/integration/**` and `test/infra/**`)
- [X] T002 [P] Create `backend/vitest.integration.config.ts` (includes only `test/integration/**`, `globalSetup` pointing to `backend/test/integration/globalSetup.ts`, sequential files to avoid table collisions)
- [X] T003 [P] Create `backend/test/integration/docker-compose.yml` running `amazon/dynamodb-local` on port 8000 (`-inMemory`), for local runs
- [X] T004 [P] Create `backend/src/shared/constants.ts` with named constants: roles (`DONANTE`, `GESTOR`, `AUDITOR`), donation statuses (`PENDIENTE_SIMULACION`, `CONFIRMADA_SIMULADA`, `RECHAZADA_SIMULADA`), project statuses, `CURRENCY = "PEN"`, `IDEMPOTENCY_TTL_SECONDS = 86400`, `SESSION_CHECK_TIMEOUT_MS`, and the list of sensitive actions (`PublishProject`, `ViewAudit`, `SimulateDonation`/CONFIRMAR)

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: arnés de pruebas contra DynamoDB real y lector del template. Bloquea todas las historias.

**⚠️ CRITICAL**: ninguna historia empieza antes de terminar esta fase

- [X] T005 Create `backend/test/integration/globalSetup.ts`: wait for `DYNAMODB_ENDPOINT` (default `http://localhost:8000`), set test env vars for the four table names, create the four tables with the same key schemas and GSIs as `infra/template.yaml` (Projects `status-createdAt-index`, Donations `donorSub-createdAt-index`, Idempotency `pk` with TTL, Audit `auditDay` (HASH, UTC date `YYYY-MM-DD`) + `timestamp#eventId` (RANGE)), and drop them on teardown
- [X] T006 [P] Create `backend/test/integration/helpers/events.ts`: builders for API Gateway HTTP API events with JWT claims for each role (`DONANTE`, `GESTOR`, `AUDITOR`, no identity, and a fake group `GESTOR_FAKE`), headers (case-insensitive `Idempotency-Key`), body, path parameters, and `requestId`
- [X] T007 [P] Create `backend/test/integration/helpers/seed.ts`: functions to insert published/draft projects and pending/confirmed donations directly into the tables, and to read an item back
- [X] T008 [P] Create `backend/test/infra/helpers/loadTemplate.ts`: parse `infra/template.yaml` with the `yaml` package registering custom tags (`!Ref`, `!Sub`, `!GetAtt`, `!Equals`, `!If`, `!Join`) as plain structures; resolve parameters and `Conditions` for a given stage (`academic`, `production`) and parameter overrides (`EnablePitr`, `EnableGuardDuty`, `EnableSecurityHub`, `EnableCloudTrail`) via `loadTemplate(stage, overrides)`; export helpers to list functions, their policies, their events and their `Handler`; export `STAGES = ["academic", "production"]` so every infra test runs for each stage (constitution V, v2.2.0)
- [X] T009 Create `backend/test/integration/smoke.test.ts` proving the harness: put and get an item in each table and run a real `TransactWriteCommand`

**Checkpoint**: `docker compose up -d` + `npm run test:integration --workspace=backend` pasa el smoke test

---

## Phase 3: User Story 1 - Confirmar una donación funciona (Priority: P1) 🎯 MVP

**Goal**: la confirmación suma el monto al proyecto una sola vez (H1, FR-001, FR-002).

**Independent Test**: crear → confirmar contra DynamoDB Local; segundo cambio de estado da 409; misma clave de idempotencia devuelve la misma donación.

### Tests for User Story 1

> Escribirlos primero y comprobar que el de confirmación **falla** antes del arreglo

- [X] T010 [P] [US1] Integration test in `backend/test/integration/confirmDonation.test.ts`: owner confirms a `PENDIENTE_SIMULACION` donation → 200, status `CONFIRMADA_SIMULADA`, project `confirmedAmountCents` increases exactly by `amountCents`; rejecting leaves the total unchanged
- [X] T011 [P] [US1] Integration test in `backend/test/integration/donationFlow.test.ts`: second state change on a terminal donation → 409 and total unchanged; same `Idempotency-Key` + same body → same donation; same key + different amount → 409; key isolated per donor; amount `-1`, missing or non-UUID key and invalid JSON → 400 without stack trace; donation to a draft project → 409

### Implementation for User Story 1

- [X] T012 [US1] Fix the update expression in `backend/src/donations/simulateDonation.ts` line 121 to `ADD confirmedAmountCents :amount SET updatedAt = :now`; replace the `any` casts in the file with typed transaction items and typed error checks
- [X] T013 [P] [US1] Correct the same expression in `specs/001-secure-donations/research.md` section 2 (`ADD ... SET`)

**Checkpoint**: T010 y T011 pasan; US1 es un MVP funcional por sí solo

---

## Phase 4: User Story 2 - MFA obligatorio (Priority: P1)

**Goal**: ningún usuario obtiene tokens sin segundo factor (H2, FR-003, FR-005). Hosted UI definido.

**Independent Test**: la prueba de infraestructura verifica MFA `REQUIRED` + TOTP, sin SMS, y que existe el dominio de Cognito.

### Tests for User Story 2

- [X] T014 [US2] Replace `backend/test/mfa.test.ts` (it simulates Cognito inside the test) with `backend/test/infra/mfa.test.ts` asserting on the real template: `MfaConfiguration` is `REQUIRED`, `EnabledMfas` is exactly `SOFTWARE_TOKEN_MFA`, no SMS configuration, a `AWS::Cognito::UserPoolDomain` exists using `CognitoDomainPrefix`, `AccessTokenValidity` ≤ 15 minutes, ID token not accepted as API credential (authorizer audience is the SPA client and routes list `AuthorizationScopes`); the runtime rejection of an ID token and of a forged token is verified only in T070 (accepted gap, constitution IV)

### Implementation for User Story 2

- [X] T015 [US2] In `infra/template.yaml`: set Cognito `MfaConfiguration` to `REQUIRED`; add the `CognitoUserPoolDomain` resource (`Domain: !Ref CognitoDomainPrefix`); update the descriptions of groups `GESTOR` and `AUDITOR` so they match the real behavior; add `UserPoolDomain` URL to `Outputs`

**Checkpoint**: T014 pasa

---

## Phase 5: User Story 3 - Autorización obligatoria con `withAuth()` (Priority: P1)

**Goal**: toda ruta pasa por un único envoltorio; una ruta nueva sin él rompe CI (H3, FR-006 a FR-010, FR-025).

**Independent Test**: prueba de cobertura sobre las líneas `Handler:` del template, matriz rol × acción y BOLA en integración, 401 uniforme sin identidad.

### Tests for User Story 3

- [X] T016 [P] [US3] Unit tests for `withAuth` in `backend/test/withAuth.test.ts` following `contracts/with-auth.md`: fixed execution order, 401 without identity, 403 on insufficient role, 404 when `loadResource` finds nothing, any exception from the policy engine denies (fail closed), errors mapped to HTTP without stack trace
- [X] T017 [P] [US3] Route coverage test in `backend/test/infra/withAuthCoverage.test.ts`: for every `Handler:` in `infra/template.yaml`, resolve it to its source file (`Handler: projects/x.handler` maps to `backend/src/projects/x.ts`), import the module and assert `handler[WITH_AUTH] === true`; include a negative case that a module without the marker fails the check
- [X] T018 [P] [US3] Integration role × action matrix in `backend/test/integration/authzMatrix.test.ts`: every disallowed combination (donor creating/publishing project, manager donating, non-auditor viewing audit, fake group `GESTOR_FAKE`, no identity) returns 401/403 and leaves the tables unchanged
- [X] T019 [P] [US3] Integration BOLA tests in `backend/test/integration/bola.test.ts`: another donor or a manager cannot confirm someone else's donation, the donor history only contains their own donations, and the donation status is unchanged after each attack (replaces the mocked `backend/test/bola.test.ts`)

### Implementation for User Story 3

- [X] T020 [US3] Extend `backend/src/authz/evaluateAuthz.ts`: add actions `ViewProjectStats` and `ViewMyDonations` (donor-only, own donations), use the constants from `backend/src/shared/constants.ts`, keep fail-closed behavior, replace the loose group parsing `catch` with a logged fail-closed result, and export `WITH_AUTH` symbol from a new `backend/src/authz/withAuthMarker.ts`
- [X] T021 [US3] Create `backend/src/authz/withAuth.ts` implementing `contracts/with-auth.md` (extract claims, optional `loadResource`, policy decision, execute, map errors; hooks for session check and audit are added by US4 and US9); mark the returned handler with `WITH_AUTH`
- [X] T022 [P] [US3] Wrap `backend/src/projects/listProjects.ts` with `withAuth` (public action `ListProjects`)
- [X] T023 [P] [US3] Wrap `backend/src/projects/getProject.ts` with `withAuth` (public action `ViewProject`)
- [X] T024 [P] [US3] Wrap `backend/src/projects/getProjectStats.ts` with `withAuth` (public action `ViewProjectStats`)
- [X] T025 [P] [US3] Wrap `backend/src/projects/createProject.ts` with `withAuth` (action `CreateProject`); remove its direct `enforceAuthz` call
- [X] T026 [P] [US3] Wrap `backend/src/projects/publishProject.ts` with `withAuth` (action `PublishProject`); remove its direct `enforceAuthz` call
- [X] T027 [P] [US3] Wrap `backend/src/donations/createDonation.ts` with `withAuth` (action `CreateDonation`); use `IDEMPOTENCY_TTL_SECONDS` instead of `86400`; replace the `any` catch with a typed check
- [X] T028 [P] [US3] Wrap `backend/src/donations/simulateDonation.ts` with `withAuth` using `loadResource` to load the donation and return `donorSub` as owner (action `SimulateDonation`); a missing identity now yields 401, not 403
- [X] T029 [P] [US3] Wrap `backend/src/donations/getMyDonations.ts` with `withAuth` using the new action `ViewMyDonations` (no longer `CreateDonation`)
- [X] T030 [P] [US3] Wrap `backend/src/audit/getAuditEvents.ts` with `withAuth` (action `ViewAudit`)
- [X] T075 [P] [US3] Integration test in `backend/test/integration/idempotencyConcurrency.test.ts` (replaces `backend/test/idempotency.test.ts` and `backend/test/concurrency.test.ts`): same key + same body → same donation and one record; same key + different body → 409; key isolated per donor; two identical requests fired in parallel with `Promise.all` create exactly one donation; two parallel confirmations of the same donation add the amount once
- [X] T076 [P] [US3] Integration test in `backend/test/integration/projects.test.ts` (replaces `backend/test/projects.test.ts` and `backend/test/projectManagement.test.ts`): list/get/stats return only `PUBLICADO` projects and never a donor identifier; a draft project returns 404 to visitors; manager creates a draft (201) and publishes it (200); publishing twice → 409; invalid body → 400
- [X] T031 [US3] Keep the pure unit test `backend/test/authz.test.ts` (adapt it to the `withAuth` era); once T011, T019, T075 and T076 pass, delete the mock-based tests `backend/test/bola.test.ts`, `backend/test/idempotency.test.ts`, `backend/test/concurrency.test.ts`, `backend/test/projects.test.ts`, `backend/test/projectManagement.test.ts`, `backend/test/donationState.test.ts` and `backend/test/donationValidation.test.ts`, since they mock the database and would break with the extra audit writes (FR-025, constitution VII)

**Checkpoint**: T016–T019 pasan; añadir una función al template sin `withAuth` rompe T017

---

## Phase 6: User Story 4 - Auditoría completa, pseudonimizada e inalterable (Priority: P2)

**Goal**: éxitos y denegados auditados, actor siempre pseudonimizado, escritura en un solo punto, tabla append-only (H5, FR-011 a FR-015).

**Independent Test**: provocar un 403, un 401 del backend y un éxito; los tres aparecen con `actorRef` pseudonimizado; ninguna función puede editar o borrar eventos.

### Tests for User Story 4

- [X] T032 [P] [US4] Integration test in `backend/test/integration/audit.test.ts`: a role-denied call, a no-identity call and a successful call each produce one event following `data-model.md`; `actorRef` matches `usr_` + 12 hex and no attribute contains the raw `sub` or email; `anonymous` is used without identity; only AUDITOR can read events and sees successes and denials
- [X] T033 [P] [US4] Unit test in `backend/test/auditFailure.test.ts`: when the audit write fails the error is logged and the original response is unchanged (success stays success, denial stays denial)
- [X] T034 [P] [US4] Unit test in `backend/test/logger.test.ts`: log output never includes tokens, `sub`/`donorSub`, email or amount fields (FR-015)

### Implementation for User Story 4

- [X] T035 [US4] Rename `backend/src/audit/logAuditEvent.ts` to `backend/src/audit/recordAuditEvent.ts`; fields per `data-model.md` (`eventType`, `requestId`, `actorRef`, `action`, `resourceRef`, `outcome`, `reason?`); compute `auditDay` as the UTC date `YYYY-MM-DD` of `timestamp` and keep `eventType` as a plain attribute; write with `ConditionExpression: attribute_not_exists(auditDay)`; export no other writer
- [X] T036 [US4] Integrate `recordAuditEvent` in `backend/src/authz/withAuth.ts` following the audit rule of `contracts/with-auth.md` (denials of any protected action are always audited with reason `UNAUTHENTICATED`, `ROLE` or `OWNER`; successes only for state-changing actions `CreateProject`, `PublishProject`, `CreateDonation`, `SimulateDonation`; public actions and read-only successes are never audited); catch write failures, log them with `logError` and keep the response
- [X] T037 [P] [US4] Remove the inline audit writes from `backend/src/projects/createProject.ts` and `backend/src/projects/publishProject.ts` (they stored the raw `sub` as `actorRef`) and let `withAuth` audit them
- [X] T038 [P] [US4] Update `backend/src/shared/logger.ts` to redact `sub`, `donorSub`, `email`, token-like fields and amounts; remove `donorSub` and `amountCents` from log calls in `backend/src/donations/createDonation.ts` and `backend/src/donations/simulateDonation.ts`
- [X] T039 [US4] Update `backend/src/audit/getAuditEvents.ts` to query the `auditDay` partitions from the most recent day backwards (at most 7 days, 50 events in total, newest first), with optional `eventType` as a filter and `from`/`to` mapped to the day range; return `SUCCESS` and `DENIED` events, keeping the response shape of `docs/api.yaml` (update `docs/api.yaml` if `eventType` semantics change)
- [X] T040 [US4] In `infra/template.yaml`: change the `AuditTable` key schema to `auditDay` (HASH) + `timestamp#eventId` (RANGE) (the table is replaced on deploy, acceptable for the academic stage and noted in `docs/free-plan-guide.md`); add a resource policy on `AuditTable` that denies `dynamodb:UpdateItem`, `dynamodb:DeleteItem` and `dynamodb:BatchWriteItem` to every principal except the deploy role; add `AccessLogSettings` to `HttpApi` writing to a dedicated log group (so gateway 401s are traceable)
- [X] T041 [US4] Delete the mock-based `backend/test/audit.test.ts` once T032 and T033 pass (they cover the same behavior against a real table)

**Checkpoint**: T032–T034 pasan

---

## Phase 7: User Story 5 - Permisos mínimos por función (Priority: P2)

**Goal**: cada función solo tiene las acciones de `contracts/iam-permissions-matrix.md` (H6, FR-016, FR-017).

**Independent Test**: la prueba de infraestructura recorre el template y falla ante cualquier acción fuera de la matriz.

### Tests for User Story 5

- [X] T042 [US5] Infra test in `backend/test/infra/iamMatrix.test.ts`: encode the matrix from `contracts/iam-permissions-matrix.md`; assert per function the exact allowed actions and tables, no `Delete*`, `BatchWrite*`, `Scan` or `dynamodb:*`, no wildcard resources, Audit only `PutItem` (plus `Query` for `GetAuditEvents`), the three public functions have no access to Audit, `GetMyDonations` and `GetAuditEvents` have `PutItem` on Audit only for denial events, one role per function, `SimulateDonation` conditioned on stage `academic`; run with `describe.each(STAGES)` so both stages are checked

### Implementation for User Story 5

- [X] T043 [US5] In `infra/template.yaml` replace every `DynamoDBCrudPolicy`/`DynamoDBReadPolicy` of the three project-read functions, `CreateProject` and `PublishProject` with explicit statements per the matrix
- [X] T044 [US5] In `infra/template.yaml` replace the policies of `CreateDonationFunction`, `SimulateDonationFunction`, `GetMyDonationsFunction` and `GetAuditEventsFunction` with explicit statements per the matrix (include the index ARN for `donorSub-createdAt-index`)
- [X] T045 [US5] Write the manual T10 procedure in `evidence/t10-access-denied.md`: invoke a function outside its matrix in a real AWS account and paste the `AccessDeniedException`; mark it pending until executed

**Checkpoint**: T042 pasa; ninguna función conserva `DynamoDBCrudPolicy`

---

## Phase 8: User Story 6 - Telemetría, límites de entrada y red en el IaC (Priority: P2)

**Goal**: logs con 14 días, CloudTrail, CORS, throttling, callbacks y CSP reproducibles (H7, H8, FR-018 a FR-021, FR-005).

**Independent Test**: las aserciones sobre el template pasan; despliegue desde cero sin pasos manuales.

### Tests for User Story 6

- [X] T046 [US6] Infra test in `backend/test/infra/telemetryAndEdge.test.ts`: log groups have `RetentionInDays` 14 and are assigned in `Globals` with JSON format; a `AWS::CloudTrail::Trail` exists with a private S3 bucket (public access blocked, lifecycle rule); CORS `AllowOrigins` contains no `*`; each public route has its own throttling in `RouteSettings`; Cognito callback and logout URLs reference the CloudFront domain and `localhost` only under the academic stage; CSP `connect-src` includes the Cognito domain; run with `describe.each(STAGES)` (the `localhost` rules must differ by stage, and `production` must keep every restriction)

### Implementation for User Story 6

- [X] T047 [US6] In `infra/template.yaml`: add `AWS::Logs::LogGroup` (`RetentionInDays: 14`) shared by all functions via `Globals.Function.LoggingConfig` (`LogFormat: JSON`), and use `RetentionInDays: 14` for the API access log group created in T040
- [X] T048 [US6] In `infra/template.yaml`: add the CloudTrail resources (`AWS::S3::Bucket` for logs with public access blocked and a 90-day lifecycle, `AWS::S3::BucketPolicy` for CloudTrail, `AWS::CloudTrail::Trail` for management events); add parameter `EnableCloudTrail` (default `"true"`) to disable the trail when the account already has one; the log bucket must not use `Retain` and must be emptiable by `scripts/cleanup.ps1` (T078) so `sam delete` can finish
- [X] T049 [US6] In `infra/template.yaml`: restrict CORS `AllowOrigins` to the CloudFront domain (plus `http://localhost:3000` only when `IsAcademicStage`), add per-route `RouteSettings` throttling with lower limits for the three public GET routes, set Cognito `CallbackURLs` and `LogoutURLs` to the CloudFront domain (plus localhost only in the academic stage), and add the Cognito domain (`https://*.amazoncognito.com`) to the CSP `connect-src`

### Detección con pruebas gratuitas de 30 días (FR-031)

- [X] T072 [US6] In `infra/template.yaml`: add parameters `EnableGuardDuty` and `EnableSecurityHub` (type String, allowed `"true"`/`"false"`, default `"false"`) with conditions, and the resources `AWS::GuardDuty::Detector` (`Enable: true`) and the Security Hub hub (`AWS::SecurityHub::Hub`; check the resource type and properties against the CloudFormation reference with `cfn-lint`, and confirm in the account's console that a Security Hub trial applies before enabling it), each created only when its condition is true; add the trial end date reminder to the parameter descriptions
- [X] T073 [US6] Infra test in `backend/test/infra/detection.test.ts`: both parameters default to `"false"`, resources exist only under their conditions, and no other resource depends on them; run with `describe.each(STAGES)`
- [X] T074 [US6] Write `docs/free-plan-guide.md`: how to confirm the account plan type in Billing, how to enable/disable GuardDuty and Security Hub (`sam deploy --parameter-overrides EnableGuardDuty=true`), the 30-day trial end date, what is excluded and why (WAF, SMS MFA, Verified Permissions, Organizations), and the single-template rule, plus the cleanup procedure of T078
- [X] T078 [US6] Create `scripts/cleanup.ps1`: empty the CloudTrail log bucket and the frontend bucket (including object versions), then run `sam delete`; refuse to run against a stage named `production` unless `-Force` is passed. A non-empty bucket otherwise blocks `sam delete` (constitution V)

**Checkpoint**: T046 y T073 pasan

---

## Phase 9: User Story 7 - CI que demuestra la seguridad antes de desplegar (Priority: P2)

**Goal**: compuertas de `contracts/ci-gates.md` (H11, FR-022 a FR-025).

**Independent Test**: introducir un permiso excesivo, una expresión inválida y una ruta sin `withAuth` hace fallar el CI en los tres casos.

### Tests for User Story 7

- [X] T050 [US7] Verify the gates by negative experiments on a scratch branch and record the result in `evidence/ci-negative-checks.md`: (a) invalid `UpdateExpression` fails `integration`, (b) a `dynamodb:*` statement fails `infra-tests` or `checkov`, (c) a handler without `withAuth` fails the coverage test

### Implementation for User Story 7

- [X] T051 [P] [US7] Update `eslint.config.js`: `complexity` max 10, `max-lines-per-function` max 50, `@typescript-eslint/no-explicit-any` as error, `@typescript-eslint/no-unused-vars` as error; fix remaining violations in touched files and list large non-compliant areas as follow-up in `specs/002-zta-hardening/followups.md`
- [X] T052 [P] [US7] Create `.prettierrc` and `.prettierignore`, add `format` and `format:check` scripts to the root `package.json`, and format the files touched by this feature
- [X] T053 [P] [US7] Create `.cfnlintrc` and `.checkov.yaml` at the repository root; each skipped check carries a one-line justification
- [X] T054 [US7] Rewrite `.github/workflows/ci.yml` with jobs `lint-format`, `typecheck`, `unit`, `integration` (service container `amazon/dynamodb-local`, `DYNAMODB_ENDPOINT` set), `infra-tests`, `iac-scan` (`cfn-lint`, `checkov`) and `deploy` (`needs` all of them, only `main`, only when `vars.AWS_DEPLOY_ROLE_ARN` is set, OIDC via `aws-actions/configure-aws-credentials`, no long-lived keys); set `permissions: id-token: write, contents: read` only on `deploy`
- [X] T055 [US7] Fix findings reported by running `cfn-lint infra/template.yaml` and `checkov -f infra/template.yaml` locally; document accepted skips in `.checkov.yaml`

**Checkpoint**: pipeline verde y T050 documentado

---

## Phase 10: User Story 8 - Datos recuperables y protegidos (Priority: P3)

**Goal**: protección contra borrado y recuperación a un punto en el tiempo (FR-026).

**Independent Test**: en `production` las tablas críticas tienen ambas protecciones; en `academic` `sam delete` sigue limpiando.

### Tests for User Story 8

- [X] T056 [US8] Infra test in `backend/test/infra/dataProtection.test.ts`: Projects, Donations and Audit have `DeletionProtectionEnabled` tied to stage `production`, `PointInTimeRecoverySpecification` tied to parameter `EnablePitr`, and Idempotency has neither; run with `describe.each(STAGES)` and with `EnablePitr` on and off

### Implementation for User Story 8

- [X] T057 [US8] In `infra/template.yaml`: add parameter `EnablePitr` (default `false`, set to `true` when deploying `production`) and condition `IsProductionStage`; set `DeletionProtectionEnabled` and `PointInTimeRecoverySpecification` on `ProjectsTable`, `DonationsTable` and `AuditTable`

**Checkpoint**: T056 pasa

---

## Phase 11: User Story 9 - Sesión revalidada en acciones sensibles (Priority: P3)

**Goal**: un token robado o revocado deja de servir en las acciones sensibles (H9, FR-027).

**Independent Test**: contra un servidor HTTP real de prueba que imita `userInfo`, una sesión revocada es rechazada y una activa pasa; sin respuesta, se rechaza.

### Tests for User Story 9

- [X] T058 [P] [US9] Integration test in `backend/test/integration/sessionCheck.test.ts` using a real local HTTP server for the userInfo endpoint (status 200, 401, delay beyond timeout, connection refused): sensitive actions return 401 when revoked or unverifiable and pass when active; public reads and non-sensitive actions never call the endpoint; the audit event has reason `SESSION_REVOKED`

### Implementation for User Story 9

- [X] T059 [US9] Create `backend/src/authz/sessionCheck.ts`: call `GET ${COGNITO_USERINFO_URL}` with the raw access token, abort after `SESSION_CHECK_TIMEOUT_MS`, return active only on HTTP 200, log and fail closed on any other result or exception
- [X] T060 [US9] Integrate the `sensitive` option in `backend/src/authz/withAuth.ts` (step 5 of the contract) and set `sensitive: true` on `PublishProject`, `ViewAudit` and on `SimulateDonation` when the action is `CONFIRMAR`, using the list in `backend/src/shared/constants.ts`
- [X] T061 [US9] In `infra/template.yaml` add `COGNITO_USERINFO_URL` to `Globals.Function.Environment.Variables` built from the Cognito domain; extend `backend/test/infra/telemetryAndEdge.test.ts` or create `backend/test/infra/sessionEnv.test.ts` to assert it exists

**Checkpoint**: T058 pasa

---

## Phase 12: User Story 10 - Lo declarado coincide con lo implementado (Priority: P3)

**Goal**: ninguna afirmación de seguridad sin evidencia (H4, FR-028 a FR-030).

**Independent Test**: cruzar cada afirmación de seguridad de los documentos con código, template o prueba.

- [X] T062 [US10] Delete `backend/src/authz/cedarAdapter.ts` and `backend/test/cedarEquivalence.test.ts`; remove `getAuthorizer()` and the `POLICY_ENGINE` branch from `backend/src/authz/evaluateAuthz.ts`; remove `@aws-sdk/client-verifiedpermissions` from `backend/package.json` and refresh `package-lock.json`
- [X] T063 [P] [US10] Create `policies/README.md` stating that the Cedar files are documentation for phase 2 and are not enforced
- [X] T064 [P] [US10] Rewrite the affected statements in `AI_USAGE.md`: no Cedar adapter as active, and list every AI tool actually used in this repository (ask the maintainer to confirm the list)
- [X] T065 [P] [US10] Update `docs/zta-hallazgos-y-mejoras.md`: status of H1–H11, the seven NIST principles, section 8 inconsistencies and section 11 evidence, marking what remains pending real AWS
- [X] T066 [P] [US10] Update `docs/arquitectura-comparacion.md` and `docs/threat-model.md` so the "mejorada" column and the mitigations match what is implemented; update the claims on MFA, audit immutability and policy engine in `design.md` and `requirements.md`
- [X] T079 [P] [US10] Write `docs/operations-notes.md` covering the edge cases of the spec: (a) after a point-in-time restore the `confirmedAmountCents` of a project can differ from its confirmed donations, with the steps to recompute it; (b) audit pseudonyms remain after a user is deleted and cannot be traced back to the user directly; (c) privileged users enroll their TOTP at first sign-in through the Hosted UI before receiving any token
- [X] T067 [US10] Final consistency sweep: search the repository for `verified_permissions`, `cedarAdapter`, `logAuditEvent`, `DynamoDBCrudPolicy`, `enforceAuthz` outside `withAuth`, and `MfaConfiguration: "OPTIONAL"`; fix or justify each hit

---

## Phase 13: Polish & Cross-Cutting

**Purpose**: validación de extremo a extremo y evidencia

- [X] T068 Update `backend/test/acceptance/t01-t14.sh` so T10 and T14 point to the new evidence and tests, and keep T01–T14 runnable
- [X] T069 Run the whole of `quickstart.md` sections 1–3 locally and fix failures; confirm total CI time under 10 minutes (SC-012)
- [ ] T070 One confirmation pass on a real AWS account (`quickstart.md` section 4), only for what no emulator can show (see `evidence/test-run-report.md`, section 3): the Cognito hosted UI in a browser including the TOTP enrollment pages, the effect of `DeletionProtectionEnabled` and point-in-time recovery on the production tables (Floci's CloudFormation ignores both properties), that the emulated behavior matches AWS, and optionally the real IAM confirmation of T10. Store the outputs in `evidence/`. Pending: the environment has no valid AWS credentials.
- [X] T071 Regenerate `docs/diagrams/zta-architecture-target.png` only if the implementation deviates from `zta-architecture-target.d2`; otherwise record in `docs/arquitectura-comparacion.md` that the target is now the current architecture

---

## Phase 14: Cierre de pendientes con emulador y mapeo NIST

**Purpose**: reducir al mínimo la evidencia que exige AWS real (T10, T11, T14) y demostrar los 7 principios. Se añadió tras revisar qué cubría cada nivel de prueba.

- [X] T080 [P] Reject non-access tokens in `backend/src/authz/claims.ts`: a claim set whose `token_use` is not `access` yields no principal (401); update `backend/test/integration/helpers/events.ts` and the unit tests so events carry `token_use: "access"`
- [X] T081 [P] Integration test `backend/test/integration/idToken.test.ts`: an ID token gets 401 on every protected route, changes nothing and is audited as `UNAUTHENTICATED`
- [X] T082 Create the Floci suite scaffolding: `backend/test/floci/docker-compose.yml` (image pinned to 2.4.0, IAM enforcement on), `backend/vitest.floci.config.ts`, `backend/test/floci/globalSetup.ts` (tables, one IAM user per function holding the inline policy of its role in `infra/template.yaml`), `backend/test/floci/helpers/policyResolver.ts`, `npm run test:floci`; move the table definitions to `backend/test/integration/helpers/tableDefinitions.ts`
- [X] T083 Create `backend/test/floci/iamEnforcement.test.ts` (T10): each real handler works with its minimal role and every operation outside the contract (`DeleteItem`, `BatchWriteItem`, `Scan`, and writes outside the matrix) gets `AccessDeniedException`
- [X] T084 Create `backend/test/floci/cognito.test.ts` (T11, T14): a user pool built from the MFA settings of the template; a user without a second factor receives `MFA_SETUP` and no tokens; after TOTP enrollment tokens carry `token_use`; the claims of an ID token get 401 and those of an access token pass
- [X] T085 Create `backend/test/floci/stackDeployment.test.ts`: deploy `infra/template.yaml` (SAM included) as a stack and check functions, tables, MFA, log retention, audit key and the optional detection services
- [X] T086 Fix the `Query` policies of `ListProjectsFunction` and `GetMyDonationsFunction` in `infra/template.yaml` (table ARN is the required resource; the index ARN is added); found by T083
- [X] T087 Add `FrontendBucketPolicy` to `infra/template.yaml` (CloudFront OAC read only, TLS only; the site could not be read without it) and `backend/test/infra/networkSecurity.test.ts` for NIST principle 2
- [X] T088 Write `docs/nist-800-207-mapping.md` (7 principles, PA/PEP/PE, evidence, state) and `backend/test/infra/nistMapping.test.ts`, which fails if a principle is missing or a cited file does not exist
- [X] T089 Add the `emulator` job to `.github/workflows/ci.yml` as a deploy gate and install `aws-sam-translator` with `cfn-lint` (without it the SAM part is silently skipped)
- [X] T091 Research other emulators (MiniStack, fakecloud, LocalStack, Moto) for the pieces Floci was assumed not to cover; record the findings in `research.md` section 11
- [X] T092 Create `backend/test/floci/apiAuthorizer.test.ts`: the template deployed in Floci with TLS on; the JWT authorizer rejects no token, a forged token, a token with an altered payload and a token of another pool (401), rejects ID tokens and access tokens without the route scope (403, scopes applied from the template) and accepts a genuine access token; extract `helpers/cognitoUsers.ts` and `helpers/stack.ts`
- [X] T093 Configure `backend/test/floci/docker-compose.yml` and the CI `emulator` job with TLS, the https base URL and private JWT targets so Floci's authorizer can read the issuer keys
- [X] T094 Update the evidence and mapping documents with the authorizer results and the exact remaining limits (Lambda execution needs the Docker socket and was not enabled)
- [X] T095 Run the Lambda functions for real: `backend/test/floci/docker-compose.lambda.yml` (Docker socket, see its security note), `backend/vitest.floci-e2e.config.ts`, `backend/test/floci/helpers/packageFunctions.ts` (build the deployment package), and `backend/test/floci/e2e/fullStack.test.ts`: the template deployed in Floci, each function with the real code and the inline IAM policy of its role, users that sign in through the hosted login, and the full flow (401/403 at the gateway, create and publish, idempotent donation, confirm, history, pseudonymized audit, session revocation)
- [X] T096 Hosted sign-in with PKCE in `backend/test/floci/helpers/cognitoUsers.ts` (`hostedSignIn`) so tokens carry the `api/*` scopes; apply the template scopes to the emulated routes; prove the happy path, the 403 for ID tokens and for tokens without the route scope, and the 401 for an expired token (`FLOCI_SERVICES_COGNITO_ENFORCE_TOKEN_VALIDITY_LIMITS=false`)
- [X] T097 Fix the sign-out in `frontend/src/auth/authService.ts`: it called `<issuer>/oauth2/revoke`, which does not exist, so the refresh token was never revoked; derive the endpoint from the discovery document (`frontend/src/auth/revocation.ts`) and log a failed revocation; prove it with `backend/test/floci/refreshRevocation.test.ts`
- [X] T098 Prove statically that the content security policy lets the SPA reach discovery, token, revocation and the API (`backend/test/infra/networkSecurity.test.ts`)
- [X] T099 Deploy the production-equivalent template (without the simulation function) in `backend/test/floci/stackDeployment.test.ts`, since Floci cannot deploy the full template for that stage
- [X] T100 Add the `emulator-e2e` job to `.github/workflows/ci.yml` (non-gating until it has been seen passing on a runner) and update the evidence, mapping, quickstart, research, README and findings documents
- [X] T090 Update `evidence/t10-access-denied.md`, `evidence/test-run-report.md`, `evidence/ci-negative-checks.md`, `specs/002-zta-hardening/quickstart.md`, `README.md`, `AI_USAGE.md` and `docs/zta-hallazgos-y-mejoras.md` with the new evidence and counts

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (1)** → **Foundational (2)** → historias. Polish (13) al final.
- **US1, US2** dependen solo de Foundational (US2 solo del lector del template, T008).
- **US3** depende de Foundational y de las constantes (T004). **No** depende de US1/US2.
- **US4** depende de US3 (`withAuth`, T021).
- **US5** depende de US4 (los roles deben permitir exactamente lo que `withAuth` escribe) y comparte `infra/template.yaml`.
- **US6, US8** solo tocan el template y dependen de que US2, US4 y US5 hayan terminado sus ediciones del archivo (editar secuencialmente).
- **US7** depende de US2–US6 para que `infra-tests` e `iac-scan` tengan qué validar; T051–T053 pueden empezar antes.
- **US9** depende de US3 (`withAuth`) y de US2 (dominio de Cognito, T015).
- **US10** depende de US3 (T020 comparte `evaluateAuthz.ts`) y se cierra al final.

### Orden recomendado del template (un solo editor a la vez)

T015 → T040 → T043 → T044 → T047 → T048 → T049 → T072 → T057 → T061

### Dentro de cada historia

- Pruebas primero y verificar que fallan; luego implementación.
- `withAuth` antes de envolver handlers; handlers antes de auditoría.

### Oportunidades de paralelismo

- Setup: T002, T003, T004.
- Foundational: T006, T007, T008 tras T005.
- US1: T010 y T011; T013 en paralelo con T012.
- US3: T016–T019 en paralelo; T022–T030 son 9 archivos distintos, en paralelo tras T021.
- US4: T032–T034 en paralelo; T037 y T038 en paralelo.
- US7: T051, T052, T053 en paralelo.
- US10: T063–T066 en paralelo.

### Ejemplo de paralelismo: User Story 3

```text
# Pruebas de US3 en paralelo:
Task: "Unit tests for withAuth in backend/test/withAuth.test.ts"
Task: "Route coverage test in backend/test/infra/withAuthCoverage.test.ts"
Task: "Role x action matrix in backend/test/integration/authzMatrix.test.ts"
Task: "BOLA tests in backend/test/integration/bola.test.ts"

# Envoltura de los nueve handlers en paralelo (tras T021):
Task: "Wrap backend/src/projects/listProjects.ts"        Task: "Wrap backend/src/donations/createDonation.ts"
Task: "Wrap backend/src/projects/getProject.ts"          Task: "Wrap backend/src/donations/simulateDonation.ts"
Task: "Wrap backend/src/projects/getProjectStats.ts"     Task: "Wrap backend/src/donations/getMyDonations.ts"
Task: "Wrap backend/src/projects/createProject.ts"       Task: "Wrap backend/src/audit/getAuditEvents.ts"
Task: "Wrap backend/src/projects/publishProject.ts"
```

---

## Implementation Strategy

### MVP (P1)

1. Fases 1 y 2.
2. **US1**: arreglar H1 con DynamoDB real. Parar y validar.
3. **US2**: MFA y dominio de Cognito.
4. **US3**: `withAuth` y su prueba de cobertura. Parar y validar: las tres brechas de prioridad alta/crítica quedan cerradas.

### Entrega incremental

1. P1 completas → demostrable.
2. US4 + US5 (auditoría y permisos) → ZTA creíble en evidencia y privilegio.
3. US6 + US7 (IaC y CI) → reproducible y verificado.
4. US8 + US9 + US10 (P3) según tiempo; US10 debe cerrarse siempre antes de la entrega para no declarar de más.

### Equipo

Tras Foundational: A → US1 + US2; B → US3 (luego US4 y US9); C → US7 (T051–T053) y documentación US10. Quien edite `infra/template.yaml` sigue el orden recomendado.


---

## Phase 15: Frontend local y pruebas en navegador

**Purpose**: poder ver y probar el sistema completo sin AWS, y cubrir con pruebas lo que se descubrió al usarlo a mano.

- [X] T090 `backend/scripts/localStack.ts` y `npm run local`: levanta Floci con IAM, TLS y el socket de Docker, despliega `infra/template.yaml`, crea tres usuarios de ejemplo y tres proyectos, escribe `frontend/.env.local` y lanza Vite; `npm run local:stop` lo desmonta; `npm run local:trust` instala el certificado del emulador en Windows; guía en `docs/ver-el-frontend.md`
- [X] T091 `backend/test/browser/spa.test.ts` (Playwright con Edge o Chrome): 15 recorridos, cada uno sobre el build con la CSP del template y sobre el servidor de Vite; `npm run test:browser`
- [X] T092 Corregir lo que el navegador reveló: estilos ausentes (`frontend/src/index.css`), URL de revocación al salir, doble intercambio del código de autorización con React StrictMode, CORS del emulador, caché de la app que no se invalidaba al donar ni al aprobar, UUID del proyecto que el gestor no podía ver para publicar, aviso visible cuando el login no puede contactar al proveedor de identidad
- [X] T093 Cerrar la sesión del Hosted UI al salir (`frontend/src/auth/revocation.ts`, `logoutUrlOf`): sin esto otra persona entraba como la anterior sin credenciales; prueba unitaria `backend/test/auth/logoutUrl.test.ts` y recorrido de dos cuentas en el navegador
- [X] T094 Auditoría de una donación denegada con el proyecto afectado (`backend/src/audit/resourceRef.ts`: el identificador del cuerpo solo entra si es un UUID); `backend/test/audit/resourceRef.test.ts` y `backend/test/integration/audit.test.ts`
- [X] T095 No ofrecer el botón de donar a quien no es DONANTE (`frontend/src/pages/ProjectDetailPage.tsx`); la API sigue siendo la que decide
- [X] T096 `deleteStack` de las pruebas de Floci espera a que termine el borrado, y `bootLocalStack` falla con un mensaje claro si ya hay otro stack (la plantilla usa nombres fijos)
- [X] T097 Personalización del Hosted UI clásico por CSS (`CognitoHostedUiBranding` y `ManagedLoginVersion: 1` en `infra/template.yaml`) con `backend/test/infra/hostedUi.test.ts`, que exige solo las clases y propiedades que Cognito acepta
- [X] T098 Etapa `browser` en `.github/workflows/ci.yml`, sin bloquear el despliegue hasta verla pasar en un runner
- [X] T099 `.local/` en `.gitignore` (certificado y registros que genera `npm run local`)
- [X] T100 Política para un usuario con más de un rol: `AUDITOR` no se combina con otro rol (`SEPARATION_OF_DUTIES`, `backend/src/authz/evaluateAuthz.ts`) y quien creó un proyecto no puede donarle (`CONFLICT_OF_INTEREST`, `createdBy` en el proyecto, nunca en las vistas públicas); ambas se auditan; `backend/test/integration/separationOfDuties.test.ts`, `backend/test/authz.test.ts`
- [X] T101 Las acciones sensibles releen los grupos de la persona en Cognito (`backend/src/authz/currentGroups.ts`, `AdminListGroupsForUser` solo para las tres funciones sensibles y sobre el pool del stack) y rechazan con `ROLE_REVOKED`, también si no pueden leerlos; pruebas en integración, infraestructura, emulador (con IAM) y e2e con Lambdas reales; procedimiento de baja en `docs/operations-notes.md`
- [X] T102 Etapa `dependency-audit` en el CI (`npm audit`: bloquea por vulnerabilidades altas o críticas en producción; reporta las de desarrollo); subir `zod` a 4.6.7 por la vulnerabilidad alta que encontró y quitar `zod` del frontend, que no lo usaba
- [X] T105 Inicio de sesión en ventana emergente (`signinPopup` de `oidc-client-ts`, `frontend/src/auth/authService.ts` y `popup.ts`): sigue siendo la página del proveedor de identidad, así que la contraseña no pasa por la app; si el navegador bloquea la ventana continúa en la página completa y si la persona la cierra no se muestra ningún error; probado en el navegador (ventana, cierre a mano, bloqueo) y con pruebas unitarias de los mensajes de error. **Pendiente de AWS real:** que el Hosted UI de Cognito no impida que la ventana avise a la página que la abrió
- [X] T107 CORS del API en AWS real: la primera vez que se desplegó, el API respondió 404 al preflight y no envió ninguna cabecera CORS, porque SAM escribe mal el CORS cuando un `!If` envuelve toda la lista de orígenes y API Gateway lo ignora en silencio. Las pruebas no lo vieron porque resolvían las condiciones antes de mirar, y el emulador lo enmascaraba porque la prueba aplicaba el CORS a mano. Corregido poniendo la condición en el elemento (`!If [IsAcademicStage, localhost, !Ref AWS::NoValue]`); guardas: `backend/test/infra/corsAsSamReadsIt.test.ts` (lee la plantilla como la recibe SAM) y `infra/scripts/check_sam_cors.py` (ejecuta el traductor de SAM; falla con la plantilla anterior), esta última en el CI. **Pendiente de AWS real:** volver a desplegar y comprobar que el preflight responde con las cabeceras (`quickstart.md`, sección 4)
- [X] T108 Publicar el frontend desde el CI junto con el backend: `infra/scripts/publish-frontend.sh` lee del stack la dirección del API y los identificadores de Cognito, compila con ellos, sube al bucket privado con caché larga para los archivos con hash y `no-cache` para `index.html`, e invalida CloudFront; sirve igual en la máquina de una persona (`--dry-run` lista lo que subiría sin cambiar nada) y es el último paso del trabajo `deploy` del CI. La plantilla gana las salidas `FrontendBucketName` y `CloudFrontDistributionId` (el README mandaba subir a un `FrontendBucketName` que no existía). Probado en simulación y luego en una publicación real a mano contra el stack desplegado, que reveló un defecto: Git Bash en Windows reescribía `/index.html` como `C:/Program Files/Git/index.html` y CloudFront rechazaba las rutas de invalidación (corregido con `MSYS_NO_PATHCONV=1` y cubierto por `backend/test/infra/publishFrontendScript.test.ts`). Queda pendiente su ejecución desde el CI, que necesita el rol de la identidad del CI
- [X] T109 Identidad del CI en AWS (`infra/bootstrap/github-oidc.yaml`, plantilla aparte que una persona administradora despliega una vez por cuenta): proveedor OIDC de GitHub y dos roles. El de GitHub solo se asume desde la rama `main` del repositorio (comparación exacta, sin patrones) y solo maneja el stack con conjuntos de cambios, sube artefactos y publica el frontend. El de ejecución solo lo usa CloudFormation, para el stack de la aplicación, y crea los recursos con permisos acotados por nombre (roles solo `aqp-solidaria-academic-*`, que excluye a los dos del CI). El CI le pasa ese rol a `sam deploy --role-arn` y exige tres variables. Pruebas: `backend/test/infra/ciIdentity.test.ts` (quién puede asumir, qué puede hacer, que cubre todos los tipos de recurso de la plantilla y que usa los nombres reales); cfn-lint y checkov la analizan. En la primera ejecución real, AWS rechazó el rol (`Not authorized to perform sts:AssumeRoleWithWebIdentity`) porque GitHub ya no presenta `repo:<propietario>/<repositorio>:...` sino `repo:<propietario>@<id>/<repositorio>@<id>:...` (identificadores numéricos inmutables); se vio en el historial de CloudTrail y se corrigió la confianza con los cuatro parámetros (nombre y número de propietario y de repositorio), lo que además impide heredar el acceso renombrando o recreando el repositorio; el CI muestra la identidad presentada cuando el rol no se puede asumir. **Pendiente de AWS real:** que el despliegue del CI complete con la identidad corregida; la lista de permisos sale de los esquemas oficiales y puede faltar alguna acción
- [ ] T103 Subir `vitest` a la versión 5 (cambio mayor) para cerrar las advertencias de `vitest`/`tinypool`, solo de desarrollo
- [X] T104 Alta automática de `DONANTE`: quien registra y confirma su correo entra como donante (`backend/src/identity/addDonorToGroup.ts`, disparador de post-confirmación de Cognito, décima función). Solo asigna `DONANTE`, solo ante el registro nuevo (no ante la recuperación de contraseña), queda auditada (`ROLE_ASSIGNED`) y sus permisos son `AdminAddUserToGroup` sobre el pool y `PutItem` en la auditoría. El registro abierto queda declarado en la plantilla (`AllowAdminCreateUserOnly: false`). Pruebas: integración, infraestructura (cableado, permiso de invocación, ausencia de ciclos), emulador con IAM y e2e con la función desplegada
- [ ] T106 Flujo para pedir el rol de gestor, aprobado por una persona administradora (hoy `GESTOR` y `AUDITOR` los concede un administrador por la CLI); incluye decidir si hay un rol administrador dentro de la app y cómo se evita que se conceda poder a sí mismo; ver `followups.md`

---

## Notes

- [P] = archivos distintos y sin dependencias pendientes.
- T090–T109 (fase 15) se añadieron al pedir que todo se pudiera ver y probar con un simulador, y al probar el frontend a mano.
- Evidencia que exige AWS real (T045, T070) queda **pendiente** hasta ejecutarse; no se marca como cumplida por pruebas locales.
- El usuario realiza los commits; las tareas no incluyen commits.
- Evitar: tareas vagas, conflictos en `infra/template.yaml`, dependencias cruzadas que rompan la independencia de historias.
- T072–T079 se añadieron después del análisis de consistencia; se ejecutan en el orden de la fase donde están, no por número.
