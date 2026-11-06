# Plataforma de Donaciones Seguras (Fundación AQP-SOLIDARIA) Constitution

## Core Principles

### I. Zero Trust Security Architecture (NIST SP 800-207)
Every request to protected resources must be explicitly authenticated and authorized at the backend level regardless of network origin. Client-side checks are purely for UX and never trusted. The architecture maps strictly to NIST SP 800-207:
- Policy Enforcement Point (PEP): API Gateway HTTP API with JWT Authorizer + CloudFront with security headers.
- Policy Decision Point (PDP) / Policy Engine (PE): Embedded `authz` module (MVP) and Amazon Verified Permissions with Cedar policies (Extension HU-12).
- Policy Administrator (PA): Amazon Cognito User Pool managing tokens and sessions.
- Least privilege must be enforced at both user (Cognito groups) and workload (IAM role per Lambda) levels.
- Assume breach: strict token lifetimes (access token <= 15 min), memory-only token storage in SPA, and structured audit logging.

### II. Academic Safety & Financial Integrity
- Absolute prohibition against collecting, transmitting, or storing real credit card numbers, CVV, bank credentials, or executing real charges.
- All monetary operations are simulated donations strictly in Peruvian Soles (PEN) represented as integer cents (`amountCents`). Floating point numbers are strictly forbidden for currency.
- Strict atomic idempotency: `Idempotency-Key` (UUID) with `TransactWriteItems` ensuring no double-counting and safe retry semantics.
- Clear simulation notices displayed across the UI: "Simulación académica: no se ha realizado ningún cobro".

### III. Minimum Privilege & Workload Isolation
- Each Lambda function must possess its own dedicated IAM execution role granting only the exact DynamoDB tables and actions needed (e.g., read-only list function cannot write).
- No wildcards (`*`) for actions or resources unless AWS service limitations strictly demand it.
- No long-lived AWS access keys in code or CI/CD; root account usage is forbidden; all privileged human access requires MFA.

### IV. Rigorous Automated Verification & Negative Testing
- All critical security invariants, validation rules, idempotency behaviors, and state transitions must have automated tests (Vitest).
- Negative testing is mandatory: proving that unauthorized calls (e.g., donor creating project, visitor accessing protected routes, ID token sent as access token, replay with altered payload) return 401/403/409/400.
- Mandatory Acceptance Test Cases T01 through T14 must be verifiable and produce documented evidence.

### V. AWS Free Plan Compliance & Resource Hygiene
- The system must operate strictly within the AWS Free Plan boundaries. High-cost services (e.g., WAF on HTTP API, GuardDuty, Security Hub, SMS MFA) are explicitly excluded.
- Single AWS region deployment (`us-east-1` recommended).
- CloudWatch log retention capped at 14 days.
- Full Infrastructure as Code (IaC) via AWS SAM enabling reproducible deployment and complete resource cleanup via `sam delete`.

### VI. Transparency, Code Quality & AI Governance
- Centralized branch protection: all changes arrive via PR with peer review.
- CI in GitHub Actions enforcing linting (ESLint), typechecking (TypeScript), and automated test execution.
- Observability: structured JSON logging with correlation IDs (`requestId`), with strict filtering to prevent leaking tokens, secrets, or sensitive donor PII.
- AI governance: every code contribution assisted by AI agents or LLMs must be documented in `AI_USAGE.md` detailing tool, prompt context, human validation, and limitations.

## Governance

- This Constitution supersedes all informal practices and serves as the quality gate for planning, development, and PR approval.
- Any architectural deviation or complexity must be documented and justified in the Implementation Plan's Complexity Tracking section.
- Pre-merge checks in CI must pass with 0 errors.

**Version**: 2.0.0 | **Ratified**: 2026-11-02 | **Last Amended**: 2026-11-06
