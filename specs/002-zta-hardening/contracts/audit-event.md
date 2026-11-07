# Contrato: evento de auditoría

Esquema en [data-model.md](../data-model.md). Este contrato fija el comportamiento.

## Escritura

- Único punto: `recordAuditEvent(params)`, invocado solo por `withAuth`.
- Entrada: `eventType`, `requestId`, `actorSub?`, `resourceRef`, `action`, `outcome`, `reason?`.
- El `actorSub` nunca se persiste: se transforma en `actorRef` dentro de la función.
- Inserción con `attribute_not_exists`; un conflicto se registra como error y no se reintenta.

## Lectura (`GET /v1/audit`)

- Solo grupo AUDITOR, scope `api/audit.read`, acción sensible.
- Devuelve eventos de éxito y denegados, más recientes primero. Respuesta y errores sin cambios respecto de `docs/api.yaml`.

## Garantías verificables

| Garantía | Cómo se prueba |
|---|---|
| Denegados quedan registrados | Integración: llamada con rol incorrecto → un evento `DENIED` |
| Actor siempre pseudonimizado | Integración: ningún `sub` aparece en ningún atributo |
| Ninguna función edita ni borra | Aserción sobre el template: solo `dynamodb:PutItem` sobre la tabla Audit; política de recursos con `Deny` de `UpdateItem`, `DeleteItem`, `BatchWriteItem` |
| El fallo de escritura no se oculta | Unitaria: forzar error de escritura → log de error y respuesta intacta |
