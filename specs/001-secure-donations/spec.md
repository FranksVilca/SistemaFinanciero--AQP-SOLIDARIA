# Feature Specification: Plataforma de Donaciones Seguras Zero Trust

**Feature Branch**: `001-secure-donations`  
**Created**: 2026-11-06  
**Status**: Approved (Synthesized from approved requirements.md & design.md v2.0)  
**Input**: Requirements: [requirements.md](../../requirements.md) | Design: [design.md](../../design.md)

---

## 1. Executive Summary & Context

The **Fundación AQP-SOLIDARIA** is a Peruvian charitable organization managing social community initiatives (education, nutrition, community health). The foundation requires a secure, cloud-native, serverless platform to publish causes and accept **verifiable, auditable simulated donation commitments**.

### Core Invariants & Boundaries
1. **Academic Simulation Only**: Absolute prohibition of real payment card data (PAN, CVV), bank credentials, or actual financial debits.
2. **Zero Trust Architecture (NIST SP 800-207)**: Every request is verified per resource and session; server-side authoritative enforcement; least privilege IAM execution roles per function; short-lived access tokens (<= 15 min); memory-only client token storage.
3. **AWS Free Plan Compliance**: Zero unplanned costs, single region deployment, SAM IaC with complete teardown capability.
4. **Idempotency & Atomic Financial Balance**: Integer PEN cents (`amountCents`), UUID `Idempotency-Key`, and atomic `TransactWriteItems`.

---

## 2. Roles & Permission Matrix

| Role | Cognito Group | Discover & View Projects | Create Simulated Intention | Simulate Own Confirmation (Academic Stage) | View Own History | Manage Projects (Draft/Publish) | View Audit Events | Mandatory MFA |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Visitante** | *(Unauthenticated)* | Yes | No | No | No | No | No | No |
| **Donante** | `DONANTE` | Yes | Yes | Yes | Yes | No | No | Optional |
| **Gestor** | `GESTOR` | Yes | No | No | No | Yes | No | **Yes (TOTP)** |
| **Auditor** | `AUDITOR` | Yes | No | No | No | No | Yes | **Yes (TOTP)** |

*Note: Roles are strictly derived from verified JWT `cognito:groups` claims in Lambda. Client UI guards are UX only.*

---

## 3. User Scenarios & Prioritized Stories

### Priority P1 — Core Identity, Discovery & Project Catalog (MVP)

#### User Story HU-01 — List Published Projects (MVP)
*As a visitor, I want to explore published social projects to discover community causes.*
- **CA-01.1**: Visiting `/v1/projects` returns only `PUBLICADO` projects with title, description, target goal in PEN, and simulated confirmed total.
- **CA-01.2**: `BORRADOR` projects never appear in public listings.
- **CA-01.3**: When no projects are published, returns an empty array with HTTP 200 without technical errors.

#### User Story HU-02 — Project Details & Progress (MVP)
*As a visitor, I want to view detailed progress of a project without seeing donor private data.*
- **CA-02.1**: View project ID, title, description, goal amount, confirmed amount, and status. No donor PII is exposed.
- **CA-02.2**: Requesting a non-existent or unapproved project returns HTTP 404 without leaking internal system state.

#### User Story HU-03 — Authentication & Session Management (MVP)
*As a donor or foundation staff member, I want to authenticate securely using modern OAuth2/OIDC.*
- **CA-03.1**: Authentication via Amazon Cognito using **Authorization Code Grant + PKCE**; implicit flow is disabled.
- **CA-03.2**: Protected routes without token, expired token, signature tampering, wrong client ID, or sending an **ID Token** instead of an Access Token return HTTP 401.
- **CA-03.3**: Access token lifetime <= 15 minutes. Logout clears tokens in memory and invokes Cognito token revocation (`/oauth2/revoke`).
- **CA-03.4**: Documented limitation: JWT authorizer validates signatures locally; token accepted until TTL expires even if revoked; risk mitigated by short TTL.

#### User Story HU-11 — Mandatory MFA for Privileged Roles (MVP)
*As a security officer, I want mandatory multi-factor authentication on administrative and auditor accounts.*
- **CA-11.1**: Members of `GESTOR` and `AUDITOR` groups must use TOTP MFA (authenticator apps). SMS MFA is strictly disabled.
- **CA-11.2**: Evidence required demonstrating that `GESTOR`/`AUDITOR` cannot acquire credentials without the 2nd factor TOTP code.

---

### Priority P2 — Simulated Donations & Atomic Idempotency (MVP)

#### User Story HU-05 — Register Simulated Donation Intent (MVP)
*As an authenticated donor, I want to register a donation intention in Peruvian Soles.*
- **CA-05.1**: For a `PUBLICADO` project, valid amount (S/ 1.00 to S/ 1,000.00 expressed as integer `amountCents` 100 to 100000), and `Idempotency-Key` (UUID header), creates a `PENDIENTE_SIMULACION` record returning HTTP 201.
- **CA-05.2**: Invalid amount (<=0, >100000, non-integer, negative), missing `Idempotency-Key`, non-existent project (404), or project not in `PUBLICADO` (409) return client errors without updating project aggregates.
- **CA-05.3**: Donor ID (`donorSub`) is extracted strictly from the verified JWT authorizer context (`sub`), never from client request bodies.
- **CA-05.4**: Replaying identical `Idempotency-Key` and payload returns the original stored HTTP response without creating a duplicate; reusing the key with altered payload returns HTTP 409 Conflict.
- **CA-05.5**: Zero capture or storage of real financial instrument numbers (cards, CVV, bank accounts, DNI).

#### User Story HU-06 — Confirm / Reject Simulation (MVP)
*As a donor, I want to simulate confirming or declining my donation intention in the academic stage.*
- **CA-06.1**: Endpoint transitions own donation from `PENDIENTE_SIMULACION` to `CONFIRMADA_SIMULADA` or `RECHAZADA_SIMULADA`. Endpoint deployed **strictly in academic stage**.
- **CA-06.2**: Atomic update using DynamoDB `TransactWriteItems`: first valid confirmation atomically increments `confirmedAmountCents` of the project. Concurrent or duplicate confirmation requests return HTTP 409 without double-incrementing.
- **CA-06.3**: Simulated rejections do not increment project aggregates.
- **CA-06.4**: Clear banner displayed: *"Simulación académica: no se ha realizado ningún cobro"*.

#### User Story HU-07 — Donor Personal History (MVP)
*As an authenticated donor, I want to review my personal simulated donation history.*
- **CA-07.1**: Returns list of donations where `donorSub` strictly equals the caller's JWT `sub`.
- **CA-07.2**: Accessing another donor's record directly returns HTTP 403 or 404 (BOLA prevention).

---

### Priority P3 — Project Management & Transparency (MVP)

#### User Story HU-08 — Project Lifecycle Management (MVP)
*As a foundation manager, I want to create and publish projects.*
- **CA-08.1**: Only users with verified `GESTOR` role can create projects in `BORRADOR` state with positive goal amount.
- **CA-08.2**: Only `GESTOR` can publish a valid draft project. Publishing an already published project returns HTTP 409.
- **CA-08.3**: Creation and publishing emit structured audit log events with timestamp, actor reference, and action.

#### User Story HU-09 — Public Aggregate Statistics (MVP)
*As a visitor, I want to see real-time verified aggregate totals per project.*
- **CA-09.1**: Confirmed totals strictly reflect `CONFIRMADA_SIMULADA` contributions, formatted in PEN.
- **CA-09.2**: Public view exposes zero donor identifiers or individual donation records.

---

### Priority P4 — Security Governance, Auditing & Policy Engine (Extensions)

#### User Story HU-10 — Audit Log Querying (Extension)
*As a compliance auditor, I want to query critical system events.*
- **CA-10.1**: Accessible strictly to `AUDITOR` group with verified MFA.
- **CA-10.2**: Structured records containing `timestamp`, `requestId`, pseudonymized actor, resource, action, and outcome. Zero secrets or tokens.

#### User Story HU-12 — Externalized Policy Engine with Amazon Verified Permissions (Extension)
*As a cloud architect, I want authorization policies evaluated externally via Cedar and Amazon Verified Permissions.*
- **CA-12.1**: Authorization rules evaluated via Cedar `IsAuthorized` API.
- **CA-12.2**: Tests T03, T09, and T12 pass equivalently with both embedded PDP and Cedar PDP.

---

## 4. Non-Functional Requirements & Security Guarantees

- **RNF-01 (Transport Security)**: CloudFront + API Gateway with TLS 1.3/1.2; CSP, HSTS, `X-Content-Type-Options: nosniff`.
- **RNF-02 (Zero Trust Identity)**: API Gateway HTTP API JWT authorizer validating issuer, signature, expiry, client_id, and scopes. Lambda validates groups and ownership per request.
- **RNF-03 (Least Privilege)**: Granular IAM execution roles per Lambda function with tight table and action bounds.
- **RNF-04 (Atomic Idempotency & Concurrency)**: 10 parallel confirmation requests result in exactly one successful increment.
- **RNF-05 (Performance)**: p95 GET latency <= 1.5s (excluding cold start) under 50 projects.
- **RNF-06 (Accessibility & UI)**: Fully functional at 375px mobile viewport; WCAG 2.2 AA compliant focus and contrast.
- **RNF-07 (Observability)**: Structured JSON logging to CloudWatch; 14-day retention; CloudTrail enabled.
- **RNF-08 (Reproducible IaC & CI)**: AWS SAM template (`template.yaml`), GitHub Actions CI running lint, typecheck, and unit/integration tests.
- **RNF-09 (AWS Free Plan Compliance)**: Single region (`us-east-1`), zero cost overruns, budget alert set up.
- **RNF-10 (Privacy)**: Test identities only; no real personal data.
- **RNF-11 (Browser Hardening)**: Tokens kept in memory (no `localStorage` / `sessionStorage`).

---

## 5. Traceability Matrix to Acceptance Test Suite (T01 - T14)

| Test ID | Scenario | Expected Result | Traced Requirement |
|---|---|---|---|
| **T01** | Visitor queries projects | HTTP 200, excludes draft projects | CA-01.1, CA-01.2 |
| **T02** | Unauthenticated user attempts donation | HTTP 401 Unauthorized | CA-03.2 |
| **T03** | Donor attempts to create project | HTTP 403 Forbidden | CA-04.1 |
| **T04** | Donor sends amount <= 0, > 100000, or non-integer | HTTP 400 Bad Request | CA-05.2 |
| **T05** | Donor creates valid donation intention | HTTP 201 Created, pending simulation | CA-05.1 |
| **T06** | Replay identical Idempotency-Key and payload | Replays 201 response, 1 record created | CA-05.4 |
| **T07** | Replay Idempotency-Key with different payload | HTTP 409 Conflict | CA-05.4 |
| **T08** | 10 concurrent confirmation requests | Exactly 1 success, total incremented once | CA-06.2, CA-NF04.1 |
| **T09** | Donor requests another donor's donation | HTTP 403 or 404 (BOLA prevented) | CA-07.2 |
| **T10** | Projects list function attempts DynamoDB write | AccessDenied / IAM failure caught | CA-NF03.1 |
| **T11** | Bearer token is ID token or has altered signature | HTTP 401 Unauthorized | CA-03.2, CA-NF02.1 |
| **T12** | Manager queries private donor history | HTTP 403 or 404 | CA-04.2 |
| **T13** | Revoked token used before expiry | Accepted until expiry (documented ZT limit) | CA-03.4 |
| **T14** | Manager attempts login without TOTP 2nd factor | Authentication blocked, no tokens | CA-11.2 |
