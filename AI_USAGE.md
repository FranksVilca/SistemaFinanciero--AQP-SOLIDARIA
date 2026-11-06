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
| **Antigravity AI (Gemini 3.8 Flash)** | Backend / Seguridad | Módulo `authz` y Políticas Cedar (T010, T018, T051–T055) | Código de autorización embebida RBAC + validación de ownership BOLA, y adaptador Cedar para Amazon Verified Permissions. | Se ejecutaron pruebas de equivalencia (`cedarEquivalence.test.ts`) para garantizar que ambas implementaciones produzcan idéntico resultado en T03, T09 y T12. | Se eliminaron comodines en permisos IAM y políticas Cedar. |
| **Antigravity AI (Gemini 3.8 Flash)** | Frontend / UX | Frontend React 19, `oidc-client-ts` y vistas públicas/privadas (T016, T017, T022, T023, T024, T030, T036, T045, T050) | Scaffolding de componentes accesibles con Tailwind CSS y configuración de tokens en memoria (`InMemoryWebStorage`). | Revisión de no persistencia en `localStorage`/`sessionStorage` para cumplir con CA-NF11.1 contra XSS. | Banner obligatorio de simulación académica visible en modales y controles. |

---

## Declaración Ética y de Originalidad

1. Ninguna credencial de producción, clave secreta de AWS ni dato personal real fue compartido o procesado por modelos de inteligencia artificial.
2. Todas las políticas de seguridad IAM y reglas de autorización fueron revisadas y verificadas contra pruebas automáticas negativas antes de su incorporación.
3. Cada integrante del equipo comprende y está en capacidad de defender técnicamente cada módulo y línea de código generada.
