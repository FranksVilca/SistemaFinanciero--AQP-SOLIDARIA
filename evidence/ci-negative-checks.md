# Comprobaciones negativas de las compuertas del CI (T050)

Se introdujo a propósito cada fallo en el árbol de trabajo local, se ejecutó la compuerta correspondiente y se restauró el archivo. Fecha: 2026-11-08.

| # | Fallo introducido | Compuerta ejecutada | Resultado |
|---|---|---|---|
| a | `UpdateExpression` inválida en `simulateDonation.ts` (`ADD ... , updatedAt = :now`, el error de H1) | `integration` (`confirmDonation.test.ts`, DynamoDB Local) | **Falla**: 1 de 2 pruebas (la confirmación devuelve 500). |
| b | Sentencia `dynamodb:*` en una función (`GetProjectFunction`) | `infra-tests` (`iamMatrix.test.ts`) | **Falla**: 4 pruebas. |
| b | Misma sentencia | `cfn-lint` | No la detecta (sale 0). |
| b | Misma sentencia | `checkov` (`.checkov.yaml`) | No la detecta (38 verificaciones pasan). |
| c | Handler que no usa `withAuth` (`projects/unprotected.handler`) en el template | `infra-tests` (`withAuthCoverage.test.ts`) | **Falla**: 2 pruebas (etapas `academic` y `production`). |

## Conclusión

Las tres regresiones conocidas rompen el CI. El permiso excesivo (b) lo detecta únicamente la prueba de infraestructura propia (`iamMatrix.test.ts`); `cfn-lint` y `checkov` con la configuración actual no lo señalan, así que la prueba propia es la defensa real contra ese caso y no debe eliminarse.

## Estado tras la restauración

Los archivos modificados para el experimento se restauraron desde una copia y se volvieron a ejecutar todas las suites (ver el informe de cierre).
