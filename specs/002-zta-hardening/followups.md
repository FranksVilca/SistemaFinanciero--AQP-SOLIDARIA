# Seguimiento: áreas que aún no cumplen el principio VII

La constitución (gobernanza) permite incorporar el código anterior al principio VII de forma gradual: todo archivo que se toque debe quedar conforme en la parte que se modifica, y las áreas grandes se registran aquí.

## Frontend (`frontend/`)

El frontend no se modificó en esta feature. ESLint reporta sus incumplimientos como **advertencias** (no bloquean el CI) y Prettier lo excluye hasta que cada archivo se toque (`.prettierignore`).

Estado al 2026-11-09: 16 advertencias en 8 archivos (`ProjectDetailPage.tsx`, `Navbar.tsx` y los archivos de autenticación quedaron conformes al tocarlos).

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

Cuando el frontend esté conforme: cambiar esas reglas a `error` en `eslint.config.js` y quitar `frontend/` de `.prettierignore`.

## Cambios de contrato que el frontend debe revisar

- `GET /v1/audit` ya no usa `PROJECT_LIFECYCLE` como tipo por defecto: devuelve éxitos y denegaciones de los últimos 7 días y `eventType` es un filtro opcional. Los eventos añaden `eventType` y, en las denegaciones, `reason`.
- Todos los usuarios, donantes incluidos, deben enrolar un autenticador TOTP en el primer inicio de sesión (Cognito aplica el MFA por pool, no por grupo).
- La respuesta 401 por sesión revocada en acciones sensibles (publicar, ver auditoría, confirmar una donación) indica que hay que iniciar sesión de nuevo.

## Otros

- Los documentos (`*.md`), los `tsconfig*.json` y `.github/` se excluyen de Prettier para conservar su formato.

## Decisiones abiertas

- **Usuario con más de un rol.** Los roles son grupos de Cognito y un usuario puede estar en varios; `authorize()` solo exige el rol de la acción. Un usuario AUDITOR y DONANTE podría donar y además consultar la auditoría de sus propias donaciones, lo que rompe la separación de funciones que se espera en una auditoría. No hay decisión escrita ni prueba con un usuario de dos roles (los de ejemplo tienen uno). Opciones: (1) denegar cuando AUDITOR coincide con DONANTE o GESTOR, con motivo propio en la auditoría; (2) permitirlo y documentarlo como riesgo aceptado; (3) permitirlo ocultando al auditor los eventos que él mismo generó. Recomendada: la 1. Tarea T100.
- **Revocación en acciones no sensibles.** Donar y ver el propio historial no revalidan la sesión: un token robado sigue sirviendo hasta 15 minutos para eso (la propiedad por recurso limita el daño a las donaciones de esa persona). Es el límite declarado del principio 3; ver `docs/nist-800-207-mapping.md`.
- **CI.** La etapa `browser` y `emulator-e2e` no bloquean el despliegue porque no se han visto pasar en un runner de GitHub (el alcance del emulador desde los contenedores de las funciones difiere de Docker Desktop, `FLOCI_LAMBDA_ENDPOINT`).
