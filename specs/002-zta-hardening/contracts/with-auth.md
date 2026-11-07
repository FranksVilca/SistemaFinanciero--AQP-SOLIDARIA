# Contrato: `withAuth()`

Única forma de exportar un handler del backend. Ningún handler llama a `enforceAuthz` ni escribe auditoría por su cuenta.

## Firma (conceptual)

```ts
withAuth<TResource>(
  handlerFn: (ctx: AuthedContext<TResource>) => Promise<ApiResponse>,
  options: {
    action: AuthzAction;              // obligatoria
    resourceType: ResourceType;       // obligatoria
    loadResource?: (event) => Promise<{ resource: TResource; ownerSub?: string }>;
    sensitive?: boolean;              // revalida la sesión antes de ejecutar
  }
): ApiGatewayHandler & { [WITH_AUTH]: true }
```

`AuthedContext` entrega: `event`, `principal` (ya verificado, ausente solo en acciones públicas), `requestId`, `resource` (si hubo `loadResource`).

## Orden de ejecución (fijo)

1. Generar `requestId` y registrar el inicio (sin PII).
2. Extraer `principal` de los claims verificados por la pasarela.
3. Si hay `loadResource`: cargarlo; si no existe → 404 (no se evalúa más).
4. Evaluar la política con rol, grupo, acción, propietario y estado. Cualquier excepción del motor → **denegar**.
5. Si `sensitive`: revalidar la sesión; fallo o timeout → 401, auditado como `SESSION_REVOKED`.
6. Ejecutar `handlerFn`.
7. Auditar el resultado (éxito o denegado) mediante `recordAuditEvent`.
8. Mapear errores tipados a HTTP; nunca devolver el stack.

## Resultados

| Situación | HTTP | Auditoría |
|---|---|---|
| Sin identidad en acción protegida | 401 | `DENIED / UNAUTHENTICATED` |
| Rol insuficiente | 403 | `DENIED / ROLE` |
| Recurso ajeno (BOLA) | 403 | `DENIED / OWNER` |
| Sesión revocada o no verificable (acción sensible) | 401 | `DENIED / SESSION_REVOKED` |
| Error del motor de política | 403 | `DENIED` |
| Éxito | el del handler | `SUCCESS` |
| Fallo al escribir la auditoría | no cambia la respuesta | error en logs |

## Prueba de cobertura (obligatoria en CI)

Para cada línea `Handler:` de `infra/template.yaml`, importar el módulo y comprobar que `handler[WITH_AUTH] === true`. Añadir una función al template sin `withAuth` debe romper la prueba.
