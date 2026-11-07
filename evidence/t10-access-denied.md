# T10 — AccessDenied por permisos IAM insuficientes

**Estado: PENDIENTE.** Requiere una cuenta de AWS real; no puede probarse con DynamoDB Local ni con un emulador.

## Qué ya está comprobado sin AWS

La prueba `backend/test/infra/iamMatrix.test.ts` recorre `infra/template.yaml` en las etapas `academic` y `production` y falla si alguna función:

- recibe una acción que no figura en `specs/002-zta-hardening/contracts/iam-permissions-matrix.md`;
- incluye `Delete*`, `BatchWrite*`, `Scan`, `dynamodb:*` o un recurso `*`;
- da a la tabla Audit algo distinto de `PutItem` (más `Query` solo a `GetAuditEvents`);
- da acceso a Audit a las tres funciones públicas.

`backend/test/infra/auditTable.test.ts` comprueba además la política de recursos que niega `UpdateItem`, `DeleteItem` y `BatchWriteItem` sobre Audit a los roles de las funciones.

## Qué falta probar en AWS real

Un permiso declarado en el template no prueba que IAM lo aplique. Hay que ver la denegación real.

### Procedimiento

1. Desplegar la etapa académica (ver `docs/free-plan-guide.md`).
2. Elegir una función de solo lectura, por ejemplo `ListProjectsFunction`.
3. Invocarla con una carga que fuerce una escritura fuera de su matriz. Opciones:
   - **Opción A (recomendada):** usar el simulador de políticas de IAM sobre el rol de la función:
     ```bash
     aws iam simulate-principal-policy \
       --policy-source-arn <ARN del rol de ListProjectsFunction> \
       --action-names dynamodb:PutItem dynamodb:DeleteItem \
       --resource-arns <ARN de la tabla Projects>
     ```
     Resultado esperado: `EvalDecision: implicitDeny` para ambas acciones.
   - **Opción B:** asumir temporalmente el rol de la función (`aws sts assume-role`) y ejecutar
     `aws dynamodb put-item --table-name aqp-projects-academic --item '{"projectId":{"S":"t10"}}'`.
     Resultado esperado: `AccessDeniedException`.
4. Repetir con la tabla Audit y el rol de `CreateDonationFunction` para `dynamodb:UpdateItem` y `dynamodb:DeleteItem`
   (denegado por la política de IAM y por la política de recursos de la tabla).
5. Pegar abajo la salida (sin identificadores de cuenta sensibles) y la fecha.

## Evidencia

| Fecha | Función / rol | Acción | Resultado | Ejecutado por |
|---|---|---|---|---|
| _pendiente_ | | | | |
