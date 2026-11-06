# Plataforma de Donaciones Seguras (2026) — Fundación AQP-SOLIDARIA

[![CI Pipeline](https://github.com/fundacion-aqp-solidaria/secure-donations-2026/actions/workflows/ci.yml/badge.svg)](https://github.com/fundacion-aqp-solidaria/secure-donations-2026/actions/workflows/ci.yml)

Sistema cloud-native serverless de publicación de causas sociales y registro de intenciones de donación simuladas bajo el modelo de seguridad **Zero Trust (NIST SP 800-207)**, diseñado para operar estrictamente dentro de los límites del **AWS Free Plan**.

> ⚠️ **Aviso de Simulación Académica**: Este sistema es un prototipo pedagógico. No procesa dinero real ni almacena números de tarjeta, CVV o claves bancarias. Todas las operaciones financieras son intenciones simuladas en céntimos enteros de Soles (PEN).

---

## 1. Arquitectura y Modelo de Seguridad Zero Trust

- **Policy Enforcement Point (PEP)**: API Gateway HTTP API con JWT Authorizer nativo y validación de scopes OAuth + CloudFront con Content Security Policy (CSP) restrictiva.
- **Policy Decision Point (PDP)**: Cómputo en AWS Lambda (Node.js 24) con roles IAM de mínimo privilegio por función; módulo `authz` embebido (RBAC + validación de ownership) y soporte para Amazon Verified Permissions con políticas Cedar (HU-12).
- **Policy Administrator (PA)**: dos Amazon Cognito User Pools con Authorization Code Grant + PKCE y tokens de vida corta ($\le 15$ min) guardados en memoria: un pool de donantes (`DONANTE`, MFA TOTP opcional) y un pool de staff (`GESTOR`, `AUDITOR`, MFA TOTP obligatorio, alta solo por administrador). Cada pool tiene su propio JWT Authorizer en API Gateway.
- **Integridad e Idempotencia**: Amazon DynamoDB (On-Demand) con `TransactWriteItems` para reserva de clave de idempotencia (UUID) y control estricto de concurrencia (T08: 10 peticiones paralelas $\to$ 1 éxito, 9 conflictos, verificado contra DynamoDB Local en `backend/test/integration/`).
- **Limitación conocida (T13, CA-03.4)**: el JWT Authorizer de API Gateway valida firma, emisor, audiencia y expiración, pero **no consulta la revocación** de Cognito. Un access token revocado (logout o `RevokeToken`) sigue siendo aceptado por el API hasta que expira; la exposición queda acotada a $\le 15$ minutos por `AccessTokenValidity`. La revocación sí invalida el refresh token, por lo que no se emiten tokens nuevos. El procedimiento de verificación tras el despliegue está en `docs/threat-model.md` (sección 4).

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
│   ├── src/authz/             # Evaluador RBAC + ownership, Cedar adapter
│   ├── src/audit/             # Auditoría inmutable y consulta
│   └── test/                  # Suite de pruebas unitarias, integración y aceptación T01-T14
├── infra/                     # AWS SAM Template (HTTP API, Cognito, DynamoDB, CloudFront)
├── policies/                  # Esquema y políticas Cedar para Amazon Verified Permissions
├── docs/                      # OpenAPI 3.1 (api.yaml) y Threat Model (threat-model.md)
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

# Ejecutar la suite unitaria (Vitest, DynamoDB simulado con mocks)
npm run test
```

### Pruebas de integración contra DynamoDB Local
Las pruebas de `backend/test/integration/` (T08 concurrencia, T06/T07 idempotencia, T09 propiedad) ejecutan los handlers reales contra DynamoDB Local, con tablas creadas a partir de los esquemas de clave de `infra/template.yaml`. Requieren Docker. Sin `DYNAMODB_ENDPOINT` se omiten con un mensaje explícito.
```bash
# Levantar DynamoDB Local (docker run --rm -d --name aqp-dynamodb-local -p 8000:8000 amazon/dynamodb-local)
npm run dynamodb:local

# Ejecutar las pruebas de integración
DYNAMODB_ENDPOINT=http://localhost:8000 npm run test:integration

# Detener el contenedor
npm run dynamodb:local:stop
```
En CI, el job `validate` levanta `amazon/dynamodb-local` como contenedor de servicio y ejecuta el mismo comando.

---

## 4. Despliegue en AWS Free Plan

El despliegue está configurado para la región `us-east-1` utilizando exclusivamente servicios cubiertos por la capa gratuita de AWS.

### Paso 1: Configurar AWS Budgets
Antes del primer despliegue, active una alerta en AWS Budgets con límite de USD 1.00 para evitar consumos no planificados.

### Paso 2: Construir y Desplegar Backend con SAM
```bash
cd infra
sam build
sam deploy --guided \
  --stack-name aqp-solidaria-academic \
  --parameter-overrides StageName=academic \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM
```

### Paso 3: Construir y Publicar Frontend
Copie las salidas de SAM (`ApiEndpoint`, `UserPoolId`, `UserPoolClientId`, `StaffUserPoolId`, `StaffUserPoolClientId`, `HostedUiDomain`, `StaffHostedUiDomain`) a `frontend/.env`:
```env
VITE_API_BASE_URL=https://<apiId>.execute-api.us-east-1.amazonaws.com/academic/v1
VITE_COGNITO_AUTHORITY=https://cognito-idp.us-east-1.amazonaws.com/<userPoolId>
VITE_COGNITO_CLIENT_ID=<userPoolClientId>
VITE_COGNITO_DOMAIN=<HostedUiDomain>
VITE_STAFF_COGNITO_AUTHORITY=https://cognito-idp.us-east-1.amazonaws.com/<staffUserPoolId>
VITE_STAFF_COGNITO_CLIENT_ID=<staffUserPoolClientId>
VITE_STAFF_COGNITO_DOMAIN=<StaffHostedUiDomain>
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

```bash
# 1. Vaciar el bucket S3 del frontend
aws s3 rm s3://<FrontendBucketName>/ --recursive

# 2. Eliminar toda la pila serverless con SAM
sam delete --stack-name aqp-solidaria-academic --no-prompts

# 3. Verificar en AWS Resource Explorer que no existan recursos huérfanos
```
