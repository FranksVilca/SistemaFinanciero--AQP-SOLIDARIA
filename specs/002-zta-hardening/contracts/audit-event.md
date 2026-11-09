# Contrato: evento de auditoría

Esquema en [data-model.md](../data-model.md). Este contrato fija el comportamiento.

## Escritura

- Único punto: `recordAuditEvent(params)`, invocado por `withAuth`, por el disparador de Cognito y por `createDonation` para los eventos de velocidad (`DONATION_RATE_LIMITED`, `SUSPICIOUS_VELOCITY`).
- Entrada: `eventType`, `requestId`, `actorSub?`, `resourceRef`, `action`, `outcome`, `reason?`, `details?` (solo números, como el total horario y su umbral; nunca datos personales).
- El `actorSub` nunca se persiste: se transforma en `actorRef` dentro de la función.
- Inserción con `attribute_not_exists(auditDay)`; un conflicto se registra como error y no se reintenta.
- Cuándo se escribe: ver la regla de auditoría en [with-auth.md](with-auth.md) (denegaciones de rutas protegidas y éxitos de acciones que cambian estado).

## Lectura (`GET /v1/audit`)

- Solo grupo AUDITOR, scope `api/audit.read`, acción sensible.
- Consulta las particiones `auditDay` desde el día más reciente hacia atrás (máximo 7 días y 50 eventos en total), más recientes primero. `eventType` es un filtro opcional y `from`/`to` acotan el rango de días.
- Devuelve eventos de éxito y denegados. Forma de la respuesta y errores sin cambios respecto de `docs/api.yaml`.

## Garantías verificables

| Garantía | Cómo se prueba |
|---|---|
| Denegados quedan registrados | Integración: llamada con rol incorrecto → un evento `DENIED` |
| Actor siempre pseudonimizado | Integración: ningún `sub` aparece en ningún atributo |
| Ninguna función edita ni borra | Aserción sobre el template: solo `dynamodb:PutItem` sobre la tabla Audit; política de recursos con `Deny` de `UpdateItem`, `DeleteItem`, `BatchWriteItem` |
| El fallo de escritura no se oculta | Unitaria: forzar error de escritura → log de error y respuesta intacta |
