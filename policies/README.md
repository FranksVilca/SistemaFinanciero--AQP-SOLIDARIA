# Políticas Cedar — documentación de la fase 2

**Estado: no se aplican.** Estos archivos describen cómo se expresarían las reglas de autorización en Cedar para Amazon Verified Permissions. Ningún componente del sistema los lee ni existe un Policy Store en `infra/template.yaml`.

El motor de políticas activo es el módulo embebido `backend/src/authz/evaluateAuthz.ts` (`EmbeddedPolicyAuthorizer`), siempre invocado a través de `withAuth()`.

## Por qué no están conectados

Verified Permissions cobra por solicitud de autorización y su tramo gratuito no está confirmado (ver `docs/free-plan-guide.md`). Conectarlo añadiría un Policy Store, latencia en cada solicitud y costo.

## Si se conecta en el futuro

1. Crear el Policy Store en `infra/template.yaml` y cargar `schema.cedarschema` y `policies.cedar`.
2. Implementar un `PolicyAuthorizer` que llame a `IsAuthorized` y devuelva `false` ante cualquier excepción (falla cerrado); `authorize()` ya acepta un autorizador intercambiable, aunque `withAuth()` todavía no lo expone como opción.
3. Añadir una prueba de equivalencia entre ambos motores sobre la matriz rol × acción de `backend/test/integration/authzMatrix.test.ts`.
4. Actualizar `AI_USAGE.md`, `design.md` y `docs/zta-hallazgos-y-mejoras.md`.
