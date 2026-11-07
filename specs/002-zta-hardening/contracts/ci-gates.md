# Contrato: compuertas de la integración continua

Todas deben pasar antes de cualquier despliegue (FR-022 a FR-024).

| Trabajo | Qué ejecuta | Falla si |
|---|---|---|
| `lint-format` | ESLint (`complexity` ≤ 10, `max-lines-per-function` ≤ 50, `no-explicit-any`), Prettier `--check` | Una regla se incumple sin comentario de justificación |
| `typecheck` | `tsc --noEmit` en backend y frontend | Hay errores de tipos |
| `unit` | Vitest, pruebas sin base de datos | Una prueba falla |
| `integration` | Vitest contra DynamoDB Local (servicio de contenedor): matriz rol × acción, BOLA, idempotencia, validación, estados, confirmación de donación | Una prueba falla, incluida una expresión de base de datos inválida |
| `infra-tests` | Aserciones sobre `template.yaml`: MFA `REQUIRED`, matriz IAM, sin `Delete*`, Audit solo `PutItem`, CORS sin `*`, retención 14 días, throttling por ruta, rutas protegidas con `AuthorizationScopes`, cobertura `withAuth` | Cualquier aserción falla |
| `iac-scan` | `cfn-lint` y `checkov` sobre `infra/template.yaml` | Hallazgo no omitido con justificación escrita en el repositorio |
| `deploy` | `sam build` + `sam deploy` con credenciales OIDC temporales | `needs` de todos los anteriores no se cumple, no es la rama principal o falta `AWS_DEPLOY_ROLE_ARN` |

## Reglas

- Sin llaves de AWS de larga duración en secretos del repositorio (constitución III).
- Las omisiones de `checkov` viven en un archivo versionado con el motivo de cada una.
- Presupuesto de tiempo: el flujo completo, sin despliegue, en menos de 10 minutos (SC-012).
