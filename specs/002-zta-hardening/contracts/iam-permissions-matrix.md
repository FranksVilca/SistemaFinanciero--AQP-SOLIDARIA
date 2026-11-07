# Contrato: matriz de permisos IAM por función

Acciones de DynamoDB permitidas. Todo lo no listado está denegado. Sin comodines de acción ni de recurso; los índices secundarios se incluyen en el recurso de su tabla cuando se consultan.

`R` = `GetItem`, `Query` · `P` = `PutItem` · `U` = `UpdateItem`

| Función | Projects | Donations | Idempotency | Audit |
|---|---|---|---|---|
| ListProjects | R | | | |
| GetProject | R | | | |
| GetProjectStats | R | | | |
| CreateProject | P | | | P |
| PublishProject | R, U | | | P |
| CreateDonation | R | P, R | P, R | P |
| SimulateDonation (solo etapa académica) | U | R, U | | P |
| GetMyDonations | | R (incluye índice `donorSub-createdAt-index`) | | |
| GetAuditEvents | | | | R (`Query`) |

## Reglas verificadas por prueba

1. Ninguna sentencia incluye `Delete*`, `BatchWrite*`, `Scan` ni `dynamodb:*`.
2. En la tabla Audit solo aparece `PutItem` (escritura) y `Query`/`GetItem` únicamente en `GetAuditEvents`.
3. Cada función tiene su propio rol; no se comparten políticas entre funciones.
4. La función `SimulateDonation` no existe en la etapa `production` (condición actual del template).
5. Las funciones públicas no tienen acceso a Audit en absoluto: sus rutas no generan eventos de denegación, porque las acciones públicas siempre se permiten.

## Evidencia T10

- **Estática (CI)**: la prueba de infraestructura recorre el template y falla ante cualquier acción fuera de esta matriz.
- **Dinámica (manual, AWS real)**: invocar una función con una operación fuera de su matriz y guardar el `AccessDeniedException` en `evidence/`.
