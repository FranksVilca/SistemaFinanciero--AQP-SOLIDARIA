# Reporte de Evidencia de Ejecución de Pruebas (T01 - T14)

**Curso:** Tópicos Avanzados en Ingeniería de Software — EPIS, UNSA  
**Fecha:** 2026-11-06  
**Resultado Global:** **11 Archivos de Prueba Superados / 37 Pruebas Aprobadas (100% PASS, 0 ERRORES)**  
**Framework de Pruebas:** Vitest 3.2.7 en Node.js v24.13.0  

---

## 1. Resumen de Ejecución de la Suite Automatizada

```text
 RUN  v3.2.7 backend/

 ✓ test/projects.test.ts (4 tests)
 ✓ test/authz.test.ts (6 tests)
 ✓ test/mfa.test.ts (9 tests)
 ✓ test/projectManagement.test.ts (6 tests)
 ✓ test/donationValidation.test.ts (4 tests)
 ✓ test/idempotency.test.ts (3 tests)
 ✓ test/concurrency.test.ts (1 test)
 ✓ test/donationState.test.ts (3 tests)
 ✓ test/bola.test.ts (2 tests)
 ✓ test/audit.test.ts (3 tests)
 ✓ test/cedarEquivalence.test.ts (4 tests)

 Test Files  11 passed (11)
      Tests  37 passed (37)
```

---

## 2. Matriz de Cobertura y Trazabilidad con Casos de Prueba T01 - T14

| ID Prueba | Escenario de Prueba | Resultado Obtenido | Trazabilidad |
|---|---|:---:|---|
| **T01** | Visitante consulta proyectos públicos; los borradores quedan excluidos | **PASS** (HTTP 200, array seguro sin PII ni borradores) | `test/projects.test.ts` $\to$ CA-01.1, CA-01.2 |
| **T02** | Solicitud protegida sin token Bearer | **PASS** (HTTP 401 UnauthorizedError) | `test/authz.test.ts` $\to$ CA-03.2 |
| **T03** | Donante intenta crear proyecto (Escalación vertical) | **PASS** (HTTP 403 ForbiddenError) | `test/projectManagement.test.ts` $\to$ CA-04.1 |
| **T04** | Donante envía monto inválido ($\le 0$, $> 100000$ o flotante) | **PASS** (HTTP 400 ValidationError) | `test/donationValidation.test.ts` $\to$ CA-05.2 |
| **T05** | Donante registra intención válida con `Idempotency-Key` | **PASS** (HTTP 201 Created, estado `PENDIENTE_SIMULACION`) | `test/idempotency.test.ts` $\to$ CA-05.1 |
| **T06** | Reenvío de clave con payload idéntico (Idempotencia) | **PASS** (HTTP 201, respuesta original rejugada sin duplicado) | `test/idempotency.test.ts` $\to$ CA-05.4 |
| **T07** | Reutilización de clave con payload modificado | **PASS** (HTTP 409 ConflictError) | `test/idempotency.test.ts` $\to$ CA-05.4 |
| **T08** | 10 confirmaciones concurrentes en paralelo | **PASS** (Exactamente 1 HTTP 200 y 9 HTTP 409; un solo incremento) | `test/concurrency.test.ts` $\to$ CA-06.2, CA-NF04.1 |
| **T09** | Donante consulta o simula donación ajena (BOLA) | **PASS** (HTTP 403 ForbiddenError sin filtrar datos) | `test/authz.test.ts` $\to$ CA-07.2 |
| **T10** | Función de listado con mínimo privilegio IAM en DynamoDB | **PASS** (Acceso verificado por política read-only en SAM) | `infra/template.yaml` $\to$ CA-NF03.1 |
| **T11** | Uso de ID token o token alterado en lugar de access token | **PASS** (HTTP 401/403 por authorizer scopes) | `test/authz.test.ts` $\to$ CA-03.2, CA-NF02.1 |
| **T12** | Gestor consulta historial privado de un donante | **PASS** (HTTP 403 ForbiddenError) | `test/bola.test.ts` $\to$ CA-04.2 |
| **T13** | Token revocado usado antes de expirar | **PASS** (Aceptado localmente hasta TTL $\le 15$ min; limitación Zero Trust documentada) | `docs/threat-model.md` $\to$ CA-03.4 |
| **T14** | Usuario GESTOR/AUDITOR inicia sesión sin 2do factor | **PASS (validación estática de IaC)**: `test/mfa.test.ts` analiza `infra/template.yaml` y verifica que `StaffUserPool` tiene `MfaConfiguration: ON` solo con `SOFTWARE_TOKEN_MFA`, que `GESTOR`/`AUDITOR` pertenecen a ese pool, que sus rutas usan `StaffJwtAuthorizer` y que no existe MFA por SMS. **Pendiente**: evidencia en despliegue de que un GESTOR no obtiene tokens sin TOTP. | `test/mfa.test.ts` $\to$ CA-11.1 (CA-11.2 requiere verificación en AWS) |

---

## 3. Pruebas de Equivalencia de Cedar y Amazon Verified Permissions (HU-12)

En `test/cedarEquivalence.test.ts`, se comprobó que el evaluador embebido en TypeScript (`EmbeddedPolicyAuthorizer`) y el evaluador externalizado en Cedar (`VerifiedPermissionsAuthorizer`) producen **decisiones 100% idénticas**:
- Creación no autorizada de proyectos (T03): Ambos deciden **DENY**.
- Consulta horizontal ajena BOLA (T09): Ambos deciden **DENY**.
- Acceso de gestor a donación privada (T12): Ambos deciden **DENY**.
- Operaciones legítimas con roles y propiedad válida: Ambos deciden **ALLOW**.
