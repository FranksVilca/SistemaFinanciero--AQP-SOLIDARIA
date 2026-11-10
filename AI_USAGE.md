# Registro de Uso de Asistentes y Agentes de Inteligencia Artificial (AI_USAGE.md)

**Curso:** Tópicos Avanzados en Ingeniería de Software — EPIS, UNSA  
**Proyecto:** Plataforma de Donaciones Seguras (2026) — Fundación AQP-SOLIDARIA  
**Modelo de Seguridad:** Zero Trust (NIST SP 800-207)  

En cumplimiento de las directivas del curso y la sección §10 de [design.md](./design.md), se documenta de forma transparente cada interacción y aporte realizado por asistentes de código o agentes de IA.

---

## Tabla de Declaración de Asistencia con IA

| Herramienta / Modelo | Integrantes Participantes | Tareas Asistidas | Aportes de la IA | Validación Humana y Correcciones | Limitaciones y Riesgos Mitigados |
|---|---|---|---|---|---|
| **Antigravity AI (Gemini 3.8 Flash)** | Equipo completo | Fase 0 & Fase 1: Planificación Técnica y Especificación (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `api-spec.yaml`, `quickstart.md`) | Estructuración del plan de implementación técnica, contratos OpenAPI 3.1 y modelado DynamoDB. | El equipo revisó que se preservara 100% de la arquitectura pactada, sin agregar funcionalidades no autorizadas. | Riesgo de servicios fuera de la capa gratuita: se excluyeron WAF en HTTP API, GuardDuty y SMS MFA. |
| **Antigravity AI (Gemini 3.8 Flash)** | Equipo completo | Fase 2: Tareas de Tareas (`tasks.md`) | Desglose ordenado por dependencias de 62 tareas con formato checklist estricto. | Verificación de trazabilidad con los criterios de aceptación CA-01 a CA-12 y pruebas T01 a T14. | Se aseguró que las historias de usuario sean independientes y evaluables individualmente. |
| **Antigravity AI (Gemini 3.8 Flash)** | Backend / Seguridad | Módulo `donations` y Pruebas de Idempotencia y Concurrencia (T031, T032, T034, T037, T039) | Implementación de `canonicalJson`, hashing SHA-256 y transacción atómica con DynamoDB `TransactWriteItems`. | Se verificó que en caso de conflicto con payload distinto se devuelva HTTP 409 y que 10 llamadas concurrentes de confirmación resulten en exactamente 1 incremento (T08). | Mitigación de condiciones de carrera y dobles conteos financieros. |
| **Antigravity AI (Gemini 3.8 Flash)** | Backend / Seguridad | Módulo `authz` y borrador de políticas Cedar (T010, T018, T051–T055) | Código de autorización embebida RBAC + validación de ownership BOLA, y un borrador de adaptador Cedar para Amazon Verified Permissions que **nunca se conectó a ningún flujo**. | El adaptador y su prueba de equivalencia se retiraron del repositorio el 2026-11-08 por estar sin uso (ver la fila de Claude Code). Las políticas de `policies/` quedan como documentación de la fase 2. | Se eliminaron comodines en los permisos IAM. |
| **Claude Code (Claude Sonnet 5.5)** | Revisión de seguridad y endurecimiento Zero Trust (`specs/002-zta-hardening/`) | Revisión del repositorio frente a NIST SP 800-207 (`docs/zta-hallazgos-y-mejoras.md`); `withAuth()`, auditoría centralizada y pseudonimizada, revalidación de sesión, permisos IAM por acción, telemetría y CloudTrail en el IaC, pruebas de integración con DynamoDB Local y pruebas de infraestructura, CI, calidad de código, entorno local con el emulador Floci (`npm run local`), pruebas de extremo a extremo y de navegador (Playwright), correcciones del frontend que esas pruebas revelaron (caché, cierre de sesión del Hosted UI, estilos) y la personalización por CSS del login | Corrección del error de confirmación de donaciones (H1), MFA obligatorio, un único envoltorio de autorización con prueba de cobertura de rutas, tabla de auditoría de solo inserción, logs con retención de 14 días, y retiro del código Cedar sin uso. | Cada cambio se acompañó de pruebas automáticas que se ejecutaron: 33 unitarias, 40 de integración contra DynamoDB Local, 163 de infraestructura y 78 contra el emulador Floci con IAM y TLS activos y 11 de extremo a extremo con las Lambdas reales. Los fallos conocidos se reintrodujeron a propósito para comprobar que el CI los detecta (`evidence/ci-negative-checks.md`). Lo que exige AWS real quedó marcado como **pendiente** (`evidence/test-run-report.md`, sección 3). | Un asistente puede declarar controles que no ejecuta: por eso las afirmaciones de seguridad se contrastan con código, template o prueba (principio VI de la constitución). No se compartió ninguna credencial ni dato personal. |
| **Antigravity AI (Gemini 3.8 Flash)** | Frontend / UX | Frontend React 19, `oidc-client-ts` y vistas públicas/privadas (T016, T017, T022, T023, T024, T030, T036, T045, T050) | Scaffolding de componentes accesibles con Tailwind CSS y configuración de tokens en memoria (`InMemoryWebStorage`). | Revisión de no persistencia en `localStorage`/`sessionStorage` para cumplir con CA-NF11.1 contra XSS. | Banner obligatorio de simulación académica visible en modales y controles. |

---

> **Pendiente de confirmación por el equipo:** esta tabla recoge las herramientas que constan en el repositorio. Si algún integrante usó otra herramienta o modelo de IA, debe añadirla aquí antes de la entrega (design.md, sección 10).

## Rendimiento y pruebas de rechazo con Codex — 2026-11-09

- OpenAI Codex asistió en los perfiles k6, el dataset de 50 proyectos en Floci y el workflow de ensayo corto.
- Método, resultados locales y pruebas del propio comprobador: `evidence/performance-method.md`.
- Participante y revisión humana pendientes de confirmación. La medición en AWS, la correlación de cold starts
  y la conformidad con el origen regional del cliente no se dan por realizadas. No se declara resistencia a DDoS.

## QA de accesibilidad asistido con Codex — 2026-11-09

- OpenAI Codex asistió en el diálogo de donación y la prueba de móvil y teclado en Playwright.
- El caso de foco se vio fallar antes de modificar la interfaz. Los comandos y límites de evidencia constan en
  `evidence/qa-accessibility.md`.
- Participante responsable y revisión humana por otro integrante: pendientes de confirmación. No se declara
  certificación WCAG completa.

## Declaración Ética y de Originalidad

1. Ninguna credencial de producción, clave secreta de AWS ni dato personal real fue compartido o procesado por modelos de inteligencia artificial.
2. Todas las políticas de seguridad IAM y reglas de autorización fueron revisadas y verificadas contra pruebas automáticas negativas antes de su incorporación.
3. Cada integrante del equipo comprende y está en capacidad de defender técnicamente cada módulo y línea de código generada.
