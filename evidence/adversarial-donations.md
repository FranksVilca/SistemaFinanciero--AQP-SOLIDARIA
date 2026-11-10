# Pruebas adversas de donaciones

Fecha: 2026-11-09. Base: `main` en `f4f2064`, después de integrar el PR #3.
Suite: `backend/test/integration/adversarialDonations.test.ts`.

Se ejecutan los handlers reales con transacciones en DynamoDB Local. No se simula DynamoDB.
El reloj de la aplicación se fija para reproducir los límites temporales; el servicio de base de datos sigue real.
La identidad del evento representa los claims que entregaría el autorizador. Cognito userInfo y la consulta de
grupos usan los sustitutos de la suite de integración existente. Estas pruebas no validan JWT, MFA, IAM ni AWS real.

## Escenarios

| Caso | Intento o condición | Resultado comprobado |
|---|---|---|
| A01 | Alternar proyectos para eludir el cupo por minuto | Cinco intenciones aceptadas, sexta con 429; ningún total confirmado cambia. |
| A02 | Repartir el monto horario entre proyectos y luego enviar S/ 1 | El acumulado sigue al donante: la que supera el umbral y la posterior quedan `EN_REVISION`, con motivo persistido `HOURLY_AMOUNT`. |
| A03 | Inyectar ID, propietario ajeno, confirmación, moneda y decisión de revisión | El servidor genera el ID y usa la identidad autenticada, estado pendiente y PEN; no persiste los campos de revisión inyectados ni incrementa lo confirmado. |
| A04 | Agotar el cupo de una cuenta y donar con otra | La segunda cuenta conserva su cupo. No se demuestra detección de múltiples cuentas de una misma persona. |
| A05 | Rotar `X-Forwarded-For`, `X-Real-IP` y `X-User-Id` en cada solicitud | Las cabeceras no reemplazan al donante autenticado: la sexta solicitud sigue devolviendo 429. No representa cambios reales de IP de origen en API Gateway. |
| A06 | Reintentar una clave rechazada por 429 en el minuto siguiente | La clave puede crear la intención al volver el cupo; repetirla devuelve el mismo ID y deja disponibles los otros cuatro lugares del minuto. |
| A07 | Enviar cinco intenciones a las 10:10:59 y cinco a las 10:11:00 UTC | Se aceptan diez en dos ventanas consecutivas; la siguiente devuelve 429. Es una limitación del diseño de ventana fija, no una ventana móvil de 60 segundos. |

La suite queda incluida automáticamente en el job `integration` del CI mediante el patrón
`test/integration/**/*.test.ts`; no requiere un job nuevo.

## Ejecución local

- `npm run test:integration`: 15 archivos, **79/79 pruebas aprobadas**, incluidas las siete de esta suite.
- `npm test`: 15 archivos, **152/152 pruebas aprobadas**.
- `npm run typecheck`: backend y frontend sin errores.
- ESLint sobre el archivo nuevo: sin errores.
- ESLint global: 0 errores y 15 advertencias existentes del frontend.
- Prettier sobre el archivo nuevo: aprobado. La comprobación global señala 112 archivos ajenos a este aporte;
  el checkout de Windows tiene archivos con CRLF donde Git guarda LF (verificado con `git ls-files --eol`).
  No se reformatearon esos archivos.

Los escenarios nuevos pasan sobre el código integrado sin modificarlo. Esta ejecución no encontró una evasión
en los casos cubiertos; A07 confirma la limitación de la ventana fija. Las tablas son locales y todos los datos
son sintéticos. No se ejecutó una prueba de carga sobre la cuenta de AWS.

## Reproducción

Desde la raíz del repositorio, con Docker y dependencias instaladas:

```powershell
docker compose -f backend/test/integration/docker-compose.yml up -d
npm run test:integration --workspace=backend -- adversarialDonations.test.ts
```

La suite usa y recrea únicamente las tablas de integración `aqp-*-it` del endpoint local. No ejecutar dos
procesos de integración a la vez sobre ese endpoint: comparten tablas. Para comprobar toda la integración:

```powershell
npm run test:integration
```

## Interpretación para la sustentación

Los casos demuestran que los límites dependen de la cuenta autenticada y que los campos del cliente no son
autoridad sobre la identidad ni el estado. No demuestran que una persona no pueda usar varias cuentas ni que
exista un bloqueo por IP. Tampoco convierten una heurística de monto en evidencia de fraude.

No se cambian umbrales, servicios de AWS ni reglas de negocio. El aporte agrega cobertura de regresión y hace
reproducible una limitación conocida. La revisión humana por otro integrante queda pendiente.
