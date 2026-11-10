# Decisiones y comportamientos esperados

Documento vivo. Recoge **qué hace el sistema que puede parecer un fallo pero no lo es**, y **qué decisiones se tomaron y por qué**, en especial las que dependen de Zero Trust (NIST SP 800-207) o de la comodidad de uso. Cuando algo sorprenda a alguien que usa o prueba el sistema, se anota aquí. Cuando se decida entre alternativas, se anota con su motivo.

- Última actualización: 2026-11-09 (se añadieron A11, D12, D13, P6 y P7; precios verificados el 2026-11-09).
- Cómo se marca la certeza: **Verificado** (probado con tests, en el emulador o en AWS real), **Del código** (se deduce de leerlo, sin ejecutarlo en ese caso) y **No verificado** (dato de memoria o hipótesis). Lo no verificado no debe citarse como un hecho.
- Documentos relacionados: [zta-hallazgos-y-mejoras.md](zta-hallazgos-y-mejoras.md) (revisión Zero Trust), [threat-model.md](threat-model.md), [analisis-velocity-y-mejoras-pendientes.md](analisis-velocity-y-mejoras-pendientes.md), [operations-notes.md](operations-notes.md).

---

## Parte A. Comportamientos esperados (no son fallos)

### A1. Al recargar la página pide «Iniciar sesión», y entra sin pedir contraseña
- **Qué se ve:** tras recargar aparece «Iniciar Sesión»; al pulsarlo se entra de inmediato con el mismo usuario. Tras «Salir», el siguiente inicio sí pide cuenta y contraseña.
- **Por qué:** son dos sesiones distintas. Los tokens de la aplicación viven **solo en la memoria de la pestaña** (`frontend/src/auth/authService.ts`, `InMemoryWebStorage`), así que recargar los borra. La cookie de sesión de Cognito sigue en el navegador, y por eso entrar de nuevo es inmediato. «Salir» revoca el refresh token y cierra también la sesión de Cognito.
- **Por qué se deja así (Zero Trust):** no guardar tokens en `localStorage` ni `sessionStorage` es la defensa contra su robo por XSS. Está declarada en [design.md](../design.md). Un clic tras recargar es el coste aceptado. Ver decisión D6.
- **Cambiar de cuenta:** se hace con «Salir».
- **Certeza:** Del código. La duración de la cookie de Cognito (se cree que ronda una hora por defecto) **No verificado**.

### A2. La ventana emergente de Cognito a veces se quedaba abierta mostrando la aplicación
- **Qué pasó:** la ventana de login volvía a `/auth/callback` y la página hacía siempre `navigate("/")`, también dentro de la emergente. Normalmente la ventana principal cierra la emergente en milisegundos; si no lo hacía, la emergente cargaba la aplicación entera y se quedaba abierta.
- **Causa probable de que la principal no la cerrara:** recargar la ventana principal con la emergente abierta, pulsar «Iniciar sesión» dos veces, o tenerla en segundo plano mucho rato. **No verificado** cuál ocurrió en el caso observado (no hay registros del navegador).
- **Arreglo:** dentro de la ventana de login, al terminar la página se cierra a sí misma, y si el navegador no la deja muestra «Puede cerrar esta ventana». `frontend/src/pages/AuthCallbackPage.tsx` y `frontend/src/auth/popup.ts` (`isSignInWindow`), con tests en `backend/test/auth/popup.test.ts`.
- **Certeza:** el arreglo está **Verificado** con tests unitarios; su efecto en un navegador real **No verificado** (los tests de navegador no se ejecutaron).

### A3. Avisos `Permissions-Policy: Unrecognized feature` en la consola
- Los avisos de `run-ad-auction`, `join-ad-interest-group`, `private-aggregation` y `attribution-reporting` **no salen de este proyecto**: ninguna de esas cadenas aparece en la plantilla, el frontend ni el backend. Es una cabecera de otra respuesta (probablemente la página de Cognito o una extensión) que lista funciones de Privacy Sandbox que el navegador no reconoce. Son inofensivos.
- **Certeza:** que no están en el repositorio, **Verificado** por búsqueda. El origen exacto, **No verificado**.

### A4. El pago es simulado, y en `production` nada confirma una donación
- En la etapa `academic` el propio donante pulsa «Simular Aprobación» y la donación pasa a `CONFIRMADA_SIMULADA`. Ese endpoint **solo existe en `academic`**; la etapa `production` no despliega `SimulateDonation` (lo comprueban los tests de infraestructura).
- En `production` una donación queda en `PENDIENTE_SIMULACION` para siempre: no hay pasarela de pagos. La etapa `production` es una plantilla de contraste, no un producto terminado. Para usarlo de verdad haría falta una pasarela con un webhook firmado que confirme el cobro.
- Los controles anti-abuso y la revisión **sí** funcionan igual en las dos etapas.
- **Certeza:** Del código y de los tests de infraestructura.

### A5. Una donación retenida se registra, pero no se puede confirmar
- Los controles de velocidad dejan la donación `EN_REVISION` en vez de rechazarla: queda registrada, no suma al proyecto y el donante no puede simularla (409). La resuelve un REVISOR o vence a los 7 días como `RECHAZADA_REVISION`.
- Reglas con los valores por defecto: más de 5 donaciones nuevas por minuto (la sexta recibe 429 y no se registra); más de S/ 5,000 acumulados en una hora; 3 donaciones de al menos S/ 900 en una hora.
- **Efecto a tener presente:** una vez que una regla salta, **todas las donaciones siguientes de esa hora** quedan retenidas, aunque sean de S/ 1, porque el acumulado de la hora ya superó el umbral. Está fijado con un test (`velocity.test.ts`) y sigue pendiente de decisión (P1).
- **Certeza:** Verificado (tests unitarios y de integración).

### A4b. El revisor es para lo sospechoso, no para todo
- El flujo normal sigue siendo automático. El REVISOR solo ve y resuelve lo que los controles de velocidad retuvieron. No ve roles, proyectos ni auditoría.

### A6. Roles que no pueden combinarse
- Tabla vigente, una sola fuente en `backend/src/shared/roleRules.ts`:

| | DONANTE | GESTOR | REVISOR | AUDITOR | ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|
| **DONANTE** | n/a | sí | sí | no | no |
| **GESTOR** | sí | n/a | no | no | no |
| **REVISOR** | sí | no | n/a | no | no |
| **AUDITOR** | no | no | no | n/a | no |
| **ADMIN** | no | no | no | no | n/a |

- **Cognito no impide asignar una combinación inválida.** La regla se aplica **al usar** la cuenta: toda acción protegida responde 403 `SEPARATION_OF_DUTIES` y queda auditada. La pantalla de administración y el script la rechazan además **al asignar** (409 o mensaje de error).
- Todo usuario nace DONANTE. Para volver auditor o administrador a alguien hay que quitarle DONANTE: `npm run role -- set <correo> AUDITOR`.
- **Certeza:** Verificado (unitarios, integración y Floci contra el Cognito emulado).

### A7. Un cambio de rol no se ve al instante en el token
- Un token conserva los grupos de cuando se emitió (hasta 15 minutos de vida del access token). Las acciones **sensibles** (publicar, ver auditoría, decidir una revisión, listar y cambiar roles) releen los grupos en Cognito en cada petición y fallan cerrado. Las demás se guían por el token.
- La persona debe cerrar sesión y volver a entrar para que su token traiga los roles nuevos y el scope `api/admin.users`.
- **Certeza:** Verificado (Floci, `roleRevalidation.test.ts`).

### A8. El auditor no puede borrar rastros
- El auditor solo lee. Ninguna función puede modificar ni borrar la tabla de auditoría: una política de recurso lo niega (`DenyAuditMutationFromFunctionRoles`) y cada evento se escribe con `attribute_not_exists`. Quien sí podría borrar es una persona con permisos directos sobre DynamoDB en AWS, como la cuenta root que se usa hoy.
- **Certeza:** Del código y de los tests de infraestructura.

### A9. Una persona puede tener varias cuentas
- El registro está abierto y el sistema identifica cada cuenta por su `sub`; no sabe que dos cuentas son la misma persona. Los controles de velocidad y las reglas de roles son **por cuenta**. Es un límite conocido, documentado en [threat-model.md](threat-model.md). La defensa real es de organización: quien se registra solo recibe DONANTE; los demás roles los asigna un administrador.

### A10. El despliegue se omite si falla cualquier otro trabajo del CI
- El trabajo `deploy` depende de todos los demás. Un `format:check`, un `eslint` con errores de complejidad (más de 10) o un test en rojo hacen que el despliegue **se omita sin avisar de otra forma**.
- **El stack de bootstrap no lo despliega el CI** (ver D7): si cambia, una persona lo aplica antes del push.

### A11. Lo desplegado no activa todo lo que la plantilla permite
- **Qué se ve:** la plantilla tiene parámetros para CloudTrail, PITR, GuardDuty y Security Hub, pero `samconfig.toml` los deja en `false`. En la cuenta real (comprobado el 2026-11-09 con el AWS CLI): no hay ningún trail, PITR está apagado en las 4 tablas, GuardDuty y Security Hub no están activados, y no existe ningún presupuesto ni alarma (el presupuesto ya está en la plantilla y se crea al configurar `ALERT_EMAIL`, D14).
- **Por qué:** son servicios opcionales por costo o por prueba de 30 días (detalle y certeza de cada uno en [arquitectura-actual.md](arquitectura-actual.md), sección 9).
- **Consecuencia:** no hay registro de quién cambió la infraestructura (la auditoría de la **aplicación** sí existe), ni restauración a un punto en el tiempo, ni aviso de costos.
- **Certeza:** Verificado (AWS CLI).

---

## Parte B. Decisiones tomadas

Formato: qué se decidió, por qué, qué alternativas había y quién decidió. Fecha 2026-11-09 salvo que se indique.

### D1. GESTOR y REVISOR no pueden combinarse
- **Decisión:** prohibido (403 `SEPARATION_OF_DUTIES` al usar; 409 al asignar).
- **Por qué:** la misma persona publicaría proyectos y aprobaría sus donaciones retenidas. La comprobación por proyecto de la revisión solo cubre los proyectos que creó ella misma, que es más débil.
- **Alternativa descartada:** dejarlo permitido y confiar en la comprobación por proyecto.
- **Decide:** James (respondió «sí» a la recomendación). Cambia una regla que antes estaba permitida.

### D2. Existe el rol ADMIN, con pantalla y con script
- **Decisión:** ADMIN gestiona identidades y roles y nada más (no dona, no crea proyectos, no revisa, no ve la auditoría). Va solo, como AUDITOR.
- **Por qué:** quitar la dependencia de comandos largos de AWS para tareas de rutina.
- **Alternativa considerada:** solo un script. Se valoró como más simple y con menos superficie de ataque; se prefirió tener también la pantalla. **Decide:** James. Con esto se cierra la mitad administrativa de T106 (`specs/002-zta-hardening/tasks.md`: «decidir si hay un rol administrador dentro de la app»); falta el flujo para que una persona **solicite** el rol de gestor.

### D3. El ADMIN no cambia sus propios roles ni los de AUDITOR o ADMIN, y solo asigna DONANTE, GESTOR y REVISOR
- **Por qué:** cuatro ojos. Quien consiga el rol ADMIN no puede concederse poder, silenciar al auditor ni crear más administradores desde la aplicación. Como ADMIN tampoco se asigna desde la app, el sistema **nunca queda sin administrador** por esa vía.
- **Dónde se impone:** en el código de `changeUserRole` y sus tests. **Cognito no permite limitar en IAM por nombre de grupo**, así que la política de la función no puede impedirlo por sí sola (límite declarado en [threat-model.md](threat-model.md)).
- **Decide:** James aceptó la recomendación.

### D4. AUDITOR, ADMIN y el primer administrador se asignan solo con el script `npm run role`
- **Por qué:** la aplicación no puede nombrar a su propio administrador (huevo y gallina), y no debe poder dar el rol que vigila al resto.
- **El script** aplica las mismas reglas, muestra el plan, tiene `--dry-run`, pide confirmación y registra el cambio con actor `operator`. Lo protege el control de acceso a la cuenta de AWS, no la aplicación.
- **Decide:** James pidió explícitamente el script.

### D5. El revisor es para lo sospechoso; lo normal es automático
- **Decisión:** el REVISOR resuelve solo las donaciones retenidas por los controles de velocidad. Se descartó revisar todo a mano.
- **Por qué:** con volumen real la revisión manual de todo no escala, y el valor del control está en separar lo anómalo.

### D6. Los tokens siguen solo en memoria (no se persiste la sesión)
- **Decisión:** se mantiene el diseño actual. Recargar la página obliga a un clic en «Iniciar sesión».
- **Por qué:** guardarlos en `sessionStorage` sobreviviría a las recargas, pero cualquier script inyectado podría leerlos y rompe la defensa documentada contra XSS.
- **Alternativa no probada:** un inicio de sesión silencioso al cargar. No se sabe si el Cognito de este stack lo soporta bien; habría que probarlo antes de prometerlo.
- **Decide:** recomendación aceptada por omisión; James pidió documentarlo.

### D7. El stack de bootstrap (`github-oidc.yaml`) no lo despliega el CI
- **Por qué:** contiene la identidad con la que el CI entra a AWS. Si el pipeline pudiera modificarlo, una cuenta de GitHub o un workflow comprometidos podrían darse más permisos (escalada de privilegios). Además, el primer despliegue no puede hacerlo un CI que aún no tiene identidad.
- **Coste:** cuando cambia (por ejemplo, el permiso de EventBridge de la revisión diaria) lo aplica una persona antes del push, con `aws cloudformation deploy ... --no-execute-changeset` y después `execute-change-set`.

### D8. El `UpdateItem` de `CreateDonation` se acota a las claves `velocity#*`
- **Decisión:** condición IAM `dynamodb:LeadingKeys` con `ForAllValues:StringLike` más `Null`.
- **Por qué:** la documentación decía «solo contadores `velocity#`», pero la política daba `UpdateItem` sobre toda la tabla de idempotencia. Ahora lo impone IAM y no solo el código.
- **Hallazgo:** el resolver de políticas de las pruebas de Floci descartaba las condiciones, así que ninguna prueba las veía; se corrigió y ahora se prueba que un contador `velocity#` se puede actualizar y un registro de idempotencia no. **Verificado** en Floci; **No verificado** contra AWS real.

### D9. Los rechazos esperados se registran como `warn`, no como `error`
- **Decisión:** los 4xx y el 503 por contención se registran como `warn`; los fallos reales siguen como `error` con su traza. El job de vencimiento avisa con `warn` si deja trabajo pendiente.
- **Por qué:** una alarma sobre errores no debe dispararse por el comportamiento normal de un usuario (por ejemplo, un 429).

### D10. Flujo de trabajo del repositorio
- Se trabaja en la rama actual y **James hace los commits**; no se crean ramas por iniciativa propia. El despliegue es el push o merge a `main`.

### D11. Cómo se documenta lo construido fuera de `specs/`
- **Situación:** `specs/001-secure-donations` y `specs/002-zta-hardening` son especificaciones históricas de dos features. Los controles de velocidad, la revisión de donaciones y la administración de roles se construyeron **sin una carpeta de `specs/` propia**.
- **Decisión:** la referencia de lo implementado es [arquitectura-actual.md](arquitectura-actual.md) (con su diagrama), más los contratos de `specs/002-zta-hardening/contracts/` que sí se actualizaron. En las especificaciones históricas solo se añadieron notas que indican el estado posterior; no se reescribieron.
- **Por qué:** reescribir una especificación cerrada falsea su historia, y crear a posteriori un `specs/003` con spec, plan y tareas inventados sería documentación retroactiva sin valor.
- **Alternativa no tomada:** generar `specs/003-...` retroactivo con las herramientas de Spec-Kit. Es posible si la entrega lo exige.
- **Mantenimiento:** el diagrama y el documento se actualizan cuando cambie la plantilla; los tests que cuentan funciones y rutas avisan si algo cambia sin documentarse.

### D12. Se documenta por separado lo que se dejó fuera por costo y lo que se dejó fuera por limitación técnica
- **Decisión:** [arquitectura-actual.md](arquitectura-actual.md), sección 9, separa los servicios apagados por costo (Cognito Plus, GuardDuty, Security Hub, CloudTrail, PITR, claves KMS propias, VPC, Verified Permissions, SMS, Organizations) de los que no se usan por una limitación técnica (WAF y el límite por usuario, que un HTTP API no admite) y de los que faltan por alcance (pasarela de pagos, cierre de campaña).
- **Por qué:** quien evalúe el proyecto no debe leer un servicio ausente como un olvido, y tampoco confundir «no se puede» con «no se quiso pagar».
- **Cómo se sabe cada dato:** cada fila marca si se comprobó en la documentación de AWS, en la cuenta real o solo está afirmado en el repositorio. Los precios no se citan.

### D13. Las mejoras que no se hicieron se justifican con un motivo honesto
- **Decisión:** [mejoras-consideradas.md](mejoras-consideradas.md) clasifica cada ausencia como INNECESARIO, TÉCNICO, COSTO, ALCANCE o **PENDIENTE**. PENDIENTE significa que no hubo decisión de excluirlo.
- **Por qué:** AWS Budgets y las alarmas se habían dado por «descartados por costo o alcance», y no se acordó eso: el proyecto exige la alerta de Budgets (CA-NF09.1) y no hay prueba de que su costo fuera el motivo. Presentarlos como decisión habría sido una justificación inventada.
- **Efecto:** P7 sigue abierto y es el punto que más conviene cerrar antes de la entrega.

### D14. La alerta de gasto (AWS Budgets) está en la plantilla y se activa con una variable del CI
- **Decisión:** recurso `CostBudget` en `infra/template.yaml`: presupuesto mensual de costo de **toda la cuenta**, por defecto USD 5 (`MonthlyBudgetUsd`), con aviso por correo al 80 % y al 100 % de lo gastado y al 100 % de lo previsto. Solo se crea si el parámetro `AlertEmail` no está vacío; el CI lo toma de la variable de repositorio `ALERT_EMAIL`.
- **Por qué una variable y no el correo en el repositorio:** el correo es un dato personal y el repositorio es compartido. Sin la variable el despliegue sigue funcionando y no crea el presupuesto.
- **Para que funcione, James debe:** (1) volver a aplicar el stack de bootstrap (`github-oidc.yaml` ganó el permiso `budgets:ViewBudget` y `budgets:ModifyBudget` sobre `budget/aqp-solidaria-academic-*`; ver D7) y (2) crear la variable `ALERT_EMAIL` en GitHub. En ese orden: si se hace al revés, el despliegue falla con `AccessDenied`.
- **Costo:** una alerta por correo no tiene cargo propio en la lista de precios de AWS (**Precio AWS**, 2026-11-09). **No verificado** contra la cuenta real: la creación efectiva del presupuesto no se ha probado en AWS (el emulador Floci no se usa para esto).
- **Límite:** mide toda la cuenta, no solo este stack, y no corta el gasto: solo avisa.
- **Cierra:** la mitad de P7 (la alerta). Las alarmas de CloudWatch siguen pendientes.

### D15. El plan de Cognito se declara: Essentials
- **Decisión:** `UserPoolTier: ESSENTIALS` explícito en la plantilla. Cierra P6.
- **Por qué:** era el valor por defecto de CloudFormation y no una decisión, así que ahora consta. El pool ya estaba en Essentials, por lo que el cambio **no modifica nada desplegado** ni el costo.
- **Alternativa no tomada:** Lite (unas 2.7 veces más barato por usuario activo). Con ~8 usuarios son centavos y exigiría probar antes la revocación de tokens, `userInfo` y el cierre de sesión del Hosted UI, que no aparecen en la tabla de funciones por plan.
- **Corregido:** el comentario de la plantilla sobre managed login v2 decía que exigía un plan «que no es el gratuito», lo cual no explicaba nada.
- **No se eligió Plus:** USD 0.020 por usuario activo y solo añade protección contra amenazas y riesgo continuo, que el proyecto declara como límite (NIST, principio 5).

### D16. No se reserva concurrencia por función
- **Decisión:** no se añade `ReservedConcurrentExecutions`.
- **Por qué:** la cuenta tiene un límite de **10 ejecuciones concurrentes en total** y las 10 están sin reservar (**Cuenta real**, `aws lambda get-account-settings`, 2026-11-09). Lambda exige dejar un mínimo sin reservar, así que reservar para una función no es posible con ese límite; y reservar para una función le quitaría capacidad a las demás.
- **Lo que acota la carga hoy:** el propio límite de la cuenta (10) y el límite de tasa del API Gateway (25/50 por defecto, 10/20 en las lecturas). El control `CKV_AWS_115` ya estaba omitido en `.checkov.yaml` con ese motivo.
- **Cuándo revisarlo:** si se sube el límite de la cuenta (solicitud de aumento de cuota).

---

## Parte C. Decisiones pendientes

| # | Tema | Pregunta | Recomendación actual |
|---|---|---|---|
| P1 | Regla «una vez marcado, todo marcado» | ¿Se mantiene, o solo se marca la donación que cruza el umbral? Hoy puede inundar la cola del revisor. | Decidirlo según el volumen esperado; el job de vencimiento resuelve como máximo 100 por corrida. |
| P2 | Cierre de campaña | `createDonation` no compara con la meta del proyecto; la interfaz oculta el exceso con `Math.min(100, …)`. | Cierre automático contando solo lo confirmado, o documentar que la meta es solo informativa. |
| P3 | Cuenta root de AWS | Se opera con la cuenta root (`746727375048`). | Un usuario con IAM Identity Center o un rol acotado; root guardada con MFA. |
| P4 | Inicio de sesión silencioso | ¿Evitar el clic tras recargar sin persistir tokens? | Probarlo contra el stack antes de decidir (ver D6). |
| P5 | Índice `status-createdAt-index` | Indexa todas las donaciones con proyección `ALL`. | Convertirlo en índice disperso si el volumen crece. |
| P6 | ~~Plan de Cognito~~ | **Resuelto** en D15 (Essentials declarado). Queda como mejora opcional pasar a Lite, probando antes la revocación de tokens. | — |
| P7 | Alertas de costo | **Ya era pendiente desde `specs/001`** (RNF-09; también `requirements.md` CA-NF09.1 y `design.md`). **Resuelta a medias:** el presupuesto está en la plantilla (D14) y falta activarlo (bootstrap y variable `ALERT_EMAIL`). Siguen pendientes las alarmas de CloudWatch con SNS (USD 0.10 por alarma al mes). | Activar D14 y crear 4 o 5 alarmas (5xx del API, errores de Lambda, job de vencimiento). |

---

## Cómo mantener este documento
- **Un comportamiento sorprendente** que alguien pregunte («¿por qué pasa esto?») va a la Parte A, con su causa, si es esperado o un defecto, y la certeza.
- **Una decisión entre alternativas** va a la Parte B, con motivo, alternativa y quién decide.
- Al decidir un punto de la Parte C, se mueve a la B y se borra de la C.
- No se anota como hecho lo que no se verificó: se marca **No verificado**.
