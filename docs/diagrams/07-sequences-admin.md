# Secuencias de administración (S8 a S12)

> Invitaciones, solicitudes de ingreso, expulsión, anuncios y control de permisos. Parte del [índice de diagramas](./README.md).

**En este archivo**

- [9. Escenarios de administración](#9-escenarios-de-administración)
  - [1.1 S8 — Admin crea una invitación y un miembro la canjea](#11-s8--admin-crea-una-invitación-y-un-miembro-la-canjea)
  - [1.2 S9 — Solicitud de ingreso y aprobación](#12-s9--solicitud-de-ingreso-y-aprobación)
  - [1.3 S10 — Moderador o Admin expulsa a un miembro](#13-s10--moderador-o-admin-expulsa-a-un-miembro)
  - [1.4 S11 — Publicar un anuncio o reunión y confirmar asistencia](#14-s11--publicar-un-anuncio-o-reunión-y-confirmar-asistencia)
  - [1.5 S12 — Moderador intenta una acción exclusiva del Admin](#15-s12--moderador-intenta-una-acción-exclusiva-del-admin)

← [Secuencias del núcleo (S1 a S7)](./06-sequences-core.md) · [Índice](./README.md) · [Convenciones transversales](./08-conventions.md) →

---

## 9. Escenarios de administración

Escenarios de gestión de la sala. Siguen las mismas convenciones que las [secuencias del núcleo](./06-sequences-core.md): REST hacia NestJS, difusión por Colyseus solo después de confirmar la escritura, y orden autenticación → autorización → validación → escritura.

### 1.1 S8 — Admin crea una invitación y un miembro la canjea

```mermaid
sequenceDiagram
    actor admin as Admin de sala
    actor guest as Usuario invitado
    participant web as React
    participant api as NestJS
    participant db as RDS PostgreSQL
    participant colyseus as Colyseus

    admin->>web: pedir invitación para la sala
    web->>api: POST de invitación (propuesto)
    api->>api: JwtAuthGuard y RoomAdminGuard
    alt no es Admin de la sala
        api-->>web: 403 sin permisos
    else es Admin
        api->>db: INSERT Invitation con hash del código
        db-->>api: fila confirmada
        api-->>web: 201 con el código en claro, una sola vez
    end
    admin-->>guest: compartir enlace o código
    guest->>web: abrir el enlace
    web->>api: POST de canje con el código
    api->>api: validar sesión y DTO
    api->>db: SELECT Invitation vigente y INSERT Membership(member)
    alt invitación expirada, revocada o agotada
        db-->>api: sin invitación válida
        api-->>web: 410 invitación no válida (propuesto)
    else canje válido
        db-->>api: membresía confirmada y usedCount incrementado
        api-->>web: 201 con la sala
        api->>colyseus: notificar member:joined
        colyseus->>colyseus: difundir a la sala si hay presentes
    end
```

El código se devuelve en claro una sola vez y solo se guarda su hash. El incremento de `usedCount` y la creación de la `Membership` van en la misma transacción para que dos canjes simultáneos no superen `maxUses`.

### 1.2 S9 — Solicitud de ingreso y aprobación

```mermaid
sequenceDiagram
    actor user as Usuario solicitante
    actor admin as Moderador o Admin
    participant web as React
    participant api as NestJS
    participant db as RDS PostgreSQL
    participant colyseus as Colyseus

    user->>web: pedir acceso a una sala
    web->>api: POST de solicitud (propuesto)
    api->>db: INSERT JoinRequest pending
    alt ya existe una solicitud pendiente
        db-->>api: violación de unicidad
        api-->>web: 409 solicitud ya enviada
    else solicitud creada
        db-->>api: fila confirmada
        api-->>web: 201
        api->>colyseus: joinrequest:created a los Admins
        colyseus-->>admin: notificación de solicitud
    end
    admin->>web: aprobar o rechazar
    web->>api: POST de resolución
    api->>api: JwtAuthGuard y RoomModeratorGuard
    alt aprobada
        api->>db: UPDATE JoinRequest y INSERT Membership(member)
        api->>colyseus: member:joined a la sala
        api-->>web: 200
    else rechazada
        api->>db: UPDATE JoinRequest rejected
        api-->>web: 200
    end
```

### 1.3 S10 — Moderador o Admin expulsa a un miembro

```mermaid
sequenceDiagram
    actor admin as Moderador o Admin
    participant web as React
    participant api as NestJS
    participant db as RDS PostgreSQL
    participant colyseus as Colyseus
    participant target as Cliente expulsado

    admin->>web: expulsar a un miembro
    web->>api: DELETE de membresía (propuesto)
    api->>api: JwtAuthGuard y RoomModeratorGuard
    alt el destino tiene igual o mayor rol, o es el último owner
        api-->>web: 403 sin permisos o 409 conflicto
    else expulsión permitida
        api->>db: DELETE Membership
        db-->>api: fila eliminada
        api-->>web: 204
        api->>colyseus: disconnectUser y member:kicked
        colyseus-->>target: member:kicked y cierre del WSS
        colyseus->>colyseus: difundir presence:changed a la sala
    end
    target->>api: intento de reingreso
    api-->>target: 403 sin membresía
```

Aunque el cliente expulsado conserve un ticket de sala viejo, Colyseus lo revalida contra NestJS (S2), y sin `Membership` la revalidación falla: la expulsión no depende de que la desconexión forzada llegue.

### 1.4 S11 — Publicar un anuncio o reunión y confirmar asistencia

```mermaid
sequenceDiagram
    actor admin as Moderador o Admin
    actor member as Miembro
    participant web as React
    participant api as NestJS
    participant db as RDS PostgreSQL
    participant colyseus as Colyseus

    admin->>web: crear reunión
    web->>api: POST de reunión (propuesto)
    api->>api: JwtAuthGuard, RoomModeratorGuard y validación Zod
    api->>db: INSERT Meeting y Attendance pending por miembro (propuesto)
    db-->>api: filas confirmadas
    api-->>web: 201
    api->>colyseus: meeting:announced
    colyseus-->>member: aviso en la sala
    member->>web: confirmar asistencia
    web->>api: PUT de asistencia
    api->>api: JwtAuthGuard y RoomMembershipGuard
    api->>db: UPDATE Attendance confirmed
    db-->>api: fila confirmada
    api-->>web: 200
```

### 1.5 S12 — Moderador intenta una acción exclusiva del Admin

Caso de prueba negativo para la matriz de la [01-use-cases §1.4](./01-use-cases.md#14-matriz-de-permisos-por-rol-propuesto): un Moderador intenta cambiar el rol de otro miembro (UC-24). El rechazo ocurre antes de validar el DTO y de tocar Prisma, y manipular el cliente no cambia el resultado.

```mermaid
sequenceDiagram
    actor mod as Moderador
    participant web as React
    participant api as NestJS
    participant db as RDS PostgreSQL

    mod->>web: intentar promover a un miembro (UI oculta o manipulada)
    web->>api: PATCH de rol de miembro (propuesto)
    api->>api: JwtAuthGuard valida la sesión
    api->>db: SELECT Membership del solicitante en la sala
    db-->>api: role = moderator
    api->>api: RoomAdminGuard exige owner
    api-->>web: 403 sin permisos
    Note over api,db: no hay escritura ni evento member:role-changed
    web->>api: mismo PATCH sin sesión
    api-->>web: 401 sin autenticación
```

---

← [Secuencias del núcleo (S1 a S7)](./06-sequences-core.md) · [Índice](./README.md) · [Convenciones transversales](./08-conventions.md) →
