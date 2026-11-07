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

- [ ] T001 Add scripts `test:integration` and `test:infra` and the `yaml` dev dependency to `backend/package.json`; create `backend/vitest.config.ts` so `npm run test` runs only unit tests (excludes `test/integration/**` and `test/infra/**`)
- [ ] T002 [P] Create `backend/vitest.integration.config.ts` (includes only `test/integration/**`, `globalSetup` pointing to `backend/test/integration/globalSetup.ts`, sequential files to avoid table collisions)
- [ ] T003 [P] Create `backend/test/integration/docker-compose.yml` running `amazon/dynamodb-local` on port 8000 (`-inMemory`), for local runs
- [ ] T004 [P] Create `backend/src/shared/constants.ts` with named constants: roles (`DONANTE`, `GESTOR`, `AUDITOR`), donation statuses (`PENDIENTE_SIMULACION`, `CONFIRMADA_SIMULADA`, `RECHAZADA_SIMULADA`), project statuses, `CURRENCY = "PEN"`, `IDEMPOTENCY_TTL_SECONDS = 86400`, `SESSION_CHECK_TIMEOUT_MS`, and the list of sensitive actions (`PublishProject`, `ViewAudit`, `SimulateDonation`/CONFIRMAR)

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: arnés de pruebas contra DynamoDB real y lector del template. Bloquea todas las historias.

**⚠️ CRITICAL**: ninguna historia empieza antes de terminar esta fase

- [ ] T005 Create `backend/test/integration/globalSetup.ts`: wait for `DYNAMODB_ENDPOINT` (default `http://localhost:8000`), set test env vars for the four table names, create the four tables with the same key schemas and GSIs as `infra/template.yaml` (Projects `status-createdAt-index`, Donations `donorSub-createdAt-index`, Idempotency `pk` with TTL, Audit `eventType` + `timestamp#eventId`), and drop them on teardown
- [ ] T006 [P] Create `backend/test/integration/helpers/events.ts`: builders for API Gateway HTTP API events with JWT claims for each role (`DONANTE`, `GESTOR`, `AUDITOR`, no identity, and a fake group `GESTOR_FAKE`), headers (case-insensitive `Idempotency-Key`), body, path parameters, and `requestId`
- [ ] T007 [P] Create `backend/test/integration/helpers/seed.ts`: functions to insert published/draft projects and pending/confirmed donations directly into the tables, and to read an item back
- [ ] T008 [P] Create `backend/test/infra/helpers/loadTemplate.ts`: parse `infra/template.yaml` with the `yaml` package registering custom tags (`!Ref`, `!Sub`, `!GetAtt`, `!Equals`, `!If`, `!Join`) as plain structures; export helpers to list functions, their policies, their events and their `Handler`
- [ ] T009 Create `backend/test/integration/smoke.test.ts` proving the harness: put and get an item in each table and run a real `TransactWriteCommand`

**Checkpoint**: `docker compose up -d` + `npm run test:integration --workspace=backend` pasa el smoke test

---

## Phase 3: User Story 1 - Confirmar una donación funciona (Priority: P1) 🎯 MVP

**Goal**: la confirmación suma el monto al proyecto una sola vez (H1, FR-001, FR-002).

**Independent Test**: crear → confirmar contra DynamoDB Local; segundo cambio de estado da 409; misma clave de idempotencia devuelve la misma donación.

### Tests for User Story 1

> Escribirlos primero y comprobar que el de confirmación **falla** antes del arreglo

- [ ] T010 [P] [US1] Integration test in `backend/test/integration/confirmDonation.test.ts`: owner confirms a `PENDIENTE_SIMULACION` donation → 200, status `CONFIRMADA_SIMULADA`, project `confirmedAmountCents` increases exactly by `amountCents`; rejecting leaves the total unchanged
- [ ] T011 [P] [US1] Integration test in `backend/test/integration/donationFlow.test.ts`: second state change on a terminal donation → 409 and total unchanged; same `Idempotency-Key` + same body → same donation; same key + different amount → 409; key isolated per donor; amount `-1`, missing or non-UUID key and invalid JSON → 400 without stack trace; donation to a draft project → 409

### Implementation for User Story 1

- [ ] T012 [US1] Fix the update expression in `backend/src/donations/simulateDonation.ts` line 121 to `ADD confirmedAmountCents :amount SET updatedAt = :now`; replace the `any` casts in the file with typed transaction items and typed error checks
- [ ] T013 [P] [US1] Correct the same expression in `specs/001-secure-donations/research.md` section 2 (`ADD ... SET`)

**Checkpoint**: T010 y T011 pasan; US1 es un MVP funcional por sí solo

---

## Phase 4: User Story 2 - MFA obligatorio (Priority: P1)

**Goal**: ningún usuario obtiene tokens sin segundo factor (H2, FR-003, FR-005). Hosted UI definido.

**Independent Test**: la prueba de infraestructura verifica MFA `REQUIRED` + TOTP, sin SMS, y que existe el dominio de Cognito.

### Tests for User Story 2

- [ ] T014 [US2] Replace `backend/test/mfa.test.ts` (it simulates Cognito inside the test) with `backend/test/infra/mfa.test.ts` asserting on the real template: `MfaConfiguration` is `REQUIRED`, `EnabledMfas` is exactly `SOFTWARE_TOKEN_MFA`, no SMS configuration, a `AWS::Cognito::UserPoolDomain` exists using `CognitoDomainPrefix`, `AccessTokenValidity` ≤ 15 minutes, ID token not accepted as API credential (authorizer audience is the SPA client and routes list `AuthorizationScopes`)

### Implementation for User Story 2

- [ ] T015 [US2] In `infra/template.yaml`: set Cognito `MfaConfiguration` to `REQUIRED`; add the `CognitoUserPoolDomain` resource (`Domain: !Ref CognitoDomainPrefix`); update the descriptions of groups `GESTOR` and `AUDITOR` so they match the real behavior; add `UserPoolDomain` URL to `Outputs`

**Checkpoint**: T014 pasa

---

## Phase 5: User Story 3 - Autorización obligatoria con `withAuth()` (Priority: P1)

**Goal**: toda ruta pasa por un único envoltorio; una ruta nueva sin él rompe CI (H3, FR-006 a FR-010, FR-025).

**Independent Test**: prueba de cobertura sobre las líneas `Handler:` del template, matriz rol × acción y BOLA en integración, 401 uniforme sin identidad.

### Tests for User Story 3

- [ ] T016 [P] [US3] Unit tests for `withAuth` in `backend/test/withAuth.test.ts` following `contracts/with-auth.md`: fixed execution order, 401 without identity, 403 on insufficient role, 404 when `loadResource` finds nothing, any exception from the policy engine denies (fail closed), errors mapped to HTTP without stack trace
- [ ] T017 [P] [US3] Route coverage test in `backend/test/infra/withAuthCoverage.test.ts`: for every `Handler:` in `infra/template.yaml`, import the compiled-source module and assert `handler[WITH_AUTH] === true`; include a negative case that a module without the marker fails the check
- [ ] T018 [P] [US3] Integration role × action matrix in `backend/test/integration/authzMatrix.test.ts`: every disallowed combination (donor creating/publishing project, manager donating, non-auditor viewing audit, fake group `GESTOR_FAKE`, no identity) returns 401/403 and leaves the tables unchanged
- [ ] T019 [P] [US3] Integration BOLA tests in `backend/test/integration/bola.test.ts`: another donor or a manager cannot confirm someone else's donation, the donor history only contains their own donations, and the donation status is unchanged after each attack (replaces the mocked `backend/test/bola.test.ts`)

### Implementation for User Story 3

- [ ] T020 [US3] Extend `backend/src/authz/evaluateAuthz.ts`: add actions `ViewProjectStats` and `ViewMyDonations` (donor-only, own donations), use the constants from `backend/src/shared/constants.ts`, keep fail-closed behavior, replace the loose group parsing `catch` with a logged fail-closed result, and export `WITH_AUTH` symbol from a new `backend/src/authz/withAuthMarker.ts`
- [ ] T021 [US3] Create `backend/src/authz/withAuth.ts` implementing `contracts/with-auth.md` (extract claims, optional `loadResource`, policy decision, execute, map errors; hooks for session check and audit are added by US4 and US9); mark the returned handler with `WITH_AUTH`
- [ ] T022 [P] [US3] Wrap `backend/src/projects/listProjects.ts` with `withAuth` (public action `ListProjects`)
- [ ] T023 [P] [US3] Wrap `backend/src/projects/getProject.ts` with `withAuth` (public action `ViewProject`)
- [ ] T024 [P] [US3] Wrap `backend/src/projects/getProjectStats.ts` with `withAuth` (public action `ViewProjectStats`)
- [ ] T025 [P] [US3] Wrap `backend/src/projects/createProject.ts` with `withAuth` (action `CreateProject`); remove its direct `enforceAuthz` call
- [ ] T026 [P] [US3] Wrap `backend/src/projects/publishProject.ts` with `withAuth` (action `PublishProject`); remove its direct `enforceAuthz` call
- [ ] T027 [P] [US3] Wrap `backend/src/donations/createDonation.ts` with `withAuth` (action `CreateDonation`); use `IDEMPOTENCY_TTL_SECONDS` instead of `86400`; replace the `any` catch with a typed check
- [ ] T028 [P] [US3] Wrap `backend/src/donations/simulateDonation.ts` with `withAuth` using `loadResource` to load the donation and return `donorSub` as owner (action `SimulateDonation`); a missing identity now yields 401, not 403
- [ ] T029 [P] [US3] Wrap `backend/src/donations/getMyDonations.ts` with `withAuth` using the new action `ViewMyDonations` (no longer `CreateDonation`)
- [ ] T030 [P] [US3] Wrap `backend/src/audit/getAuditEvents.ts` with `withAuth` (action `ViewAudit`)
- [ ] T031 [US3] Update the existing unit tests `backend/test/authz.test.ts`, `backend/test/projects.test.ts`, `backend/test/projectManagement.test.ts`, `backend/test/donationState.test.ts` and `backend/test/donationValidation.test.ts` to the new handler shape; delete `backend/test/bola.test.ts` once T019 replaces it

**Checkpoint**: T016–T019 pasan; añadir una función al template sin `withAuth` rompe T017

---

## Phase 6: User Story 4 - Auditoría completa, pseudonimizada e inalterable (Priority: P2)

**Goal**: éxitos y denegados auditados, actor siempre pseudonimizado, escritura en un solo punto, tabla append-only (H5, FR-011 a FR-015).

**Independent Test**: provocar un 403, un 401 del backend y un éxito; los tres aparecen con `actorRef` pseudonimizado; ninguna función puede editar o borrar eventos.

### Tests for User Story 4

- [ ] T032 [P] [US4] Integration test in `backend/test/integration/audit.test.ts`: a role-denied call, a no-identity call and a successful call each produce one event following `data-model.md`; `actorRef` matches `usr_` + 12 hex and no attribute contains the raw `sub` or email; `anonymous` is used without identity; only AUDITOR can read events and sees successes and denials
- [ ] T033 [P] [US4] Unit test in `backend/test/auditFailure.test.ts`: when the audit write fails the error is logged and the original response is unchanged (success stays success, denial stays denial)
- [ ] T034 [P] [US4] Unit test in `backend/test/logger.test.ts`: log output never includes tokens, `sub`/`donorSub`, email or amount fields (FR-015)

### Implementation for User Story 4

- [ ] T035 [US4] Rename `backend/src/audit/logAuditEvent.ts` to `backend/src/audit/recordAuditEvent.ts`; fields per `data-model.md` (`eventType`, `requestId`, `actorRef`, `action`, `resourceRef`, `outcome`, `reason?`); write with `ConditionExpression: attribute_not_exists(eventType)`; export no other writer
- [ ] T036 [US4] Integrate `recordAuditEvent` in `backend/src/authz/withAuth.ts` (success and denied, reason codes `UNAUTHENTICATED`, `ROLE`, `OWNER`); catch write failures, log them with `logError` and keep the response
- [ ] T037 [P] [US4] Remove the inline audit writes from `backend/src/projects/createProject.ts` and `backend/src/projects/publishProject.ts` (they stored the raw `sub` as `actorRef`) and let `withAuth` audit them
- [ ] T038 [P] [US4] Update `backend/src/shared/logger.ts` to redact `sub`, `donorSub`, `email`, token-like fields and amounts; remove `donorSub` and `amountCents` from log calls in `backend/src/donations/createDonation.ts` and `backend/src/donations/simulateDonation.ts`
- [ ] T039 [US4] Update `backend/src/audit/getAuditEvents.ts` to return `SUCCESS` and `DENIED` events ordered by most recent, keeping the response shape of `docs/api.yaml`
- [ ] T040 [US4] In `infra/template.yaml`: add a resource policy on `AuditTable` that denies `dynamodb:UpdateItem`, `dynamodb:DeleteItem` and `dynamodb:BatchWriteItem` to every principal except the deploy role; add `AccessLogSettings` to `HttpApi` writing to a dedicated log group (so gateway 401s are traceable)
- [ ] T041 [US4] Update `backend/test/audit.test.ts` to the new module name and event shape

**Checkpoint**: T032–T034 pasan

---

## Phase 7: User Story 5 - Permisos mínimos por función (Priority: P2)

**Goal**: cada función solo tiene las acciones de `contracts/iam-permissions-matrix.md` (H6, FR-016, FR-017).

**Independent Test**: la prueba de infraestructura recorre el template y falla ante cualquier acción fuera de la matriz.

### Tests for User Story 5

- [ ] T042 [US5] Infra test in `backend/test/infra/iamMatrix.test.ts`: encode the matrix from `contracts/iam-permissions-matrix.md`; assert per function the exact allowed actions and tables, no `Delete*`, `BatchWrite*`, `Scan` or `dynamodb:*`, no wildcard resources, Audit only `PutItem` (plus `Query`/`GetItem` for `GetAuditEvents`), public functions have no access to Audit, one role per function, `SimulateDonation` conditioned on stage `academic`

### Implementation for User Story 5

- [ ] T043 [US5] In `infra/template.yaml` replace every `DynamoDBCrudPolicy`/`DynamoDBReadPolicy` of the three project-read functions, `CreateProject` and `PublishProject` with explicit statements per the matrix
- [ ] T044 [US5] In `infra/template.yaml` replace the policies of `CreateDonationFunction`, `SimulateDonationFunction`, `GetMyDonationsFunction` and `GetAuditEventsFunction` with explicit statements per the matrix (include the index ARN for `donorSub-createdAt-index`)
- [ ] T045 [US5] Write the manual T10 procedure in `evidence/t10-access-denied.md`: invoke a function outside its matrix in a real AWS account and paste the `AccessDeniedException`; mark it pending until executed

**Checkpoint**: T042 pasa; ninguna función conserva `DynamoDBCrudPolicy`

---

## Phase 8: User Story 6 - Telemetría, límites de entrada y red en el IaC (Priority: P2)

**Goal**: logs con 14 días, CloudTrail, CORS, throttling, callbacks y CSP reproducibles (H7, H8, FR-018 a FR-021, FR-005).

**Independent Test**: las aserciones sobre el template pasan; despliegue desde cero sin pasos manuales.

### Tests for User Story 6

- [ ] T046 [US6] Infra test in `backend/test/infra/telemetryAndEdge.test.ts`: log groups have `RetentionInDays` 14 and are assigned in `Globals` with JSON format; a `AWS::CloudTrail::Trail` exists with a private S3 bucket (public access blocked, lifecycle rule); CORS `AllowOrigins` contains no `*`; each public route has its own throttling in `RouteSettings`; Cognito callback and logout URLs reference the CloudFront domain and `localhost` only under the academic stage; CSP `connect-src` includes the Cognito domain

### Implementation for User Story 6

- [ ] T047 [US6] In `infra/template.yaml`: add `AWS::Logs::LogGroup` (`RetentionInDays: 14`) shared by all functions via `Globals.Function.LoggingConfig` (`LogFormat: JSON`), and use `RetentionInDays: 14` for the API access log group created in T040
- [ ] T048 [US6] In `infra/template.yaml`: add the CloudTrail resources (`AWS::S3::Bucket` for logs with public access blocked and a 90-day lifecycle, `AWS::S3::BucketPolicy` for CloudTrail, `AWS::CloudTrail::Trail` for management events); add a parameter to disable the trail when the account already has one
- [ ] T049 [US6] In `infra/template.yaml`: restrict CORS `AllowOrigins` to the CloudFront domain (plus `http://localhost:3000` only when `IsAcademicStage`), add per-route `RouteSettings` throttling with lower limits for the three public GET routes, set Cognito `CallbackURLs` and `LogoutURLs` to the CloudFront domain (plus localhost only in the academic stage), and add the Cognito domain (`https://*.amazoncognito.com`) to the CSP `connect-src`

### Detección con pruebas gratuitas de 30 días (FR-031)

- [ ] T072 [US6] In `infra/template.yaml`: add parameters `EnableGuardDuty` and `EnableSecurityHub` (type String, allowed `"true"`/`"false"`, default `"false"`) with conditions, and the resources `AWS::GuardDuty::Detector` (`Enable: true`) and the Security Hub hub, each created only when its condition is true; add the trial end date reminder to the parameter descriptions
- [ ] T073 [US6] Infra test in `backend/test/infra/detection.test.ts`: both parameters default to `"false"`, resources exist only under their conditions, and no other resource depends on them
- [ ] T074 [US6] Write `docs/free-plan-guide.md`: how to confirm the account plan type in Billing, how to enable/disable GuardDuty and Security Hub (`sam deploy --parameter-overrides EnableGuardDuty=true`), the 30-day trial end date, what is excluded and why (WAF, SMS MFA, Verified Permissions, Organizations), and the single-template rule

**Checkpoint**: T046 y T073 pasan

---

## Phase 9: User Story 7 - CI que demuestra la seguridad antes de desplegar (Priority: P2)

**Goal**: compuertas de `contracts/ci-gates.md` (H11, FR-022 a FR-025).

**Independent Test**: introducir un permiso excesivo, una expresión inválida y una ruta sin `withAuth` hace fallar el CI en los tres casos.

### Tests for User Story 7

- [ ] T050 [US7] Verify the gates by negative experiments on a scratch branch and record the result in `evidence/ci-negative-checks.md`: (a) invalid `UpdateExpression` fails `integration`, (b) a `dynamodb:*` statement fails `infra-tests` or `checkov`, (c) a handler without `withAuth` fails the coverage test

### Implementation for User Story 7

- [ ] T051 [P] [US7] Update `eslint.config.js`: `complexity` max 10, `max-lines-per-function` max 50, `@typescript-eslint/no-explicit-any` as error, `@typescript-eslint/no-unused-vars` as error; fix remaining violations in touched files and list large non-compliant areas as follow-up in `specs/002-zta-hardening/followups.md`
- [ ] T052 [P] [US7] Create `.prettierrc` and `.prettierignore`, add `format` and `format:check` scripts to the root `package.json`, and format the files touched by this feature
- [ ] T053 [P] [US7] Create `.cfnlintrc` and `.checkov.yaml` at the repository root; each skipped check carries a one-line justification
- [ ] T054 [US7] Rewrite `.github/workflows/ci.yml` with jobs `lint-format`, `typecheck`, `unit`, `integration` (service container `amazon/dynamodb-local`, `DYNAMODB_ENDPOINT` set), `infra-tests`, `iac-scan` (`cfn-lint`, `checkov`) and `deploy` (`needs` all of them, only `main`, only when `vars.AWS_DEPLOY_ROLE_ARN` is set, OIDC via `aws-actions/configure-aws-credentials`, no long-lived keys); set `permissions: id-token: write, contents: read` only on `deploy`
- [ ] T055 [US7] Fix findings reported by running `cfn-lint infra/template.yaml` and `checkov -f infra/template.yaml` locally; document accepted skips in `.checkov.yaml`

**Checkpoint**: pipeline verde y T050 documentado

---

## Phase 10: User Story 8 - Datos recuperables y protegidos (Priority: P3)

**Goal**: protección contra borrado y recuperación a un punto en el tiempo (FR-026).

**Independent Test**: en `production` las tablas críticas tienen ambas protecciones; en `academic` `sam delete` sigue limpiando.

### Tests for User Story 8

- [ ] T056 [US8] Infra test in `backend/test/infra/dataProtection.test.ts`: Projects, Donations and Audit have `DeletionProtectionEnabled` tied to stage `production`, `PointInTimeRecoverySpecification` tied to parameter `EnablePitr`, and Idempotency has neither

### Implementation for User Story 8

- [ ] T057 [US8] In `infra/template.yaml`: add parameter `EnablePitr` (default `false`, set to `true` when deploying `production`) and condition `IsProductionStage`; set `DeletionProtectionEnabled` and `PointInTimeRecoverySpecification` on `ProjectsTable`, `DonationsTable` and `AuditTable`

**Checkpoint**: T056 pasa

---

## Phase 11: User Story 9 - Sesión revalidada en acciones sensibles (Priority: P3)

**Goal**: un token robado o revocado deja de servir en las acciones sensibles (H9, FR-027).

**Independent Test**: contra un servidor HTTP real de prueba que imita `userInfo`, una sesión revocada es rechazada y una activa pasa; sin respuesta, se rechaza.

### Tests for User Story 9

- [ ] T058 [P] [US9] Integration test in `backend/test/integration/sessionCheck.test.ts` using a real local HTTP server for the userInfo endpoint (status 200, 401, delay beyond timeout, connection refused): sensitive actions return 401 when revoked or unverifiable and pass when active; public reads and non-sensitive actions never call the endpoint; the audit event has reason `SESSION_REVOKED`

### Implementation for User Story 9

- [ ] T059 [US9] Create `backend/src/authz/sessionCheck.ts`: call `GET ${COGNITO_USERINFO_URL}` with the raw access token, abort after `SESSION_CHECK_TIMEOUT_MS`, return active only on HTTP 200, log and fail closed on any other result or exception
- [ ] T060 [US9] Integrate the `sensitive` option in `backend/src/authz/withAuth.ts` (step 5 of the contract) and set `sensitive: true` on `PublishProject`, `ViewAudit` and on `SimulateDonation` when the action is `CONFIRMAR`, using the list in `backend/src/shared/constants.ts`
- [ ] T061 [US9] In `infra/template.yaml` add `COGNITO_USERINFO_URL` to `Globals.Function.Environment.Variables` built from the Cognito domain; extend `backend/test/infra/telemetryAndEdge.test.ts` or create `backend/test/infra/sessionEnv.test.ts` to assert it exists

**Checkpoint**: T058 pasa

---

## Phase 12: User Story 10 - Lo declarado coincide con lo implementado (Priority: P3)

**Goal**: ninguna afirmación de seguridad sin evidencia (H4, FR-028 a FR-030).

**Independent Test**: cruzar cada afirmación de seguridad de los documentos con código, template o prueba.

- [ ] T062 [US10] Delete `backend/src/authz/cedarAdapter.ts` and `backend/test/cedarEquivalence.test.ts`; remove `getAuthorizer()` and the `POLICY_ENGINE` branch from `backend/src/authz/evaluateAuthz.ts`; remove `@aws-sdk/client-verifiedpermissions` from `backend/package.json` and refresh `package-lock.json`
- [ ] T063 [P] [US10] Create `policies/README.md` stating that the Cedar files are documentation for phase 2 and are not enforced
- [ ] T064 [P] [US10] Rewrite the affected statements in `AI_USAGE.md`: no Cedar adapter as active, and list every AI tool actually used in this repository (ask the maintainer to confirm the list)
- [ ] T065 [P] [US10] Update `docs/zta-hallazgos-y-mejoras.md`: status of H1–H11, the seven NIST principles, section 8 inconsistencies and section 11 evidence, marking what remains pending real AWS
- [ ] T066 [P] [US10] Update `docs/arquitectura-comparacion.md` and `docs/threat-model.md` so the "mejorada" column and the mitigations match what is implemented; update the claims on MFA, audit immutability and policy engine in `design.md` and `requirements.md`
- [ ] T067 [US10] Final consistency sweep: search the repository for `verified_permissions`, `cedarAdapter`, `logAuditEvent`, `DynamoDBCrudPolicy`, `enforceAuthz` outside `withAuth`, and `MfaConfiguration: "OPTIONAL"`; fix or justify each hit

---

## Phase 13: Polish & Cross-Cutting

**Purpose**: validación de extremo a extremo y evidencia

- [ ] T068 Update `backend/test/acceptance/t01-t14.sh` so T10 and T14 point to the new evidence and tests, and keep T01–T14 runnable
- [ ] T069 Run the whole of `quickstart.md` sections 1–3 locally and fix failures; confirm total CI time under 10 minutes (SC-012)
- [ ] T070 Execute the real-AWS checks of `quickstart.md` section 4 (token falso/vencido/ID token, MFA, T10, sesión revocada, login con CSP, auditoría inmutable, PITR en producción) and store the outputs in `evidence/`; mark any not executed as pending in `docs/zta-hallazgos-y-mejoras.md`
- [ ] T071 Regenerate `docs/diagrams/zta-architecture-target.png` only if the implementation deviates from `zta-architecture-target.d2`; otherwise record in `docs/arquitectura-comparacion.md` that the target is now the current architecture

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

T015 → T040 → T043 → T044 → T047 → T048 → T049 → T057 → T061

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

## Notes

- [P] = archivos distintos y sin dependencias pendientes.
- Evidencia que exige AWS real (T045, T070) queda **pendiente** hasta ejecutarse; no se marca como cumplida por pruebas locales.
- El usuario realiza los commits; las tareas no incluyen commits.
- Evitar: tareas vagas, conflictos en `infra/template.yaml`, dependencias cruzadas que rompan la independencia de historias.
