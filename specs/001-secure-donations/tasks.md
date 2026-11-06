# Tasks: Plataforma de Donaciones Seguras Zero Trust

**Input**: Design documents from `specs/001-secure-donations/`  
**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/api-spec.yaml](./contracts/api-spec.yaml), [quickstart.md](./quickstart.md), [constitution.md](../../.specify/memory/constitution.md)

---

## Format: `- [ ] [TaskID] [P?] [Story?] Description with file path`

- **[P]**: Can run in parallel (different files, no blocking dependencies)
- **[Story]**: Which user story this task belongs to (e.g. `[US1]`, `[US2]`, etc.)
- Every task includes explicit file paths and verifiable completion criteria.

---

## Phase 1: Setup (Shared Infrastructure & Monorepo Initialization)

**Purpose**: Project initialization, directory structure, tooling, and repository foundations.

- [X] T001 Initialize monorepo structure with `frontend/`, `backend/`, `infra/`, `policies/`, `docs/`, `evidence/` per plan in `package.json`
- [X] T002 [P] Configure root TypeScript configuration, ESLint 10, Prettier 3, and script runners in `tsconfig.json` and `eslint.config.js`
- [X] T003 [P] Initialize React 19 + Vite 8 + Tailwind CSS 4 frontend application in `frontend/package.json` and `frontend/vite.config.ts`
- [X] T004 [P] Initialize Node.js 24 Lambda backend with AWS SDK v3, Vitest 5, and Zod 4 in `backend/package.json` and `backend/tsconfig.json`
- [X] T005 [P] Create initial GitHub Actions CI workflow executing lint, typecheck, and test suites in `.github/workflows/ci.yml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure, shared validation schemas, error handling, DynamoDB clients, and base SAM infrastructure that MUST be complete before ANY user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 Implement shared Zod validation schemas quoting verbatim constraints from data-model: `title` ("3 to 100 characters, trimmed"), `description` ("10 to 2000 characters"), `goalAmountCents` ("integer > 0, Min S/ 10.00 = 1000 cents"), `confirmedAmountCents` ("integer >= 0"), `amountCents` ("integer between 100 and 100000"), `currency` (strictly `"PEN"`), `status` (enums `"BORRADOR"`, `"PUBLICADO"`, and `"PENDIENTE_SIMULACION"`, `"CONFIRMADA_SIMULADA"`, `"RECHAZADA_SIMULADA"`), and UUID `Idempotency-Key` in `backend/src/shared/schemas.ts`
- [X] T007 [P] Implement custom application error classes (`AppError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`, `ValidationError`) and uniform response formatter producing `{ code, message, requestId }` in `backend/src/shared/errors.ts` and `backend/src/shared/response.ts`
- [X] T008 [P] Implement structured JSON logger masking secrets, Authorization headers, and PII while attaching correlation `requestId` in `backend/src/shared/logger.ts`
- [X] T009 [P] Initialize DynamoDB DocumentClient wrapper with retry logic and environment table mapping in `backend/src/shared/dynamo.ts`
- [X] T010 [P] Define core policy authorizer interface `PolicyAuthorizer` and embedded RBAC evaluator resolving `sub` and `cognito:groups` in `backend/src/authz/evaluateAuthz.ts`
- [X] T011 Define AWS SAM base infrastructure template with HTTP API, DynamoDB tables (`Projects`, `Donations`, `Idempotency` with TTL `expiresAt`, `AuditEvents`), Cognito User Pool with groups (`DONANTE`, `GESTOR`, `AUDITOR`), Resource Server scopes, and Stage condition `IsAcademicStage` in `infra/template.yaml`

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 (HU-01 & HU-02) — Public Project Catalog & Detail (Priority: P1) 🎯 MVP

**Goal**: Enable visitors to browse published social projects and inspect project details and funding progress without authentication and without exposing private donor data.

**Independent Test**: Send `GET /v1/projects` and `GET /v1/projects/{projectId}`; verify only `PUBLICADO` projects are returned (HTTP 200), draft projects return 404/excluded (CA-01.2, T01), and donor data is absent.

### Tests for User Story 1
- [X] T012 [P] [US1] Unit and integration tests for `listProjects` and `getProject` handlers verifying draft exclusion, empty catalog handling, and 404 on missing/draft items (T01) in `backend/test/projects.test.ts`

### Implementation for User Story 1
- [X] T013 [US1] Implement `listProjects` Lambda handler querying `Projects` table via GSI `status-createdAt-index` for `status = "PUBLICADO"` in `backend/src/projects/listProjects.ts`
- [X] T014 [US1] Implement `getProject` Lambda handler reading by `projectId` with `status = "PUBLICADO"` validation in `backend/src/projects/getProject.ts`
- [X] T015 [US1] Configure SAM HTTP API routes `GET /v1/projects` and `GET /v1/projects/{projectId}` with dedicated read-only IAM execution role (T10 verification) in `infra/template.yaml`
- [X] T016 [P] [US1] Build accessible Project Card, Progress Bar, and empty state component in `frontend/src/components/ProjectCard.tsx`
- [X] T017 [US1] Build public Catalog and Project Detail pages with TanStack Query fetching from `/v1/projects` in `frontend/src/pages/CatalogPage.tsx` and `frontend/src/pages/ProjectDetailPage.tsx`

**Checkpoint**: User Story 1 functional and independently testable end-to-end.

---

## Phase 4: User Story 2 (HU-03 & HU-11) — Zero Trust Authentication, OIDC PKCE & Privileged MFA (Priority: P1) 🎯 MVP

**Goal**: Secure identity management using Amazon Cognito with Authorization Code + PKCE, token lifetime $\le 15$ min, in-memory client storage, and mandatory TOTP MFA for `GESTOR` and `AUDITOR`.

**Independent Test**: Attempt API calls without token (HTTP 401, T02), with ID token (HTTP 401, T11), and verify manager login blocks without TOTP MFA (T14).

### Tests for User Story 2
- [X] T018 [P] [US2] Security tests asserting unauthenticated requests receive 401 (T02) and ID tokens are rejected by authorizer scopes (T11) in `backend/test/authz.test.ts`
- [X] T019 [P] [US2] Automated verification script demonstrating privileged user login challenges with `SOFTWARE_TOKEN_MFA` (T14) in `backend/test/mfa.test.ts`

### Implementation for User Story 2
- [X] T020 [US2] Configure Cognito User Pool Client in SAM with Authorization Code Grant, PKCE enabled, refresh token validity, access token validity $\le 15$ minutes, and TOTP MFA configuration in `infra/template.yaml`
- [X] T021 [US2] Configure API Gateway HTTP API JWT Authorizer pointing to Cognito Issuer and Audience with route scopes in `infra/template.yaml`
- [X] T022 [P] [US2] Implement OIDC authentication service using `oidc-client-ts` and `InMemoryWebStorage` (no `localStorage` or `sessionStorage`, CA-NF11.1) in `frontend/src/auth/authService.ts`
- [X] T023 [US2] Create React `AuthContext` and authentication callback handler with logout token revocation (`/oauth2/revoke`) in `frontend/src/auth/AuthContext.tsx` and `frontend/src/pages/AuthCallbackPage.tsx`
- [X] T024 [P] [US2] Create Navbar component with login/logout actions and role badge indicators in `frontend/src/components/Navbar.tsx`

**Checkpoint**: User Story 2 complete: Zero Trust authentication and privileged MFA enforced.

---

## Phase 5: User Story 3 (HU-08 & HU-09) — Project Lifecycle Management & Aggregate Statistics (Priority: P2)

**Goal**: Allow authorized users in the `GESTOR` group to create draft projects and publish them, preventing non-managers from writing projects, and exposing public verified aggregates.

**Independent Test**: Donor attempts project creation (HTTP 403, T03); manager creates draft (HTTP 201) and publishes (HTTP 200, T01); re-publishing returns HTTP 409.

### Tests for User Story 3
- [X] T025 [P] [US3] Tests asserting donor cannot create project (T03), manager creates draft project, publishes project, and re-publishing returns 409 in `backend/test/projectManagement.test.ts`

### Implementation for User Story 3
- [X] T026 [US3] Implement `createProject` Lambda handler validating `GESTOR` role, creating `BORRADOR` record with UUID `projectId`, and logging audit event in `backend/src/projects/createProject.ts`
- [X] T027 [US3] Implement `publishProject` Lambda handler with DynamoDB conditional expression `attribute_exists(projectId) AND #status = :draft` in `backend/src/projects/publishProject.ts`
- [X] T028 [US3] Implement `getProjectStats` Lambda handler returning verified `confirmedAmountCents` and `goalAmountCents` in PEN in `backend/src/projects/getProjectStats.ts`
- [X] T029 [US3] Configure SAM routes `POST /v1/projects`, `PATCH /v1/projects/{projectId}/publish`, `GET /v1/projects/{projectId}/stats` with `api/projects.write` scope in `infra/template.yaml`
- [X] T030 [P] [US3] Build Project Management dashboard for `GESTOR` users to create and publish projects in `frontend/src/pages/ManagerDashboardPage.tsx`

**Checkpoint**: User Stories 1, 2, and 3 functional and verified.

---

## Phase 6: User Story 4 (HU-05) — Simulated Donation Intent & Atomic Idempotency (Priority: P2) 🎯 MVP

**Goal**: Authenticated donors can register donation intentions in PEN with atomic idempotency using `Idempotency-Key` and `TransactWriteItems`, preventing duplicate creations.

**Independent Test**: Send invalid amount (HTTP 400, T04); send valid donation intent (HTTP 201, `PENDIENTE_SIMULACION`, T05); repeat identical request (HTTP 201, exact same record, T06); repeat key with altered body (HTTP 409, T07).

### Tests for User Story 4
- [X] T031 [P] [US4] Unit tests for donation amount validation rejecting $\le 0$, $> 100000$, and floats (T04) in `backend/test/donationValidation.test.ts`
- [X] T032 [P] [US4] Integration tests for `createDonation` verifying atomic idempotency replay (T06) and altered payload conflict 409 (T07) in `backend/test/idempotency.test.ts`

### Implementation for User Story 4
- [X] T033 [US4] Implement canonical JSON hashing utility (`sha256(canonicalJson(payload))`) in `backend/src/shared/hash.ts`
- [X] T034 [US4] Implement `createDonation` Lambda handler extracting `donorSub` strictly from JWT context, validating `PUBLICADO` project, and executing `TransactWriteItems` on `Idempotency` and `Donations` in `backend/src/donations/createDonation.ts`
- [X] T035 [US4] Configure SAM route `POST /v1/donations` with `api/donations.write` scope and write permissions on `Donations`, `Idempotency`, and read permissions on `Projects` in `infra/template.yaml`
- [X] T036 [P] [US4] Build accessible simulated donation modal with UUID `Idempotency-Key` generation and mandatory disclaimer banner *"Simulación académica: no se ha realizado ningún cobro"* in `frontend/src/components/DonationModal.tsx`

**Checkpoint**: User Story 4 complete: atomic idempotency and safe donation creation verified.

---

## Phase 7: User Story 5 (HU-06) — Simulated Confirmation / Rejection & Concurrency Control (Priority: P2) 🎯 MVP

**Goal**: Donors can simulate confirming or rejecting their own pending donation within the academic stage, guaranteeing that 10 concurrent confirmation requests result in exactly one increment to the project total.

**Independent Test**: Transition pending donation to confirmed (HTTP 200); dispatch 10 concurrent confirmation requests to the same donation and verify exactly 1 succeeds and 9 return HTTP 409 (T08); verify rejected donations do not increment totals.

### Tests for User Story 5
- [X] T037 [P] [US5] Concurrency test dispatching 10 parallel requests to `simulateDonation` confirming exactly 1 success and 9 conflict responses (T08) in `backend/test/concurrency.test.ts`
- [X] T038 [P] [US5] Unit tests for donation state machine transitions (`PENDIENTE_SIMULACION` $\to$ terminal) rejecting re-confirmation with 409 in `backend/test/donationState.test.ts`

### Implementation for User Story 5
- [X] T039 [US5] Implement `simulateDonation` Lambda handler with conditional `TransactWriteItems` updating `Donation` status and atomically incrementing `Project.confirmedAmountCents` when confirming in `backend/src/donations/simulateDonation.ts`
- [X] T040 [US5] Configure SAM route `POST /v1/donations/{donationId}/simulate` conditioned with `Condition: IsAcademicStage` in `infra/template.yaml`
- [X] T041 [P] [US5] Add simulation controls (Confirmar / Rechazar buttons with academic notice) to the donor interface in `frontend/src/components/SimulationControls.tsx`

**Checkpoint**: User Story 5 complete: atomic concurrency protection and stage conditioning verified.

---

## Phase 8: User Story 6 (HU-07) — Donor Personal History & BOLA Prevention (Priority: P2)

**Goal**: Donors can inspect their own donation history, while requests attempting to view another user's donation return HTTP 403 or 404 without leaking data.

**Independent Test**: Donor requests personal history (HTTP 200, T05/T07 records); donor attempts to access another donor's donation ID directly (HTTP 403/404, T09); manager attempts access to donor history (HTTP 403/404, T12).

### Tests for User Story 6
- [X] T042 [P] [US6] Security tests verifying BOLA prevention for cross-donor queries (T09) and manager queries on donor history (T12) in `backend/test/bola.test.ts`

### Implementation for User Story 6
- [X] T043 [US6] Implement `getMyDonations` Lambda handler querying `Donations` via GSI `donorSub-createdAt-index` matching caller's JWT `sub` in `backend/src/donations/getMyDonations.ts`
- [X] T044 [US6] Configure SAM route `GET /v1/donations/me` with `api/donations.read` scope and restricted GSI query IAM policy in `infra/template.yaml`
- [X] T045 [P] [US6] Build Donor History page displaying user's contributions with status badges and simulation action buttons in `frontend/src/pages/DonorHistoryPage.tsx`

**Checkpoint**: User Story 6 complete: BOLA protection and private history functional.

---

## Phase 9: User Story 7 (HU-10) — Structured Audit Log Querying (Priority: P3) [Extension]

**Goal**: Authorized auditors with verified TOTP MFA can query immutable audit event logs filtered by date range and event type.

**Independent Test**: Auditor with MFA queries `/v1/audit` (HTTP 200); non-auditor receives HTTP 403; audit logs contain zero tokens, secrets, or banking details.

### Tests for User Story 7
- [X] T046 [P] [US7] Tests verifying audit logging for project and donation operations and auditor role access controls in `backend/test/audit.test.ts`

### Implementation for User Story 7
- [X] T047 [US7] Implement audit event writer recording timestamp, correlation `requestId`, pseudonymized `actorRef`, resource, action, and outcome in `backend/src/audit/logAuditEvent.ts`
- [X] T048 [US7] Implement `getAuditEvents` Lambda handler querying `AuditEvents` table with date range filtering in `backend/src/audit/getAuditEvents.ts`
- [X] T049 [US7] Configure SAM route `GET /v1/audit` with `api/audit.read` scope and auditor IAM permissions in `infra/template.yaml`
- [X] T050 [P] [US7] Build Auditor view for inspecting security and business events in `frontend/src/pages/AuditorPage.tsx`

**Checkpoint**: User Story 7 complete: audit trail and governance functional.

---

## Phase 10: User Story 8 (HU-12) — Externalized Policy Engine with Cedar & Amazon Verified Permissions (Priority: P3) [Extension]

**Goal**: Externalize authorization policies to Cedar evaluated by Amazon Verified Permissions (`IsAuthorized`), passing acceptance tests T03, T09, and T12 equivalently.

**Independent Test**: Execute tests T03, T09, and T12 with `POLICY_ENGINE=verified_permissions` and assert identical access decisions as embedded `authz`.

### Tests for User Story 8
- [X] T051 [P] [US8] Equivalence test suite comparing `EmbeddedPolicyAuthorizer` vs `VerifiedPermissionsAuthorizer` decisions for T03, T09, and T12 in `backend/test/cedarEquivalence.test.ts`

### Implementation for User Story 8
- [X] T052 [US8] Define Cedar schema (`FundacionAQPSolidaria::User`, `Group`, `Project`, `Donation`, `Action`) in `policies/schema.cedarschema`
- [X] T053 [US8] Write Cedar policies enforcing RBAC and resource ownership in `policies/policies.cedar`
- [X] T054 [US8] Implement `VerifiedPermissionsAuthorizer` invoking `@aws-sdk/client-verifiedpermissions` `IsAuthorized` API in `backend/src/authz/cedarAdapter.ts`
- [X] T055 [US8] Add toggle in `evaluateAuthz.ts` switching between embedded and externalized PDP via environment variable `POLICY_ENGINE` in `backend/src/authz/evaluateAuthz.ts`

**Checkpoint**: User Story 8 complete: externalized policy engine with Cedar verified.

---

## Phase 11: Polish & Cross-Cutting Verification

**Purpose**: End-to-end acceptance suite execution (T01–T14), browser security hardening via CloudFront, CI validation, and final documentation.

- [X] T056 [P] Configure CloudFront Response Headers Policy delivering CSP, HSTS, `X-Content-Type-Options: nosniff`, and `frame-ancestors: 'none'` in `infra/template.yaml`
- [X] T057 [P] Create automated acceptance test collection (Bruno/Postman and curl runner) covering all scenarios T01–T14 in `backend/test/acceptance/t01-t14.sh`
- [X] T058 [P] Write comprehensive threat model and NIST SP 800-207 mapping documentation in `docs/threat-model.md`
- [X] T059 [P] Sync and validate OpenAPI 3.1 contract reference in `docs/api.yaml`
- [X] T060 Update `README.md` with step-by-step AWS deployment, local testing, Free Plan guidelines, and clean teardown instructions (`sam delete`) in `README.md`
- [X] T061 Document AI assistant usage and human validation logs in `AI_USAGE.md`
- [X] T062 Execute end-to-end quickstart validation and collect sanitized evidence in `evidence/test-run-report.md`

---

## Dependencies & Execution Order

### Phase Dependencies
- **Phase 1 (Setup)**: Can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1. Blocks all subsequent user stories.
- **Phase 3 (US1 - Public Projects)**: Depends on Phase 2. Delivers initial read-only MVP increment.
- **Phase 4 (US2 - Authentication & MFA)**: Depends on Phase 2. Enables protected routes.
- **Phase 5 (US3 - Project Management)**: Depends on Phase 3 and Phase 4.
- **Phase 6 (US4 - Donation Intent & Idempotency)**: Depends on Phase 3 and Phase 4.
- **Phase 7 (US5 - Donation Confirmation & Concurrency)**: Depends on Phase 6.
- **Phase 8 (US6 - Donor History & BOLA)**: Depends on Phase 6.
- **Phase 9 (US7 - Audit Querying - Ext)**: Depends on Phase 4 and Phase 5.
- **Phase 10 (US8 - Cedar AVP - Ext)**: Depends on Phase 4, Phase 5, Phase 8.
- **Phase 11 (Polish & Verification)**: Runs after all target user stories are completed.

---

## Parallel Execution Opportunities

```bash
# Parallel Phase 1 & 2 Setup:
Task T002: TypeScript & ESLint configuration
Task T003: Frontend Vite setup
Task T004: Backend Node setup
Task T005: GitHub Actions CI workflow

# Parallel Foundational Utilities:
Task T007: Error handling and uniform response
Task T008: Structured JSON logging
Task T009: DynamoDB DocumentClient wrapper
Task T010: Base authz evaluator

# Parallel User Story 1:
Task T012: Unit/Integration tests
Task T016: Frontend ProjectCard and Progress bar

# Parallel User Story 4:
Task T031: Validation unit tests
Task T032: Idempotency integration tests
Task T036: Frontend DonationModal component
```

---

## Implementation Strategy: MVP First

1. **Step 1**: Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. **Step 2**: Implement Phase 3 (US1 - Public Catalog) $\to$ Validate read-only capabilities without auth.
3. **Step 3**: Implement Phase 4 (US2 - Cognito Auth + PKCE + MFA) $\to$ Validate identity and session management.
4. **Step 4**: Implement Phase 6 (US4 - Donations Intent & Idempotency) + Phase 7 (US5 - Concurrency Confirmation) $\to$ Core financial simulation MVP.
5. **Step 5**: Complete Phase 5 (US3 - Project Management) + Phase 8 (US6 - Donor History).
6. **Step 6**: Execute Extensions (Phase 9 & Phase 10) if time permits.
7. **Step 7**: Run Phase 11 Polish, execute acceptance suite T01–T14, and verify clean teardown with `sam delete`.
