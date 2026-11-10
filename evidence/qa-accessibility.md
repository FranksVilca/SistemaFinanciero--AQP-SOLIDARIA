# QA de móvil y teclado — 2026-11-09

Requisitos: CA-NF06.1 y CA-NF06.2. Suite: `backend/test/browser/spa.test.ts`, caso `375px`.
Entorno: Microsoft Edge headless, viewport 375 × 812, SPA compilada con CSP y servidor Vite con StrictMode,
contra API Gateway, Lambdas, IAM y Cognito en Floci. No usa una API simulada para registrar la donación.
El login usa el proveedor del emulador; esta evidencia no verifica el Hosted UI de AWS ni su MFA real.

## Hallazgos y correcciones

- Antes del cambio, la prueba falló en ambos modos: al abrir el modal, el foco seguía fuera del diálogo.
- Se usa `<dialog>` con `showModal()` y limpieza mediante `close()`. El resto del documento queda inerte.
  Se devuelve explícitamente el foco al botón de apertura al desmontar el diálogo, incluido el cierre con Escape.
- El resultado conserva un título accesible y recibe el foco al registrarse la donación.
- El campo monetario admite céntimos (`step=0.01`), en lugar de saltos de S/ 0.50 que impedían enviar S/ 1.01.
- Los errores del envío tienen `role=alert` y se relacionan con el campo. El botón de cierre tiene foco visible.
- La navegación ocultaba todos sus enlaces por debajo de 768 px: un donante móvil no podía abrir su historial.
  Ahora los mismos enlaces se muestran en una fila adaptable, manteniendo la visibilidad por rol.

## Verificaciones automatizadas

- Catálogo, detalle, modal y confirmación a 375 px sin desbordamiento horizontal de la página.
- Abrir y enviar con Enter; Tab y Shift+Tab dentro del diálogo; cerrar con Escape y recuperar el foco de apertura.
- Registrar S/ 1.01 con el backend del emulador y comprobar el resultado y el nombre accesible del diálogo.
- Abrir Mis Donaciones desde la barra móvil y confirmar la simulación con Enter, hasta `CONFIRMADA_SIMULADA`.
- Capturas en `.local/qa/built/` y `.local/qa/vite-dev/`, sin tokens ni credenciales.

Resultado inicial: `npm run test:browser` pasó **36/36** pruebas, incluido el caso nuevo en ambos modos. La ejecución
completa duró 184,74 s. Typecheck de backend/frontend sin errores; ESLint sobre los archivos cambiados sin errores
(se conserva la advertencia de tamaño del componente). La prueba nueva recorrió ocho Tab seguidos y ocho
Shift+Tab, además de Escape y retorno de foco. Se inspeccionaron visualmente las cuatro capturas del build.
Después de extender el recorrido al historial y su simulación, la ejecución focalizada pasó **2/2** (build y Vite),
en 87,96 s. La captura adicional muestra la confirmación simulada y el acceso móvil al historial.

El caso móvil crea una cuenta DONANTE independiente por modo. El build y Vite comparten stack: reutilizar la cuenta
de demostración para todos los casos añadía seis donaciones y podía agotar el cupo de cinco por minuto en un runner
rápido. Se aísla el dato de prueba; no se elevan ni desactivan los límites de seguridad.

Capturas conservadas: [catálogo](qa-mobile/catalog-375.png), [detalle](qa-mobile/detail-375.png),
[donación](qa-mobile/donation-375.png), [confirmación](qa-mobile/confirmation-375.png),
[simulación en el historial](qa-mobile/simulation-375.png).

```powershell
docker compose -f backend/test/floci/docker-compose.lambda.yml up -d
npm run test:browser --workspace=backend -- -t "375px"
```

No ejecutar a la vez con las suites E2E o rendimiento local: comparten nombres de recursos del template en Floci.

## Alcance pendiente

Esto demuestra los comportamientos listados; no certifica conformidad WCAG 2.2 AA completa. Faltan la revisión
humana con lector de pantalla, contraste de todas las vistas y estados, zoom al 200 %, otros navegadores y la
pasada contra AWS. El login móvil necesita cobertura específica: el caso inicia sesión antes de ajustar el viewport.

Referencia: [patrón de diálogo modal de W3C](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
