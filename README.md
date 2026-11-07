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

# Emulador de AWS (Floci) con IAM activo: políticas IAM reales del template, Cognito con MFA y despliegue del stack
docker compose -f backend/test/floci/docker-compose.yml up -d
npm run test:floci
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
Copie las salidas de SAM (`ApiEndpoint`, `UserPoolId`, `UserPoolClientId`) a `frontend/.env`:
```env
VITE_API_BASE_URL=https://<apiId>.execute-api.us-east-1.amazonaws.com/academic/v1
VITE_COGNITO_AUTHORITY=https://cognito-idp.us-east-1.amazonaws.com/<userPoolId>
VITE_COGNITO_CLIENT_ID=<userPoolClientId>
```

Compile los activos estáticos y súbalos al bucket privado de S3:
```bash
cd ../frontend
npm run build
aws s3 sync dist/ s3://<FrontendBucketName>/ --delete
```

---

## 5. Procedimiento de Limpieza Total (Teardown)

Para garantizar cero costos al concluir la evaluación o el ciclo académico, ejecute:

```powershell
# Vacía los buckets del frontend y de CloudTrail y elimina el stack (un bucket con objetos bloquea `sam delete`)
./scripts/cleanup.ps1 -Stage academic

# Después, verificar en AWS Resource Explorer que no existan recursos huérfanos
```

Si activó GuardDuty o Security Hub, se eliminan junto con el stack.
