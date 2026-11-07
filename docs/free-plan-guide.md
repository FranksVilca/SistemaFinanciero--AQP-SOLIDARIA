# Guía del plan gratuito de AWS

Cómo desplegar la plataforma usando lo que ofrece el plan gratuito de AWS, qué servicios son opcionales y qué queda fuera. Basada en la documentación de AWS consultada el 2026-11-08; confirma los precios y las pruebas vigentes en la consola de tu cuenta.

## 1. Un solo archivo de despliegue

Toda la infraestructura está en [infra/template.yaml](../infra/template.yaml). No hay un template distinto para el emulador ni para producción: las etapas (`academic` y `production`) difieren solo en parámetros y condiciones de costo o de borrado, y las pruebas de infraestructura (`npm run test:infra --workspace=backend`) las verifican para ambas.

## 2. Confirma el tipo de cuenta

En la consola de AWS abre **Billing and Cost Management** y mira si tu cuenta es del **plan gratuito** o del **plan de pago**.

- El plan gratuito dura 6 meses o hasta agotar los créditos (USD 100 al registrarte, hasta 100 más por actividades). Después la cuenta se cierra.
- Solo da acceso a servicios seleccionados.
- Unirte a AWS Organizations convierte la cuenta en plan de pago.
- Según la documentación, las pruebas de corta duración (por ejemplo, 30 días de GuardDuty) pertenecen al plan de pago.

## 3. Qué es gratuito y qué es opcional

| Pieza | Costo | En el template |
|---|---|---|
| Lambda, API Gateway, DynamoDB bajo demanda, Cognito (TOTP), S3, CloudFront, CloudWatch con retención de 14 días | Dentro del plan | Siempre activo |
| CloudTrail, trail de eventos de gestión | Primera copia gratuita | `EnableCloudTrail` (por defecto `true`; poner `false` si la cuenta ya tiene un trail) |
| Recuperación a un punto en el tiempo (PITR) de DynamoDB | No es gratuita (centavos con estos volúmenes) | `EnablePitr` (por defecto `false`; en `production` siempre activa) |
| Protección contra borrado de tablas | Gratuita | Solo en `production`, para que `sam delete` limpie la etapa académica |
| GuardDuty | 30 días de prueba por región; después se cobra | `EnableGuardDuty` (por defecto `false`) |
| Security Hub | Planes propios; su prueba gratuita no se confirmó | `EnableSecurityHub` (por defecto `false`; se crea sin estándares por defecto) |

## 4. Desplegar

```bash
npm ci
npm run build --workspace=backend
sam build -t infra/template.yaml
sam deploy --guided
```

Para activar las pruebas de 30 días (tras confirmar el tipo de cuenta):

```bash
sam deploy --parameter-overrides EnableGuardDuty=true EnableSecurityHub=true
```

**Fecha de fin de la prueba:** anota hoy la fecha de activación y suma 30 días. Antes de esa fecha, vuelve a desplegar con `EnableGuardDuty=false EnableSecurityHub=false`, o acepta el costo de forma consciente.

Para producción:

```bash
sam deploy --parameter-overrides StageName=production EnablePitr=true
```

## 5. Cambios que reemplazan datos

La tabla de auditoría cambió de clave (`auditDay` + `timestamp#eventId`). Al desplegar sobre un stack existente, CloudFormation **reemplaza** la tabla y se pierden sus eventos. Es aceptable en la etapa académica; en un entorno con datos reales habría que migrarlos antes.

## 6. Limpieza

Un bucket con objetos impide que `sam delete` termine. Usa el script, que vacía los buckets del frontend y de CloudTrail y luego elimina el stack:

```powershell
./scripts/cleanup.ps1 -Stage academic
```

Con `production` el script se niega a continuar salvo que pases `-Force`.

## 7. Lo que queda fuera y por qué

| Servicio | Motivo |
|---|---|
| WAF | No se asocia a una HTTP API; los planes planos de CloudFront que lo incluyen no están disponibles en cuentas del plan gratuito |
| SMS MFA | Necesita número de origen y sandbox, cobra por mensaje y, una vez configurado, no se puede quitar como factor. Se usa TOTP |
| Verified Permissions | Cobro por solicitud de autorización; su tramo gratuito no está confirmado. Es la fase 2 del motor de políticas |
| Varias cuentas (Organizations) | Convierte la cuenta en plan de pago |

## 8. Notas de operación

Los casos límite (restaurar PITR, seudónimos tras borrar un usuario, enrolamiento de TOTP) están en [operations-notes.md](operations-notes.md).
