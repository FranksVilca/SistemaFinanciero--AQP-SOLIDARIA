# Seguimiento: áreas que aún no cumplen el principio VII

La constitución (gobernanza) permite incorporar el código anterior al principio VII de forma gradual: todo archivo que se toque debe quedar conforme en la parte que se modifica, y las áreas grandes se registran aquí.

## Frontend (`frontend/`)

El frontend no se modificó en esta feature. ESLint reporta sus incumplimientos como **advertencias** (no bloquean el CI) y Prettier lo excluye hasta que cada archivo se toque (`.prettierignore`).

Estado al 2026-11-08: 16 advertencias en 9 archivos.

| Archivo | Advertencias |
|---|---|
| `frontend/src/pages/ManagerDashboardPage.tsx` | `any` (2), tamaño de función (1) |
| `frontend/src/components/DonationModal.tsx` | tamaño de función (1), `any` (1) |
| `frontend/src/components/SimulationControls.tsx` | `any` (1), tamaño de función (1) |
| `frontend/src/pages/AuditorPage.tsx` | tamaño de función (1), complejidad (1) |
| `frontend/src/pages/DonorHistoryPage.tsx` | tamaño de función (1), complejidad (1) |
| `frontend/src/services/apiClient.ts` | `any` (2) |
| `frontend/src/components/Navbar.tsx` | tamaño de función (1) |
| `frontend/src/pages/CatalogPage.tsx` | complejidad (1) |
| `frontend/src/pages/ProjectDetailPage.tsx` | tamaño de función (1) |

Cuando el frontend esté conforme: cambiar esas reglas a `error` en `eslint.config.js` y quitar `frontend/` de `.prettierignore`.

## Cambios de contrato que el frontend debe revisar

- `GET /v1/audit` ya no usa `PROJECT_LIFECYCLE` como tipo por defecto: devuelve éxitos y denegaciones de los últimos 7 días y `eventType` es un filtro opcional. Los eventos añaden `eventType` y, en las denegaciones, `reason`.
- Todos los usuarios, donantes incluidos, deben enrolar un autenticador TOTP en el primer inicio de sesión (Cognito aplica el MFA por pool, no por grupo).
- La respuesta 401 por sesión revocada en acciones sensibles (publicar, ver auditoría, confirmar una donación) indica que hay que iniciar sesión de nuevo.

## Otros

- Los documentos (`*.md`), los `tsconfig*.json` y `.github/` se excluyen de Prettier para conservar su formato.
