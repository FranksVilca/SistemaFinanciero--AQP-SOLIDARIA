# Technical Research & Architecture Decisions: Plataforma de Donaciones Seguras

**Feature Branch**: `001-secure-donations`  
**Date**: 2026-11-06  
**Status**: Completed  
**Traced Documents**: [requirements.md](../../requirements.md), [design.md](../../design.md), [spec.md](./spec.md)

---

## 1. Research Topic: Identity, Token Validation & Scope Enforcement in HTTP API

### Context & Challenge
Under Zero Trust, no request is trusted based on network origin. We must authenticate each API request against Amazon Cognito. Cognito Access Tokens differ from ID Tokens:
- Access tokens contain `token_use: "access"`, `client_id`, `sub`, `cognito:groups`, and custom OAuth scopes defined in a Resource Server. They do NOT contain `aud`.
- ID tokens contain `token_use: "id"`, `aud` (the client id), user identity profile attributes, but NO custom OAuth scopes.
- CA-03.2 and T11 require that sending an ID Token as Bearer token MUST be rejected with HTTP 401/403.

### Decision
1. **API Gateway HTTP API JWT Authorizer**:
   - Set `IdentitySource: "$request.header.Authorization"`.
   - Set `Issuer: "https://cognito-idp.{region}.amazonaws.com/{userPoolId}"`.
   - Set `Audience: ["{userPoolClientId}"]` (Note: In AWS API Gateway HTTP API, for Cognito access tokens, the JWT authorizer validates `client_id` against the configured audience list).
2. **Route Authorization Scopes**:
   - Define a Cognito Resource Server `api` with custom scopes:
     - `api/projects.write`
     - `api/donations.write`
     - `api/donations.read`
     - `api/audit.read`
   - Configure HTTP API routes in AWS SAM with `AuthorizationScopes: ["api/..."]`.
   - Because ID tokens lack the `scope` claim with resource server identifiers, API Gateway automatically rejects any ID token presented on these routes with HTTP 401/403 before invoking Lambda.
3. **Lambda Role/Group Validation**:
   - The Lambda function extracts caller identity and roles from `$event.requestContext.authorizer.jwt.claims`:
     - `sub`: Authenticated principal identity.
     - `cognito:groups`: Comma-separated or array of user groups (`DONANTE`, `GESTOR`, `AUDITOR`).
   - The Lambda `authz` module performs secondary defense-in-depth authorization, matching the required role against the user group.

### Alternatives Considered
- *Custom Lambda Authorizer*: Allows arbitrary token parsing and custom revocation checks, but introduces cold-start latency and higher execution overhead. HTTP API built-in JWT authorizer is native, zero-cost, runs at AWS edge/gateway layer, and complies with Free Plan.
- *API Gateway REST API*: Supports Cognito authorizers directly with ID tokens, but costs significantly more, has higher latency, and lacks native HTTP API JWT claims routing without custom velocity templates.

---

## 2. Research Topic: Atomic Idempotency & Concurrency Invariant in DynamoDB

### Context & Challenge
Requirements CA-05.1, CA-05.4, CA-06.2, CA-NF04.1 and test case T08 dictate:
- Creation of donation intention must require a UUID `Idempotency-Key`.
- Replaying the exact same request body with the same key must return the stored response without duplicate creation.
- Replaying with a different body must return HTTP 409 Conflict.
- When confirming a donation, at least 10 concurrent requests must result in exactly one increment to the project's `confirmedAmountCents`, and all other concurrent calls must fail with HTTP 409.

### Decision
1. **Donation Creation (`POST /v1/donations`)**:
   - Construct an idempotency key composite: `pk = "${donorSub}#createDonation#${idempotencyKey}"`.
   - Compute `payloadHash = sha256(canonicalJson({ projectId, amountCents }))`.
   - Execute `TransactWriteItems`:
     - Item 1: Insert into `Idempotency` table:
       - `pk`: `${donorSub}#createDonation#${idempotencyKey}`
       - `payloadHash`: hash
       - `donationId`: new UUID
       - `responseStatus`: 201
       - `expiresAt`: current timestamp + 86400 (DynamoDB TTL: 24h)
       - Condition: `attribute_not_exists(pk)`
     - Item 2: Insert into `Donations` table:
       - `donationId`: new UUID
       - `projectId`: projectId
       - `donorSub`: donorSub
       - `amountCents`: amountCents
       - `currency`: 'PEN'
       - `status`: 'PENDIENTE_SIMULACION'
       - `createdAt`: ISO timestamp
       - `updatedAt`: ISO timestamp
   - **Handling Conflict / Idempotency Replay**:
     - If transaction succeeds: return HTTP 201 with created donation.
     - If transaction fails with `TransactionCanceledException`:
       - Read existing item in `Idempotency` table using `ConsistentRead: true`.
       - If item exists and stored `payloadHash === requestPayloadHash`:
         - Read the existing donation from `Donations` table.
         - Return HTTP 201 with existing donation (idempotent replay).
       - If item exists but stored `payloadHash !== requestPayloadHash`:
         - Return HTTP 409 Conflict ("Idempotency key reuse with different parameters").
       - If project does not exist or is not `PUBLICADO`: Return HTTP 404 or 409 accordingly.

2. **Simulation Confirmation (`POST /v1/donations/{id}/simulate`)**:
   - Execute `TransactWriteItems`:
     - Item 1: Update `Donations` table:
       - `Key: { donationId }`
       - `UpdateExpression: "SET #status = :newStatus, updatedAt = :now"`
       - `ConditionExpression: "attribute_exists(donationId) AND #status = :pendingStatus AND donorSub = :sub"`
       - Expression attribute values: `:newStatus = 'CONFIRMADA_SIMULADA'`, `:pendingStatus = 'PENDIENTE_SIMULACION'`, `:sub = donorSub`.
     - Item 2 (only if `CONFIRMADA_SIMULADA`): Update `Projects` table:
       - `Key: { projectId }`
       - `UpdateExpression: "ADD confirmedAmountCents :amount, updatedAt = :now"`
       - `ConditionExpression: "attribute_exists(projectId)"`
       - Expression attribute values: `:amount = donation.amountCents`.
   - **Concurrency Guarantee**:
     - DynamoDB serializes transaction execution.
     - Out of 10 simultaneous requests attempting to transition from `PENDIENTE_SIMULACION`, exactly one succeeds.
     - The other 9 encounter condition failure on Item 1 (`status` is no longer `PENDIENTE_SIMULACION`), triggering `TransactionCanceledException`.
     - The handler intercepts this exception and returns HTTP 409 Conflict. Project `confirmedAmountCents` is incremented exactly once.

### Alternatives Considered
- *DynamoDB Streams + Lambda Worker*: Asynchronous eventual consistency. Rejected because user flows require immediate confirmation feedback, and eventual consistency introduces race windows that complicate idempotency verification in test T08.
- *Distributed Locking (Redis/ElastiCache)*: Excluded due to AWS Free Plan constraints (ElastiCache is not free beyond limited trial, and introduces server infrastructure).

---

## 3. Research Topic: Client-Side Security & In-Memory Token Management

### Context & Challenge
RNF-HU-11 and CA-NF11.1 require that authentication tokens (Access Token, Refresh Token) are kept in application memory and NEVER persisted in `localStorage` or `sessionStorage`, to protect against Cross-Site Scripting (XSS) token exfiltration.

### Decision
1. **OIDC Client Library**: Use `oidc-client-ts` configured with `InMemoryWebStorage`:
   ```typescript
   const userManager = new UserManager({
     authority: `https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}`,
     client_id: CLIENT_ID,
     redirect_uri: `${WINDOW_ORIGIN}/auth/callback`,
     response_type: "code",
     scope: "openid profile email api/projects.write api/donations.write api/donations.read api/audit.read",
     userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
     loadUserInfo: false
   });
   ```
2. **Token Lifecycle & Refresh**:
   - Refresh tokens and access tokens are held purely in React context / memory.
   - Page refreshes initiate a silent session check or redirect to Cognito managed login if session expires.
   - On Logout: Call `userManager.signoutRedirect()` and invoke Cognito token revocation (`POST /oauth2/revoke`) with the refresh token.
3. **CloudFront Security Headers Policy**:
   - Attach a CloudFront Response Headers Policy providing:
     - `Content-Security-Policy: default-src 'self'; connect-src 'self' https://cognito-idp.{region}.amazonaws.com https://{apiId}.execute-api.{region}.amazonaws.com; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none';`
     - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
     - `X-Content-Type-Options: nosniff`
     - `X-Frame-Options: DENY`
     - `Referrer-Policy: strict-origin-when-cross-origin`

### Alternatives Considered
- *BFF (Backend-For-Frontend) with httpOnly Cookies*: While optimal for security against XSS, it requires a dedicated container/server layer to manage cookie translation, violating the zero-maintenance static SPA + serverless architectural pattern and AWS Free Plan simplicity.
- *Web Workers for Token Handling*: Overly complex for a 1-week timeline without tangible benefit over in-memory state when coupled with strict CSP.

---

## 4. Research Topic: AWS SAM Academic Stage Conditioning

### Context & Challenge
Requirement CA-06.1 dictates:
> "El endpoint de simulación permite pasar una donación propia de PENDIENTE_SIMULACION a CONFIRMADA_SIMULADA o RECHAZADA_SIMULADA, y **solo se despliega en el stage académico** (condición en la plantilla SAM); en otro stage la ruta no existe."

### Decision
In `infra/template.yaml`:
1. Define a Parameter:
   ```yaml
   Parameters:
     StageName:
       Type: String
       Default: academic
       AllowedValues:
         - academic
         - production
   ```
2. Define a Condition:
   ```yaml
   Conditions:
     IsAcademicStage: !Equals [!Ref StageName, "academic"]
   ```
3. Attach the condition to the simulation Lambda function and its HTTP API Route:
   ```yaml
   SimulateDonationRoute:
     Type: AWS::Serverless::HttpApi
     # or OpenApi specification with condition / Route definition:
     Condition: IsAcademicStage
   SimulateDonationFunction:
     Type: AWS::Serverless::Function
     Condition: IsAcademicStage
     Properties:
       Events:
         SimulateApi:
           Type: HttpApi
           Properties:
             Path: /v1/donations/{donationId}/simulate
             Method: POST
             ApiId: !Ref HttpApi
   ```
When `StageName != 'academic'`, CloudFormation completely skips synthesizing the route and Lambda function, ensuring the endpoint does not exist.

---

## 5. Research Topic: Externalized Policy Engine with Amazon Verified Permissions (HU-12 Extension)

### Context & Challenge
HU-12 requires externalizing the authorization logic to Cedar policies evaluated by Amazon Verified Permissions (AVP) while keeping compatibility with the core embedded `authz` module so both can run and pass tests T03, T09, and T12.

### Decision
1. **Cedar Policy Store Schema**:
   - Entity types:
     - `FundacionAQPSolidaria::User` with parent group types `Group`.
     - `FundacionAQPSolidaria::Project` with attribute `status: String`.
     - `FundacionAQPSolidaria::Donation` with attribute `donorSub: String`, `projectId: String`.
   - Actions:
     - `Action::"ListProjects"`, `Action::"ViewProject"`, `Action::"CreateProject"`, `Action::"PublishProject"`
     - `Action::"CreateDonation"`, `Action::"ViewDonation"`, `Action::"SimulateDonation"`
     - `Action::"ViewAudit"`
2. **Cedar Policies**:
   ```cedar
   // Permit GESTOR to create and publish projects
   permit(
       principal in FundacionAQPSolidaria::Group::"GESTOR",
       action in [FundacionAQPSolidaria::Action::"CreateProject", FundacionAQPSolidaria::Action::"PublishProject"],
       resource is FundacionAQPSolidaria::Project
   );

   // Forbid non-GESTOR from creating projects
   // (Default deny in Cedar handles this, T03 succeeds)

   // Permit DONANTE to view their own donation
   permit(
       principal in FundacionAQPSolidaria::Group::"DONANTE",
       action == FundacionAQPSolidaria::Action::"ViewDonation",
       resource is FundacionAQPSolidaria::Donation
   ) when {
       resource.donorSub == principal.id
   };
   ```
3. **Pluggable Authorizer Interface**:
   ```typescript
   export interface PolicyAuthorizer {
     isAuthorized(input: AuthorizationRequest): Promise<boolean>;
   }
   ```
   - Implement `EmbeddedPolicyAuthorizer` (evaluates in TypeScript in Lambda memory).
   - Implement `VerifiedPermissionsAuthorizer` (calls `client.isAuthorized(...)` via AWS SDK).
   - Switched via environment variable `POLICY_ENGINE=embedded | verified_permissions`.

---

## Summary of Architectural Consolidations

| Architecture Area | Chosen Approach | Why Chosen |
|---|---|---|
| API Authentication | HTTP API + JWT Authorizer + Scopes | Built-in zero-maintenance PEP, validates token signatures, enforces scopes, rejects ID tokens (T11). |
| Application Authorization | `authz` module with embedded RBAC + ownership | PDP in Lambda, sub/group claims verification, Zero Trust least privilege. |
| Idempotency & Balances | DynamoDB `TransactWriteItems` + TTL | Atomic item reservation and conditional update, 100% race-condition immune (T08). |
| SPA Token Storage | `oidc-client-ts` in-memory storage | Mitigates token exfiltration via XSS, strictly complies with CA-NF11.1. |
| Stage Conditioning | AWS SAM `Condition: IsAcademicStage` | Guarantees test simulation route does not exist outside academic environments. |
| Testing & Verification | Vitest unit/integration + HTTP negative suites | Fast, reproducible in CI/CD, covers full test suite T01-T14. |
