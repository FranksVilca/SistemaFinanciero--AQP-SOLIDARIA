# Arquitectura Zero Trust: actual, mejorada e ideal

Este documento compara tres versiones de la arquitectura de AQP-SOLIDARIA para ver qué cambia entre ellas y por qué.

| Versión | Qué representa | Diagrama |
|---|---|---|
| **Actual** | Lo que hay hoy en el repositorio y en `infra/template.yaml` | [zta-architecture.png](diagrams/zta-architecture.png) |
| **Mejorada** | La actual con correcciones realistas, sin cambiar de plataforma | [zta-architecture-target.png](diagrams/zta-architecture-target.png) |
| **Ideal** | Diseño desde cero para un producto real, sin límites del Free plan ni de tiempo | -- |

Los diagramas se generan con D2 (ver el pie de cada archivo `.d2`).

> **Para lo que está implementado hoy** (incluida la revisión de donaciones, los controles de velocidad y la administración de roles, que ninguno de estos diagramas muestra) ver [arquitectura-actual.md](arquitectura-actual.md) y su diagrama [zta-architecture-current.png](diagrams/zta-architecture-current.png). Este documento y sus diagramas conservan la comparación entre versiones.

> **Estado al 2026-11-08:** la versión **Mejorada** ya está implementada en el código y en `infra/template.yaml` (feature `specs/002-zta-hardening/`). Las columnas "Actual" de este documento describen el estado **anterior** a esa feature. Lo que sigue **pendiente de comprobar en una cuenta de AWS real** está en `evidence/test-run-report.md`, sección 3.
>
> Diferencias entre el diagrama mejorado y lo implementado: PITR es un parámetro (siempre activo en `production`), la protección contra borrado solo se activa en `production`, GuardDuty y Security Hub se añadieron como parámetros opcionales con prueba de 30 días (no figuran en el diagrama), y Verified Permissions sigue en la fase 2.

## 1. Lo que no cambia en ninguna versión

- Cognito como administrador de identidad (PA), con Authorization Code + PKCE.
- API Gateway con authorizer JWT y scopes por ruta como punto de aplicación (PEP).
- Una función Lambda por endpoint, cada una con su propio rol IAM.
- Proyectos y donaciones en el mismo núcleo, porque confirmar una donación actualiza el proyecto en una transacción atómica.
- La SPA en memoria del navegador, servida por CloudFront + S3 privado.

## 2. Comparación pieza por pieza

| Tema | Actual | Mejorada | Ideal |
|---|---|---|---|
| **MFA** | `OPTIONAL` en el template, aunque se declara obligatorio para gestor y auditor | Obligatorio para gestor y auditor | Passkeys (WebAuthn) o MFA obligatorio |
| **Motor de políticas (PE)** | Código embebido en cada función; `enforceAuthz()` se llama a mano | `withAuth()` obligatorio, con una prueba que falla si una ruta no lo usa | Verified Permissions (Cedar), central y versionado |
| **Verified Permissions** | Código y archivos Cedar existentes, pero sin conectar | Fase 2 | Conectado |
| **API Gateway** | JWT + scopes, CORS `*`, sin límite de peticiones | Además throttling por ruta y CORS al dominio propio | Igual, más WAF delante |
| **Roles IAM** | `DynamoDBCrudPolicy` (incluye borrar) en varias funciones | Solo las acciones necesarias | Igual que la mejorada |
| **Auditoría** | Misma cuenta y mismos roles; solo registra éxitos; `actorRef` con el `sub` en crudo al crear y publicar | Tabla aparte, solo `PutItem`, actor pseudonimizado, registra denegados | Otra cuenta de AWS (Organizations): el núcleo no puede alterarla |
| **Telemetría** | Logs sin retención ni CloudTrail en el template | CloudWatch con retención de 14 días y CloudTrail en el IaC | CloudTrail de la organización, GuardDuty y Security Hub |
| **Datos de negocio** | 4 tablas DynamoDB | Con PITR y protección contra borrado | Igual, y exportación a S3 + Athena para reportes y conciliación |
| **Pagos** | Simulados dentro del núcleo | Igual | Servicio aparte que habla con un procesador externo con webhooks firmados |
| **Notificaciones** | No hay | No hay | Cola SQS y función aparte, asíncronas |
| **Pruebas y CI** | 37 pruebas con DynamoDB simulado | Pruebas de integración contra DynamoDB emulado, `cfn-lint` y `checkov` | Igual, el despliegue depende de que pasen |
| **Revocación de sesión** | Un token robado vale 15 minutos | Acciones sensibles revalidan la sesión en Cognito | Igual |
| **Cuentas AWS** | Una sola | Una sola | Varias (producción, auditoría, logging) |

## 3. Fallos de la arquitectura actual que las otras versiones corrigen

Se descubrieron probando el código contra DynamoDB emulado (Floci):

1. **Confirmar una donación devuelve 500.** La expresión de actualización de [simulateDonation.ts:121](../backend/src/donations/simulateDonation.ts#L121) es inválida (`ADD ... , updatedAt = :now`). Los tests unitarios no lo detectaron porque simulan DynamoDB.
2. **MFA opcional** frente a lo declarado como obligatorio.
3. **`actorRef` sin pseudonimizar** en crear y publicar proyecto, aunque el modelo de datos pide un seudónimo.
4. **Cedar sin conectar:** [AI_USAGE.md](../AI_USAGE.md) declara un adaptador para Verified Permissions, pero ningún handler lo usa y el template no crea el almacén de políticas.
5. **Telemetría ausente del IaC:** el template no define retención de logs ni CloudTrail.

## 4. Qué cuesta cada versión

| Versión | Esfuerzo | Dependencias nuevas |
|---|---|---|
| **Mejorada** | Cambios en el template, en el código de `authz` y en el CI | Ninguna |
| **Ideal** | Rediseño: servicio de pagos, eventos, varias cuentas, WAF y GuardDuty | Procesador de pagos externo, AWS Organizations, servicios fuera del Free plan |

La mejorada es el siguiente paso razonable. La ideal sirve como referencia de hacia dónde crecería el sistema con dinero real.

## 5. Limitaciones de esta comparación

- Los diagramas **Mejorada** e **Ideal** describen lo que debería existir. Nada de lo marcado como nuevo o cambiado está implementado.
- Las pruebas contra DynamoDB se hicieron con el emulador Floci. No se probó el JWT authorizer real de API Gateway ni Cognito en AWS.
- Todo lo que se dice del estado actual sale del código y del template del repositorio al momento de escribir este documento.
