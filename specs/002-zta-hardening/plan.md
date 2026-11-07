# Implementation Plan: Cumplimiento Zero Trust (arquitectura objetivo)

**Branch**: `002-zta-hardening` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-zta-hardening/spec.md`

## Summary

Llevar la plataforma a la arquitectura objetivo (`docs/diagrams/zta-architecture-target.d2`) cerrando los hallazgos H1–H11 de `docs/zta-hallazgos-y-mejoras.md`. El enfoque: (1) corregir el bug de confirmación (H1) y validarlo con DynamoDB Local; (2) un único envoltorio `withAuth()` que autoriza, audita denegaciones y revalida sesión en acciones sensibles, con una prueba de cobertura de rutas; (3) endurecer el template (MFA obligatorio, IAM por acción, auditoría append-only, logs con retención, CloudTrail, CORS, throttling, callbacks, protección de datos); (4) CI con integración, `cfn-lint`, `checkov` y las reglas de calidad de la constitución; (5) retirar el código Cedar sin uso y corregir los documentos. Se mantienen 9 funciones y un solo repositorio.

## Technical Context

**Language/Version**: TypeScript 5.8 (strict, ESM), Node.js 24 (`nodejs24.x`)

**Primary Dependencies**: AWS SDK v3 (`client-dynamodb`, `lib-dynamodb`), Zod 3. Se **elimina** `@aws-sdk/client-verifiedpermissions`. Dev: Vitest 3, ESLint 9 + typescript-eslint, Prettier 3, `cfn-lint`, `checkov` (solo CI)

**Storage**: DynamoDB (Projects, Donations, Idempotency, Audit)

**Testing**: Vitest. Unitarias existentes + nuevo conjunto de integración contra **DynamoDB Local** (contenedor)

**Target Platform**: AWS serverless (Lambda, HTTP API, Cognito, S3 + CloudFront), `us-east-1`, SAM

**Project Type**: web-service + SPA (monorepo con workspaces `backend` y `frontend`)

**Performance Goals**: la revalidación de sesión añade una llamada a Cognito solo en 3 acciones sensibles; CI completo < 10 min (SC-012)

**Constraints**: AWS Free Plan (constitución V), log retention ≤ 14 días, sin claves de larga duración en CI (OIDC), `sam delete` debe seguir limpiando la etapa académica

**Scale/Scope**: curso académico; 9 funciones, 4 tablas, 3 roles

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación | Resultado |
|---|---|---|
| I. Zero Trust (NIST 800-207) | La feature implementa el principio: PE obligatorio, MFA, revalidación, auditoría | Pasa |
| II. Seguridad académica / integridad financiera | Sin cambios de dominio; se corrige la transición de confirmación atómica | Pasa |
| III. Mínimo privilegio | Roles por acción, sin borrado ni comodines, Audit solo `PutItem`; CI sin llaves (OIDC) | Pasa |
| IV. Verificación negativa | Pasa de DB simulada a DynamoDB Local; la prueba T14 actual simula Cognito y se reemplaza por una aserción sobre el template | Pasa |
| V. Free Plan e higiene (v2.2.0) | Un solo `template.yaml`. PITR no es gratuito: parámetro apagado por defecto. Protección de borrado solo en producción para conservar `sam delete`. CloudTrail: primer trail de eventos de gestión gratuito. GuardDuty y Security Hub (pruebas de 30 días): parámetros apagados por defecto, sujetos al tipo de cuenta. Los buckets con objetos bloquean `sam delete`, por lo que se añade `scripts/cleanup.ps1` (T078). Las pruebas de infraestructura corren para cada etapa (T008) | Pasa con nota (ver Complexity Tracking) |
| VI. Transparencia y gobierno de IA | `AI_USAGE.md` se corrige (FR-030); logs sin PII (FR-015) | Pasa |
| VII. Código mantenible | ESLint con complejidad ≤ 10, función ≤ 50 líneas, `no-explicit-any`; Prettier en CI; autorización/auditoría/errores centralizados en un solo módulo | Pasa |

**Re-evaluación post-diseño**: sin cambios; ver Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-zta-hardening/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── with-auth.md
│   ├── audit-event.md
│   ├── iam-permissions-matrix.md
│   └── ci-gates.md
└── tasks.md             # lo genera /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── authz/
│   │   ├── withAuth.ts            # NUEVO: envoltorio obligatorio (PE + auditoría + sesión)
│   │   ├── evaluateAuthz.ts       # se mantiene el autorizador embebido; se quita getAuthorizer/Cedar
│   │   ├── sessionCheck.ts        # NUEVO: revalida sesión en Cognito (falla cerrado)
│   │   └── cedarAdapter.ts        # SE ELIMINA (fase 2)
│   ├── audit/
│   │   ├── recordAuditEvent.ts    # antes logAuditEvent.ts: único punto de escritura
│   │   └── getAuditEvents.ts
│   ├── donations/ projects/       # handlers reducidos a lógica de negocio dentro de withAuth()
│   └── shared/
│       ├── constants.ts           # NUEVO: roles, estados, TTL, acciones sensibles
│       └── (errors, dynamo, hash, logger, response, schemas)
└── test/
    ├── integration/               # NUEVO: DynamoDB Local (matriz rol×acción, BOLA, idempotencia, estados, H1)
    ├── infra/                     # NUEVO: aserciones sobre template.yaml (IAM, MFA, CORS, rutas con withAuth)
    └── (unitarias existentes; cedarEquivalence.test.ts se elimina)

infra/template.yaml                # MFA, IAM, Audit, logs, CloudTrail, CORS, throttling, callbacks, PITR
.github/workflows/ci.yml           # integración, cfn-lint, checkov, prettier, deploy con OIDC
scripts/cleanup.ps1                # vacía los buckets de logs y frontend y ejecuta sam delete
docs/free-plan-guide.md            # tipo de cuenta, parámetros opcionales, fecha fin de pruebas, limpieza
eslint.config.js  .prettierrc      # reglas del principio VII
policies/                          # se conserva como documentación de fase 2 (README aclara que no se aplica)
docs/  AI_USAGE.md  specs/001-secure-donations/research.md   # coherencia documental
frontend/                          # solo ajustes menores (CSP de Cognito se corrige en el template)
```

**Structure Decision**: se mantiene el monorepo con workspaces `backend` y `frontend` y las 9 funciones (una por endpoint, un rol IAM cada una). Reorganizar en paquetes (`packages/authz`, `packages/audit`) queda como opción posterior al cierre de esta feature, porque aún no hay un segundo consumidor.

## Complexity Tracking

| Desviación | Por qué hace falta | Alternativa más simple rechazada porque |
|---|---|---|
| PITR fuera del plan gratuito | Requisito de recuperación (FR-026) y mejora 12 | No tenerlo deja datos y evidencia sin recuperación; parámetro `EnablePitr` apagado por defecto, encendido en `production` |
| Pruebas de 30 días (GuardDuty, Security Hub) | Monitoreo de la postura (principio 5 de NIST, FR-031) con lo que ofrece AWS | No usarlas deja el principio 5 sin cubrir; van como parámetros apagados por defecto, con fecha de fin de prueba documentada, para no generar cobro por sorpresa |
| MFA obligatorio para todo el pool, donantes incluidos | Cognito no exige MFA por grupo; la alternativa es un segundo pool de usuarios con su propio authorizer | Dos pools duplican identidad, clientes y rutas; el costo para el donante es una configuración única |
| Llamada a Cognito en acciones sensibles | Cierra la ventana de token robado (H9) | Confiar solo en el JWT deja 15 min de exposición |
