# Mejoras consideradas y por qué no se incluyeron

Reúne **lo que alguien propondría añadir o mejorar** en AQP-SOLIDARIA y **la razón por la que no está**, para responder en la sustentación sin improvisar y para que ningún servicio ausente se lea como un olvido. Complementa [arquitectura-actual.md](arquitectura-actual.md) (qué hay) y [decisiones-y-comportamientos.md](decisiones-y-comportamientos.md) (qué se decidió).

- Última actualización: 2026-11-09 (con precios reales, ver más abajo).

## Cómo leer este documento

Cada mejora lleva un motivo, y los motivos **no son equivalentes**:

| Motivo | Significa |
|---|---|
| **INNECESARIO** | La arquitectura ya lo cubre; añadirlo duplicaría lo que existe. |
| **TÉCNICO** | No se puede hacer con esta arquitectura (por ejemplo, el HTTP API no admite WAF). |
| **COSTO** | Se podría, pero cobra, o solo es gratuito durante una prueba. |
| **ALCANCE** | Fuera de lo que cabe en un proyecto de curso de una semana con 4 o 5 integrantes ([requirements.md](../requirements.md) y [design.md](../design.md)). |
| **PENDIENTE** | **No se decidió excluirlo**: debería hacerse, o un requisito lo pide y no está. No es una justificación, es trabajo por hacer. |

La columna *Certeza* indica cómo se sabe cada dato:

| Etiqueta | Origen |
|---|---|
| **Precio AWS** | Lista de precios oficial de AWS (Price List API), región `us-east-1`, consultada el 2026-11-09. |
| **Docs AWS** | Documentación oficial de AWS, consultada el 2026-11-09. |
| **Cuenta real** | Comprobado con el AWS CLI en la cuenta desplegada (solo lecturas). |
| **Código** | Se ve en la plantilla o el código. |
| **Repo** | Lo afirma un documento del proyecto y no se pudo verificar. |

**Sobre los precios.** Salen de la Price List de AWS. Esa lista **no incluye los tramos gratuitos** (por ejemplo, los usuarios gratis de Cognito o las alarmas gratis de CloudWatch), así que esos datos siguen sin verificarse y se marcan como tales. Los importes mensuales de este documento suponen 730 horas al mes y **no incluyen impuestos ni transferencia de datos**. La consulta se hizo con el AWS CLI y el perfil `aqp` porque el servidor MCP de precios no tenía credenciales válidas.

> **Aclaración importante.** Los presupuestos de AWS (Budgets) y las alarmas **no se acordaron como excluidos**: son trabajo pendiente que el proyecto exige desde su primera especificación (ver la sección 7).

---

## 1. Entrada de tráfico y disponibilidad

| Mejora | Motivo | Por qué no está | Qué haría falta | Certeza |
|---|---|---|---|---|
| **Load balancer (ALB)** | INNECESARIO | El punto de entrada ya es API Gateway, que valida el JWT y limita la tasa, y detrás hay Lambda, que escala sola. Un balanceador repartiría carga entre servidores que aquí no existen. **Costaría unos USD 16.43 al mes fijos** (USD 0.0225 por hora) más una unidad de capacidad variable, tenga o no tráfico. | Solo si el backend pasara a contenedores; iría **detrás** de API Gateway (VPC Link). | Precio AWS (tarifa por hora). Docs AWS (Lambda escala sola, 1,000 ejecuciones concurrentes por cuenta por defecto) |
| **WAF** | TÉCNICO (y COSTO) | **Un HTTP API no se asocia a AWS WAF**; un REST API sí. Ponerlo delante exigiría CloudFront con una web ACL o cambiar a REST API. WAF cobra **USD 5.00 al mes por web ACL y USD 1.00 al mes por regla**, más las solicitudes procesadas: una ACL con dos reglas son USD 7.00 al mes antes de tráfico. | Cambiar a REST API, o CloudFront con una web ACL delante del API. | Docs AWS (HTTP API: WAF «No»; REST: «Sí»). Precio AWS |
| **Límite de tasa por usuario en el gateway** | TÉCNICO | Los planes de uso con claves por cliente **son solo de REST API**, y aun allí AWS avisa de que no son un límite duro. El gateway tiene límite global por ruta (25/50, lecturas 10/20). | Ya resuelto de otra forma: **límite por donante en el backend** (5 por minuto, con transacción atómica). | Docs AWS. El 25/50, Código |
| **Bajar el límite global de `POST /v1/donations`** | INNECESARIO | Es global por ruta: un solo abusador agotaría el cupo de todos los donantes. Para eso está el control por donante. | — | Repo |
| **Tope de concurrencia por función** | TÉCNICO | La cuenta tiene un límite de **10 ejecuciones concurrentes en total**, todas sin reservar, y Lambda exige dejar un mínimo sin reservar: no se puede reservar para una función (D16). No tiene costo propio, pero aquí no es posible. | Pedir un aumento de la cuota de concurrencia de la cuenta; después, una línea por función. | Cuenta real (`get-account-settings`, 2026-11-09) |
| **Alta disponibilidad (multi-AZ)** | INNECESARIO | Es serverless: DynamoDB replica los datos en tres zonas de disponibilidad por defecto (SLA del 99.99 %). | — | Docs AWS |
| **Multi-región (tablas globales)** | ALCANCE (y COSTO) | Eleva la disponibilidad al 99.999 %, pero cada escritura se repite en cada región réplica y se cobra como escritura replicada (USD 0.625 por millón de unidades, además de la escritura normal), y complica la consistencia. | Tablas globales de DynamoDB, Cognito y frontend en otra región. | Docs AWS (SLA). Precio AWS |
| **Dominio propio con certificado** | ALCANCE (y COSTO) | Se usa el dominio de CloudFront y el prefijo de Cognito. Un dominio propio se compra y exige Route 53 y ACM. | Registrar el dominio, un certificado y un alias en CloudFront. | Código (no hay Route 53 ni ACM en la plantilla) |

## 2. Identidad y acceso

| Mejora | Motivo | Por qué no está | Qué haría falta | Certeza |
|---|---|---|---|---|
| **Cognito Plus** (detección de contraseñas filtradas e inicios de sesión maliciosos) | COSTO | Esas funciones son **exclusivas del plan Plus**: USD 0.020 por usuario activo al mes, frente a USD 0.015 de Essentials y USD 0.0055 de Lite. | Cambiar `UserPoolTier` a `PLUS`. | Docs AWS (funciones de Plus). Precio AWS |
| **Managed login v2** (interfaz moderna de Cognito) | ALCANCE | Exige Essentials o Plus, y el pool **ya está en Essentials** (declarado en la plantilla, D15), así que el plan no lo impide. No se usa porque el Hosted UI clásico ya lleva la marca de la aplicación con CSS y nada lo necesita. | Cambiar `ManagedLoginVersion` y rehacer el estilo. | Docs AWS y Cuenta real |
| **Passkeys / sin contraseña** | ALCANCE | Requieren plan Essentials o superior y se apoyan en managed login. | Adoptar managed login v2 y habilitar el flujo. | Docs AWS |
| **MFA por SMS** | COSTO (y TÉCNICO) | Cobra por mensaje y necesita número de origen; una vez habilitado SMS como factor, solo se desactiva apagando el MFA entero. Se usa TOTP, disponible en todos los planes y sin costo por mensaje. Ya era una exclusión por costo en la primera especificación. | — | Docs AWS (TOTP en Lite, Essentials y Plus; SMS no se puede quitar). Origen: `specs/001` |
| **Correo con SES propio** | ALCANCE | Cognito con su configuración por defecto **limita los correos por día y por pool**; AWS indica que para producción típica ese límite queda corto. Alcanza para un curso. | Configurar Amazon SES y sacar la cuenta del *sandbox*. | Docs AWS |
| **IAM Identity Center y dejar de usar root** | PENDIENTE | Hoy se opera con la cuenta root (P3). Es la observación que más pesaría en una auditoría externa. No tiene costo propio. | Crear un usuario o un rol acotado y guardar el root con MFA. | Cuenta real |
| **Persistir la sesión tras recargar** | INNECESARIO (decisión) | Los tokens van solo en memoria como defensa contra XSS. Ver D6. | Un inicio de sesión silencioso, aún por probar. | Código |

## 3. Datos, copias y cifrado

| Mejora | Motivo | Por qué no está | Qué haría falta | Certeza |
|---|---|---|---|---|
| **PITR de DynamoDB** | **HECHO** (D18) | Activado con `EnablePitr=true` en el despliegue académico. Se factura **USD 0.20 por GB al mes** de copia: con tablas de decenas de megabytes son **centavos**. Siempre activo en `production`. | — | Precio AWS. Cuenta real: apagado hasta el despliegue de D18 |
| **Claves KMS propias** | COSTO | DynamoDB ya cifra en reposo con claves propiedad de AWS **sin cargo adicional**. Una clave propia cuesta **USD 1.00 al mes** más las solicitudes: cuatro tablas serían USD 4.00 al mes. | Una clave por tabla y permisos en cada función. | Docs AWS (cifrado sin cargo). Precio AWS |
| **VPC para las funciones** | COSTO (e INNECESARIO) | No hay recursos privados que aislar. Una función en VPC necesita NAT o endpoints para llegar a DynamoDB y Cognito; **una NAT cuesta unos USD 32.85 al mes fijos** (USD 0.045 por hora) más USD 0.045 por GB procesado. | Una VPC, subredes y endpoints o NAT. | Docs AWS (hace falta NAT o endpoints). Precio AWS |
| **Copias entre cuentas o regiones** | ALCANCE | Requiere más cuentas y más servicios; excede el curso. | AWS Backup con bóveda en otra cuenta. | Deducción |

## 4. Observabilidad y operación

| Mejora | Motivo | Por qué no está | Qué haría falta | Certeza |
|---|---|---|---|---|
| **AWS Budgets** (alerta de gasto) | **HECHO** (D14) | El proyecto lo exige. El presupuesto `aqp-solidaria-academic-monthly` (USD 5 al mes) existe en la cuenta, comprobado con el AWS CLI. La lista de precios solo cobra los presupuestos *con acciones* (USD 0.10 por día pasados los primeros 62 días-presupuesto al mes) y los informes enviados (USD 0.01 por mensaje); una alerta por correo no tiene cargo propio. | — | Precio AWS y Docs AWS. Cuenta real |
| **Alarmas de CloudWatch y SNS** | **HECHO EN LA PLANTILLA** (D17, falta activarlas) | Cuatro alarmas y un tópico SNS por correo, creados con `ALERT_EMAIL` tras reaplicar el bootstrap. **Cuestan USD 0.10 por alarma al mes** (unos USD 0.40); el correo de SNS incluye las primeras 1,000 notificaciones al mes gratis. | Reaplicar el bootstrap, hacer el push y confirmar la suscripción desde el correo. | Precio AWS. Que haya tramo gratuito de alarmas, no verificado |
| **CloudTrail** | COSTO | Opcional (`EnableCloudTrail`) y apagado en `samconfig.toml`. La lista de precios distingue eventos **gratuitos** y eventos **de pago** (USD 0.00002 cada uno, es decir USD 2.00 por 100,000), lo que es coherente con que la primera copia de eventos de gestión sea gratuita y las copias adicionales se cobren. **Hoy no hay ningún trail**, así que no queda registro de quién cambia la infraestructura. | `EnableCloudTrail=true`. | Precio AWS (la lista no dice cuál evento es cuál: la correspondencia se concluye por coherencia). Cuenta real: ningún trail |
| **GuardDuty** | COSTO | Tiene 30 días de prueba por región; después, p. ej. **USD 4.00 por millón de eventos de CloudTrail analizados** (hay otras fuentes de datos que también se cobran y no se cotizaron). Apagado por parámetro. | `EnableGuardDuty=true`, anotando la fecha en que acaba la prueba. | Docs AWS (prueba). Precio AWS. Cuenta real: no activado |
| **Security Hub** | COSTO | Tiene 30 días de prueba; después cobra por varias dimensiones (por hora y por eventos analizados). Apagado por parámetro. | `EnableSecurityHub=true`, con fecha de fin de prueba. | Docs AWS (prueba). Precio AWS (dimensiones de pago). Cuenta real: no activado |
| **Trazas con X-Ray** | PENDIENTE | La plantilla las desactiva (`Tracing: Disabled`) y no hay una razón documentada. Cobra por traza: USD 5.00 por millón almacenadas y USD 0.50 por millón consultadas. | Activar el trazado y revisar el tramo gratuito. | Código. Precio AWS. El tramo gratuito, no verificado |
| **Paneles de métricas** | ALCANCE | No se pidieron y el curso se evalúa con logs y auditoría. | Un tablero de CloudWatch. | Deducción |
| **Pruebas de carga** | ALCANCE | No existen. El control por donante se prueba con concurrencia real contra DynamoDB Local, no con carga sostenida. | Una herramienta de carga contra un stack de prueba. | Código |

## 5. Dominio: pagos y fraude

| Mejora | Motivo | Por qué no está | Qué haría falta | Certeza |
|---|---|---|---|---|
| **Pasarela de pagos real** | ALCANCE | El pago es simulado a propósito; en `production` ni existe el botón de simular, así que nada confirma una donación. | Una pasarela con un webhook firmado, y no enviar a cobrar lo que esté `EN_REVISION`. | Código |
| **Cierre de campaña** | PENDIENTE | Es una regla de dominio sin decidir (P2): hoy se puede donar mucho más que la meta y la interfaz lo oculta con un tope visual del 100 %. | Decidir si cuentan las pendientes, un estado `CERRADO` y su validación al donar. | Código |
| **Regla «todo marcado» más fina** | PENDIENTE | Una vez que salta una regla, las demás donaciones de esa hora también se retienen (P1). Puede inundar la cola del revisor. | Decidir si solo se marca la que cruza el umbral. | Código y tests |
| **Detección del fraccionamiento en días o semanas** | ALCANCE | Las ventanas son fijas por minuto y hora. Pasar a ventanas deslizantes complica la transacción para poco beneficio. | Contadores diarios o semanales y una nueva regla. | Repo |
| **Misma persona con varias cuentas, KYC y reporte a la UIF** | ALCANCE | Los controles son por cuenta (`sub`). El reporte a la UIF-Perú está declarado fuera del alcance. | Verificación de identidad y vincular cuentas. | Repo |
| **Revisión automática con aprendizaje automático** | ALCANCE | Las reglas son sencillas y explicables, que es lo que se evalúa; la revisión humana cubre lo dudoso. | Un modelo y datos reales para entrenarlo. | Deducción |
| **Postura del dispositivo y riesgo continuo** (NIST, principio 5) | COSTO (y TÉCNICO) | Declarado como cumplimiento parcial. Medirlo exige un agente o Verified Access, y el riesgo continuo de Cognito es del plan Plus (USD 0.020 por usuario activo al mes). | Verified Access o Cognito Plus. | Repo (`specs/002` seguimiento). Docs AWS (Plus). Precio AWS |

## 6. Plataforma y proceso

| Mejora | Motivo | Por qué no está | Qué haría falta | Certeza |
|---|---|---|---|---|
| **Varias cuentas de AWS (Organizations)** | COSTO | Unirse a una organización convierte la cuenta del plan gratuito en plan de pago. | Una organización con cuentas de producción, auditoría y registros. | Repo |
| **Verified Permissions con Cedar** | COSTO | Se cobra por solicitud de autorización: **USD 5.00 por millón** de solicitudes simples (USD 150 por millón en las solicitudes por lote del primer tramo). A este volumen sería casi nada; el motivo para no usarlo es que el motor propio ya cubre el caso y mantener dos motores confunde. Cedar queda como fase 2. | Un almacén de políticas y llamadas en `withAuth`. | Precio AWS. Que sea la fase 2, Repo |
| **Entornos separados con promoción** | ALCANCE | Hay dos etapas (`academic` y `production`) en una sola plantilla, pero no un flujo de promoción entre cuentas. | Cuentas y pipelines por entorno. | Código |
| **Despliegue gradual (canario)** | ALCANCE | El despliegue es directo tras pasar las pruebas. | Despliegues graduales de SAM con alarmas. | Deducción |
| **Que el CI también despliegue el *bootstrap*** | INNECESARIO (decisión de seguridad) | El *bootstrap* crea la identidad con la que el CI entra a AWS; si el pipeline pudiera cambiarlo, podría darse más permisos. Ver D7. | — | Código y Repo |
| **Una especificación `specs/003` retroactiva** | INNECESARIO (decisión) | Sería documentación hecha a posteriori. Ver D11. | Solo si la entrega lo exige. | — |

---

## 7. Qué ya era pendiente, y desde cuándo

Varios de los puntos anteriores **no son hallazgos de hoy**: el proyecto ya los había registrado. Esta tabla recoge dónde, para no presentarlos como descubrimientos nuevos ni como decisiones tomadas.

| Tema | Dónde ya constaba | Estado hoy |
|---|---|---|
| **Alerta de gasto en AWS Budgets** | Primera especificación (`specs/001`, RNF-09), `requirements.md` (CA-NF09.1), `design.md` (sección 7, paso 4) y la tabla de riesgos de `specs/001/plan.md`, que da por mitigado el riesgo de facturación inesperada con «AWS Budget alert configured on day 1». | **En la plantilla (D14), sin activar**: la cuenta no tiene presupuesto hasta aplicar el bootstrap y definir `ALERT_EMAIL`. |
| **Alarmas de CloudWatch y SNS** | [analisis-velocity-y-mejoras-pendientes.md](analisis-velocity-y-mejoras-pendientes.md), secciones 2.3 y 3.1 y fila 8 de su plan. | En la plantilla (D17), sin activar. |
| **Rol administrador dentro de la aplicación, y que no se conceda poder a sí mismo** | `specs/002-zta-hardening/followups.md` («Alta de roles») y la tarea T106 de `tasks.md`. | **Resuelto en parte**: el rol ADMIN y el script de operación existen (D2 a D4). **Falta** el flujo para que una persona *solicite* el rol de gestor, que era la otra mitad de T106. |
| **Revisión de las donaciones retenidas** (`EN_REVISION` sin salida) | `docs/threat-model.md` (límite declarado) y el análisis de velocity, sección 4.5. | **Resuelto** con el flujo de revisión. |
| **Cierre de campaña** | Análisis de velocity, sección 5. | Pendiente (P2). |
| **Exclusiones por costo: WAF, GuardDuty, SMS para MFA** | La tabla de riesgos de `specs/001/plan.md` («Accidental Billing in AWS Free Plan»), que ya las listaba como servicios que no se deben usar. | **Decisión original, vigente.** |
| **Postura del dispositivo** (Verified Access, Cognito Plus) | `specs/002-zta-hardening/followups.md`. | Límite declarado. |
| **Revocación en acciones no sensibles** (un token robado sirve hasta 15 minutos) | `specs/002-zta-hardening/followups.md` («Decisiones abiertas»). | Límite declarado (A7 de las decisiones). |

## 8. Un hallazgo de precios: el plan de Cognito (P6)

- **Qué pasa:** la plantilla **no declara** `UserPoolTier`, y la documentación de CloudFormation dice que el valor por defecto es `ESSENTIALS`. Por eso el pool desplegado está en Essentials: no fue una decisión, fue el valor por defecto.
- **Qué usa el proyecto:** Hosted UI clásico, MFA por aplicación autenticadora (TOTP), grupos, un servidor de recursos con scopes personalizados, disparadores de Lambda y renovación con refresh token. **Todo eso está disponible en el plan Lite**, según la tabla de funciones por plan de la documentación.
- **Qué cuesta:** en `us-east-1`, USD 0.0055 por usuario activo al mes en Lite y USD 0.015 en Essentials (USD 0.020 en Plus). Lite es unas 2.7 veces más barato por usuario.
- **Qué importa de verdad:** el tramo gratuito de usuarios **no figura en la lista de precios**, así que no se puede afirmar cuánto se paga hoy. Con unos 8 usuarios la diferencia es de **centavos**; solo pesaría a escala.
- **Qué se pierde con Lite:** managed login v2, passkeys, personalización del token de acceso y el MFA por correo, que el proyecto no usa.
- **Qué hay que probar antes de cambiar:** la revocación de tokens al cerrar sesión, el endpoint `userInfo` y el cierre de sesión del Hosted UI **no aparecen** en la tabla de funciones por plan, así que no se puede afirmar que sean idénticos en Lite. Se prueba en un stack de pruebas antes de tocar el real.
- **Un comentario de la plantilla es engañoso:** dice que managed login v2 exigiría un plan «que no es el gratuito», pero el pool ya corre en el plan que lo permite. Conviene corregirlo cuando se decida el plan.
- **Decisión tomada (D15):** se declara `UserPoolTier: ESSENTIALS`, sin cambiar lo desplegado, y se corrigió el comentario engañoso de la plantilla. Lite queda como mejora opcional, a probar antes en un stack de pruebas.

---

## 9. Las tres preguntas más probables, en una frase

- **«¿Por qué no hay load balancer?»** Porque el punto de entrada es API Gateway y detrás hay Lambda, que escala sola; un balanceador no tendría servidores que repartir y costaría unos USD 16 al mes fijos.
- **«¿Por qué no WAF ni límite por usuario en el gateway?»** Porque un HTTP API no admite WAF ni planes de uso por cliente (eso es de REST API); el límite por usuario está en el backend.
- **«¿Por qué no hay alarmas ni presupuesto?»** No es una decisión: es trabajo que el proyecto exige desde su primera especificación y cuesta centavos. El presupuesto ya existe (D14) y las alarmas están en la plantilla a la espera de activarse (D17).

## Cómo mantener este documento
- Cuando alguien proponga una mejora nueva, se añade a la tabla que corresponda con su motivo. Si no hubo una decisión real, el motivo es **PENDIENTE**, no se disfraza de otro.
- Cuando se implemente algo, se quita de aquí y se anota en [arquitectura-actual.md](arquitectura-actual.md).
- Los precios cambian: al reutilizar una cifra en una entrega, se vuelve a consultar la Price List o la calculadora de AWS.

## Fuentes consultadas (2026-11-09)

**Documentación de AWS**
- API Gateway, HTTP API frente a REST API: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html>
- Planes de uso y claves de API: <https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html>
- Limitación de tasa del HTTP API: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html>
- Concurrencia de Lambda: <https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html>
- Lambda en una VPC: <https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html>
- Funciones por plan de Cognito: <https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html>
- Propiedad `UserPoolTier` (valor por defecto `ESSENTIALS`): <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cognito-userpool.html>
- Correo por defecto de Cognito: <https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html>
- GuardDuty, prueba de 30 días: <https://docs.aws.amazon.com/guardduty/latest/ug/guardduty-pricing.html>
- Security Hub, prueba de 30 días: <https://docs.aws.amazon.com/securityhub/latest/userguide/what-is-securityhub.html>
- DynamoDB (tres zonas, tablas globales, cifrado con claves de AWS): <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html>
- Alertas de AWS Budgets: <https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html>

**Lista de precios de AWS (Price List API, `us-east-1`)**: servicios `AWSELB`, `awswaf`, `AWSBudgets`, `AWSCloudTrail`, `AmazonGuardDuty`, `AWSSecurityHub`, `AmazonCognito`, `awskms`, `AmazonDynamoDB`, `AmazonCloudWatch`, `AmazonSNS`, `AmazonEC2` (NAT Gateway), `AWSXRay` y `AmazonVerifiedPermissions`. Los tramos gratuitos no vienen en esa lista.
