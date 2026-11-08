# Plataforma de Donaciones Seguras (2026) — Fundación AQP-SOLIDARIA

[![CI Pipeline](https://github.com/fundacion-aqp-solidaria/secure-donations-2026/actions/workflows/ci.yml/badge.svg)](https://github.com/fundacion-aqp-solidaria/secure-donations-2026/actions/workflows/ci.yml)

Sistema cloud-native serverless de publicación de causas sociales y registro de intenciones de donación simuladas bajo el modelo de seguridad **Zero Trust (NIST SP 800-207)**, diseñado para operar estrictamente dentro de los límites del **AWS Free Plan**.

> ⚠️ **Aviso de Simulación Académica**: Este sistema es un prototipo pedagógico. No procesa dinero real ni almacena números de tarjeta, CVV o claves bancarias. Todas las operaciones financieras son intenciones simuladas en céntimos enteros de Soles (PEN).

---

## 1. Arquitectura y Modelo de Seguridad Zero Trust

- **Policy Enforcement Point (PEP)**: API Gateway HTTP API con JWT Authorizer nativo y validación de scopes OAuth + CloudFront con Content Security Policy (CSP) restrictiva.
- **Policy Decision Point (PDP)**: Cómputo en AWS Lambda (Node.js 24) con roles IAM de mínimo privilegio por función; módulo `authz` embebido (RBAC + validación de ownership), siempre invocado a través de `withAuth()`: una prueba falla si una ruta del template no lo usa. Amazon Verified Permissions con Cedar es la **fase 2** y hoy no está conectado (ver `policies/README.md`).
- **Policy Administrator (PA)**: Amazon Cognito User Pool con Authorization Code Grant + PKCE, tokens de vida corta ($\le 15$ min) guardados en memoria y MFA TOTP obligatorio para todo el pool (Cognito no lo aplica por grupo, así que también los donantes enrolan un autenticador una vez). Las acciones sensibles (publicar, ver auditoría, confirmar una donación) revalidan la sesión contra Cognito.
- **Integridad e Idempotencia**: Amazon DynamoDB (On-Demand) con `TransactWriteItems` para reserva de clave de idempotencia (UUID) y control estricto de concurrencia (T08: 10 peticiones paralelas $\to$ 1 éxito, 9 conflictos).

---

## 2. Estructura del Repositorio

```text
secure-donations-2026/
├── frontend/                  # SPA React 19 + Vite + Tailwind CSS (tokens en memoria)
│   ├── src/auth/              # oidc-client-ts y AuthContext
│   ├── src/components/        # Componentes accesibles (ProjectCard, DonationModal)
│   ├── src/pages/             # Catálogo, Detalle, Historial, Gestor, Auditor
│   └── src/services/          # Cliente API con TanStack Query
├── backend/                   # AWS Lambda Handlers en Node.js 24 + TypeScript
│   ├── src/projects/          # Listar, Detalle, Crear, Publicar, Estadísticas
│   ├── src/donations/         # Intención, Simulación condicional, Historial propio
│   ├── src/authz/             # withAuth() obligatorio, evaluador RBAC + ownership, revalidación de sesión
│   ├── src/audit/             # Escritura única y pseudonimizada de eventos y consulta
│   └── test/                  # unit (sin base de datos), integration (DynamoDB Local) e infra (template)
├── infra/                     # Único template SAM (HTTP API, Cognito, DynamoDB, CloudFront, logs, CloudTrail)
├── scripts/                   # cleanup.ps1: vacía los buckets y elimina el stack
├── policies/                  # Documentación de la fase 2 (Cedar); no se aplica
├── docs/                      # OpenAPI (api.yaml), Threat Model, guía del plan gratuito, hallazgos Zero Trust
└── specs/                     # Especificaciones ejecutables con Spec-Kit
```

---

## 3. Prerrequisitos y Configuración Local

> **Ver el frontend sin AWS:** `npm run local` y abrir http://localhost:3000 (usuarios de ejemplo y pruebas de
> navegador en [docs/ver-el-frontend.md](docs/ver-el-frontend.md)).

- **Node.js**: v24.x (`node -v`)
- **npm**: v11.x
- **AWS CLI**: v2 configurado con usuario IAM (no root) con MFA
- **AWS SAM CLI**: v1.115+

### Instalación de Dependencias
```bash
# Instala dependencias en el workspace raíz, backend y frontend
npm install
```

### Ejecución de Pruebas y Validación de Calidad
```bash
# Validar tipado TypeScript en todo el monorepo
npm run typecheck

# Validar estilo y linting con ESLint
npm run lint

# Pruebas unitarias (sin base de datos)
npm run test

# Pruebas de integración contra DynamoDB Local (requiere Docker)
docker compose -f backend/test/integration/docker-compose.yml up -d
npm run test:integration

# Pruebas sobre infra/template.yaml, en las etapas academic y production
npm run test:infra

# Emulador de AWS (Floci) con IAM y TLS activos: políticas IAM reales del template, Cognito con MFA,
# autorizador JWT de API Gateway, revocación y despliegue del stack
docker compose -f backend/test/floci/docker-compose.yml up -d
npm run test:floci

# Extremo a extremo con las Lambdas reales en contenedores (monta el socket de Docker: solo en una máquina tuya)
docker compose -f backend/test/floci/docker-compose.lambda.yml up -d
npm run test:floci:e2e

# El SPA en un navegador real (Edge o Chrome) contra todo el sistema en Floci; antes ejecute `npm run local:stop` si tiene `npm run local` corriendo
npm run test:browser
```

El mapeo de cada principio de NIST SP 800-207 a su evidencia está en [docs/nist-800-207-mapping.md](docs/nist-800-207-mapping.md).

El CI ejecuta además `cfn-lint`, `checkov` y `npm run format:check`; el despliegue solo ocurre si todo pasa.

---

## 4. Despliegue en AWS Free Plan

El despliegue está configurado para la región `us-east-1` utilizando exclusivamente servicios cubiertos por la capa gratuita de AWS.

### Paso 1: Configurar AWS Budgets
Antes del primer despliegue, active una alerta en AWS Budgets con límite de USD 1.00 para evitar consumos no planificados.

### Paso 2: Construir y Desplegar Backend con SAM
```bash
npm run build --workspace=backend   # compila a backend/dist y genera su package.json (ESM + dependencias)
sam build --template-file infra/template.yaml
sam deploy --guided \
  --stack-name aqp-solidaria-academic \
  --parameter-overrides StageName=academic \
  --capabilities CAPABILITY_IAM
```

Los parámetros opcionales (GuardDuty y Security Hub con prueba de 30 días, PITR, CloudTrail) y lo que queda fuera del plan gratuito están en [docs/free-plan-guide.md](docs/free-plan-guide.md).

### Paso 3: Construir y Publicar Frontend

Un solo comando toma del stack ya desplegado la dirección del API y los identificadores de Cognito, compila el
frontend con ellos, lo sube al bucket privado con las cabeceras de caché adecuadas e invalida CloudFront:

```bash
bash infra/scripts/publish-frontend.sh --dry-run   # compila y lista lo que subiría, sin cambiar nada
bash infra/scripts/publish-frontend.sh             # publica
```

Necesita el AWS CLI y credenciales de la cuenta del stack (`AWS_PROFILE`). Si el stack se desplegó con una versión
anterior de la plantilla, redespliéguelo antes: el script lee el bucket y la distribución de las salidas
`FrontendBucketName` y `CloudFrontDistributionId`.

---

### Despliegue automático desde GitHub (opcional)

El primer despliegue se hace a mano (arriba). Después, cada cambio en `main` puede desplegarse solo, **si** las pruebas
pasan y la cuenta de AWS tiene la identidad del CI. Esa identidad no usa claves guardadas: GitHub asume un rol por OIDC.

**1. Una sola vez por cuenta, una persona administradora crea esa identidad** (plantilla aparte, `infra/bootstrap/github-oidc.yaml`):

```bash
aws cloudformation deploy --template-file infra/bootstrap/github-oidc.yaml \
  --stack-name aqp-solidaria-github-oidc --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides GitHubRepository=<propietario>/<repositorio>
aws cloudformation describe-stacks --stack-name aqp-solidaria-github-oidc --query "Stacks[0].Outputs" --output table
```

Si la cuenta ya tiene el proveedor `token.actions.githubusercontent.com`, agregue `CreateOidcProvider=false`. Escriba el
repositorio con las mismas mayúsculas que en GitHub: la comparación distingue mayúsculas.

**2. Tres variables del repositorio** (Settings, Secrets and variables, Actions, pestaña Variables; no son secretos):

| Variable | Valor |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | Salida `GitHubDeployRoleArn` del paso anterior |
| `AWS_CLOUDFORMATION_ROLE_ARN` | Salida `CloudFormationExecutionRoleArn` |
| `COGNITO_DOMAIN_PREFIX` | El prefijo de Cognito de **su** despliegue (el de `sam deploy --guided`) |

Sin las tres, el trabajo de despliegue se omite y el resto del pipeline corre igual. El prefijo es obligatorio porque es
único en todo AWS: con el valor por defecto el pipeline reemplazaría el dominio de Cognito de un stack ya desplegado y
rompería el inicio de sesión. Tras desplegar, el mismo trabajo publica el frontend con el script del paso 3.

**Cómo está acotado.** GitHub solo puede asumir el rol desde la rama `main` de este repositorio, y ese rol solo puede
manejar el stack con conjuntos de cambios, subir los artefactos y publicar el frontend; no crea nada por sí mismo. Los
permisos para crear los recursos los tiene un segundo rol que únicamente CloudFormation puede usar, limitado a los
nombres de la aplicación (`aqp-solidaria-academic-*`), que no incluyen a los dos roles del CI.

**Lo que debe saber.**

- Quien pueda subir a `main` controla lo que CloudFormation crea en ese espacio de nombres, incluidos roles de función
  con cualquier permiso. Proteja `main` en GitHub con revisión obligatoria de pull requests.
- GuardDuty y Security Hub no están cubiertos: si se activan con sus parámetros, el despliegue falla con `AccessDenied`
  hasta que se agreguen sus permisos en la plantilla de arranque. La etapa `production` no se despliega desde el CI.
- La lista de permisos sale de los esquemas oficiales de cada tipo de recurso y no se ha podido ejecutar en una cuenta
  real. Si el primer despliegue del CI falla con `AccessDenied`, el mensaje nombra la acción: se agrega al rol de
  ejecución y se vuelve a desplegar la plantilla de arranque.

## 5. Procedimiento de Limpieza Total (Teardown)

Para garantizar cero costos al concluir la evaluación o el ciclo académico, ejecute:

```powershell
# Vacía los buckets del frontend y de CloudTrail y elimina el stack (un bucket con objetos bloquea `sam delete`)
./scripts/cleanup.ps1 -Stage academic

# Después, verificar en AWS Resource Explorer que no existan recursos huérfanos
```

Si activó GuardDuty o Security Hub, se eliminan junto con el stack.
