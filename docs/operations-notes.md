# Notas de operación

Casos límite de la plataforma que conviene conocer antes de operarla.

## 1. Restaurar una tabla a un punto en el tiempo (PITR)

La recuperación a un punto en el tiempo está activa en `production` (o con `EnablePitr=true`). DynamoDB restaura **a una tabla nueva**; no sobrescribe la existente.

Las tablas `Projects` y `Donations` se restauran por separado, por lo que pueden quedar en puntos distintos de la transacción de confirmación. Después de restaurar, el campo `confirmedAmountCents` de un proyecto puede no coincidir con la suma de sus donaciones `CONFIRMADA_SIMULADA`.

Para recalcularlo:

1. Restaurar `Projects` y `Donations` al **mismo instante**.
2. Para cada proyecto, consultar sus donaciones confirmadas y sumar `amountCents`.
3. Actualizar `confirmedAmountCents` del proyecto con esa suma.
4. Apuntar las funciones a las tablas restauradas (variables `PROJECTS_TABLE`, `DONATIONS_TABLE`, `AUDIT_TABLE`) o renombrar tras eliminar las originales, que están protegidas contra borrado en `production`.

La tabla `Idempotency` no se restaura: sus claves caducan a las 24 horas.

## 2. Seudónimos de auditoría tras borrar un usuario

El campo `actorRef` de un evento es `usr_` más 12 caracteres hexadecimales del SHA-256 del identificador (`sub`) del usuario. Los eventos nunca contienen el `sub`, el correo ni otro dato personal.

Si el usuario se elimina de Cognito, sus eventos **se conservan** con el mismo seudónimo: la auditoría es de solo inserción y ninguna función puede borrarlos. El seudónimo no permite reconstruir el usuario por sí solo; solo quien conozca el `sub` original puede recalcularlo y comprobar a qué eventos corresponde.

## 3. Primer inicio de sesión: enrolamiento de TOTP

El MFA es obligatorio para todo el pool de usuarios (`MfaConfiguration: ON`, solo aplicación autenticadora; no hay SMS). En el primer inicio de sesión, el Hosted UI de Cognito pide configurar el autenticador (QR o clave) **antes** de emitir cualquier token. Una persona sin segundo factor configurado no obtiene tokens.

Los grupos (`DONANTE`, `GESTOR`, `AUDITOR`) se asignan en Cognito por una persona administradora; un usuario nuevo sin grupo no puede usar ninguna acción protegida. Hoy **nadie recibe `DONANTE` automáticamente**: quien se registra queda sin grupo hasta que una persona administradora lo agrega.

### Reglas sobre los roles de una persona

Un usuario puede estar en más de un grupo, con dos reglas que el backend aplica y que quedan auditadas:

- **`AUDITOR` no se combina con ningún otro rol** (motivo `SEPARATION_OF_DUTIES`): quien audita no puede ser quien opera, porque auditaría sus propias acciones. Una persona con `AUDITOR` y otro grupo recibe 403 en toda acción protegida hasta que un administrador deje un solo rol.
- **Quien creó un proyecto no puede donarle** (motivo `CONFLICT_OF_INTEREST`): sin esto, un gestor que también es donante podría subir el monto de su propio proyecto. Se comprueba con `createdBy`, un campo que guarda el proyecto y que ninguna vista pública muestra. Los proyectos creados antes de este cambio no tienen `createdBy` y no quedan cubiertos.

`GESTOR` y `AUDITOR` son privilegios que **concede una persona administradora**; ninguna pantalla permite elevarse a sí mismo.

## 4. Sesión revocada en acciones sensibles

Publicar un proyecto, consultar la auditoría y confirmar una donación llaman al endpoint `userInfo` de Cognito con el access token. Si responde distinto de 200, hay tiempo agotado (2 segundos) o no se puede alcanzar, la acción responde **401** y queda auditada con el motivo `SESSION_REVOKED`. El usuario debe iniciar sesión de nuevo.

Esas mismas acciones sensibles **vuelven a leer los grupos de la persona** en Cognito (`AdminListGroupsForUser`, con un permiso IAM acotado al pool). Un token conserva los grupos con los que se emitió, así que quitar un rol no lo cambia; con esta lectura, publicar, auditar y confirmar dejan de funcionar en el acto, con 403 y el motivo `ROLE_REVOKED` en la auditoría. Si Cognito no responde, la acción se rechaza (falla cerrada).

### Dar de baja o quitar un rol

1. Quitar el grupo: `aws cognito-idp admin-remove-user-from-group --user-pool-id <pool> --username <usuario> --group-name <GRUPO>`. Surte efecto de inmediato en publicar, auditar y confirmar.
2. Terminar sus sesiones: `aws cognito-idp admin-user-global-sign-out --user-pool-id <pool> --username <usuario>`. Hasta hacerlo, **el token que ya tiene sigue sirviendo hasta 15 minutos para las acciones que no son sensibles** (donar, ver el propio historial), porque el gateway solo valida la firma y la expiración.
3. Si la persona deja la organización: `aws cognito-idp admin-disable-user ...`, que además revoca sus tokens de acceso.

## 5. Costos que pueden aparecer

Ver [free-plan-guide.md](free-plan-guide.md): PITR, GuardDuty y Security Hub (después de su prueba de 30 días) y un segundo trail de CloudTrail en una cuenta que ya tenga uno.
