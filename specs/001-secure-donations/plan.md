# Implementation Plan: Plataforma de Donaciones Seguras Zero Trust

**Branch**: `001-secure-donations` | **Date**: 2026-11-06 | **Spec**: [specs/001-secure-donations/spec.md](./spec.md)  
**Input**: Requirements: [requirements.md](../../requirements.md) | Technical Design: [design.md](../../design.md)

---

## Summary

The objective of this technical implementation plan is to build and deploy the **Plataforma de Donaciones Seguras** for the fictitious Peruvian charity *Fundación AQP-SOLIDARIA*. The system is a cloud-native, serverless web application adhering strictly to the **Zero Trust Architecture (NIST SP 800-207)** and running within the **AWS Free Plan**. It allows visitors to explore verified community projects and authenticated donors to register and simulate donation intentions in Peruvian Soles (PEN) with atomic idempotency and concurrency protection.

The implementation preserves all approved architectural decisions:
- A responsive React 19 SPA hosted on private S3 and served via CloudFront with Origin Access Control (OAC) and strict Content Security Policy (CSP).
- An Amazon API Gateway HTTP API acting as Policy Enforcement Point (PEP) with native JWT authorization and OAuth scopes.
- AWS Lambda functions running Node.js 24 with dedicated, least-privilege IAM execution roles, acting as Policy Decision Point (PDP) via an internal `authz` module and optional Cedar policies via Amazon Verified Permissions (HU-12).
- Amazon Cognito User Pool with Authorization Code Grant + PKCE, in-memory client token handling, and mandatory TOTP MFA for privileged roles (`GESTOR`, `AUDITOR`).
- Amazon DynamoDB with single/multi-table design utilizing `TransactWriteItems` for atomic idempotency, double-counting prevention, and audit event logging.
- Complete Infrastructure as Code (IaC) via AWS SAM with stage-conditioned deployment (`academic` stage for simulation).

---

## Technical Context

**Language/Version**: TypeScript 5.8+ (Frontend & Backend, unified shared types)  
**Primary Dependencies**:
- *Frontend*: React 19.3.x, React DOM, Vite 8.3.x, Tailwind CSS 4.x, Lucide React, Radix UI primitives, React Router 8.x, React Hook Form 7.x, Zod 4.x, TanStack Query 5.x, `oidc-client-ts`
- *Backend*: Node.js 24 (`nodejs24.x`), AWS SDK v3 (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-verifiedpermissions`), Zod 4.x  
**Storage**: Amazon DynamoDB (On-Demand capacity mode): `Projects`, `Donations`, `Idempotency`, `AuditEvents`  
**Testing**: Vitest 5.x, React Testing Library, Bruno/Postman automated negative test collections (T01–T14)  
**Target Platform**: AWS Serverless (CloudFront + S3 + API Gateway HTTP API + AWS Lambda + DynamoDB + Cognito)  
**Project Type**: Monorepo Web Application (`frontend/`, `backend/`, `infra/`, `policies/`, `docs/`)  
**Performance Goals**: 95% of backend GET responses <= 1.5s (excluding cold start) under 50 published projects; responsive UI at 375px mobile width  
**Constraints**:
- Strict AWS Free Plan compliance (single region `us-east-1`, zero billable services outside free tier).
- Zero capture or storage of real payment instruments (PAN, CVV, bank credentials).
- Short-lived access tokens (<= 15 min), memory-only token storage in SPA.
- CloudWatch log retention <= 14 days; zero secrets or tokens in logs.  
**Scale/Scope**: Academic prototype; 4 roles (Visitante, Donante, Gestor, Auditor); 10,000 Free Plan MAU limit in Cognito.

---

## Constitution Check

*GATE: Evaluated against `.specify/memory/constitution.md`*

| Constitution Principle | Evaluation Status | Implementation Guarantee |
|---|:---:|---|
| **I. Zero Trust Security (NIST SP 800-207)** | **PASS** | API Gateway JWT authorizer (PEP) validates token signature, issuer, client_id, and scopes; Lambda `authz` validates user groups and resource ownership (PDP); Cognito acts as PA; tokens stored in-memory; access token <= 15 min. |
| **II. Academic Safety & Financial Integrity** | **PASS** | No real PAN/CVV captured; integer cents `amountCents` in PEN; atomic idempotency with `TransactWriteItems`; explicit simulation warning banner. |
| **III. Minimum Privilege & Workload Isolation** | **PASS** | Separate IAM execution role per Lambda function (e.g. `listProjects` has read-only access); no wildcard permissions; no long-lived AWS keys in code/CI. |
| **IV. Automated Verification & Negative Testing** | **PASS** | Vitest test suite enforcing all business rules and negative acceptance scenarios T01–T14 (including 10 concurrent requests test T08). |
| **V. AWS Free Plan Compliance & Hygiene** | **PASS** | Single region (`us-east-1`); no WAF on HTTP API; no GuardDuty/Security Hub; log retention <= 14 days; SAM template support for `sam delete`. |
| **VI. Transparency, Code Quality & AI Governance** | **PASS** | GitHub Actions CI with lint/typecheck/tests; JSON structured logging with `requestId` and secret masking; complete `AI_USAGE.md` tracking. |

**Gate Result**: **APPROVED (0 Violations)**

---

## Project Structure

### Documentation (this feature)

```text
specs/001-secure-donations/
├── plan.md              # This technical implementation plan
├── research.md          # Architectural decisions & best practices
├── data-model.md        # Physical DynamoDB schema, entity lifecycles & Zod schemas
├── quickstart.md        # Run and validation guide (T01–T14 test verification)
├── contracts/
│   └── api-spec.yaml    # OpenAPI 3.1 specification for HTTP endpoints
└── tasks.md             # Implementation tasks (generated in Phase 2 via /speckit-tasks)
```

### Source Code (Repository Layout)

```text
secure-donations-2026/
├── frontend/                         # React 19 + Vite + Tailwind CSS SPA
│   ├── src/
│   │   ├── auth/                     # oidc-client-ts, in-memory token store, AuthContext
│   │   ├── components/               # Accessible UI components (ProjectCard, DonationForm, Navbar)
│   │   ├── pages/                    # CatalogPage, ProjectDetailPage, DonorHistoryPage, ManagerPage, AuditorPage
│   │   ├── services/                 # API client wrapper with TanStack Query
│   │   ├── types/                    # Shared frontend TypeScript interfaces
│   │   ├── App.tsx                   # Route definitions with React Router 8
│   │   └── main.tsx                  # Application bootstrap
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── package.json
├── backend/                          # Modular AWS Lambda handlers (Node.js 24)
│   ├── src/
│   │   ├── projects/                 # Handlers: listProjects, getProject, createProject, publishProject
│   │   ├── donations/                # Handlers: createDonation, simulateDonation, getMyDonations
│   │   ├── authz/                    # Policy Decision Point: RBAC & ownership evaluation, Cedar adapter
│   │   ├── audit/                    # Audit event logger and query handler (HU-10)
│   │   └── shared/                   # Zod schemas, errors, canonicalJson, logger with secret masking
│   ├── test/                         # Vitest unit, integration & negative tests (T01–T14)
│   ├── tsconfig.json
│   └── package.json
├── infra/
│   ├── template.yaml                 # AWS SAM template (Cognito, HTTP API, Lambdas, DynamoDB, CloudFront, S3)
│   └── samconfig.toml                # Deployment configuration for academic stage
├── policies/                         # Cedar policies for Amazon Verified Permissions (HU-12)
│   ├── schema.cedarschema
│   └── policies.cedar
├── docs/
│   ├── api.yaml                      # OpenAPI 3.1 contract reference
│   └── threat-model.md               # STRIDE threat model & NIST SP 800-207 mapping
├── evidence/                         # Sanitized test execution logs & verification screenshots
├── .github/
│   └── workflows/
│       └── ci.yml                    # GitHub Actions CI (lint, typecheck, test, build)
├── requirements.md                   # Approved requirements document
├── design.md                         # Approved technical design document
├── README.md                         # Setup, deployment, testing, and teardown instructions
└── AI_USAGE.md                       # Mandatory AI assistant attribution and validation log
```

**Structure Decision**: Monorepo Web Application (Option 2) matching `design.md §8`, ensuring strict separation of concerns, zero code pollution, and independent build/deployment workflows for frontend static assets and backend Lambda packages.

---

## Detailed Component & Module Design

### 1. Frontend Subsystem (`frontend/`)
- **`src/auth/`**: Initializes `UserManager` from `oidc-client-ts` using `InMemoryWebStorage`. Exposes `useAuth()` hook providing user identity, role extraction from `cognito:groups`, token retrieval, login redirect, and logout with `/oauth2/revoke`.
- **`src/pages/CatalogPage.tsx`**: Queries `/v1/projects` via TanStack Query. Renders list of `PUBLICADO` initiatives with goal vs. confirmed progress bar. Displays empty state message when no projects exist (CA-01.3).
- **`src/pages/ProjectDetailPage.tsx`**: Displays detailed information and hosts the simulated donation modal.
- **`src/components/DonationModal.tsx`**: Form built with React Hook Form + Zod. Accepts amount in Soles (converted to integer céntimos). Generates a fresh `Idempotency-Key` (UUID v4) on initial submission. Displays required disclaimer: *"Simulación académica: no se ha realizado ningún cobro"*.
- **`src/pages/DonorHistoryPage.tsx`**: Displays personal donations retrieved from `/v1/donations/me`. In academic stage, renders buttons to simulate confirmation or rejection (`POST /v1/donations/{id}/simulate`).

### 2. Backend Subsystem (`backend/`)
- **`src/shared/`**:
  - `schemas.ts`: Single source of truth for validation using Zod.
  - `errors.ts`: Standard error classes (`AppError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`, `ValidationError`).
  - `logger.ts`: Outputs JSON formatted logs containing `requestId`, timestamp, level, action, and automatically redacts Authorization headers, passwords, and tokens.
  - `response.ts`: Standard JSON response builder ensuring `{ code, message, requestId }` format for errors.
- **`src/authz/`**:
  - `evaluateAuthz.ts`: Extracts `sub` and `cognito:groups` from the API Gateway authorizer event. Enforces RBAC matrix and validates resource ownership (e.g. verifying `donation.donorSub === caller.sub`).
  - `cedarAdapter.ts` (HU-12): Translates requests to Cedar format and invokes Amazon Verified Permissions `IsAuthorized` if enabled.
- **`src/projects/`**:
  - `listProjects`: Reads `Projects` table via GSI `status-createdAt-index` for `status = 'PUBLICADO'`.
  - `getProject`: Retrieves project by `projectId`; returns 404 if project is missing or in `BORRADOR` status.
  - `createProject`: Validates `GESTOR` group; inserts new project in `BORRADOR` state; logs `AuditEvent`.
  - `publishProject`: Validates `GESTOR` group; updates status from `BORRADOR` to `PUBLICADO` with conditional expression `attribute_exists(projectId) AND #status = :draft`.
- **`src/donations/`**:
  - `createDonation`: Validates `DONANTE` group and `Idempotency-Key`. Verifies target project is `PUBLICADO`. Executes atomic `TransactWriteItems` writing `IdempotencyRecord` and `Donation`. Handles replay and payload conflict.
  - `simulateDonation`: Academic-stage only. Validates `DONANTE` role and ownership. Executes `TransactWriteItems` updating `Donation` status from `PENDIENTE_SIMULACION` to `CONFIRMADA_SIMULADA` or `RECHAZADA_SIMULADA`, atomically incrementing project's `confirmedAmountCents` if confirmed.
  - `getMyDonations`: Queries `Donations` table via GSI `donorSub-createdAt-index` matching caller's `sub`.
- **`src/audit/`**:
  - `logAuditEvent`: Utility writing immutable records to `AuditEvents` table.
  - `queryAudit`: Validates `AUDITOR` group with verified MFA; queries `AuditEvents` table by event type and date range.

### 3. Infrastructure & Deployment Subsystem (`infra/`)
- **Cognito**: Two User Pools, each with a public client configured for Authorization Code Grant + PKCE. Donor pool: group `DONANTE`, scopes `api/donations.write`, `api/donations.read`, MFA TOTP optional. Staff pool: groups `GESTOR`, `AUDITOR`, scopes `api/projects.write`, `api/audit.read`, admin-only sign-up, MFA TOTP mandatory (`MfaConfiguration: ON`, `SOFTWARE_TOKEN_MFA` only).
- **API Gateway HTTP API**: Configured with `$default` or `academic` stage, one JWT Authorizer per Cognito User Pool (donor routes on the donor authorizer, GESTOR/AUDITOR routes on the staff authorizer), and route-level authorization scopes.
- **DynamoDB Tables**:
  - `aqp-projects`: PK `projectId` (GSI: `status-createdAt-index`).
  - `aqp-donations`: PK `donationId` (GSI: `donorSub-createdAt-index`).
  - `aqp-idempotency`: PK `pk`, TTL attribute `expiresAt`.
  - `aqp-audit`: PK `eventType`, SK `timestamp#eventId`.
- **IAM Roles**: Distinct execution role for each Lambda function with scoped DynamoDB policies.
- **S3 & CloudFront**: S3 bucket with public access blocked; CloudFront distribution with Origin Access Control (OAC) and Response Headers Policy delivering CSP, HSTS, and framing restrictions.

---

## Technical Risks, Constraints & Mitigations

| Risk / Constraint | Impact | Mitigation Strategy | Traceability |
|---|---|---|---|
| **Token Revocation Lag** | A revoked access token remains valid at API Gateway until its TTL expires because JWT authorizer validates signatures locally without querying Cognito. | Enforce short token lifetime (<= 15 min). On logout, SPA immediately purges tokens from memory and triggers refresh token revocation (`/oauth2/revoke`). Documented as known Zero Trust limitation. | AD-07, CA-03.3, CA-03.4, T13 |
| **Race Conditions in Donation Confirmation** | Multiple concurrent requests to confirm the same donation could double-increment the project's confirmed total. | Atomic conditional update using DynamoDB `TransactWriteItems` with condition `status = 'PENDIENTE_SIMULACION'`. Test T08 verifies 10 concurrent requests yield exactly 1 increment and 9 conflicts (409). | AD-05, CA-06.2, CA-NF04.1, T08 |
| **Accidental Billing in AWS Free Plan** | Deploying non-eligible resources (WAF, GuardDuty, SMS MFA) could incur unwanted credit card charges. | SAM template uses exclusively Free Plan services (HTTP API instead of REST API; DynamoDB On-Demand within free limits; TOTP MFA instead of SMS; single region `us-east-1`). AWS Budget alert configured on day 1. | AD-06, RNF-HU-09 |
| **Token Theft via XSS** | Malicious scripts in the browser could exfiltrate stored tokens. | Tokens are stored exclusively in memory (`InMemoryWebStorage`), never in `localStorage` or `sessionStorage`. CloudFront delivers strict Content Security Policy (CSP). | CA-NF11.1, CA-NF11.2 |
| **BOLA / Insecure Direct Object Reference** | Donors attempting to inspect or alter other donors' contributions. | Server-side ownership validation in Lambda comparing resource `donorSub` against JWT `sub`. Test T09 and T12 prove unauthorized cross-tenant requests return 403 or 404. | CA-04.2, CA-07.2, T09, T12 |
| **Simulation Route in Non-Academic Stage** | Simulation endpoint being deployed in a production-ready environment. | SAM template condition `Condition: IsAcademicStage` encapsulates route and Lambda function, preventing its synthesis outside the `academic` stage. | CA-06.1 |

---

## Complexity Tracking

*No constitutional violations identified. Design adheres strictly to the ratified Constitution, Requirements, and Design documents.*

| Item | Assessment | Justification |
|---|---|---|
| Dual Authz Engine (HU-12) | Optional Extension | Architecture utilizes an adapter interface (`PolicyAuthorizer`) allowing default embedded TypeScript evaluation (MVP) with seamless zero-impact delegation to Amazon Verified Permissions (Cedar) when enabled. |
| Monorepo layout | Standardized | Unifies TypeScript contracts between React frontend and Node.js Lambda functions without external private package registries. |
