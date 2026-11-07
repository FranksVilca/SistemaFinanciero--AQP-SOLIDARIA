# Feature Specification: Cumplimiento Zero Trust de la plataforma (arquitectura objetivo)

**Feature Branch**: `002-zta-hardening`

**Created**: 2026-11-08

**Status**: Draft

**Input**: User description: "Corregir todo lo necesario para cumplir con Zero Trust, siguiendo la arquitectura objetivo (docs/diagrams/zta-architecture-target.d2) y las mejoras del documento docs/zta-hallazgos-y-mejoras.md."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El flujo principal de donación funciona de punta a punta (Priority: P1)

Un donante crea una donación y el sistema la confirma. Hoy la confirmación falla con un error interno (H1), de modo que el flujo central de la plataforma no se puede completar, y las pruebas actuales no lo detectan porque no usan una base de datos real o emulada.

**Why this priority**: Sin esto la plataforma no cumple su propósito. Además es el cambio más pequeño y de mayor impacto, y es el que demuestra por qué hacen falta pruebas contra una base de datos real.

**Independent Test**: Ejecutar el flujo crear donación → confirmar contra una base de datos emulada y verificar que la donación queda confirmada y el total del proyecto se actualiza una sola vez.

**Acceptance Scenarios**:

1. **Given** un proyecto publicado y una donación pendiente del donante, **When** el donante confirma la donación, **Then** la donación queda confirmada y el total recaudado del proyecto aumenta exactamente en el monto de la donación.
2. **Given** una donación ya confirmada, **When** se intenta confirmar de nuevo o cambiar su estado, **Then** el sistema responde con conflicto y el total no cambia.
3. **Given** la misma solicitud repetida con la misma clave de idempotencia, **When** se reenvía, **Then** devuelve la misma donación sin duplicar montos.

---

### User Story 2 - Gestores y auditores solo entran con segundo factor (Priority: P1)

Una persona con rol de gestor o auditor no puede iniciar sesión solo con contraseña: debe completar un segundo factor. Hoy el segundo factor es opcional (H2), aunque los documentos y el diagrama lo declaran obligatorio.

**Why this priority**: Los roles privilegiados son el objetivo principal de un atacante. Es una brecha entre lo declarado y lo real.

**Independent Test**: Intentar iniciar sesión como gestor y como auditor sin segundo factor y comprobar que no se obtiene acceso; con segundo factor, sí.

**Acceptance Scenarios**:

1. **Given** un usuario del grupo gestor o auditor sin segundo factor completado, **When** intenta iniciar sesión, **Then** no obtiene un token de acceso.
2. **Given** un usuario gestor con segundo factor configurado, **When** inicia sesión con contraseña y segundo factor, **Then** obtiene acceso con las capacidades de su rol.
3. **Given** un donante que inicia sesión por primera vez, **When** configura su segundo factor una sola vez, **Then** en adelante accede con contraseña y segundo factor igual que los demás roles (el servicio de identidad no permite exigirlo solo a ciertos grupos sin duplicar la gestión de usuarios).

---

### User Story 3 - Toda ruta protegida se autoriza siempre, y una ruta nueva no puede olvidarlo (Priority: P1)

La decisión de autorización (rol, propietario del recurso, estado) se aplica de forma obligatoria y única a cada operación protegida. Hoy cada operación debe acordarse de invocarla (H3): si una nueva la olvida, queda abierta sin aviso.

**Why this priority**: Es la garantía central de Zero Trust: ninguna solicitud llega a los datos sin haber sido decidida. Una autorización opcional equivale a ninguna.

**Independent Test**: Añadir una operación de prueba sin autorización y comprobar que la verificación automática del proyecto falla; ejecutar la matriz rol × acción y comprobar que cada combinación no permitida es rechazada.

**Acceptance Scenarios**:

1. **Given** cualquier operación protegida del sistema, **When** se inspecciona el proyecto, **Then** toda operación declara su acción de autorización y no existe forma de exponerla sin ella.
2. **Given** una operación nueva sin autorización declarada, **When** corre la verificación automática, **Then** falla y bloquea la integración.
3. **Given** un donante o gestor distinto del propietario, **When** intenta leer o cambiar una donación ajena, **Then** recibe denegación y el estado del recurso no cambia.
4. **Given** una solicitud sin identidad válida, **When** llega a cualquier operación protegida, **Then** se rechaza como no autenticada, de forma uniforme.
5. **Given** que el motor de decisión falla o no puede evaluar, **When** llega una solicitud, **Then** se deniega (falla cerrado).

---

### User Story 4 - La auditoría es completa, pseudonimizada e inalterable (Priority: P2)

Un auditor puede reconstruir quién intentó qué y con qué resultado, incluidos los intentos denegados. Los eventos no contienen el identificador real del usuario, y ningún componente de la aplicación puede modificar o borrar eventos ya escritos (H5).

**Why this priority**: La evidencia es la base del monitoreo y de la mejora continua (principios 5 y 7 de NIST). Hoy solo se registran éxitos, parte de los eventos guarda el identificador en crudo y varias funciones pueden editar o borrar la tabla.

**Independent Test**: Provocar un rechazo por rol, un rechazo por falta de identidad y una acción exitosa; verificar que los tres quedan registrados con actor pseudonimizado, y que ninguna función de la aplicación puede editar ni borrar eventos.

**Acceptance Scenarios**:

1. **Given** una solicitud denegada (401 o 403), **When** se procesa, **Then** se registra un evento con acción, resultado, actor pseudonimizado y `requestId`.
2. **Given** cualquier evento de auditoría, **When** se consulta, **Then** el identificador del usuario aparece siempre como seudónimo, nunca en crudo.
3. **Given** una función cualquiera de la aplicación, **When** intenta editar o borrar un evento ya escrito, **Then** el permiso se lo impide.
4. **Given** el auditor, **When** consulta eventos, **Then** ve éxitos y denegados; ningún otro rol puede consultarlos.
5. **Given** que el registro de auditoría falla al escribir en una acción sensible, **When** ocurre, **Then** el fallo queda registrado en los logs y la operación se trata de forma explícita (sin ocultarlo).

---

### User Story 5 - Cada función tiene solo los permisos que necesita (Priority: P2)

Cada función del backend opera con permisos mínimos: solo lectura donde solo lee, sin borrado en ninguna que no lo necesite, sin comodines (H6). Los permisos se verifican por pruebas, incluida una prueba de acceso denegado por permiso insuficiente (T10).

**Why this priority**: Limita el daño si una función se compromete (principio de suposición de brecha).

**Independent Test**: Revisar la definición de permisos de cada función contra una lista de acciones permitidas, y ejecutar una operación fuera de lo permitido comprobando que se deniega por permisos.

**Acceptance Scenarios**:

1. **Given** la función que solo lista proyectos, **When** intenta escribir en cualquier tabla, **Then** recibe acceso denegado.
2. **Given** cualquier función, **When** se analiza su política de permisos, **Then** no incluye borrado ni comodines salvo justificación documentada.
3. **Given** la función de confirmación de donación, **When** intenta modificar eventos de auditoría, **Then** recibe acceso denegado.

---

### User Story 6 - Telemetría, límites de entrada y red reproducibles desde el código (Priority: P2)

Los registros con retención de 14 días, el registro de cambios de la cuenta, el origen permitido para el navegador, los límites de peticiones por ruta y las direcciones de retorno de inicio y cierre de sesión están definidos en la infraestructura como código y son reproducibles, no configurados a mano (H7, H8).

**Why this priority**: Lo que no está en el código no se puede revisar, repetir ni auditar. Hoy además el inicio de sesión desplegado no funcionaría por apuntar solo a localhost.

**Independent Test**: Desplegar desde cero y comprobar que existen los registros con retención, el registro de cambios, el origen permitido restringido, los límites por ruta y las direcciones de producción, sin pasos manuales.

**Acceptance Scenarios**:

1. **Given** un despliegue desde cero, **When** termina, **Then** cada función tiene su grupo de registros con retención de 14 días y existe el registro de cambios de la cuenta.
2. **Given** una petición desde un origen distinto al del dominio propio, **When** el navegador la hace, **Then** no se permite.
3. **Given** ráfagas de peticiones a las rutas públicas, **When** superan el límite por ruta, **Then** el sistema responde con límite excedido.
4. **Given** el despliegue de producción, **When** una persona inicia y cierra sesión, **Then** se redirige a las direcciones de producción.

---

### User Story 7 - La integración continua demuestra la seguridad antes de desplegar (Priority: P2)

Cada cambio ejecuta pruebas de integración contra una base de datos emulada que cubren la matriz de roles, la propiedad del recurso (BOLA), idempotencia, validación y estados, y analiza el template con herramientas de seguridad. Solo se despliega si todo pasa (H11).

**Why this priority**: Es lo que habría detectado H1 y lo que impide regresiones de seguridad.

**Independent Test**: Introducir deliberadamente un permiso excesivo y un error de expresión de actualización y comprobar que la integración continua falla en ambos casos.

**Acceptance Scenarios**:

1. **Given** un cambio con una expresión de base de datos inválida, **When** corre la integración continua, **Then** falla.
2. **Given** un cambio que añade un permiso con comodín o borrado, **When** corre el análisis del template, **Then** falla o requiere justificación explícita.
3. **Given** que alguna prueba o análisis falla, **When** se intenta desplegar, **Then** el despliegue no ocurre.
4. **Given** el código y la configuración de formato y estilo, **When** corre la integración, **Then** se comprueban las reglas de complejidad, tamaño de función, tipos y formato de la constitución (principio VII).

---

### User Story 8 - Los datos críticos se pueden recuperar y no se borran por accidente (Priority: P3)

Las donaciones, proyectos y eventos de auditoría tienen protección contra borrado y se pueden recuperar a un punto anterior en el tiempo (mejora 12).

**Why this priority**: Protege la integridad de los datos financieros simulados y de la evidencia, pero no bloquea el cumplimiento de los principios principales.

**Independent Test**: Verificar que borrar una tabla crítica está bloqueado y que existe un punto de recuperación disponible.

**Acceptance Scenarios**:

1. **Given** una tabla de datos críticos, **When** alguien intenta eliminarla, **Then** la operación es rechazada.
2. **Given** una corrupción de datos, **When** se solicita recuperación, **Then** existe un punto en el tiempo al que restaurar.

---

### User Story 9 - Sesión revalidada en acciones sensibles (Priority: P3)

En acciones sensibles (publicar proyecto, ver auditoría, confirmar donación) el sistema comprueba que la sesión no ha sido revocada, de modo que un token robado deje de servir antes de su expiración natural (H9).

**Why this priority**: Reduce la ventana de uso de un token robado de hasta 15 minutos a un valor cercano a cero en las acciones que más importan.

**Independent Test**: Revocar la sesión de un usuario y comprobar que una acción sensible con su token todavía vigente es rechazada, mientras las acciones de lectura pública siguen funcionando.

**Acceptance Scenarios**:

1. **Given** un token vigente pero con la sesión revocada, **When** se llama a una acción sensible, **Then** se rechaza.
2. **Given** una sesión activa, **When** se llama a una acción sensible, **Then** se acepta sin fricción visible para la persona.
3. **Given** que no se puede comprobar la sesión, **When** se llama a una acción sensible, **Then** se rechaza (falla cerrado).

---

### User Story 10 - Lo declarado coincide con lo implementado (Priority: P3)

Los documentos, el uso de IA y los diagramas dicen solo lo que existe. El código de motor de políticas externo que nadie invoca se retira o se marca como fase 2, y se corrigen los textos que lo presentan como hecho (H4). Se corrige también la expresión errónea en el documento de investigación, de donde nació H1, y la declaración de herramientas de IA usadas.

**Why this priority**: Una arquitectura que declara más de lo que hace es un riesgo de gobierno; es la inconsistencia que reveló la revisión.

**Independent Test**: Cruzar cada afirmación de seguridad de los documentos con su evidencia (código, template o prueba) y comprobar que no queda ninguna sin respaldo.

**Acceptance Scenarios**:

1. **Given** el documento de uso de IA, **When** se lee, **Then** no declara capacidades inexistentes y lista todas las herramientas de IA usadas.
2. **Given** el repositorio, **When** se busca código de autorización que ningún flujo invoca, **Then** no existe o está claramente marcado como fase 2 sin ser presentado como activo.
3. **Given** el documento de hallazgos, **When** se revisa tras la implementación, **Then** el estado de cada hallazgo (H1–H11) refleja la realidad.

---

### Edge Cases

- ¿Qué ocurre si la escritura de auditoría falla durante una acción exitosa? Debe quedar en logs y tratarse según una regla explícita (no perderse en silencio).
- ¿Qué ocurre con un ID token enviado en lugar de un access token? Debe rechazarse como no autenticado.
- ¿Qué ocurre con un grupo de nombre parecido a un rol (`GESTOR_FAKE`)? No otorga el rol.
- ¿Qué ocurre si un usuario de rol privilegiado aún no ha configurado el segundo factor? Debe guiarse la configuración antes de dar acceso, no dejar entrar solo con contraseña.
- ¿Qué ocurre si una operación de autorización no puede cargar el recurso para comparar propietario? Se deniega.
- ¿Qué ocurre con los eventos de auditoría de un usuario que luego es eliminado? El seudónimo se conserva sin permitir reidentificación directa.
- ¿Qué ocurre al restaurar a un punto en el tiempo con transacciones recientes? Debe documentarse el efecto sobre totales de proyectos.

## Requirements *(mandatory)*

### Functional Requirements

**Flujo principal**
- **FR-001**: El sistema MUST permitir confirmar una donación pendiente y actualizar el total del proyecto en una sola operación atómica.
- **FR-002**: El sistema MUST rechazar con conflicto todo segundo cambio de estado de una donación ya confirmada, sin alterar totales.

**Identidad**
- **FR-003**: El sistema MUST exigir segundo factor a todo usuario de rol gestor o auditor antes de entregarle acceso.
- **FR-004**: Los tokens de acceso MUST mantener una vida máxima de 15 minutos y el ID token MUST ser rechazado como credencial de API.
- **FR-005**: Las direcciones de retorno de inicio y cierre de sesión MUST incluir las de producción y excluir las no usadas en ese entorno.

**Autorización**
- **FR-006**: Toda operación protegida MUST pasar por un único mecanismo obligatorio de autorización que decide por rol, grupo, acción, propietario del recurso y estado.
- **FR-007**: El sistema MUST contar con una verificación automática que falle si alguna operación protegida no usa ese mecanismo.
- **FR-008**: La autorización MUST fallar cerrado ante cualquier error del motor de decisión.
- **FR-009**: Cada operación MUST usar la acción de autorización que describe su intención real (por ejemplo, consultar el historial propio no debe usar la acción de crear).
- **FR-010**: El sistema MUST rechazar solicitudes sin identidad válida de forma uniforme como no autenticadas.

**Auditoría**
- **FR-011**: El sistema MUST registrar eventos de auditoría para éxitos y para denegaciones (401/403), con acción, resultado, actor pseudonimizado, instante y `requestId`.
- **FR-012**: El identificador del usuario MUST estar siempre pseudonimizado en la auditoría, y su escritura MUST centralizarse en un único punto.
- **FR-013**: Ningún componente de la aplicación MUST poder editar ni borrar eventos de auditoría ya escritos; solo agregar nuevos.
- **FR-014**: Solo el rol auditor MUST poder consultar los eventos de auditoría.
- **FR-015**: Los logs MUST NOT incluir identificadores personales de donantes ni tokens ni secretos.

**Privilegio mínimo**
- **FR-016**: Cada función MUST tener su propio rol con solo las acciones y tablas necesarias, sin comodines ni borrado salvo justificación documentada.
- **FR-017**: Debe existir evidencia automatizada de acceso denegado por permiso insuficiente (T10).

**Telemetría y red**
- **FR-018**: Los registros de todas las funciones MUST tener retención de 14 días definida en la infraestructura como código.
- **FR-019**: El registro de cambios de la cuenta MUST estar definido en la infraestructura como código.
- **FR-020**: El origen permitido para el navegador MUST limitarse al dominio propio.
- **FR-021**: Cada ruta pública MUST tener un límite de peticiones propio.

**Verificación**
- **FR-022**: La integración continua MUST ejecutar pruebas contra una base de datos emulada que cubran la matriz rol × acción, BOLA, idempotencia, validación y estados.
- **FR-023**: La integración continua MUST analizar el template de infraestructura con herramientas de seguridad y de sintaxis, y bloquear el despliegue si fallan.
- **FR-024**: La integración continua MUST comprobar las reglas de calidad de código del principio VII: complejidad, tamaño de función, prohibición de tipos no justificados y formato.
- **FR-025**: Las pruebas del proyecto MUST NOT reemplazar con simulaciones el comportamiento que verifican (por ejemplo, una expresión de base de datos).

**Detección**
- **FR-031**: El sistema MUST permitir activar, mediante parámetros del despliegue, los servicios de detección de amenazas con prueba gratuita de 30 días (detección de amenazas y centro de hallazgos de seguridad), apagados por defecto, y la documentación MUST indicar la fecha de fin de la prueba y cómo apagarlos para no generar costo.

**Integridad de datos**
- **FR-026**: Las tablas de donaciones, proyectos y auditoría MUST tener protección contra borrado y recuperación a un punto en el tiempo.

**Sesión**
- **FR-027**: Las acciones sensibles MUST revalidar que la sesión no esté revocada y MUST fallar cerrado si no se puede comprobar.

**Coherencia documental**
- **FR-028**: Toda afirmación de seguridad en los documentos MUST tener evidencia en código, plantilla o prueba; las que no, se corrigen o se marcan como fase 2.
- **FR-029**: El código de motor de políticas externo sin uso MUST retirarse o marcarse como fase 2 sin presentarse como activo.
- **FR-030**: El documento de uso de IA MUST listar todas las herramientas de IA usadas y no declarar funciones inexistentes.

### Key Entities *(include if feature involves data)*

- **Evento de auditoría**: registro inmutable de una decisión de acceso. Atributos: instante, acción, resultado (permitido o denegado, con motivo), actor pseudonimizado, recurso afectado y `requestId`.
- **Donación**: promesa de aporte simulada de un donante a un proyecto, con estado, monto en céntimos y clave de idempotencia. Pertenece a un único donante.
- **Proyecto**: causa que recibe donaciones, con estado de publicación y total recaudado; su total depende de las donaciones confirmadas.
- **Decisión de autorización**: resultado de evaluar rol, grupo, acción, propietario y estado para una solicitud; permitido o denegado, siempre con motivo.
- **Operación protegida**: cada acción del backend que requiere identidad; declara su acción de autorización.
- **Hallazgo (H1–H11)**: brecha identificada en `docs/zta-hallazgos-y-mejoras.md`, con estado al cierre de este trabajo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100 % de los intentos de confirmar una donación válida terminan con éxito en la verificación contra base de datos emulada.
- **SC-002**: El 100 % de las operaciones protegidas declaran su autorización, y la verificación automática falla ante una que no la declare.
- **SC-003**: El 100 % de las combinaciones rol × acción no permitidas y de los accesos a recursos ajenos son rechazados, sin cambiar el estado del recurso.
- **SC-004**: Ningún usuario de rol gestor o auditor obtiene acceso sin segundo factor en las pruebas de aceptación.
- **SC-005**: El 100 % de los eventos de auditoría, de éxito y denegación, muestran el actor pseudonimizado, y 0 funciones de la aplicación pueden editar o borrar eventos.
- **SC-006**: 0 funciones con permisos de borrado o comodines no justificados.
- **SC-007**: Un despliegue desde cero deja registros con retención de 14 días, registro de cambios, límites por ruta y origen restringido, sin pasos manuales.
- **SC-008**: Un cambio que reintroduce un fallo conocido (expresión inválida, permiso excesivo, ruta sin autorización) hace fallar la integración continua en el 100 % de los casos.
- **SC-009**: En acciones sensibles, una sesión revocada es rechazada en menos de 1 minuto desde la revocación.
- **SC-010**: Los 7 principios de NIST SP 800-207 tienen su estado actualizado con evidencia; los principios 3, 6 y 7 pasan de parcial a cumple, y el 5 queda como parcial declarado.
- **SC-011**: 0 afirmaciones de seguridad en los documentos sin evidencia respaldatoria.
- **SC-012**: El conjunto completo de pruebas y análisis se ejecuta en menos de 10 minutos en la integración continua.

## Assumptions

- Se sigue la arquitectura objetivo `zta-architecture-target.d2` ("mejorada"); la arquitectura "ideal" (varias cuentas, WAF, GuardDuty, passkeys, servicios de pago y notificaciones) queda fuera de alcance por el plan gratuito de AWS y la constitución.
- Se mantienen 9 funciones, una por endpoint, con un solo código fuente: el aislamiento por función es una decisión Zero Trust (mínimo privilegio) y no cambia.
- Se mantiene un solo repositorio; reorganizar carpetas en paquetes es opcional y posterior a que `authz` y auditoría sean módulos propios.
- Verified Permissions con Cedar es **fase 2**: en este trabajo se retira o marca como no activo el código sin uso, y se corrigen los documentos, en lugar de conectarlo.
- La auditoría usa una tabla con permisos de solo agregar dentro de la misma cuenta; mover la auditoría a otra cuenta de AWS queda como mejora ideal.
- El segundo factor de roles privilegiados es por aplicación autenticadora (TOTP); no se usa SMS por la constitución.
- El dominio propio de producción se conoce o se parametriza por entorno; no hay un dominio único codificado.
- Los rechazos 401 que emite la pasarela antes de llegar al backend no pueden escribirse en la tabla de auditoría; quedan en los registros de acceso de la pasarela. Los 401 y 403 que decide el backend sí se auditan.
- El objetivo es aprovechar lo que ofrece el plan gratuito de AWS, incluidas las pruebas de 30 días (constitución v2.2.0, principio V). Hay un único archivo de despliegue; las etapas solo difieren en parámetros y condiciones de costo o de borrado.
- GuardDuty y Security Hub se ofrecen como parámetros apagados por defecto. Su disponibilidad depende del tipo de cuenta (plan gratuito o de pago); la documentación de AWS asocia las pruebas de corta duración al plan de pago, y esto se confirma en la consola de Billing antes de activarlos.
- WAF (no se asocia a una HTTP API), SMS MFA, Verified Permissions y varias cuentas con Organizations quedan fuera: Organizations convierte la cuenta en plan de pago.
- La protección contra borrado de tablas se activa solo en la etapa de producción, para no impedir la limpieza completa de la etapa académica (constitución, principio V). La recuperación a un punto en el tiempo no es gratuita (centavos con estos volúmenes) y se controla con un parámetro apagado por defecto.
- La revalidación de sesión cuenta como mejora de prioridad baja y puede entregarse después de las de prioridad alta y media.
- No se pudo probar contra AWS real el rechazo de tokens por API Gateway, la configuración real de Cognito ni la evidencia T10 completa; la validación de esas partes requiere un despliegue real y se registra como evidencia pendiente hasta entonces.
- Dependencias: acceso a una cuenta de AWS para las pruebas finales, un emulador de base de datos en la integración continua y las constantes de la constitución v2.1.0.
