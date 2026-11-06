# Quickstart & Validation Guide: Plataforma de Donaciones Seguras

**Feature Branch**: `001-secure-donations`  
**Date**: 2026-11-06  
**Status**: Ready for Validation  
**References**: [spec.md](./spec.md), [data-model.md](./data-model.md), [api-spec.yaml](./contracts/api-spec.yaml)

---

## 1. Prerequisites & Environment Setup

### Required Tools
- Node.js 24 (`node -v` >= 24.x)
- npm 10.x
- AWS CLI v2 (`aws --version`) configured with non-root IAM credentials and MFA
- AWS SAM CLI (`sam --version` >= 1.115)
- Git 2.x

### Environment Variables
Configure the following in `backend/.env.test` or local execution environment:
```bash
AWS_REGION=us-east-1
STAGE=academic
PROJECTS_TABLE=aqp-projects-academic
DONATIONS_TABLE=aqp-donations-academic
IDEMPOTENCY_TABLE=aqp-idempotency-academic
AUDIT_TABLE=aqp-audit-academic
COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 2. Fast Verification Commands (Local & CI)

### Linting, Typecheck & Unit Tests
```bash
# In repository root:
npm install

# Type checking across frontend and backend:
npm run typecheck

# Code formatting & style checks:
npm run lint

# Run automated unit and negative test suite:
npm run test
```

Expected result: 100% passing tests with 0 TypeScript and ESLint errors.

---

## 3. Step-by-Step Scenario Validation (T01 - T14)

### Scenario A: Discovery & Public Project Catalog
1. **T01 - Query Public Projects (Visitor)**:
   - **Command**:
     ```bash
     curl -s -X GET "https://{apiId}.execute-api.us-east-1.amazonaws.com/v1/projects"
     ```
   - **Expected Outcome**: HTTP 200. Returns array of projects where `status == "PUBLICADO"`. Draft projects are not present.

---

### Scenario B: Zero Trust Authentication & Scopes
2. **T02 - Unauthorized Donation Creation**:
   - **Command**:
     ```bash
     curl -s -w "\nHTTP Status: %{http_code}\n" -X POST \
       "https://{apiId}.execute-api.us-east-1.amazonaws.com/v1/donations" \
       -H "Content-Type: application/json" \
       -d '{"projectId":"11111111-1111-1111-1111-111111111111","amountCents":5000}'
     ```
   - **Expected Outcome**: HTTP 401 Unauthorized. Request blocked at API Gateway JWT authorizer layer.

3. **T11 - ID Token Rejection**:
   - **Command**:
     ```bash
     curl -s -w "\nHTTP Status: %{http_code}\n" -X POST \
       "https://{apiId}.execute-api.us-east-1.amazonaws.com/v1/donations" \
       -H "Authorization: Bearer <VALID_COGNITO_ID_TOKEN>" \
       -H "Idempotency-Key: 33333333-3333-3333-3333-333333333333" \
       -H "Content-Type: application/json" \
       -d '{"projectId":"11111111-1111-1111-1111-111111111111","amountCents":5000}'
     ```
   - **Expected Outcome**: HTTP 401/403. API Gateway rejects the token because it lacks the required OAuth `scope` claim.

---

### Scenario C: Role-Based Access Control (RBAC) & BOLA
4. **T03 - Donor Attempts Project Creation (Vertical Privilege Escalation)**:
   - **Command**:
     ```bash
     curl -s -w "\nHTTP Status: %{http_code}\n" -X POST \
       "https://{apiId}.execute-api.us-east-1.amazonaws.com/v1/projects" \
       -H "Authorization: Bearer <DONANTE_ACCESS_TOKEN>" \
       -H "Content-Type: application/json" \
       -d '{"title":"Nuevo Proyecto","description":"Intento de escalación","goalAmountCents":500000}'
     ```
   - **Expected Outcome**: HTTP 403 Forbidden. Lambda `authz` verifies `cognito:groups` lacks `GESTOR`.

5. **T09 - Cross-Donor Donation Access (BOLA / Horizontal Escalation)**:
   - **Command**: Donor A queries or simulates Donor B's donation ID.
   - **Expected Outcome**: HTTP 403 or 404 without leaking whether Donor B's record exists.

6. **T12 - Manager Queries Donor Private History**:
   - **Command**: User with `GESTOR` role attempts `GET /v1/donations/me`.
   - **Expected Outcome**: HTTP 403/404. Historical records are strictly tied to caller `sub`.

---

### Scenario D: Idempotency, Input Validation & Concurrency
7. **T04 - Invalid Amount Validation**:
   - **Command**: Donor sends `amountCents: 0` or `100001` or floating point `50.5`.
   - **Expected Outcome**: HTTP 400 Bad Request. Detailed validation error, zero database writes.

8. **T05 - Valid Donation Intention Creation**:
   - **Command**:
     ```bash
     curl -s -i -X POST \
       "https://{apiId}.execute-api.us-east-1.amazonaws.com/v1/donations" \
       -H "Authorization: Bearer <DONANTE_ACCESS_TOKEN>" \
       -H "Idempotency-Key: e1a2b3c4-d5e6-7f8a-9b0c-1d2e3f4a5b6c" \
       -H "Content-Type: application/json" \
       -d '{"projectId":"11111111-1111-1111-1111-111111111111","amountCents":2500}'
     ```
   - **Expected Outcome**: HTTP 201 Created. `status: "PENDIENTE_SIMULACION"`.

9. **T06 - Idempotent Replay (Identical Payload)**:
   - **Command**: Re-run the exact command above with the identical `Idempotency-Key` and JSON body.
   - **Expected Outcome**: HTTP 201 Created. Identical response returned; exactly 1 record in DynamoDB.

10. **T07 - Idempotency Replay with Altered Payload**:
    - **Command**: Re-run with the same `Idempotency-Key` but `amountCents: 5000`.
    - **Expected Outcome**: HTTP 409 Conflict. Duplicate key reused with modified parameters.

11. **T08 - 10 Concurrent Confirmation Requests**:
    - **Command**: Dispatch 10 parallel HTTP POST requests to `/v1/donations/{id}/simulate` with `action: "CONFIRMAR"`.
    - **Expected Outcome**: Exactly 1 request receives HTTP 200; the other 9 receive HTTP 409 Conflict. `confirmedAmountCents` of the target project increments exactly once.

---

### Scenario E: Privileged Security Controls & Teardown
12. **T14 - Privileged TOTP MFA Enforcement**:
    - **Action**: Attempt password-only authentication for a user in `GESTOR` or `AUDITOR` groups.
    - **Expected Outcome**: Cognito returns `SOFTWARE_TOKEN_MFA` challenge. Authentication cannot complete without valid TOTP code.

13. **T10 - IAM Least Privilege Verification**:
    - **Action**: Run Lambda unit test or AWS IAM Policy Simulator asserting the `listProjects` function's execution role cannot execute `dynamodb:PutItem` or `dynamodb:UpdateItem`.
    - **Expected Outcome**: AccessDenied policy verification succeeds.

14. **Clean Teardown**:
    - **Command**:
      ```bash
      sam delete --stack-name aqp-solidaria-academic --no-prompts
      ```
    - **Expected Outcome**: All AWS resources safely and completely eliminated.
