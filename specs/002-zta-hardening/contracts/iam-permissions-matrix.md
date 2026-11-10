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
| CloseProject | R (`GetItem`, creador del proyecto), U | | | P |
| CreateDonation | R | P, R | P, R, U (solo contadores de velocidad `velocity#`, impuesto por `dynamodb:LeadingKeys` con `ForAllValues:StringLike` `velocity#*`) | P |
| SimulateDonation (solo etapa académica) | U | R, U | | P |
| GetMyDonations | | R (incluye índice `donorSub-createdAt-index`) | | P (solo denegaciones) |
| GetAuditEvents | | | | R (`Query`), P (solo denegaciones) |
| ListReviews | | R (`Query` sobre el índice `status-createdAt-index`) | | P (solo denegaciones) |
| ReviewDonation | R (`GetItem`, creador del proyecto) | R (`GetItem`), U | | P |
| ListUsers | | | | P (solo denegaciones) |
| ChangeUserRole | | | | P (solo denegaciones; el cambio y su evento `ROLE_GRANTED`/`ROLE_REVOKED` se registran en `PutItem`) |
| ExpireReviews (job programado, sin ruta) | | R (`Query` sobre `status-createdAt-index`), U | | P (el evento `REVIEW_EXPIRED`) |
| AddDonorToGroup (disparador de Cognito, sin ruta) | | | | P (el evento `ROLE_ASSIGNED`) |

## Cognito

Una sola acción, `cognito-idp:AdminListGroupsForUser`, sobre el pool de usuarios del stack, solo para `PublishProject`, `CloseProject`, `SimulateDonation`, `GetAuditEvents`, `ReviewDonation`, `ListUsers` y `ChangeUserRole` (las acciones sensibles releen los grupos de la persona, porque un token conserva los de cuando se emitió). `AddDonorToGroup` tiene una sola, `cognito-idp:AdminAddUserToGroup`, sobre el mismo pool, en una política `AWS::IAM::Policy` aparte (el pool la nombra como disparador, así que una política en línea que nombrara al pool formaría un ciclo). Las dos funciones de administración añaden, sobre el mismo pool y nada más: `ListUsers` (`cognito-idp:ListUsers`) y `ChangeUserRole` (`AdminGetUser`, `AdminAddUserToGroup`, `AdminRemoveUserFromGroup`); ninguna puede crear, borrar, deshabilitar ni autenticar usuarios, ni tocar las demás tablas. Cognito no permite limitar esas acciones por grupo en IAM, así que qué roles pueden asignarse lo impone el código (`test/admin/changeUserRole.test.ts`). Ninguna otra función tiene permisos de `cognito-idp`. Lo verifica `backend/test/infra/identityTrigger.test.ts`. Lo verifica `backend/test/infra/roleRevalidation.test.ts` y, con IAM activo, `backend/test/floci/roleRevalidation.test.ts`.

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
