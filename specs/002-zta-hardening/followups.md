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

- **Usuario con más de un rol (resuelto, T100).** `AUDITOR` no se combina con ningún otro rol y quien creó un proyecto no puede donarle; ver `docs/operations-notes.md`, sección 3. Los proyectos creados antes del cambio no tienen `createdBy` y no quedan cubiertos.
- **Revocación en acciones no sensibles.** Donar y ver el propio historial no revalidan la sesión: un token robado sigue sirviendo hasta 15 minutos para eso (la propiedad por recurso limita el daño a las donaciones de esa persona). Es el límite declarado del principio 3; ver `docs/nist-800-207-mapping.md`.
- **CI.** La etapa `browser` y `emulator-e2e` no bloquean el despliegue porque no se han visto pasar en un runner de GitHub (el alcance del emulador desde los contenedores de las funciones difiere de Docker Desktop, `FLOCI_LAMBDA_ENDPOINT`).
- **Alta de roles (donante resuelto, T104).** Quien se registra recibe `DONANTE` automáticamente. `GESTOR` y `AUDITOR` los concede una persona administradora por la CLI o la consola de AWS; no hay pantalla para eso. Queda por decidir (T106) un flujo de solicitud de gestor y si habría un rol administrador dentro de la app: tendría que impedir que se conceda poder a sí mismo, no combinarse con `AUDITOR` y dejar cada concesión en la auditoría. **Actualización (2026-11-09):** el rol administrador ya existe (`ADMIN`): no cambia sus propios roles, no se combina con ningún otro y cada cambio queda auditado; `AUDITOR` y `ADMIN` se asignan con `npm run role`. Sigue **sin existir** el flujo para que una persona solicite el rol de gestor. Ver `docs/decisiones-y-comportamientos.md` (D2 a D4).
- **Postura del dispositivo (principio 5).** Medirla de verdad exige un agente o una gestión de dispositivos (Verified Access con un proveedor de confianza en dispositivos, Intune u otro) y la protección contra amenazas de Cognito, que es del plan Plus; ninguno entra en el plan gratuito. Lo que un navegador dice de sí mismo (agente de usuario, versión) lo controla el atacante y no sirve como señal de confianza. Se mantiene declarado como parcial.
- **El rol de despliegue del CI puede crear roles de función con cualquier permiso** dentro de `aqp-solidaria-academic-*`. No hay frontera de permisos porque exigiría que la plantilla de la aplicación la declare en cada función y que exista en el emulador. Lo mitiga limitar la confianza a `main` y proteger esa rama con revisión; reducirlo del todo es trabajo futuro.
- **Herramientas de desarrollo.** Quedan 10 advertencias de `npm audit` (`vitest`, `tinypool`, `typescript-eslint`) que exigen subir `vitest` a la versión 5. Solo afectan a quien ejecuta las pruebas, no a lo que se despliega. Tarea T103.
