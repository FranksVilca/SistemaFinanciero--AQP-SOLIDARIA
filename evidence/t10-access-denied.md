# T10 — AccessDenied por permisos IAM insuficientes

**Estado: evidencia en emulador completa; confirmación en AWS real pendiente (opcional).**

## 1. Evidencia ejecutada (Floci con IAM activo)

`backend/test/floci/iamEnforcement.test.ts` crea en Floci un usuario IAM por función, con **exactamente la política en línea que `infra/template.yaml` da a su rol** (las ARN se resuelven desde el propio template), y ejecuta dos cosas:

1. **Cada handler real funciona con su rol mínimo** (8 pruebas): listar, ver, estadísticas, crear y publicar proyecto, crear y confirmar donación (transacciones incluidas), historial propio y auditoría, con sus escrituras de auditoría.
2. **Todo lo que queda fuera del contrato recibe `AccessDeniedException`** (36 casos: 9 funciones × 4 tablas). Para cada función y tabla se intentan `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem` y `Scan`: borrar, escribir por lotes y escanear se deniegan siempre; `PutItem` y `UpdateItem` solo se permiten donde el contrato lo dice (`specs/002-zta-hardening/contracts/iam-permissions-matrix.md`).

```bash
docker compose -f backend/test/floci/docker-compose.yml up -d   # Floci 2.4.0 con FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true
npm run test:floci
```

Resultado del 2026-11-08: **44 de 44 pruebas pasan** en esta suite (72 con las de Cognito, API Gateway y despliegue).

### Por qué el emulador prueba algo y no es un simulacro

Floci aplica IAM solo si se activa la opción `FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED`. Antes de escribir la suite se comprobó a mano:

| Con IAM | `GetItem` del usuario de solo lectura | `PutItem` | `DeleteItem` |
|---|---|---|---|
| Desactivado (por defecto) | permitido | **permitido** (no prueba nada) | permitido |
| Activado | permitido | `AccessDeniedException` | `AccessDeniedException` |

### La suite detectó un error real del template

La política de `ListProjects` y `GetMyDonations` daba solo el ARN del índice secundario, y ambas funciones respondían 500 con `AccessDeniedException` en `Query`. La referencia de autorización de DynamoDB (Service Authorization Reference) indica que `Query` exige el ARN de la **tabla** (recurso obligatorio) y admite el del índice. Se corrigió añadiendo ambos ARN al template.

### La suite falla cuando debe

| Cambio introducido a propósito | Resultado |
|---|---|
| `GetProjectFunction` recibe `dynamodb:DeleteItem` | Falla: el caso `getProject.handler` sobre la tabla de proyectos deja de recibir `AccessDenied` |
| `CreateProjectFunction` pierde el permiso sobre la tabla de auditoría | Falla: el handler no puede escribir su evento y el caso de la tabla de auditoría cambia |

## 2. Lo que el emulador no demuestra

- Floci no materializa las políticas en línea de los roles que crea el stack (el rol existe con solo `AWSLambdaBasicExecutionRole`), por eso las pruebas usan usuarios IAM con la política del template en lugar de roles asumidos por Lambda.
- Floci no ejecuta las Lambdas (no alcanza Docker desde su contenedor): los handlers se ejecutan en el proceso de prueba con las credenciales de cada función.
- No prueba la política de recursos de la tabla de auditoría (se verifica en `backend/test/infra/auditTable.test.ts`).

## 3. Confirmación en AWS real (pendiente, opcional)

Cuando haya una cuenta, basta repetir una comprobación para confirmar que el comportamiento coincide con el emulador.

1. Desplegar la etapa académica (ver `docs/free-plan-guide.md`).
2. Simular la política del rol de una función con el simulador de IAM:
   ```bash
   aws iam simulate-principal-policy \
     --policy-source-arn <ARN del rol de ListProjectsFunction> \
     --action-names dynamodb:PutItem dynamodb:DeleteItem \
     --resource-arns <ARN de la tabla Projects>
   ```
   Esperado: `EvalDecision: implicitDeny` en ambas.
3. Repetir con la tabla de auditoría y el rol de `CreateDonationFunction` para `dynamodb:UpdateItem` y `dynamodb:DeleteItem` (denegado por IAM y por la política de recursos).
4. Confirmar que `ListProjectsFunction` responde 200 (comprueba que `Query` con ambos ARN funciona).

| Fecha | Función / rol | Acción | Resultado | Ejecutado por |
|---|---|---|---|---|
| _pendiente_ | | | | |
