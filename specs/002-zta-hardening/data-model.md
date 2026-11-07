# Data Model: cambios para el cumplimiento Zero Trust

Las tablas de negocio no cambian de forma. Cambian la tabla de auditoría (atributos y permisos) y se añaden constantes y un tipo de decisión.

## AuditEvent (tabla `Audit`, append-only)

| Atributo | Tipo | Regla |
|---|---|---|
| `auditDay` (PK) | string | Fecha UTC `YYYY-MM-DD` del evento. Reparte la escritura por día y permite listar de más reciente a más antiguo con un `Query` por día |
| `timestamp#eventId` (SK) | string | `ISO-8601#uuid`; único por evento |
| `eventType` | string | Atributo (no clave): `AUTHZ_DECISION`, `PROJECT_CREATED`, `PROJECT_PUBLISHED`, `DONATION_CREATED`, `DONATION_TRANSITIONED`. Sirve de filtro opcional |
| `eventId` | string (UUID) | Generado en el servidor |
| `timestamp` | string ISO-8601 | Instante de la decisión |
| `requestId` | string | Correlación con los logs |
| `actorRef` | string | **Siempre** `usr_` + SHA-256(sub) truncado a 12 hex; `anonymous` si no hubo identidad |
| `action` | string | Una de las acciones de autorización |
| `resourceRef` | string | Identificador del recurso afectado o `-` |
| `outcome` | `SUCCESS` \| `DENIED` \| `FAILED` | `DENIED` incluye `reason` |
| `reason` | string (opcional) | `UNAUTHENTICATED`, `ROLE`, `OWNER`, `STATE`, `SESSION_REVOKED` |

**Reglas**
- Solo se inserta (`PutItem` con `attribute_not_exists(auditDay)`); nunca `Update` ni `Delete`.
- Se audita: toda denegación de una acción protegida y todo éxito de una acción que cambia estado; nunca acciones públicas ni éxitos de lectura.
- Cambiar la clave reemplaza la tabla al desplegar; aceptable en la etapa académica (no hay datos de producción).
- Sin `sub`, correo, token ni monto en crudo (FR-015).
- Solo el rol AUDITOR los lee.

## AuthzDecision (en memoria, no se persiste)

| Campo | Descripción |
|---|---|
| `allowed` | booleano; por defecto `false` (falla cerrado) |
| `reason` | motivo de denegación para auditoría |
| `action`, `resourceType` | de la declaración de la ruta |
| `resourceOwnerSub` | obtenido por `loadResource` cuando aplica |

## Acciones de autorización (constantes)

`ListProjects`, `ViewProject`, `ViewProjectStats` (públicas), `CreateProject`, `PublishProject`, `CreateDonation`, `SimulateDonation`, **`ViewMyDonations`** (nueva, antes reutilizaba `CreateDonation`), `ViewAudit`.

Acciones sensibles (revalidan sesión): `PublishProject`, `ViewAudit`, `SimulateDonation` con acción `CONFIRMAR`.

## Donation y Project

Sin cambios de esquema. Transiciones válidas de Donation:
`PENDIENTE_SIMULACION → CONFIRMADA_SIMULADA` (suma `amountCents` a `Project.confirmedAmountCents` en la misma transacción) y `PENDIENTE_SIMULACION → RECHAZADA_SIMULADA`. Cualquier otra transición devuelve 409.

## Protección de datos (atributos de las tablas)

| Tabla | Protección contra borrado | PITR |
|---|---|---|
| Projects, Donations, Audit | solo `production` | parámetro `EnablePitr` (apagado por defecto; encendido en `production`) |
| Idempotency | no (TTL de 24 h) | no |
