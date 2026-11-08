# Contrato: matriz de permisos IAM por función

Acciones de DynamoDB permitidas. Todo lo no listado está denegado. Sin comodines de acción ni de recurso; los índices secundarios se incluyen en el recurso de su tabla cuando se consultan.

`R` = `GetItem`, `Query` · `P` = `PutItem` · `U` = `UpdateItem`

| Función | Projects | Donations | Idempotency | Audit |
|---|---|---|---|---|
| ListProjects | R | | | |
| GetProject | R | | | |
| GetProjectStats | R | | | |
| CreateProject | P | | | P |
| PublishProject | U | | | P |
| CreateDonation | R | P, R | P, R | P |
| SimulateDonation (solo etapa académica) | U | R, U | | P |
| GetMyDonations | | R (incluye índice `donorSub-createdAt-index`) | | P (solo denegaciones) |
| GetAuditEvents | | | | R (`Query`), P (solo denegaciones) |

## Cognito

Una sola acción, `cognito-idp:AdminListGroupsForUser`, sobre el pool de usuarios del stack, solo para `PublishProject`, `SimulateDonation` y `GetAuditEvents` (las acciones sensibles releen los grupos de la persona, porque un token conserva los de cuando se emitió). Ninguna otra función tiene permisos de `cognito-idp`. Lo verifica `backend/test/infra/roleRevalidation.test.ts` y, con IAM activo, `backend/test/floci/roleRevalidation.test.ts`.

## Reglas verificadas por prueba

1. Ninguna sentencia incluye `Delete*`, `BatchWrite*`, `Scan` ni `dynamodb:*`.
2. En la tabla Audit solo aparece `PutItem` (escritura) y `Query` únicamente en `GetAuditEvents`.
3. Cada función tiene su propio rol; no se comparten políticas entre funciones.
4. La función `SimulateDonation` no existe en la etapa `production` (condición actual del template).
5. Las tres funciones públicas no tienen acceso a Audit: sus acciones siempre se permiten y nunca se auditan (ver la regla de auditoría en [with-auth.md](with-auth.md)). `GetMyDonations` y `GetAuditEvents` solo escriben eventos de denegación.
6. La prueba se ejecuta para cada etapa (`academic` y `production`); `SimulateDonation` solo existe en `academic`.

## Evidencia T10

- **Estática (CI)**: la prueba de infraestructura recorre el template y falla ante cualquier acción fuera de esta matriz.
- **Dinámica (manual, AWS real)**: invocar una función con una operación fuera de su matriz y guardar el `AccessDeniedException` en `evidence/`.
