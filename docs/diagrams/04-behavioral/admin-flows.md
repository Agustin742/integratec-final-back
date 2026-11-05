# Secuencias de administración y servicios del aula (S8 a S13)

> Gestión de escuela y aula, accesos, comunicación, tienda y consulta al Bot según la [ERS](../../functional-requirements.md). Nombres de guards, operaciones y respuestas no exigidas por RF son propuestas, no implementación.

**En este archivo**

- [1. Escenarios de administración y servicios](#1-escenarios-de-administración-y-servicios)
  - [1.1 S8 — Creación de aula](#11-s8--creación-de-aula)
  - [1.2 S9 — Invitación y alta en el aula](#12-s9--invitación-y-alta-en-el-aula)
  - [1.3 S10 — Baja lógica de un miembro](#13-s10--baja-lógica-de-un-miembro)
  - [1.4 S11 — Aviso con notificación](#14-s11--aviso-con-notificación)
  - [1.5 S12 — Compra en la tienda](#15-s12--compra-en-la-tienda)
  - [1.6 S13 — Consulta al Bot Guía de Estudio](#16-s13--consulta-al-bot-guía-de-estudio)

← [Secuencias del núcleo](./core-flows.md) · [Índice](../README.md) · [Convenciones](../05-reference/conventions.md) →

## 1. Escenarios de administración y servicios

Las escrituras pasan por NestJS, con autenticación, autorización contextual y validación, en ese orden ([Convenciones](../05-reference/conventions.md#12-orden-obligatorio-de-verificación)). Se difunde solo después de confirmar y solo a destinatarios autorizados. La autoridad docente es de quien dicta el aula o, por derivación de `SchoolMember`, del Dueño y del Admin de la escuela (RN-03). Todo es **diseño propuesto**, no implementado. Quedan fuera de esta serie, por ser MVP Extendido, la vinculación Padre-Alumno (RF-AUT-004), los controles de clase en vivo (RF-VIV) y la mascota del aula (RF-GAM-004); sus reglas están en la ERS.

### 1.1 S8 — Creación de aula

RF-AUL-001 (Must · MVP Core, HU-AUL-001; RN-01, RN-04). Un Profesor independiente o el Dueño/Admin de una escuela crean un aula. El `Classroom` pertenece a exactamente una `School` o a un Profesor independiente, y esa exclusión la garantiza la base de datos. Se inicializan en la misma transacción la `Pet`, los `Desk` base y los controles por defecto.

```mermaid
sequenceDiagram
    actor creator as Profesor o Dueño/Admin de Escuela
    participant web as React
    participant api as NestJS (ClassroomsController y ClassroomsService)
    participant auth as AuthorizationService
    participant db as RDS PostgreSQL

    creator->>web: completar nombre, materia y modalidad (adultMode)
    web->>api: crear aula
    api->>api: SessionAuthGuard valida la sesión
    api->>auth: ¿puede crear en la escuela o como Profesor independiente?
    alt Alumno o Padre/Tutor
        auth-->>api: sin autoridad docente
        api-->>web: 403
    else escuela ajena al actor
        auth-->>api: sin relación con la escuela
        api-->>web: 404 sin revelar existencia
    else autorizado
        api->>api: validar DTO
        api->>db: transacción: INSERT Classroom (schoolId o independentTeacherId), asignación docente, Pet, Desk base y controles por defecto
        db-->>api: aula creada
        api-->>web: aula con chatMuted, collaborationLocked y gamesDisabled en falso
    end
```

Dueño y Admin obtienen autoridad por su `SchoolMember`, sin una `ClassroomMembership` por aula. Cómo consta el profesor titular en el aula (`ClassroomMembership.role`) es **propuesto** y está **abierto** en [Data](../../../rules/data.md#entities). El alcance de lo que puede hacer un Admin frente al Dueño está **abierto** en [Classrooms and roles](../../../rules/classrooms-and-roles.md). La creación de la escuela y del espacio del Profesor independiente ocurre en el registro (S1).

### 1.2 S9 — Invitación y alta en el aula

RF-AUL-002 (Must · MVP Core, HU-AUL-002; RN-02). El Profesor del aula o el Dueño/Admin emiten una invitación por email o un código/enlace con vencimiento y revocación. Solo se guarda el hash del secreto. El rol lo fija la invitación y el invitado no puede cambiarlo. La validación y el alta de la membresía son una única operación atómica e idempotente.

```mermaid
sequenceDiagram
    actor teacher as Profesor o Dueño/Admin
    actor guest as Alumno invitado
    participant api as NestJS (InvitationsService y MembershipsService)
    participant db as RDS PostgreSQL
    participant mail as Servicio de email

    teacher->>api: emitir invitación para el aula con rol alumno
    api->>api: sesión y autoridad docente sobre el aula
    alt sin autoridad
        api-->>teacher: 403 (aula propia) o 404 (aula ajena)
    else autorizado
        api->>db: INSERT Invitation con secretHash, aula, rol y expiresAt
        db-->>api: invitación vigente
        api->>mail: enviar enlace por email (si es por correo)
        api-->>teacher: enlace o código copiable
    end
    teacher-->>guest: compartir invitación
    guest->>api: aceptar invitación autenticado (o registrarse primero)
    api->>db: transacción: validar secreto, estado, vencimiento y aula activa
    alt vencida, revocada, usada o aula dada de baja
        db-->>api: invitación no válida
        api-->>guest: rechazo con mensaje claro, sin membresía
    else ya es miembro activo
        db-->>api: membresía existente
        api-->>guest: ingresar sin duplicar la inscripción
    else alta permitida
        db-->>api: crear ClassroomMembership con el rol de la invitación y marcar uso
        api-->>guest: aula disponible
    end
```

La invitación es de un solo uso, vence y es revocable ([Classrooms and roles](../../../rules/classrooms-and-roles.md#invitations-and-membership)). Que un código o enlace compartido con varios alumnos admita varios usos no queda resuelto por esa regla y se considera **abierto**. Una invitación de Padre/Tutor sigue este mismo patrón pero pertenece a RF-AUT-004 (MVP Extendido) y se rechaza en aulas con `adultMode` (RN-16). El mecanismo de reintentos y rebotes del email está **abierto** en [Communication and notifications](../../../rules/communication-and-notifications.md). La invitación a la escuela (Dueño/Admin invitan Profesores, RF-AUL-004, MVP Extendido) es análoga con destino `schoolId`.

### 1.3 S10 — Baja lógica de un miembro

RF-AUL-003 (Must · MVP Core, HU-AUL-003; RN-03, RN-18). Dar de baja a un alumno corta de inmediato su acceso HTTP y su presencia en tiempo real, pero conserva entregas, calificaciones y mensajes atribuidos. No hay borrado físico.

```mermaid
sequenceDiagram
    actor staff as Profesor o Dueño/Admin
    participant web as React
    participant api as NestJS (MembershipsService)
    participant db as RDS PostgreSQL
    participant rt as RealtimePublisher
    participant colyseus as Colyseus (ClassroomRoom)
    actor student as Alumno dado de baja

    staff->>web: confirmar baja del alumno
    web->>api: dar de baja la membresía
    api->>api: sesión y autoridad docente sobre el aula
    alt aula de otro docente o escuela
        api-->>web: 404
    else sin autoridad dentro del aula
        api-->>web: 403
    else autorizado
        api->>db: marcar deletedAt en ClassroomMembership y liberar el Desk
        db-->>api: baja confirmada
        api->>rt: disconnectUser del aula
        rt->>colyseus: expulsar al alumno de la sala
        colyseus-->>student: conexión cerrada
        api-->>web: alumno fuera del padrón activo
    end
    student->>api: intentar leer el aula o reconectar
    api-->>student: sin acceso (404 en recursos del aula)
```

Los contenidos generados (entregas, notas, mensajes, asientos de puntos) se conservan íntegros para trazabilidad académica (RN-18). La propagación a la sala en vivo es un requisito ([Realtime and presence](../../../rules/realtime-and-presence.md)) cuyo mecanismo concreto está **abierto**; el diagrama usa `RealtimePublisher` como propuesta. Los efectos de eliminar una cuenta, un aula o una escuela sobre los registros retenidos siguen **abiertos** en [Data](../../../rules/data.md#open-decisions).

### 1.4 S11 — Aviso con notificación

RF-COM-001 y RF-COM-004 (Must · MVP Core, HU-COM-001 y HU-COM-004). El aviso pertenece a la cartelera del aula. El aviso y su notificación son durables en PostgreSQL y el correo es un canal con envío idempotente. La difusión en vivo ocurre solo después de persistir.

```mermaid
sequenceDiagram
    actor author as Profesor o Dueño/Admin
    participant web as React
    participant api as NestJS (NotificationsService)
    participant db as RDS PostgreSQL
    participant mail as Servicio de email
    participant rt as RealtimePublisher
    actor reader as Alumno del aula

    author->>web: redactar aviso
    web->>api: publicar aviso en el aula
    api->>api: sesión y autoridad docente sobre el aula
    alt Alumno o Padre/Tutor
        api-->>web: 403
    else autorizado
        api->>db: INSERT Announcement y Notification por destinatario con acceso
        db-->>api: persistido
        api->>mail: enqueueEmail con unicidad por notificación y canal
        api->>rt: avisar a conectados del aula
        api-->>web: aviso publicado
    end
    mail-->>reader: correo con el aviso (cuerpo sin datos sensibles)
    reader->>api: abrir centro de notificaciones
    api->>db: leer Notification del propio usuario
    api->>db: marcar readAt al leerla
```

Los destinatarios son los alumnos matriculados y, en el MVP Extendido, los Padres/Tutores de los hijos vinculados **si la decisión de producto lo permite**: queda **abierto** en [Communication and notifications](../../../rules/communication-and-notifications.md). Un alumno nunca ve notificaciones ajenas, y la baja de acceso al aula quita la lectura. También **abiertos**: frecuencia, resumen versus envío inmediato para padres, opción de baja de correos no esenciales, y registro y supresión de rebotes. Los correos y los registros nunca incluyen contraseñas, tokens ni datos sensibles de menores (RN-20).

### 1.5 S12 — Compra en la tienda

RF-GAM-003 (Must · MVP Core, HU-GAM-003; RN-09, RN-07). La compra debita puntos y otorga el ítem en una única transacción con bloqueo, de modo que el saldo no queda negativo ni siquiera ante dos peticiones concurrentes.

```mermaid
sequenceDiagram
    actor alumno as Alumno
    participant web as React (ShopPanel)
    participant api as NestJS (ShopService)
    participant ledger as PointsLedgerService
    participant db as RDS PostgreSQL
    participant rt as RealtimePublisher

    alumno->>web: elegir ítem de la tienda del aula
    web->>api: comprar ítem con clave de idempotencia (propuesto)
    api->>api: sesión y matrícula en el aula
    alt ítem de otra aula
        api-->>web: 404
    else autorizado
        api->>db: transacción: bloquear el saldo del alumno y leer ShopItem
        api->>ledger: debit (alumno, pointsCost, origen compra)
        alt saldo insuficiente o ítem no disponible
            ledger-->>api: rechazo sin escribir
            api-->>web: compra rechazada, saldo sin cambios
        else compra repetida (misma clave)
            db-->>api: resultado ya registrado
            api-->>web: mismo resultado, sin doble débito
        else compra válida
            ledger->>db: INSERT PointsTransaction negativo y ClassroomItem
            db-->>api: confirmado
            api->>rt: actualizar vista del aula si el ítem es visible
            api-->>web: ítem otorgado y nuevo saldo
        end
    end
```

El libro mayor es inmutable: no se edita ni se borra un asiento (RN-07). Un ítem solo es comprable si su efecto está implementado (RN-09). Siguen **abiertos** en [Points and shop](../../../rules/points-and-shop.md): reembolsos (si existen son asientos compensatorios), ítems consumibles o permanentes, apilado y límites por aula, quién puede comprar y equipar accesorios, y el saldo visible entre compañeros (por defecto no se muestra). El aporte a la mascota (RF-GAM-004) es MVP Extendido y sigue la misma mecánica con `pet_contribution`.

### 1.6 S13 — Consulta al Bot Guía de Estudio

RF-BOT-001 y RF-BOT-002 (Must · MVP Core, HU-BOT-001 y HU-BOT-002; RN-12, RN-13, RN-14). El Bot responde por RAG solo sobre el material que el Profesor habilitó para el aula, es solo de lectura y se bloquea para el alumno mientras tiene un examen en curso. Bedrock se invoca únicamente desde NestJS.

```mermaid
sequenceDiagram
    actor alumno as Alumno
    participant web as React (BotPanel)
    participant api as NestJS (BotController y BotService)
    participant db as RDS PostgreSQL
    participant tools as ReadOnlyToolRegistry
    participant bedrock as Amazon Bedrock

    alumno->>web: escribir una consulta
    web->>api: preguntar al Bot en un aula
    api->>api: sesión y matrícula en el aula
    alt Padre/Tutor
        api-->>web: 403 (sin acceso al Bot)
    else examen en curso según el reloj del servidor
        api-->>web: Bot bloqueado para este alumno
    else límite de uso excedido (límite abierto)
        api-->>web: mensaje claro de límite alcanzado
    else autorizado
        api->>db: recuperar fragmentos de AllowedMaterial del aula
        api->>tools: consultas de solo lectura bajo los permisos del usuario
        api->>bedrock: consulta, fragmentos y reglas anticopia
        bedrock-->>api: respuesta con citas al material
        alt la respuesta no consta en el material aprobado
            api-->>web: informar la limitación sin inventar contenido
        else pide resolver una tarea o revelar respuestas de examen
            api-->>web: orientar el razonamiento sin resolver
        else respuesta fundada
            api->>db: registrar metadatos de auditoría pedagógica (BotConversation, abierto)
            api-->>web: respuesta con fuentes citadas
        end
    end
```

El filtro por aula y material habilitado se aplica en el servidor antes de invocar a Bedrock, y el Bot no crea, edita ni borra datos en el MVP, ni siquiera ante un pedido explícito (RN-14, RF-BOT-004). Siguen **abiertos** en [AI bot and daily briefing](../../../rules/ai-bot-and-daily-briefing.md): modelo concreto, límites numéricos por usuario, aula y global, si se persiste `BotConversation` y su retención, la detección de uso indebido y la extensión de las pruebas adversarias. Verificar la disponibilidad de modelos de Bedrock en `us-east-2` es una condición pendiente de la decisión D5.

---

← [Secuencias del núcleo](./core-flows.md) · [Índice](../README.md) · [Convenciones](../05-reference/conventions.md) →
