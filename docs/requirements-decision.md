# ERS · Decisiones de alcance, roles y alineación al nicho escolar (v0.3)

Actualizado: 2026-11-02 · Alineación con `master-document.md` v0.3 y `rules/`

## Decisiones cerradas del dominio escolar (Aula Virtual 3D para Escuelas)

Tras el pivote de producto desde el modelo anterior de *Oficinas Virtuales y Habitaciones* hacia la **Plataforma de Aulas Virtuales 3D para Escuelas** (`master-document.md` v0.3), quedan cerradas las decisiones estructurales de roles, alcance por fases, reglas de negocio y módulos de la ERS v0.2 (`docs/functional-requirements.md`) y del catálogo de historias de usuario v0.2 (`docs/user-stories.md`).

| Tema | Decisión consolidada |
| --- | --- |
| **Nicho y unidad central** | Se reemplazan Oficinas, Habitaciones, tableros Kanban y reuniones genéricas por **Escuelas y Aulas Virtuales 3D** con soporte equivalente en **Modo 2D Clásico**. El **Aula (`Classroom`)** es la unidad persistente central que agrupa a su profesor, alumnos, material de estudio, actividades (TPs y exámenes), entregas, calificaciones, chat, avisos, tienda y mascota del aula. |
| **Caminos de organización** | Al registrarse se admite el camino de **Profesor independiente** (`Profesor → Aulas`) y el camino institucional de **Escuela** (`Escuela → Profesores → Aulas`), donde el creador actúa como `Dueño / Admin de escuela`. Una cuenta puede participar en distintos contextos según su membresía persistida. |
| **Roles del sistema** | Sin Superadministrador global. Se definen cuatro roles de dominio acotados por escuela o aula: **Profesor** (creador/administrador pedagógico del aula en MVP Core), **Alumno** (participante principal que cursa, entrega actividades y suma puntos), **Padre / Tutor** (seguimiento de solo lectura y mensajería vinculada explícitamente a sus hijos mediante `ParentStudentLink` / `ParentLink`, máximo 2 tutores por alumno) y **Dueño / Admin de escuela** (gestión institucional multi-aula y delegación sobre las aulas de la escuela). |
| **Modo educación de adultos** | Un aula puede operar en modo educación de adultos (`adult_mode`), en cuyo caso los alumnos gestionan su propia cuenta sin intervención parental y se deshabilitan las invitaciones, vinculaciones y notificaciones del rol `Padre / Tutor`. |
| **Incorporación e invitaciones** | El alta de miembros en escuelas y aulas se realiza por invitación (correo electrónico con secreto hasheado de un solo uso y vencimiento, o código/enlace de invitación revocable y con expiración validado en el servidor). Toda aceptación es atómica e idempotente. |
| **Evaluación y puntos ponderados** | Las actividades (`TP` o `Examen`, con entrega de archivos o preguntas de opción múltiple) se califican en escala `0–100`. La calificación confirma en la misma transacción una acreditación inmutable en el libro mayor (`PointTransaction` / `PointsTransaction`) calculada con peso por tipo de actividad (`nota * peso_actividad`, donde un Examen pondera más que un TP). Las recalificaciones generan asientos compensatorios sin sobrescribir el historial. |
| **Economía del aula, mascota y racha** | Moneda única de puntos por alumno. Permite adquirir ítems funcionales del aula, mejoras de avatar/pupitre y accesorios o aportes para la **Mascota del Aula** (una por aula, puramente motivacional e independiente del Bot IA). La **Racha** contabiliza como máximo 1 hito diario en zona horaria `America/Argentina/Buenos_Aires` ante actividades académicas reales (entregas en término, exámenes aprobados o pregunta diaria de repaso), nunca por el mero inicio de sesión. |
| **Bot Guía de Estudio (RAG) y regla anticopia** | El Bot IA actúa como tutor pedagógico sobre **Amazon Bedrock**, respondiendo exclusivamente a partir de la bibliografía subida y habilitada por el profesor del aula (`StudyMaterial` / `AllowedMaterial`). Tiene prohibido resolver tareas o entregar respuestas de exámenes, no modifica datos en base de datos en el MVP y se **bloquea automáticamente** mientras el alumno tiene un examen en curso. Incluye el **Repaso Diario** en la primera conexión autenticada del día para todos los roles excepto `Padre / Tutor`. |

---

## Alcance y fases de entrega (MVP Core vs. MVP Extendido)

El alcance funcional se estructura en dos fases incrementales prioritarias (**MVP Core** y **MVP Extendido**) más una bandeja de **Evolución / Futuro**, manteniendo trazabilidad completa entre la ERS v0.2 y el documento maestro:

| Fase | Horizonte | Alcance funcional incluido |
| --- | --- | --- |
| **MVP Core** | Foco inmediato (1–2 meses) | **1. Auth y Perfiles (`RF-AUT`):** registro, login, sesiones expirables, cierre de sesión, protección `401`/`403`/`404` y configuración de perfil/avatar.<br>**2. Aulas y Membresías (`RF-AUL`):** creación y gestión de aulas por el Profesor, incorporación por invitación/código y aislamiento por aula.<br>**3. Espacio 3D y Modo 2D Clásico (`RF-ESP`):** navegación isométrica en Three.js + React Three Fiber, colisiones, avatares y presencia en vivo con Colyseus, pupitres e interfaz equivalente en **Modo 2D Clásico** accesible en un clic.<br>**4. Actividades, Entregas y Calificaciones (`RF-ACT`):** publicación de TPs, exámenes y bibliografía (S3), ciclo `Pendiente → Entregada → Corregida / Vencida`, devolución docente y acreditación transaccional de puntos.<br>**5. Gamificación (`RF-GAM`):** billetera de puntos ponderados, racha diaria por actividad real, medallas, tienda e interacción con la mascota del aula.<br>**6. Comunicación (`RF-COM`):** tablón de avisos con notificación por email, chat del aula en tiempo real con moderación y `@menciones`, foro de consultas por actividad y notificaciones in-app.<br>**7. Bot Guía de Estudio RAG (`RF-BOT`):** ingesta/habilitación de bibliografía docente, consultas RAG con citas, bloqueo durante exámenes, repaso diario y pregunta de repaso. |
| **MVP Extendido** | Segunda etapa priorizada | **1. Herramientas de Clase en Vivo (`RF-VIV`):** congelar alumnos en sus pupitres (`freeze`), silenciar micrófonos/chat masivamente (`mute`), videollamadas/voz y presentaciones en vivo (WebRTC), y pizarrón interactivo colaborativo con gráficos matemáticos y fórmulas **LaTeX**.<br>**2. Seguimiento Parental (`RF-AUT-004`, `RF-ACT-006`):** vinculación `Padre / Tutor ↔ Alumno`, vista dedicada de calificaciones, entregas y mensajería con el profesor, más alertas por email.<br>**3. Gestión Multi-Aula e Institucional (`RF-AUL-004`):** camino Escuela completo con rol `Dueño / Admin de escuela`, delegación docente y vista institucional consolidada.<br>**4. Ampliaciones pedagógicas y lúdicas:** autoevaluación de opción múltiple, minijuegos deshabilitables en horario de clase y auditoría docente de temas consultados al Bot. |
| **Evolución / Futuro** | Post-entrega | Acciones asistidas del Bot mediante *tools* con confirmación explícita, analíticas y gráficos históricos avanzados de desempeño, plantillas adicionales de escenarios 3D y escalado horizontal multi-instancia de Colyseus. |

---

## Confirmaciones para la alineación documental

Estas confirmaciones consolidan la alineación entre el [documento maestro v0.3](../master-document.md), las reglas de ingeniería en [`rules/`](../rules/README.md) y los artefactos funcionales actualizados ([ERS v0.2](./functional-requirements.md) e [historias de usuario v0.2](./user-stories.md)).

| Tema | Decisión y fundamento | Referencia |
| --- | --- | --- |
| **Alineación documental v0.3 (Vigente)** | **Completada.** `docs/functional-requirements.md` (v0.2), `docs/user-stories.md` (v0.2) y `docs/requirements-decision.md` quedan 100 % alineados con el modelo de **Aula Virtual 3D para Escuelas** (`master-document.md` v0.3) y con las reglas de dominio de `rules/`. Se elimina toda referencia residual al modelo anterior de oficinas, habitaciones y tableros Kanban. | [ERS v0.2](./functional-requirements.md), [Historias de usuario v0.2](./user-stories.md), [Documento maestro §13](../master-document.md#13-organización-documental) |
| **Renderizado 3D y Modo 2D** | **Three.js + React Three Fiber están elegidos** para la escena 3D isométrica del aula, combinados con una vista equivalente en **Modo 2D Clásico** en React para garantizar accesibilidad y uso en todo tipo de dispositivos. PixiJS 2.5D permanece descartado. | [Documento maestro §2.9](../master-document.md#29-modo-3d-y-modo-2d-clásico) y [§3.1](../master-document.md#31-entorno-tridimensional-isométrico) |
| **Zona horaria y marcas de tiempo** | Se aplica la regla de [Data and time](../rules/data-and-time.md): el corte diario del **Repaso Diario** y de la **Racha** utiliza la fecha local en `America/Argentina/Buenos_Aires` calculada exclusivamente por el servidor; los instantes persistidos se representan sin ambigüedad horaria y los relojes del cliente nunca son fuente de autoridad. | [AI Bot and Daily Review](../rules/ai-bot-and-daily-briefing.md#daily-review), [Points, Streak, and Shop](../rules/points-and-shop.md#connection-streak), [Data and Time](../rules/data-and-time.md#dates-and-time-zones) |
| **Autorización y respuestas HTTP** | Se respeta [Authentication and session](../rules/authentication-and-session.md#authorization-responses) y [Classrooms, roles, and permissions](../rules/classrooms-and-roles.md#server-side-checks): `401` ante ausencia o invalidez de sesión, `403` ante rol insuficiente dentro de un ámbito visible para el usuario y `404` uniforme ante identificadores de escuelas, aulas o hijos ajenos para no revelar su existencia. | [Authentication and session](../rules/authentication-and-session.md#authorization-responses), [Classrooms and roles](../rules/classrooms-and-roles.md#server-side-checks) |
| **Persistencia y baja lógica** | Se mantienen las invariantes de [Data](../rules/data.md): las bajas de membresías, actividades o aulas operan mediante desactivación/baja lógica (`deleted_at` o estado equivalente) preservando la autoría histórica de entregas, calificaciones y mensajes; el libro mayor de puntos (`PointTransaction`) es inmutable; las posiciones por fotograma de los avatares nunca se persisten en PostgreSQL. | [Data](../rules/data.md#deletion-and-lifecycle), [Architecture](../rules/architecture.md) |

---

## Formato de los requisitos

Cada requisito funcional de la [ERS v0.2](./functional-requirements.md) conserva un identificador único y trazable hacia las reglas de negocio (`RN-NN`) y las historias de usuario (`HU-XXX-NNN`):

1. **ID:** `RF-MÓDULO-NNN`.
2. **Nombre descriptivo.**
3. **Prioridad MoSCoW:** `Must`, `Should`, `Could`, `Won't`.
4. **Fase de entrega:** `MVP Core`, `MVP Extendido` o `Evolución`.
5. **Actores principales.**
6. **Precondiciones y postcondiciones.**
7. **Descripción funcional y criterios de aceptación** verificables (`Dado / Cuando / Entonces`).

---

## Módulos de la ERS (v0.2 · Nicho Escolar)

La [ERS v0.2](./functional-requirements.md) y el catálogo de [historias de usuario v0.2](./user-stories.md) organizan el sistema en ocho módulos cohesivos del dominio educativo:

| N.º | Módulo | Prefijo | Alcance principal |
| --- | --- | --- | --- |
| 1 | Autenticación, Perfiles y Cuentas | `AUT` | Registro, login, sesiones expirables, perfil/avatar base y vinculación Padre-Alumno. |
| 2 | Aulas, Escuelas, Membresías y Roles | `AUL` | Creación de aulas, códigos/invitaciones de acceso, membresías, roles y gestión institucional de escuela. |
| 3 | Espacio 3D, Avatar, Pupitres y Modo 2D Clásico | `ESP` | Navegación isométrica 3D, colisiones, pupitres interactivos, presencia en tiempo real y conmutación en un clic a Modo 2D Clásico. |
| 4 | Actividades, TPs, Exámenes, Entregas y Calificaciones | `ACT` | Publicación de TPs/exámenes/bibliografía, entregas con adjuntos o cuestionarios, corrección docente, notas y vista de seguimiento familiar. |
| 5 | Puntos Ponderados, Racha, Medallas, Tienda y Mascota del Aula | `GAM` | Libro mayor de puntos ponderados, racha diaria por actividad académica, medallas, tienda del aula y mascota grupal. |
| 6 | Comunicación del Aula, Avisos, Chat y Foro de Consultas | `COM` | Tablón de anuncios con aviso por email, chat del aula en tiempo real con moderación y `@menciones`, foro de dudas por actividad y notificaciones in-app. |
| 7 | Herramientas de Clase en Vivo | `VIV` | Congelar alumnos en sus asientos, silenciar sala/chat, llamadas de voz/video y presentaciones WebRTC, y pizarrón colaborativo con gráficos y LaTeX. |
| 8 | Bot Guía de Estudio (RAG) y Repaso Diario | `BOT` | Indexación de bibliografía aprobada por el profesor, consultas RAG con citas y regla anticopia, repaso diario / pregunta diaria y auditoría docente. |

---

## Estado de la documentación de requisitos

- **ERS (`docs/functional-requirements.md`):** actualizada a la versión `0.2` bajo el modelo de **Aula Virtual 3D para Escuelas**, incluyendo matriz de permisos escolar, reglas de negocio `RN-01` a `RN-20`, catálogo `RF-AUT` a `RF-BOT`, requerimientos no funcionales `RNF-001` a `RNF-010`, entidades conceptuales alineadas con `rules/data.md` y matriz de trazabilidad completa.
- **Historias de usuario (`docs/user-stories.md`):** actualizadas a la versión `0.2`, mapeadas 1 a 1 con los módulos `HU-AUT`, `HU-AUL`, `HU-ESP`, `HU-ACT`, `HU-GAM`, `HU-COM`, `HU-VIV` y `HU-BOT`, con criterios `Dado / Cuando / Entonces`, trazabilidad a `RF`/`RN` y descomposición en tareas técnicas `[back]` y `[front]`.
