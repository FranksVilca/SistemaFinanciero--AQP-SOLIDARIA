# Ver el frontend funcionando (sin AWS)

Todo el sistema corre en un simulador (Floci): Cognito con MFA/PKCE, API Gateway con el authorizer y los scopes de
`infra/template.yaml`, las Lambdas reales (en contenedores) y DynamoDB. No se usa ninguna cuenta de AWS.

## Requisitos

- Docker Desktop encendido (Floci necesita el socket de Docker para ejecutar las Lambdas).
- Node 20+ y `npm install` ya hecho en la raíz.
- Puerto 3000 y 4566 libres.

## Levantarlo

```bash
npm run local        # déjalo corriendo en su terminal: si lo cierras, http://localhost:3000 deja de responder
```

Esto arranca Floci, despliega la plantilla, crea usuarios y proyectos de ejemplo, escribe `frontend/.env.local` y
lanza Vite. Cuando termine, abre **http://localhost:3000**.

| Usuario                    | Rol     | Contraseña    |
| -------------------------- | ------- | ------------- |
| donante@aqpsolidaria.pe    | DONANTE | `Passw0rd!x`  |
| gestor@aqpsolidaria.pe     | GESTOR  | `Passw0rd!x`  |
| auditor@aqpsolidaria.pe    | AUDITOR | `Passw0rd!x`  |
| revisor@aqpsolidaria.pe    | REVISOR | `Passw0rd!x`  |

### Paso obligatorio: confiar en el certificado del emulador

El login habla con el emulador por `https://localhost:4566`, con un certificado propio. **Sin confiar en él, el botón
"Iniciar Sesión" no puede continuar** (la app muestra un aviso rojo). Hazlo una vez por cada arranque del emulador:

- Windows: `npm run local:trust` (acepta el aviso de Windows) y reinicia el navegador.
- Cualquier sistema: abre `https://localhost:4566/_floci/health` en el navegador y acepta la advertencia.

La CA exportada queda en `.local/floci-root-ca.crt`.

> **La página de login no tiene estilos en local.** La genera el emulador (un formulario HTML básico) y no soporta
> la personalización de Cognito. La plantilla define la marca del Hosted UI clásico (`CognitoHostedUiBranding`), que
> solo se verá al desplegar en AWS real.

El inicio de sesión se abre en una **ventana emergente** con la página del proveedor de identidad: la contraseña nunca
pasa por la app y no pierdes tu lugar. Si el navegador bloquea la ventana, el mismo inicio de sesión continúa en la
página completa; si la cierras, no pasa nada.

Recorrido sugerido: entra como donante, dona S/ 50 a un proyecto, ve "Mis Donaciones", pulsa "Simular Aprobación" y
sal; luego entra como auditor y revisa el registro (actores seudonimizados `usr_…`).

Para parar solo la web: `Ctrl+C`. Para quitar también el stack y apagar Floci: `npm run local:stop`. El estado se borra al
reiniciar (el emulador no persiste datos). `npm run test:browser` usa los mismos nombres de recursos, así que antes de
correrlo ejecuta `npm run local:stop`.

## Pruebas automáticas en el navegador

```bash
docker compose -f backend/test/floci/docker-compose.lambda.yml up -d
npm run test:browser
```

Corre todo dos veces: contra el build con la CSP de la plantilla y contra el servidor de desarrollo de Vite (el que
abres tú). También comprueba que, sin confiar en el certificado, la app avisa en vez de quedarse muda. Usa Microsoft Edge (o Chrome con `BROWSER_CHANNEL=chrome`) mediante Playwright, sirve el build con la CSP de la
plantilla y comprueba: catálogo sin errores de consola ni violaciones de CSP, login PKCE, tokens fuera del
almacenamiento web, donación y aprobación, logout con revocación del token, ocultamiento de páginas reservadas, accesos
de gestor y auditor, y CORS (origen permitido vs. otro origen).

## Lo que sigue siendo solo de AWS real

Las pantallas propias de Cognito Managed Login, el efecto real de `DeletionProtection`/PITR en producción y una
pasada final de paridad (tarea T070). Todo lo demás está cubierto en el emulador.
