# Casos de uso

> Vista funcional derivada de la [ERS](../../functional-requirements.md) y sus [historias de usuario](../../user-stories.md). Parte del [índice de diagramas](../README.md).

**En este archivo**

- [1. Casos de uso](#1-casos-de-uso)
  - [1.1 Actores y glosario](#11-actores-y-glosario)
  - [1.2 Diagrama general de casos de uso](#12-diagrama-general-de-casos-de-uso)
  - [1.3 Catálogo granular](#13-catálogo-granular)
  - [1.4 Matriz de permisos por rol](#14-matriz-de-permisos-por-rol)

[Índice](../README.md) · [Arquitectura](../02-system-architecture/deployment-and-network.md) →

## 1. Casos de uso

El comportamiento y las prioridades provienen de RF/RN de la ERS, no de los identificadores UC locales de esta vista, que solo ordenan el catálogo y no son endpoints ni contratos consumidos por código. Los nombres de eventos, DTOs y transportes específicos siguen siendo **propuestas técnicas**, sujetas a las [reglas de contratos](../../../rules/api-contracts.md). Esta vista es **diseño propuesto**: el repositorio todavía no implementa estos casos de uso.

### 1.1 Actores y glosario

| Actor | Alcance | Modelo técnico propuesto |
|---|---|---|
| Visitante | Registro, login, recuperación de contraseña y apertura de un enlace de invitación | Sin sesión |
| Profesor | Aulas que dicta (independiente o de una escuela); publica material, avisos y actividades, califica, modera y opera la clase en vivo | `User`, `ClassroomMembership.role = teacher` y/o `SchoolMember.role = teacher` |
| Alumno | Aulas donde está matriculado; entrega, rinde exámenes, gana puntos, compra en la tienda, chatea y consulta al Bot | `User`, `ClassroomMembership.role = student` |
| Padre / Tutor | Solo hijos vinculados, en solo lectura, más mensajería acotada con el Profesor; **MVP Extendido** (base de datos desde Core) | `ParentLink` (máximo 2 por alumno) |
| Dueño de Escuela | Único por escuela; gestiona la institución y tiene autoridad docente sobre todas sus aulas | `SchoolMember.role = owner` |
| Admin de Escuela | Delegado del Dueño; el alcance exacto de la delegación (por ejemplo baja o traspaso de la escuela) está **abierto** en [Classrooms and roles](../../../rules/classrooms-and-roles.md) | `SchoolMember.role = admin` |
| Bot Guía de Estudio | Responde solo con RAG sobre material docente habilitado; **no modifica datos en el MVP** (RN-12 a RN-14) | `BotService` con consultas filtradas, sobre Amazon Bedrock |
| Sistema | Autorización en cada operación, puntos, racha, repaso diario, notificaciones por email | Procesos de backend por diseñar |
| Colyseus | Presencia, movimiento y difusión a destinatarios autorizados; no es autoridad de datos persistentes (RN-19) | Servicio realtime (`apps/realtime`) |

No existe un Superadmin global: toda autoridad emana de una membresía persistida o de un vínculo parental verificado en el servidor. Dueño y Admin de Escuela tienen autoridad docente sobre todas las aulas de su escuela sin inscripción por aula (RN-03); un Profesor solo la tiene sobre las aulas que dicta. Las asunciones pendientes de la ERS siguen vigentes; los puntos abiertos se señalan en el catálogo.

### 1.2 Diagrama general de casos de uso

```mermaid
flowchart LR
  vis(["Visitante"])
  prof(["Profesor"])
  alu(["Alumno"])
  par(["Padre / Tutor"])
  own(["Dueño / Admin de Escuela"])
  bot(["Bot Guía de Estudio"])

  subgraph cuenta["Cuenta (RF-AUT)"]
    register("Registrarse: Profesor independiente o Escuela")
    auth("Login, renovación, logout y recuperación de contraseña")
    profile("Perfil y avatar base")
    link("Vincular Padre / Tutor con un Alumno - Extendido")
  end
  subgraph aulas["Aulas y escuelas (RF-AUL)"]
    createClass("Crear y configurar aulas")
    invite("Invitar o generar código/enlace de acceso")
    join("Unirse al aula por invitación")
    members("Gestionar miembros y bajas lógicas")
    school("Gestión institucional multi-aula - Extendido")
  end
  subgraph espacio["Aula 3D y Modo 2D Clásico (RF-ESP)"]
    enter("Ingresar al Aula 3D, moverse y ver presencia")
    mode2d("Alternar al Modo 2D Clásico")
    desk("Interactuar con pupitre y objetos del aula")
  end
  subgraph acad["Actividades (RF-ACT)"]
    publishAct("Publicar TPs, Exámenes y Material")
    inbox("Ver bandeja y vencimientos")
    submit("Entregar TP o rendir Examen")
    grade("Calificar, dar devolución y recalificar")
    follow("Seguimiento académico del hijo - Extendido")
  end
  subgraph gam["Gamificación (RF-GAM)"]
    wallet("Billetera de puntos, racha y medallas")
    shop("Comprar en la tienda y aportar a la mascota")
    shopcfg("Configurar catálogo y minijuegos - Extendido")
  end
  subgraph com["Comunicación (RF-COM)"]
    notice("Publicar y leer avisos")
    chat("Chat del aula y moderación")
    forum("Foro por actividad y mensajería Padre-Profesor")
    notif("Centro de notificaciones in-app y email")
  end
  subgraph viv["Clase en vivo (RF-VIV) - Extendido"]
    freeze("Congelar alumnos y silenciar sala/chat")
    call("Llamada y pizarrón colaborativo")
  end
  subgraph botg["Bot Guía de Estudio (RF-BOT)"]
    material("Habilitar bibliografía para el Bot")
    ask("Consultar al Bot con RAG")
    daily("Recibir Repaso Diario y pregunta de racha")
  end

  vis --> register
  vis --> auth
  prof --> auth
  alu --> auth
  par --> auth
  own --> auth
  prof --> profile
  alu --> profile
  prof --> createClass
  own --> createClass
  prof --> invite
  own --> invite
  alu --> join
  prof --> members
  own --> members
  own --> school
  prof --> link
  own --> link
  par --> link
  prof --> enter
  alu --> enter
  own --> enter
  alu --> mode2d
  prof --> mode2d
  alu --> desk
  prof --> publishAct
  own --> publishAct
  alu --> inbox
  alu --> submit
  prof --> grade
  own --> grade
  par --> follow
  par --> inbox
  alu --> wallet
  alu --> shop
  prof --> shopcfg
  prof --> notice
  own --> notice
  alu --> notice
  par --> notice
  alu --> chat
  prof --> chat
  alu --> forum
  prof --> forum
  par --> forum
  alu --> notif
  par --> notif
  prof --> freeze
  prof --> call
  alu --> call
  prof --> material
  alu --> ask
  alu --> daily
  prof --> daily
  ask --> bot
  daily --> bot
  own -.->|"autoridad docente sobre sus aulas"| prof
```

### 1.3 Catálogo granular

Este catálogo resume recorridos y su trazabilidad; no reemplaza los requisitos de la ERS. La columna **Fase/prioridad** conserva MoSCoW y la fase de la ERS: pertenecer al MVP no convierte un Should en Must. Las escrituras por REST y la difusión por WSS son la propuesta de [consistencia](../02-system-architecture/realtime-colyseus.md#13-regla-de-consistencia-y-autoridad), no un catálogo aprobado de endpoints. `HU-XXX-NNN` comparte número con su `RF-XXX-NNN` en el [catálogo de historias](../../user-stories.md).

| UC | Recorrido y actor | Regla funcional / entidades | RF / HU de origen | Fase/prioridad |
|---|---|---|---|---|
| 01 | Registro del Visitante | Crea `User`, `AvatarConfiguration` y la estructura del camino elegido (Profesor independiente o `School` con `SchoolMember(owner)`), en una transacción; sin invitación no se obtiene rol en estructuras existentes | RF-AUT-001 / HU-AUT-001 (RN-02, RN-20) | Must · MVP Core |
| 02 | Login, renovación y logout | Sesión con vencimiento (D1, pendiente de aprobación del equipo); logout y reinicio de contraseña invalidan la sesión y cortan la presencia en Colyseus | RF-AUT-002 / HU-AUT-002 (RN-04) | Must · MVP Core |
| 03 | Perfil y avatar base | `AvatarConfiguration` persistente; ítems bloqueados se rechazan | RF-AUT-003 / HU-AUT-003 (RN-09) | Must · MVP Core |
| 04 | Vincular Padre / Tutor | Invitación de Profesor o Dueño/Admin aceptada por el adulto; máximo 2 por alumno; rechazada con `adultMode` | RF-AUT-004 / HU-AUT-004 (RN-02, RN-16) | Should · MVP Extendido |
| 05 | Crear y configurar aula | `Classroom` de exactamente una `School` o un Profesor independiente, con `Pet`, `Desk` base y controles por defecto | RF-AUL-001 / HU-AUL-001 (RN-01) | Must · MVP Core |
| 06 | Invitar y unirse al aula | Invitación por email o código/enlace con secreto hasheado, vencimiento y revocación; alta de membresía atómica e idempotente; el rol lo fija la invitación | RF-AUL-002 / HU-AUL-002 (RN-02) | Must · MVP Core |
| 07 | Gestionar miembros y bajas lógicas | Padrón del aula; baja lógica desconecta de inmediato y conserva entregas, notas y mensajes | RF-AUL-003 / HU-AUL-003 (RN-18) | Must · MVP Core |
| 08 | Gestión institucional multi-aula | Dueño/Admin invitan Profesores y supervisan aulas con autoridad docente derivada de `SchoolMember` | RF-AUL-004 / HU-AUL-004 (RN-03) | Should · MVP Extendido |
| 09 | Aislamiento y verificación de acceso | Cada operación resuelve aula y escuela en el servidor; sin sesión `401`, rol insuficiente `403`, recurso ajeno `404` | RF-AUL-005 / HU-AUL-005 (RN-01, RN-04) | Must · MVP Core |
| 10 | Ingresar al Aula 3D y presencia | Autorización por NestJS y handshake de Colyseus (D2); WASD, clic o táctil, colisiones; sin filas por fotograma | RF-ESP-001 / HU-ESP-001 (RN-19) | Must · MVP Core |
| 11 | Interactuar con pupitre y objetos | Pupitre (`Desk`), estantería, tienda, cartelera, mascota y Bot abren su panel; las acciones se validan en el servidor | RF-ESP-002 / HU-ESP-002 (RN-17) | Must · MVP Core |
| 12 | Alternar al Modo 2D Clásico | Equivalencia funcional total sin perder sesión | RF-ESP-003 / HU-ESP-003 (RN-17) | Must · MVP Core |
| 13 | Personalizar avatar y pupitre | Equipar ítems adquiridos; el servidor verifica titularidad | RF-ESP-004 / HU-ESP-004 (RN-09) | Should · MVP Core |
| 14 | Publicar y gestionar Actividades | TP o Examen, formato archivo u opción múltiple, `dueAt`, `maxScore`, `allowLate`, `weightMultiplier`; sin borrado con entregas | RF-ACT-001 / HU-ACT-001 (RN-05) | Must · MVP Core |
| 15 | Bandeja del Alumno | Estados `Pendiente`, `Entregada`, `Corregida`, `Vencida` derivados de `Submission`, `Grade` y hora del servidor | RF-ACT-002 / HU-ACT-002 (RN-05) | Must · MVP Core |
| 16 | Entregar TP o rendir Examen | Archivos en S3 privado o respuestas; entrega idempotente, marca tardía si `allowLate` | RF-ACT-003 / HU-ACT-003 (RN-05, RN-20) | Must · MVP Core |
| 17 | Calificar y acreditar puntos | `Grade` y `PointsTransaction` en una transacción; recalificar genera asiento compensatorio | RF-ACT-004 / HU-ACT-004 (RN-06, RN-07) | Must · MVP Core |
| 18 | Historial y métricas | `ActivityMetric` con tiempo conectado agregado; fórmula del nivel **abierta** en [Activities](../../../rules/activities-and-grading.md#activity-level-metric) | RF-ACT-005 / HU-ACT-005 (RN-19) | Should · MVP Core |
| 19 | Seguimiento del hijo | Solo lectura de notas, entregas y avisos de hijos con `ParentLink` activo | RF-ACT-006 / HU-ACT-006 (RN-16) | Should · MVP Extendido |
| 20 | Billetera, racha y medallas | Saldo derivado del libro mayor; a lo sumo un hito de racha por día en Buenos Aires; catálogo de medallas **abierto** | RF-GAM-001, RF-GAM-002 / HU-GAM-001, HU-GAM-002 (RN-07, RN-08) | Must · MVP Core |
| 21 | Comprar en la tienda | Débito atómico con saldo no negativo e idempotencia; reembolsos **abiertos** | RF-GAM-003 / HU-GAM-003 (RN-09) | Must · MVP Core |
| 22 | Mascota del aula | Aportes y accesorios de `Pet`, independiente del Bot; quién equipa accesorios está **abierto** | RF-GAM-004 / HU-GAM-004 (RN-09) | Should · MVP Extendido |
| 23 | Configurar catálogo y minijuegos | Profesor define premios y habilita o deshabilita minijuegos (`gamesDisabled`) | RF-GAM-005 / HU-GAM-005 (RN-09, RN-10) | Should · MVP Extendido |
| 24 | Publicar avisos | Cartelera del aula con notificación in-app y por email | RF-COM-001 / HU-COM-001 | Must · MVP Core |
| 25 | Chat del aula | Persistencia antes de difundir, `@menciones`, moderación con historial íntegro; Padre / Tutor sin acceso | RF-COM-002 / HU-COM-002 (RN-16, RN-18) | Must · MVP Core |
| 26 | Foro por actividad y mensajería Padre-Profesor | Foro y conversación ligada a `ParentLink`; modelado del foro **abierto** | RF-COM-003 / HU-COM-003 (RN-16) | Should · MVP Core |
| 27 | Notificaciones | `Notification` durable con estado de lectura; email como canal | RF-COM-004 / HU-COM-004 | Must · MVP Core |
| 28 | Congelar y silenciar | Freeze en pupitres, silenciar sala y chat; solo nivel Profesor, autoritativo en servidor | RF-VIV-001, RF-VIV-002 / HU-VIV-001, HU-VIV-002 (RN-10) | Must/Should · MVP Extendido |
| 29 | Llamada y pizarrón colaborativo | WebRTC y pizarrón con gráficos y LaTeX como datos; persistencia del pizarrón **abierta** | RF-VIV-003, RF-VIV-004 / HU-VIV-003, HU-VIV-004 (RN-11) | Should · MVP Extendido |
| 30 | Habilitar bibliografía para el Bot | `Material` y `AllowedMaterial` por aula | RF-BOT-001 / HU-BOT-001 (RN-12) | Must · MVP Core |
| 31 | Consultar al Bot | RAG filtrado por aula y material habilitado, regla anticopia, bloqueo en examen; límites numéricos **abiertos** | RF-BOT-002 / HU-BOT-002 (RN-12 a RN-14) | Must · MVP Core |
| 32 | Repaso Diario y racha | Una entrega por usuario y día en Buenos Aires; resumen estructurado sin IA si falla el proveedor; no aplica a Padre / Tutor | RF-BOT-003 / HU-BOT-003 (RN-08, RN-15) | Must · MVP Core |
| 33 | Auditoría de consultas al Bot | `BotConversation` como metadato pedagógico para el Profesor; persistencia y retención **abiertas** | RF-BOT-004 / HU-BOT-004 (RN-14) | Should · MVP Extendido |

Fuera del alcance actual (Evolución): acciones asistidas del Bot con confirmación explícita, analíticas por cohorte y plantillas adicionales de aulas.

### 1.4 Matriz de permisos por rol

Resumen de la [matriz de la ERS](../../functional-requirements.md#3-permisos). "Dueño / Admin" refleja la autoridad docente sobre las aulas de su escuela (RN-03). Las acciones de aula requieren membresía o vínculo activos.

| Acción | Alumno | Padre / Tutor | Profesor (su aula) | Dueño / Admin de Escuela |
|---|---|---|---|---|
| Ingresar al Aula 3D o al Modo 2D Clásico | Sí | No (usa su vista) | Sí | Sí |
| Publicar actividades, material y avisos | No | No | Sí | Sí |
| Entregar TP o rendir examen | Sí (propias) | No | No | No |
| Calificar, devolver y recalificar | No | No | Sí | Sí |
| Ver calificaciones y puntos | Solo propios | Solo del hijo vinculado | Su aula | Toda la escuela |
| Comprar en la tienda y aportar a la mascota | Sí (saldo propio) | No | No | No |
| Configurar catálogo de la tienda | No | No | Sí | Sí |
| Chat del aula | Sí, si no está silenciado | No | Sí | Sí (moderación) |
| Moderar mensajes | No | No | Sí | Sí |
| Mensajería Padre-Profesor | No | Sí (hijo vinculado) | Sí | Auditoría institucional: **abierto** |
| Controles en vivo (Freeze, silenciar) | No | No | Sí | Sí |
| Consultar al Bot y recibir Repaso Diario | Sí (salvo examen en curso) | No | Sí | Sí |
| Habilitar bibliografía para el Bot y ver auditoría | No | No | Sí | Sí |
| Crear aulas, generar invitaciones y dar de baja miembros | No | No | Sí (propias) | Sí (su escuela) |
| Crear escuela e invitar Profesores | No | No | No | Sí (Dueño; Admin según delegación **abierta**) |

Toda operación se valida en servidor: sin sesión `401`; con sesión pero sin permiso sobre un recurso visible `403`; ante un recurso de otra escuela o aula `404` uniforme, para no revelar existencia ([Authentication and session](../../../rules/authentication-and-session.md#authorization-responses), RN-04). Ocultar botones no sustituye autorización. La [matriz normativa](../../../rules/classrooms-and-roles.md#permission-matrix) y [Activities and grading](../../../rules/activities-and-grading.md) gobiernan esta vista. La baja de una membresía impide leer historial y desconecta la presencia del aula, pero preserva los contenidos generados (RN-18).

[Índice](../README.md) · [Arquitectura](../02-system-architecture/deployment-and-network.md) →
