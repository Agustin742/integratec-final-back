# Especificación de Requerimientos Funcionales (ERS)

## Plataforma de Aulas Virtuales 3D para Escuelas — Proyecto Integrador Final

| Campo | Valor |
| --- | --- |
| **Proyecto** | Proyecto integrador final · Fundación Integrar (IntegrarTEC 2026) |
| **Documento** | Especificación de Requerimientos Funcionales (ERS) |
| **Versión** | 0.2 (Alineada con `master-document.md` v0.3 y reglas de dominio en `rules/`) |
| **Fecha** | 2026-11-02 |
| **Equipo** | Alejo Martínez, Agustín Tabarcache, Matías Sousa, Luis Calegari |
| **Documentos de referencia** | [`master-document.md`](../master-document.md), [`docs/requirements-decision.md`](./requirements-decision.md), [`rules/README.md`](../rules/README.md) |
| **Estado** | Vigente — Base funcional y de trazabilidad para el dominio escolar |

### Control de cambios

| Versión | Fecha | Cambios principales | Autor |
| --- | --- | --- | --- |
| 0.1 | 2026-10-26 | Primera redacción completa bajo el modelo inicial de oficinas y habitaciones virtuales. | Luis Calegari |
| 0.2 | 2026-11-02 | Realineación integral al modelo de **Aula Virtual 3D para Escuelas** (`master-document.md` v0.3 y `rules/`). Se reemplazan oficinas, habitaciones y tableros Kanban por escuelas, aulas, actividades académicas (TPs y exámenes), entregas, calificaciones, puntos ponderados, tienda, mascota del aula, racha, medallas, controles de clase en vivo, vista para padres/tutores, Modo 2D Clásico y Bot Guía de Estudio con RAG sobre material docente. | Equipo |

---

## 1. Introducción y Alcance

### 1.1 Propósito

Este documento especifica el comportamiento funcional y las reglas de negocio de la **Plataforma de Aulas Virtuales 3D para Escuelas**. Cumple tres objetivos dentro del proyecto:

1. Consolidar en un contrato funcional verificable el alcance del **MVP Core**, el **MVP Extendido** y la **Evolución / Futuro** definidos en el [documento maestro](../master-document.md).
2. Servir como fuente de verdad para el catálogo de [historias de usuario (`docs/user-stories.md`)](./user-stories.md) y las tarjetas de trabajo del tablero del proyecto.
3. Establecer la trazabilidad entre reglas de negocio (`RN-NN`), requerimientos funcionales (`RF-XXX-NNN`), requerimientos no funcionales (`RNF-NNN`), historias de usuario (`HU-XXX-NNN`) y los requisitos obligatorios `R1`–`R8` de IntegrarTEC 2026.

### 1.2 Visión del producto

La plataforma es una aplicación web de **aulas virtuales tridimensionales con cámara isométrica** (implementada con **Three.js + React Three Fiber** sobre **React**) complementada por un **Modo 2D Clásico** totalmente equivalente.

- En cada **Aula**, el **Profesor** dicta clases, publica bibliografía y avisos, asigna actividades (**Trabajos Prácticos y Exámenes**), corrige entregas, modera la convivencia y coordina dinámicas en vivo.
- El **Alumno** navega por el aula con su avatar personalizable (o utiliza el Modo 2D Clásico), interactúa con su pupitre, la pizarra, la cartelera, la tienda y el **Bot Guía de Estudio (RAG)**, realiza entregas y recibe **Puntos Ponderados** en función de sus calificaciones para personalizar su experiencia, sostener su **Racha** de estudio y colaborar con la **Mascota del Aula**.
- El **Padre / Tutor** accede a una interfaz simplificada de solo lectura y comunicación acotada para acompañar las calificaciones, entregas pendientes y novedades de sus hijos vinculados.
- El **Dueño / Admin de Escuela** gestiona la estructura institucional cuando las aulas se organizan bajo una escuela.

El producto **no es un videojuego competitivo ni un MMO**: la gamificación está subordinada al progreso pedagógico, la convivencia escolar y la motivación de los estudiantes.

### 1.3 Fases de entrega

La planificación funcional se divide en tres horizontes incrementales:

| Fase | Objetivo operativo | Módulos y capacidades centrales |
| --- | --- | --- |
| **MVP Core** | Recorrido académico completo en producción (1–2 meses) | Autenticación y perfiles (`RF-AUT`), creación y membresía de aulas (`RF-AUL`), escena de Aula 3D + conmutación en un clic a Modo 2D Clásico (`RF-ESP`), ciclo completo de Actividades/TPs/Exámenes con entregas, corrección y puntos ponderados (`RF-ACT`), billetera de puntos, racha diaria, medallas, tienda y mascota del aula (`RF-GAM`), avisos con notificación por email, chat en tiempo real con moderación y foro de consultas (`RF-COM`), y Bot Guía de Estudio con RAG sobre material docente y repaso diario (`RF-BOT`). |
| **MVP Extendido** | Herramientas sincrónicas avanzadas, familia y gestión multi-aula | Controles de clase en vivo (`RF-VIV`: congelar alumnos en sus pupitres, silenciar sala/chat, llamadas de audio/video WebRTC y pizarrón interactivo con gráficos matemáticos y LaTeX), vinculación y panel de seguimiento para `Padre / Tutor` (`RF-AUT-004`, `RF-ACT-006`), vista institucional multi-aula para `Dueño / Admin de Escuela` (`RF-AUL-004`), cuestionarios autoevaluables, minijuegos deshabilitables por el docente y auditoría pedagógica de consultas al Bot (`RF-BOT-004`). |
| **Evolución / Futuro** | Expansión post-defensa | Ejecución de acciones asistidas por el Bot con confirmación explícita, analíticas históricas avanzadas por cohorte, plantillas adicionales de aulas 3D y escalamiento horizontal multi-instancia de sesiones en tiempo real. |

### 1.4 Convenciones del documento

- **Identificadores de requerimientos:** `RF-MÓDULO-NNN` para requerimientos funcionales y `RNF-NNN` para requerimientos no funcionales.
- **Reglas de negocio:** `RN-01` a `RN-20`, referenciadas desde los requerimientos e historias de usuario.
- **Priorización MoSCoW:**
  - `Must`: indispensable para la entrega obligatoria y la integridad funcional/seguridad del sistema.
  - `Should`: importante y previsto dentro del alcance objetivo de los MVP.
  - `Could`: deseable, sujeto a disponibilidad de tiempo luego de cubrir `Must` y `Should`.
  - `Won't`: excluido explícitamente del alcance actual.
- **Criterios de aceptación:** expresados en formato verificable *Dado / Cuando / Entonces*.

### 1.5 Glosario de dominio escolar

| Término | Definición funcional |
| --- | --- |
| **Escuela (`School`)** | Unidad institucional opcional que agrupa a un `Dueño / Admin de Escuela`, un plantel de `Profesores` y múltiples `Aulas`. Constituye una frontera estricta de aislamiento de datos. |
| **Aula (`Classroom`)** | Espacio educativo persistente (independiente de si hay usuarios conectados en ese instante) que agrupa a su profesor, alumnos matriculados, pupitres, bibliografía, actividades, entregas, calificaciones, chat, tablón de anuncios, tienda y mascota. |
| **Profesor (`Teacher`)** | Docente responsable de crear o administrar el aula, publicar material y actividades, calificar entregas, moderar el chat, configurar el Bot IA y operar las herramientas de clase en vivo. |
| **Alumno (`Student`)** | Estudiante matriculado en una o más aulas. Realiza entregas, consulta bibliografía y al Bot Guía, participa en el chat, mantiene su racha y utiliza sus puntos ponderados en la tienda y mascota del aula. |
| **Padre / Tutor (`Parent`)** | Adulto responsable vinculado explícitamente a uno o más hijos (`ParentStudentLink` / `ParentLink`). Dispone de una vista simple de seguimiento de calificaciones, entregas y avisos, y canal de mensajes con el profesor. |
| **Actividad (`Activity`)** | Propuesta evaluable o formativa publicada en un aula: **Trabajo Práctico (`TP`)** o **Examen (`Exam`)**, en formato de entrega de archivos o cuestionario de opción múltiple, con fecha límite (`due_date`), puntaje máximo (`max_score`) y ponderación de puntos. |
| **Entrega (`Submission`)** | Resolución enviada por un alumno para una actividad publicada (archivos adjuntos en almacenamiento seguro o respuestas seleccionadas), con registro de fecha/hora del servidor y estado derivado (`Pendiente`, `Entregada`, `Corregida`, `Vencida`). |
| **Calificación (`Grade`)** | Nota numérica en escala `0–100` y devolución cualitativa (`feedback`) registradas por el profesor (o calculadas por el servidor en cuestionarios autoevaluables) sobre una entrega. |
| **Puntos Ponderados** | Moneda única de gamificación del alumno. Se acreditan automáticamente en el libro mayor (`PointTransaction`) al confirmarse una calificación, aplicando la fórmula `nota * peso_actividad` según el tipo de actividad. |
| **Tienda (`Shop`)** | Catálogo de ítems adquiribles con puntos ganados: mejoras del aula, personalización de avatar/pupitre, minijuegos habilitables y accesorios para la mascota del aula. |
| **Mascota del Aula (`ClassroomPet`)** | Personaje motivacional único por aula (independiente del Bot IA) cuyo nivel, estado o accesorios progresan mediante compras y aportes de puntos de los alumnos del curso. |
| **Racha (`Streak`)** | Contador de días consecutivos en los que el alumno completa al menos una acción académica válida (entrega en término, examen aprobado o pregunta diaria de repaso), a razón de máximo 1 hito computable por día calendario en `America/Argentina/Buenos_Aires`. |
| **Medalla (`Badge` / `Medal`)** | Reconocimiento persistente otorgado automáticamente al alumno al alcanzar hitos académicos, de constancia o de colaboración en el aula. |
| **Modo 2D Clásico** | Interfaz web accesible y responsiva en React que expone todas las funciones académicas esenciales (actividades, entregas, notas, material, chat, avisos, tienda y bot) sin requerir navegación ni interacción sobre el lienzo 3D. |
| **Bot Guía de Estudio RAG** | Asistente pedagógico basado en IA (**Amazon Bedrock**) que responde consultas de los alumnos únicamente sobre la bibliografía habilitada por el profesor del aula, aplicando regla anticopia, bloqueo durante exámenes y repaso diario. |

---

## 2. Actores y Perfiles de Usuario

El sistema prescinde de un Superadministrador global; toda autoridad emana de la membresía persistida en una escuela, en un aula o de un vínculo parental verificado en el servidor:

| Actor | Alcance y fase principal | Responsabilidades y capacidades dentro del sistema |
| --- | --- | --- |
| **Profesor (`Teacher`)** | Aula propia o asignada · **MVP Core** | Crea y configura sus aulas (como profesor independiente o dentro de una escuela); genera invitaciones/códigos de acceso; sube bibliografía (`StudyMaterial`) y define qué documentos puede usar el Bot IA; publica anuncios, Trabajos Prácticos y Exámenes; revisa entregas, asigna calificaciones y devoluciones; modera el chat; configura el catálogo de premios y utiliza las herramientas de control de clase en vivo. |
| **Alumno (`Student`)** | Aulas donde está matriculado · **MVP Core** | Se une a sus aulas por invitación o código; recorre el Aula 3D con su avatar o alterna en un clic al Modo 2D Clásico; consulta actividades pendientes y material de estudio; realiza entregas de TPs y rinde exámenes; recibe calificaciones, puntos ponderados, racha y medallas; canjea puntos en la tienda y aporta a la mascota del aula; participa en el chat/foro y consulta al Bot Guía de Estudio. |
| **Padre / Tutor (`Parent`)** | Hijos vinculados explícitamente · **MVP Extendido** (base en modelo de datos desde Core) | Accede mediante invitación vinculada a su hijo (`ParentStudentLink`, hasta 2 tutores por alumno); visualiza en modo de solo lectura las calificaciones, el estado de entregas y los avisos relevantes de su hijo; recibe notificaciones in-app y por correo electrónico; intercambia mensajes con el profesor sin acceder al chat grupal de los alumnos ni a datos de terceros. Queda deshabilitado en aulas con `adult_mode`. |
| **Dueño / Admin de Escuela (`School Owner / Admin`)** | Institución (`School`) y todas sus aulas · **MVP Extendido** (estructura base en Core) | Crea y administra la escuela en el camino institucional; invita y gestiona profesores; supervisa las aulas y métricas de actividad de la institución; posee autoridad equivalente a profesor sobre las aulas de su escuela sin requerir inscripción individual en cada una. |
| **Sistema / Bot Guía IA** | Transversal en servidor (`NestJS` + `Colyseus` + `Bedrock`) · **MVP Core** | Verifica permisos en cada operación; calcula y acredita puntos ponderados de forma atómica; evalúa el corte diario de racha y del Repaso Diario en `America/Argentina/Buenos_Aires`; indexa la bibliografía docente; responde consultas pedagógicas mediante RAG citando las fuentes permitidas sin resolver evaluaciones; y bloquea automáticamente su asistencia durante exámenes en curso. |

---

## 3. Permisos

Toda validación de permisos se ejecuta obligatoriamente en el servidor ([`rules/classrooms-and-roles.md`](../rules/classrooms-and-roles.md)) a partir del estado persistido en PostgreSQL. En esta matriz, *"En sus aulas"* incluye tanto al `Profesor` titular del aula como al `Dueño / Admin de Escuela` respecto de todas las aulas pertenecientes a su institución.

### 3.1 Cuenta, autenticación y organización

| Acción | Visitante (sin sesión) | Profesor | Alumno | Padre / Tutor | Dueño / Admin de Escuela |
| --- | --- | --- | --- | --- | --- |
| Registrarse e iniciar sesión | ✅ | ❌ | ❌ | ❌ | ❌ |
| Recuperar contraseña por email | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cerrar sesión y renovar sesión activa | ❌ | ✅ | ✅ | ✅ | ✅ |
| Editar perfil propio y configuración de avatar base | ❌ | ✅ | ✅ | ✅ (perfil básico) | ✅ |
| Crear y administrar una Escuela e invitar Profesores | ❌ | ❌ | ❌ | ❌ | ✅ (Dueño; Admin según delegación) |
| Crear y configurar Aulas | ❌ | ✅ (propias) | ❌ | ❌ | ✅ (en su escuela) |
| Generar o revocar invitaciones / códigos de acceso al aula | ❌ | ✅ (en sus aulas) | ❌ | ❌ | ✅ (en su escuela) |
| Vincular cuenta de Padre / Tutor con un Alumno (`ParentStudentLink`) | ❌ | ✅ (emite invitación) | ❌ | ✅ (acepta invitación) | ✅ (emite invitación) |

### 3.2 Espacio 3D, Modo 2D Clásico, Actividades y Calificaciones

| Acción | Dueño / Admin de Escuela | Profesor (en sus aulas) | Alumno (matriculado) | Padre / Tutor (hijo vinculado) |
| --- | --- | --- | --- | --- |
| Ingresar al Aula 3D o alternar al Modo 2D Clásico | ✅ | ✅ | ✅ | ❌ (usa vista de padres) |
| Desplazar avatar, interactuar con pupitres y ver presencia en vivo | ✅ | ✅ | ✅ | ❌ |
| Subir, editar o dar de baja bibliografía y material de estudio | ✅ | ✅ | ❌ (solo lectura/descarga) | ❌ |
| Crear, publicar, editar o dar de baja Actividades (TPs y Exámenes) | ✅ | ✅ | ❌ | ❌ |
| Ver bandeja de actividades publicadas y fechas de vencimiento | ✅ | ✅ | ✅ | ✅ (solo las de su hijo) |
| Realizar entregas de TPs o responder Exámenes | ❌ | ❌ | ✅ (propias) | ❌ |
| Ver entregas de alumnos y descargar archivos adjuntos | ✅ | ✅ | ✅ (solo las propias) | ❌ (ve estado y nota de su hijo) |
| Calificar entregas, registrar devolución y recalificar | ✅ | ✅ | ❌ | ❌ |
| Consultar calificaciones e historial académico | ✅ (toda la escuela) | ✅ (su aula) | ✅ (solo propio) | ✅ (solo de su hijo vinculado) |
| Consultar métricas de nivel de actividad (`ActivityMetric`) | ✅ (toda la escuela) | ✅ (su aula) | ✅ (solo propias) | ✅ (solo de su hijo vinculado) |

### 3.3 Gamificación, Comunicación, Clase en Vivo y Bot IA

| Acción | Dueño / Admin de Escuela | Profesor (en sus aulas) | Alumno (matriculado) | Padre / Tutor (hijo vinculado) |
| --- | --- | --- | --- | --- |
| Configurar catálogo de premios/ítems de tienda del aula | ✅ | ✅ | ❌ | ❌ |
| Consultar billetera de puntos, racha diaria y medallas | ✅ (consulta docente) | ✅ (consulta docente) | ✅ (propia) | ✅ (solo lectura de su hijo) |
| Comprar ítems en la tienda y aportar/equipar a la Mascota del Aula | ❌ | ❌ | ✅ (con saldo propio) | ❌ |
| Publicar, editar o eliminar avisos en el tablón del aula | ✅ | ✅ | ❌ (solo lectura) | ❌ (solo lectura de avisos) |
| Leer y escribir en el chat grupal del aula y usar `@menciones` | ✅ (moderación) | ✅ | ✅ (si no está silenciado) | ❌ |
| Moderar/ocultar mensajes del chat del aula y ver historial moderado | ✅ | ✅ | ❌ | ❌ |
| Participar en el foro de consultas de una actividad | ✅ | ✅ | ✅ | ❌ |
| Enviar y recibir mensajes directos Padre ↔ Profesor | ✅ (auditoría institucional) | ✅ | ❌ | ✅ (sobre su hijo vinculado) |
| Ejecutar controles en vivo (congelar asientos, silenciar sala/chat, bloquear pizarra, desactivar minijuegos) | ✅ | ✅ | ❌ | ❌ |
| Iniciar videollamada/voz y escribir en pizarrón colaborativo (gráficos y LaTeX) | ✅ | ✅ | ✅ (colabora si no está bloqueado) | ❌ |
| Configurar bibliografía permitida para el Bot Guía de Estudio y ver auditoría | ✅ | ✅ | ❌ | ❌ |
| Consultar al Bot Guía de Estudio (RAG) y recibir el Repaso Diario | ✅ | ✅ | ✅ (salvo examen en curso) | ❌ |

---

## 4. Reglas de Negocio (`RN-01` a `RN-20`)

Las siguientes reglas de negocio son invariantes transversales del dominio escolar y deben cumplirse en todas las capas del backend (`NestJS`, `Colyseus`, `Prisma/PostgreSQL` e integración con `Bedrock`):

| ID | Nombre de la regla | Especificación obligatoria |
| --- | --- | --- |
| **RN-01** | **Aislamiento multi-aula y multi-escuela** | Todo recurso académico (aula, material, actividad, entrega, calificación, mensaje, transacción de puntos o conversación con el bot) pertenece a un contexto organizacional explícito. Ningún usuario puede listar, leer ni modificar recursos de escuelas o aulas con las que no posea membresía o vínculo parental activo. |
| **RN-02** | **Membresía e invitaciones de ingreso** | El ingreso a una escuela o aula requiere una invitación válida (por correo electrónico con secreto hasheado de un solo uso y expiración, o código/enlace de invitación vigente y no revocado). La validación y el alta de membresía (`ClassroomMembership` / `Enrollment` o `SchoolMember`) se ejecutan en una única transacción atómica e idempotente. |
| **RN-03** | **Autoridad institucional sobre aulas** | El `Dueño` y el `Admin de Escuela` poseen autoridad equivalente a `Profesor` sobre todas las aulas pertenecientes a su escuela, derivada directamente de su membresía institucional (`SchoolMember`), sin requerir inscripción duplicada aula por aula. Un `Profesor` solo tiene autoridad sobre las aulas que dicta. |
| **RN-04** | **Respuestas uniformes de seguridad (`401` / `403` / `404`)** | Toda operación se autoriza en el servidor: sin sesión válida o con sesión expirada responde `401 Unauthorized`; con sesión válida pero rol insuficiente dentro de un aula accesible responde `403 Forbidden`; ante identificadores de escuelas, aulas, actividades o alumnos fuera del alcance del actor responde `404 Not Found` para no revelar su existencia. |
| **RN-05** | **Ciclo de vida y vencimientos de actividades** | Toda actividad publicada pertenece a un aula, define un tipo (`TP` o `Examen`), un formato (`Archivo` u `Opción Múltiple`), un puntaje máximo (`max_score`, escala `0–100`), una fecha/ventana límite (`due_date`) y una política de entregas tardías (`allow_late`). El estado del trabajo de cada alumno (`Pendiente`, `Entregada`, `Corregida`, `Vencida`) se deriva de los registros de `Submission`, `Grade` y de la hora oficial del servidor: si vence el plazo sin entrega y `allow_late = false`, el servidor rechaza envíos posteriores y expone el estado `Vencida`; si `allow_late = true`, admite la entrega marcándola explícitamente como tardía (`is_late = true`). |
| **RN-06** | **Reglas de corrección, devolución y privacidad de respuestas** | Solo el personal con autoridad de `Profesor` sobre el aula puede calificar o recalificar entregas manuales y registrar devoluciones (`feedback`). En actividades de opción múltiple, las opciones correctas nunca se envían al cliente antes de que la evaluación esté cerrada y corregida, y el puntaje se calcula exclusivamente en el servidor. |
| **RN-07** | **Fórmula de Puntos Ponderados e inmutabilidad del libro mayor** | Al confirmarse una calificación sobre una entrega, el servidor calcula y acredita en la misma transacción de base de datos los puntos ganados mediante la fórmula `puntos = redondear(nota * peso_actividad)` (`weight_multiplier`), donde un `Examen` posee una ponderación mayor que un `TP`. Todo movimiento se registra como un asiento inmutable en `PointTransaction` con restricción única por origen `(source_type, source_id)`. Si un docente recalifica una entrega, el sistema genera un asiento compensatorio por la diferencia, sin editar ni borrar asientos previos. |
| **RN-08** | **Regla de Racha Diaria (máximo 1 hito por día)** | La racha del alumno (`Streak`) se incrementa únicamente cuando completa una acción académica real verificada por el servidor: **(a)** entregar una actividad en término, **(b)** aprobar un examen o **(c)** responder correctamente la pregunta diaria de repaso del Bot. El simple inicio de sesión o conexión al mundo 3D no extiende la racha. Se computa como máximo **1 hito por alumno y día calendario** en la zona horaria `America/Argentina/Buenos_Aires`. |
| **RN-09** | **Economía de Tienda y Mascota del Aula** | El saldo de puntos de un alumno nunca puede ser negativo. Toda compra en la tienda (`points_cost`) o aporte colaborativo a la **Mascota del Aula** (`pet_contribution`) valida autorización, disponibilidad del ítem y saldo suficiente bajo bloqueo transaccional e idempotencia. Cada aula posee exactamente una `ClassroomPet` motivacional e independiente del Bot IA; los ítems comprables deben corresponder a efectos o accesorios implementados. |
| **RN-10** | **Controles de Clase en Vivo autoritativos en servidor** | Las herramientas de control sincrónico (`Congelar / Freeze`, `Silenciar a todos / Mute`, `Silenciar chat`, `Bloquear colaboración en pizarrón` y `Deshabilitar minijuegos`) solo pueden ser accionadas por un usuario con autoridad de `Profesor` en el aula activa. `Freeze` asigna y bloquea a cada alumno en su pupitre (`Desk`) rechazando entradas de movimiento en el servidor; los bloqueos de chat, pizarrón y minijuegos persisten en el estado del aula y se re-aplican ante reconexiones. |
| **RN-11** | **Pizarrón colaborativo, gráficos y LaTeX seguros** | Las ediciones sobre el pizarrón interactivo, el graficador de funciones matemáticas y las expresiones **LaTeX** se validan en tamaño, frecuencia y permisos de colaboración en el servidor. El contenido LaTeX y textual se interpreta únicamente como datos estructurados (por ejemplo, mediante KaTeX) y jamás se ejecuta ni inyecta como HTML arbitrario. |
| **RN-12** | **Restricción RAG del Bot a bibliografía docente aprobada** | El **Bot Guía de Estudio** responde consultas exclusivamente mediante generación aumentada por recuperación (RAG) sobre los documentos (`StudyMaterial`) subidos al aula y explícitamente habilitados por el profesor (`is_bot_enabled = true` / `AllowedMaterial`). El filtro de recuperación por aula y material habilitado se aplica en el servidor antes de invocar a Amazon Bedrock; si la respuesta no consta en el material aprobado, el bot informa dicha limitación sin inventar contenido curricular. |
| **RN-13** | **Regla anticopia y bloqueo del Bot durante exámenes** | El Bot actúa estrictamente como guía socrática y de estudio: explica conceptos, cita el material docente y orienta el razonamiento, pero **tiene prohibido resolver tareas, redactar entregas o revelar respuestas de exámenes**. Además, mientras un alumno tiene un examen en curso según el reloj del servidor, el Bot y el Repaso Diario quedan bloqueados para ese alumno (incluyendo respuestas en vuelo). |
| **RN-14** | **Trazabilidad académica y solo lectura del Bot** | Toda interacción con el Bot se ejecuta bajo los permisos del usuario autenticado, registra metadatos de auditoría pedagógica (`BotConversationLog` / `BotConversation`) para que el docente identifique qué temas generan más dudas en el curso, y **no realiza ninguna modificación directa (creación, edición ni borrado) en la base de datos** durante el MVP. |
| **RN-15** | **Repaso Diario único por día en hora de Argentina** | En la primera conexión autenticada de cada día calendario (calculado en el servidor bajo la zona horaria `America/Argentina/Buenos_Aires`), el sistema presenta por única vez el **Repaso Diario** (`DailyReviewDelivery`) a todos los roles excepto `Padre / Tutor`, resumiendo actividades próximas a vencer, calificaciones recientes y preguntas de repaso. Si el proveedor de IA no está disponible, entrega automáticamente un resumen estructurado sin texto generativo. |
| **RN-16** | **Aislamiento de solo lectura para Padre / Tutor y Modo Adultos** | Un `Padre / Tutor` accede únicamente a la información académica y notificaciones de los hijos a los que esté vinculado mediante un `ParentStudentLink` activo (máximo **2** tutores por alumno), sin acceso al mundo 3D, al chat grupal de alumnos ni al Bot. Si el aula tiene activo el **Modo Educación de Adultos (`adult_mode = true`)**, el servidor rechaza la creación de vínculos parentales, invitaciones a padres, mensajería parental y envíos de alertas familiares en esa aula. |
| **RN-17** | **Equivalencia funcional del Modo 2D Clásico** | Toda funcionalidad académica esencial disponible mediante objetos del entorno 3D (actividades, entregas, calificaciones, bibliografía, avisos, chat, tienda, mascota y consulta al Bot) debe poder ejecutarse íntegramente desde el **Modo 2D Clásico** y no otorga permisos por la mera proximidad o clic sobre un objeto 3D. |
| **RN-18** | **Moderación preservando historial y baja lógica (`deleted_at`)** | La expulsión de un miembro, la baja de un recurso o la moderación de un mensaje en el chat se implementan como cambios de estado o bajas lógicas (`deleted_at` / estado de moderación con autor y marca temporal). Las entregas, calificaciones, transacciones de puntos y el historial de moderación para el profesor se conservan íntegros para trazabilidad académica. |
| **RN-19** | **Separación entre persistencia transaccional y estado efímero 3D** | Las posiciones por fotograma, vectores de movimiento e interpolaciones de avatares residen en memoria de la sesión en tiempo real (`Colyseus`) y nunca se persisten fila por fila en PostgreSQL. El tiempo de conexión se consolida únicamente de forma agregada en `ActivityMetric`. |
| **RN-20** | **Privacidad de archivos y datos de menores** | Los archivos de bibliografía y los adjuntos de entregas se almacenan en buckets privados (`Amazon S3`), validando tipo real, tamaño y cantidad en el servidor, y se sirven únicamente mediante URLs firmadas de corta duración tras verificar autorización sobre el aula o la entrega. Los registros de aplicación y correos electrónicos nunca exponen contraseñas, tokens, claves ni datos sensibles de menores. |

---

## 5. Especificación de Requerimientos Funcionales (`RF-XXX-NNN`)

### 5.1 Módulo `RF-AUT` · Autenticación, Perfiles y Cuentas

#### RF-AUT-001 · Registro de cuenta y elección de camino organizacional
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** Visitante
- **Precondiciones:** El visitante no posee una sesión activa y proporciona un correo electrónico no registrado.
- **Postcondiciones:** Se crea el usuario con contraseña hasheada, su configuración inicial de avatar (`AvatarConfiguration`) y, de forma atómica, su espacio de profesor independiente o su escuela inicial (o bien queda listo para aceptar una invitación recibida).
- **Descripción:** El sistema debe permitir el registro de usuarios mediante correo electrónico normalizado, nombre visible, contraseña segura (mínimo 8 caracteres) y selección del camino de organización (`Profesor independiente` o `Escuela`), o el alta guiada desde una invitación escolar.
- **Criterios de aceptación:**
  1. **Dado** un visitante que envía datos válidos eligiendo el camino de Profesor independiente o de Escuela, **cuando** confirma el registro, **entonces** el servidor crea en una sola transacción la cuenta (`User`), su configuración base de avatar y la estructura organizacional correspondiente, sin almacenar ni devolver jamás la contraseña en texto plano (`RN-02`, `RN-20`).
  2. **Dado** un correo electrónico ya registrado (tras normalizar mayúsculas y espacios), **cuando** un visitante intenta registrarse con él, **entonces** el servidor rechaza la operación con un mensaje claro sin duplicar la cuenta.
  3. **Dados** campos vacíos, correo con formato inválido o contraseña menor a 8 caracteres, **cuando** se envía el formulario, **entonces** el cliente informa los errores por campo y el servidor vuelve a validar y rechaza la petición con `400 Bad Request`.

#### RF-AUT-002 · Inicio de sesión, renovación y cierre de sesión
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** Visitante, Usuario autenticado (`Profesor`, `Alumno`, `Padre / Tutor`, `Dueño / Admin`)
- **Precondiciones:** El usuario posee una cuenta registrada.
- **Postcondiciones:** Se emite una sesión/credencial con expiración verificable en el servidor; al cerrar sesión se invalida la credencial y se desconecta cualquier sesión en vivo activa en Colyseus.
- **Descripción:** El sistema debe autenticar credenciales de acceso, renovar sesiones activas dentro de su ventana de validez, invalidar sesiones al ejecutar logout o restablecimiento de contraseña y proteger todos los endpoints privados y conexiones en tiempo real.
- **Criterios de aceptación:**
  1. **Dadas** credenciales válidas, **cuando** el usuario inicia sesión, **entonces** accede al panel correspondiente a sus membresías y roles vigentes.
  2. **Dadas** credenciales inválidas, **cuando** un visitante intenta iniciar sesión, **entonces** el servidor responde `401 Unauthorized` con un mensaje genérico que no revela si falló el correo o la contraseña.
  3. **Dado** un usuario autenticado que ejecuta el cierre de sesión (`logout`), **cuando** la operación se confirma, **entonces** el servidor invalida la sesión de forma inmediata, retira su avatar de cualquier aula activa en Colyseus y responde `401` ante cualquier petición posterior con la credencial anterior (`RN-04`).
  4. **Dado** un usuario que solicita recuperar su contraseña por email, **cuando** ingresa un correo registrado o no registrado, **entonces** el sistema devuelve una respuesta idéntica en pantalla y, si la cuenta existe, envía un enlace de un solo uso con expiración que al utilizarse invalida las sesiones previas.

#### RF-AUT-003 · Gestión de perfil y configuración de avatar base
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Alumno`, `Padre / Tutor`, `Dueño / Admin`
- **Precondiciones:** El usuario tiene una sesión válida activa.
- **Postcondiciones:** Se actualizan los datos del perfil (`display_name`) y la apariencia persistente del avatar (`AvatarConfiguration`), reflejándose en las aulas donde participa.
- **Descripción:** El sistema debe permitir a cada usuario consultar y actualizar su nombre visible y la configuración visual base de su avatar 3D (aspecto inicial e ítems desbloqueados), persistiendo los cambios entre sesiones y dispositivos.
- **Criterios de aceptación:**
  1. **Dado** un usuario autenticado, **cuando** actualiza su nombre visible o los parámetros base permitidos de su avatar y guarda los cambios, **entonces** la configuración se persiste en base de datos y se mantiene tras recargar la página o volver a iniciar sesión.
  2. **Dado** un alumno o profesor dentro de un aula activa, **cuando** actualiza su apariencia con opciones válidas o ítems adquiridos en la tienda, **entonces** los demás integrantes conectados al aula ven el avatar actualizado (`RN-09`).
  3. **Dado** un usuario que intenta equipar un accesorio o ítem bloqueado que no posee, **entonces** el servidor rechaza la actualización con `403` o `400` sin modificar la configuración persistida.

#### RF-AUT-004 · Vinculación Padre-Alumno (`ParentStudentLink`)
- **Prioridad:** Should · **Fase:** MVP Extendido · **Actor:** `Profesor`, `Dueño / Admin`, `Padre / Tutor`
- **Precondiciones:** El aula no se encuentra en modo educación de adultos (`adult_mode = false`) y el alumno tiene menos de 2 tutores activos vinculados.
- **Postcondiciones:** Se crea un registro `ParentStudentLink` (`ParentLink`) activo que habilita al `Padre / Tutor` la vista de seguimiento y las notificaciones de ese hijo.
- **Descripción:** El sistema debe permitir que el profesor o administrador de la escuela emita una invitación de vinculación familiar asociada a un alumno específico, y que el padre o tutor la acepte desde su cuenta autenticada.
- **Criterios de aceptación:**
  1. **Dado** un profesor o administrador de un aula con `adult_mode = false`, **cuando** envía una invitación de padre/tutor asociada a un alumno matriculado y el adulto la acepta autenticado, **entonces** se registra el vínculo `ParentStudentLink` de forma atómica (`RN-02`, `RN-16`).
  2. **Dado** un alumno que ya posee **2** tutores activos vinculados, **cuando** se intenta registrar un tercer vínculo parental, **entonces** el servidor rechaza la operación informando el límite máximo permitido (`RN-16`).
  3. **Dada** un aula configurada con `adult_mode = true`, **cuando** se intenta emitir o aceptar una invitación de `Padre / Tutor` o consultar datos mediante un vínculo parental en esa aula, **entonces** el servidor rechaza la operación (`RN-16`).

---

### 5.2 Módulo `RF-AUL` · Aulas, Escuelas, Membresías y Roles

#### RF-AUL-001 · Creación y configuración de aula
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Dueño / Admin de Escuela`
- **Precondiciones:** El usuario posee sesión activa con rol de `Profesor` (independiente o de escuela) o `Dueño / Admin de Escuela`.
- **Postcondiciones:** Se crea el registro persistente `Classroom` asociado exactamente a una escuela o a un profesor independiente, junto con su mascota inicial (`ClassroomPet`), sus pupitres base y sus estados de control por defecto.
- **Descripción:** El sistema debe permitir crear, configurar y listar aulas virtuales indicando nombre, materia/descripción, modalidad (`adult_mode`) y pertenencia organizacional, inicializando automáticamente sus recursos base.
- **Criterios de aceptación:**
  1. **Dado** un profesor o administrador autorizado, **cuando** crea un aula con datos válidos, **entonces** el servidor persiste en una transacción el `Classroom`, la asignación docente, la `ClassroomPet` inicial y el estado por defecto de los controles del aula (`chat_muted = false`, `collaboration_locked = false`, `games_disabled = false`).
  2. **Dado** un usuario con rol `Alumno` o `Padre / Tutor`, **cuando** intenta crear o editar la configuración de un aula, **entonces** el servidor rechaza la petición con `403 Forbidden` (`RN-04`).
  3. **Dada** la creación de un aula, **entonces** la base de datos garantiza que pertenezca exactamente a una `School` o a un `Profesor independiente`, nunca a ambos ni a ninguno (`RN-01`).

#### RF-AUL-002 · Incorporación al aula por invitación o código/enlace de acceso
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Dueño / Admin`, `Alumno`, `Padre / Tutor`
- **Precondiciones:** El aula se encuentra activa (`deleted_at IS NULL`) y el emisor tiene autoridad docente sobre ella.
- **Postcondiciones:** Se genera una invitación con vencimiento y secreto hasheado (o código/enlace revocable), y al ser aceptada por el destinatario autenticado se crea su membresía (`ClassroomMembership` / `Enrollment`) con el rol fijado por la invitación.
- **Descripción:** El sistema debe permitir a profesores y administradores invitar alumnos y padres por correo electrónico, y permitir que los alumnos se unan mediante un código/enlace de aula con fecha de expiración y revocación (el código otorga únicamente el rol `Alumno`; los padres y los profesores invitados se incorporan siempre por correo, de un solo uso; decisión D7), e inscribir al usuario de forma atómica al aceptar.
- **Criterios de aceptación:**
  1. **Dado** un profesor del aula, **cuando** emite una invitación por correo para un alumno o un padre, o genera un código/enlace de acceso de aula (solo rol `Alumno`) con vencimiento, **entonces** el servidor almacena únicamente el hash del secreto junto con el aula destino, el rol asignado y la fecha de expiración (`RN-02`).
  2. **Dada** una invitación vigente y no utilizada/revocada, **cuando** el usuario autenticado la acepta, **entonces** el servidor registra su membresía en el aula de manera atómica e idempotente sin permitir que el invitado modifique el rol estipulado (`RN-02`).
  3. **Dada** una invitación expirada, revocada o perteneciente a un aula dada de baja, **cuando** un usuario intenta utilizarla, **entonces** el servidor rechaza la solicitud con un mensaje claro y no crea ninguna membresía.
  4. **Dado** un usuario que ya es miembro activo del aula, **cuando** intenta aceptar nuevamente una invitación para la misma aula, **entonces** el sistema no duplica la inscripción.

#### RF-AUL-003 · Gestión de miembros, roles y bajas lógicas en el aula
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Dueño / Admin de Escuela`
- **Precondiciones:** El actor tiene autoridad docente o institucional sobre el aula.
- **Postcondiciones:** Se consulta el padrón del aula o se desactiva lógicamente (`deleted_at`) la membresía de un integrante, cortando de inmediato su acceso HTTP y su conexión en tiempo real.
- **Descripción:** El sistema debe permitir visualizar la nómina de miembros del aula (profesores, alumnos matriculados y vínculos parentales activos) y desactivar lógicamente la membresía de un alumno o revocar accesos cuando corresponda, conservando sus registros académicos históricos.
- **Criterios de aceptación:**
  1. **Dado** un profesor del aula, **cuando** consulta el listado de integrantes, **entonces** obtiene la nómina paginada de alumnos matriculados y su estado de actividad dentro de esa aula (`RN-01`).
  2. **Dado** un profesor o administrador que da de baja a un alumno del aula, **cuando** confirma la acción, **entonces** la membresía pasa a baja lógica (`deleted_at`), el alumno es desconectado de inmediato de la sesión Colyseus del aula y ya no puede acceder a ella, pero sus entregas, calificaciones y mensajes previos se conservan atribuidos (`RN-18`).
  3. **Dado** un profesor de un aula `A`, **cuando** intenta listar miembros o modificar roles en un aula `B` de otro docente donde no tiene autoridad, **entonces** el servidor responde `404 Not Found` (`RN-03`, `RN-04`).

#### RF-AUL-004 · Gestión institucional multi-aula para Dueño / Admin de Escuela
- **Prioridad:** Should · **Fase:** MVP Extendido · **Actor:** `Dueño / Admin de Escuela`
- **Precondiciones:** La organización fue creada bajo el camino `Escuela` y el usuario posee membresía `SchoolMember` con rol `Owner` o `Admin`.
- **Postcondiciones:** Se gestiona el plantel docente, las aulas de la institución y la supervisión consolidada de la escuela.
- **Descripción:** El sistema debe permitir al `Dueño / Admin de Escuela` invitar profesores a la institución, asignarles o supervisar aulas, delegar funciones administrativas y acceder con autoridad docente a cualquier aula de su escuela.
- **Criterios de aceptación:**
  1. **Dado** el `Dueño` o `Admin` de una escuela, **cuando** invita a un docente por correo electrónico y este acepta, **entonces** el docente queda incorporado como `SchoolMember` con rol `Teacher` dentro de esa escuela (`RN-02`).
  2. **Dado** el `Dueño` o `Admin` de una escuela, **cuando** accede a cualquier aula perteneciente a su institución, **entonces** el servidor le reconoce autoridad de nivel `Profesor` a partir de su rol en `SchoolMember` sin exigir una fila de inscripción por aula (`RN-03`).
  3. **Dado** el `Dueño` o `Admin` de la Escuela `X`, **cuando** intenta acceder a un aula o recurso de la Escuela `Y`, **entonces** el servidor rechaza la petición con `404 Not Found` (`RN-01`, `RN-04`).

#### RF-AUL-005 · Aislamiento de recursos y verificación de acceso en servidor
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Sistema`
- **Precondiciones:** Cualquier petición HTTP a `NestJS` o mensaje/unión WebSocket a `Colyseus`.
- **Postcondiciones:** Se autoriza o rechaza la operación evaluando autenticación → membresía/vínculo → rol a partir del estado persistido actual.
- **Descripción:** El sistema debe resolver el aula y la escuela de cada recurso en el servidor a partir de su identificador persistido, ignorando ámbitos enviados por el cliente y previniendo cualquier acceso cruzado por manipulación de IDs (*ID tampering*).
- **Criterios de aceptación:**
  1. **Dada** una petición sobre una actividad, entrega, mensaje o archivo cuyo ID pertenece a un aula con la que el usuario no tiene relación, **cuando** el servidor la procesa, **entonces** responde `404 Not Found` sin filtrar ningún dato del recurso (`RN-01`, `RN-04`).
  2. **Dado** un alumno matriculado en el aula que invoca un endpoint exclusivo de `Profesor` dentro de su propia aula (por ejemplo, publicar una actividad o congelar el aula), **cuando** el servidor verifica su rol, **entonces** responde `403 Forbidden` (`RN-04`).

---

### 5.3 Módulo `RF-ESP` · Espacio 3D, Avatar, Pupitres y Modo 2D Clásico

#### RF-ESP-001 · Navegación en Aula 3D isométrica y sincronización de presencia
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Alumno`, `Dueño / Admin`
- **Precondiciones:** El usuario posee acceso vigente al aula seleccionada.
- **Postcondiciones:** El cliente renderiza el aula 3D con cámara isométrica en Three.js + React Three Fiber, conecta a la `Room` correspondiente de Colyseus y sincroniza en tiempo real la posición y presencia de los avatares conectados.
- **Descripción:** El sistema debe permitir a profesores y alumnos desplazarse por el aula tridimensional mediante teclado (`WASD`), clic de mouse a destino o entrada táctil equivalente, respetando límites y colisiones del escenario y visualizando en tiempo real a los demás miembros presentes sin persistir cada paso en PostgreSQL.
- **Criterios de aceptación:**
  1. **Dado** un profesor o alumno con acceso al aula, **cuando** ingresa al entorno 3D, **entonces** Colyseus verifica su identidad y membresía contra el backend de negocio y sincroniza su avatar y la lista de presencia con los demás usuarios conectados a esa misma aula (`RN-01`, `RN-19`).
  2. **Dado** un usuario desplazándose con `WASD`, clic o gesto táctil sobre superficies transitables, **cuando** encuentra paredes, pupitres u obstáculos, **entonces** el sistema aplica las colisiones del escenario y mantiene una cámara isométrica estable.
  3. **Dado** un usuario que se desconecta o pierde conexión temporalmente, **cuando** ocurre el corte o se reconecta, **entonces** los demás integrantes ven actualizarse su estado de presencia y el servidor limpia o restaura su asiento/avatar sin generar filas por fotograma en la base de datos (`RN-19`).

#### RF-ESP-002 · Interacción con pupitres (`Desk`) y objetos educativos del aula
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Alumno`
- **Precondiciones:** El usuario se encuentra dentro del Aula 3D con membresía activa.
- **Postcondiciones:** Al interactuar con un objeto del aula se abre el panel React correspondiente o se ejecuta su transición autorizada.
- **Descripción:** El sistema debe proveer en el aula pupitres asignables para los alumnos (`Desk`), escritorio del profesor, pizarra, estantería de bibliografía, cartelera de avisos, boletín de notas, tienda, mascota y el personaje del Bot Guía de Estudio, abriendo sus interfaces React al seleccionarlos y validando cada acción de negocio en el backend.
- **Criterios de aceptación:**
  1. **Dado** un alumno en el Aula 3D, **cuando** interactúa con su pupitre (`Desk`), la estantería de material, la tienda o el Bot Guía, **entonces** la aplicación resalta el objeto interactuable y abre el panel React de actividades/entregas, bibliografía, tienda o tutor IA respectivamente (`RN-17`).
  2. **Dado** un alumno que interactúa con el escritorio del profesor o con un objeto de gestión docente, **cuando** intenta ejecutar una acción administrativa, **entonces** la interfaz no habilita acciones de edición docente y el servidor rechaza cualquier petición directa con `403 Forbidden` (`RN-04`, `RN-17`).
  3. **Dado** el crecimiento de alumnos matriculados en el aula, **entonces** el sistema garantiza que exista siempre al menos un pupitre/asiento (`Desk`) asignable por cada alumno inscrito (`RN-10`).

#### RF-ESP-003 · Conmutación en un clic al Modo 2D Clásico accesible
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Alumno`, `Dueño / Admin`
- **Precondiciones:** El usuario tiene acceso al aula.
- **Postcondiciones:** La interfaz alterna de forma inmediata entre la vista de Aula 3D y el Modo 2D Clásico sin perder la sesión ni el contexto del aula actual.
- **Descripción:** El sistema debe ofrecer un conmutador directo (en un solo clic o atajo de teclado) entre la escena 3D y el **Modo 2D Clásico**, brindando desde la interfaz 2D acceso completo a actividades, entregas, calificaciones, bibliografía, anuncios, chat, tienda, mascota y Bot Guía de Estudio.
- **Criterios de aceptación:**
  1. **Dado** un profesor o alumno ubicado en el Aula 3D (o que ingresa desde un dispositivo móvil o sin soporte WebGL fluido), **cuando** activa el cambio a **Modo 2D Clásico**, **entonces** accede mediante paneles convencionales navegables por teclado y lector de pantalla a todas las funciones esenciales del aula sin recargar ni perder su sesión (`RN-17`).
  2. **Dado** un usuario operando desde el Modo 2D Clásico, **cuando** publica o entrega una actividad, envía un mensaje en el chat, compra en la tienda o consulta al Bot IA, **entonces** el sistema ejecuta exactamente las mismas validaciones, persistencia y notificaciones que desde el entorno 3D (`RN-17`).

#### RF-ESP-004 · Personalización visual de avatar y pupitre con ítems del aula
- **Prioridad:** Should · **Fase:** MVP Core · **Actor:** `Alumno`, `Profesor`
- **Precondiciones:** El usuario posee en su inventario (`StudentPurchase` / `ClassroomItem`) los accesorios o mejoras que desea aplicar.
- **Postcondiciones:** Se persiste la selección visual y se representa tanto en la escena 3D como en el perfil del usuario.
- **Descripción:** El sistema debe permitir a los usuarios aplicar sobre su avatar o pupitre los accesorios y mejoras adquiridos legítimamente en la tienda del aula, sincronizando su visualización con el resto de los miembros conectados.
- **Criterios de aceptación:**
  1. **Dado** un alumno que adquirió un accesorio de avatar o decoración de pupitre en la tienda del aula, **cuando** lo equipa desde su inventario, **entonces** el servidor verifica la titularidad del ítem, persiste el cambio y los demás usuarios del aula visualizan la personalización en la escena 3D (`RN-09`).

---

### 5.4 Módulo `RF-ACT` · Actividades, TPs, Exámenes, Entregas y Calificaciones

#### RF-ACT-001 · Publicación y gestión de Actividades (TPs, Exámenes y Material)
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Dueño / Admin de Escuela`
- **Precondiciones:** El actor posee autoridad de `Profesor` sobre el aula.
- **Postcondiciones:** Se persiste la actividad (`Activity`) o el material (`StudyMaterial` / `Material`) en PostgreSQL/S3 y, al publicarse, se notifica a los alumnos matriculados.
- **Descripción:** El sistema debe permitir al profesor crear, editar, publicar y dar de baja lógica actividades de tipo **Trabajo Práctico (`TP`)** o **Examen (`Exam`)**, con formato de **entrega de archivo** o **opción múltiple**, definiendo título, consigna, fecha/ventana de vencimiento (`due_date`), puntaje máximo (`max_score = 100`), política de entrega tardía (`allow_late`) y ponderación de puntos (`weight_multiplier`), así como subir archivos de bibliografía a almacenamiento privado S3.
- **Criterios de aceptación:**
  1. **Dado** un profesor en su aula, **cuando** crea y publica un `TP` o `Examen` con datos válidos, **entonces** el servidor persiste la actividad asociada al aula, emite el evento `activity:published` y genera notificaciones para los alumnos inscritos (`RN-05`).
  2. **Dada** una actividad en estado borrador (no publicada), **cuando** un alumno o padre consulta las actividades del aula, **entonces** el servidor no incluye borradores ni claves de respuestas correctas de opción múltiple en ninguna respuesta (`RN-05`, `RN-06`).
  3. **Dada** una actividad que ya registra entregas o calificaciones de alumnos, **cuando** el profesor intenta eliminarla físicamente, **entonces** el servidor rechaza el borrado físico y aplica únicamente desactivación/baja lógica (`deleted_at`) según la política de integridad académica (`RN-18`).
  4. **Dado** un profesor que sube un archivo de material de estudio (PDF, imagen o documento permitido), **cuando** el servidor valida su tipo real y tamaño, **entonces** lo almacena de forma privada en S3 y permite descargarlo a los miembros autorizados del aula mediante URLs firmadas temporales (`RN-20`).

#### RF-ACT-002 · Bandeja de actividades del alumno y estados del ciclo de vida
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Alumno`
- **Precondiciones:** El alumno se encuentra matriculado activamente en el aula.
- **Postcondiciones:** Se presenta la lista paginada y filtrable de actividades publicadas con el estado derivado exacto para ese alumno.
- **Descripción:** El sistema debe mostrar al alumno desde su pupitre 3D o desde el Modo 2D Clásico la bandeja de actividades del aula con su tipo (`TP` o `Examen`), fecha de vencimiento, ponderación de puntos y estado actual derivado (`Pendiente`, `Entregada`, `Corregida` o `Vencida`).
- **Criterios de aceptación:**
  1. **Dado** un alumno matriculado, **cuando** abre su bandeja de actividades, **entonces** visualiza las actividades publicadas de su aula clasificadas por estado (`Pendiente`, `Entregada`, `Corregida`, `Vencida`) calculado a partir de sus registros de `Submission`, `Grade` y la fecha/hora del servidor (`RN-05`).
  2. **Dada** una actividad cuya fecha límite (`due_date`) ha expirado sin entrega del alumno y cuya configuración tiene `allow_late = false`, **cuando** el alumno consulta su bandeja, **entonces** la actividad figura como `Vencida` y no permite enviar nuevas entregas (`RN-05`).

#### RF-ACT-003 · Realización de entregas con archivos adjuntos o respuestas de opción múltiple
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Alumno`
- **Precondiciones:** El alumno está matriculado en el aula, la actividad está publicada y se encuentra dentro del plazo permitido (o `allow_late = true`).
- **Postcondiciones:** Se registra o actualiza la `Submission` con marca temporal del servidor; en exámenes de opción múltiple autoevaluables puede dispararse la corrección automática en el servidor.
- **Descripción:** El sistema debe permitir al alumno enviar su resolución de un `TP` o `Examen` subiendo archivos adjuntos validados (almacenados en S3 privado) o respondiendo las preguntas de opción múltiple, garantizando idempotencia ante reintentos de red.
- **Criterios de aceptación:**
  1. **Dado** un alumno dentro del plazo de una actividad publicada, **cuando** envía su entrega con archivos válidos o respuestas seleccionadas, **entonces** el servidor asigna autor y timestamp oficial, persiste la `Submission` de forma idempotente y el estado pasa a `Entregada` (`RN-05`, `RN-20`).
  2. **Dada** una actividad con `allow_late = true` cuya fecha de vencimiento ya pasó, **cuando** el alumno realiza la entrega, **entonces** el servidor la acepta dejándola marcada explícitamente como entrega tardía (`is_late = true`) para conocimiento del profesor (`RN-05`).
  3. **Dado** un alumno `A`, **cuando** intenta leer, descargar o sobrescribir la entrega de otro alumno `B`, **entonces** el servidor rechaza la operación con `403` o `404` (`RN-04`, `RN-20`).

#### RF-ACT-004 · Corrección docente, devolución (`feedback`) y acreditación automática de puntos
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Dueño / Admin de Escuela`, `Sistema`
- **Precondiciones:** Existe una `Submission` de un alumno en un aula donde el actor tiene autoridad de `Profesor`.
- **Postcondiciones:** Se persiste la calificación (`Grade`, escala `0–100`) y la devolución docente en la misma transacción que el asiento `PointTransaction` de puntos ponderados, y se notifica al alumno y a sus padres vinculados.
- **Descripción:** El sistema debe proveer al profesor una bandeja paginada y filtrable de entregas para revisar los archivos o respuestas del alumno, asignar una nota de `0` a `100` con comentarios de devolución (`feedback`) y acreditar automáticamente en el libro mayor los puntos ponderados (`nota * peso_actividad`).
- **Criterios de aceptación:**
  1. **Dado** un profesor revisando una entrega de su aula, **cuando** registra una calificación válida (`0–100`) y su devolución, **entonces** el servidor guarda en una única transacción atómica el registro `Grade` y el asiento inmutable `PointTransaction` calculado según el peso de la actividad (`RN-06`, `RN-07`).
  2. **Dado** el commit exitoso de una calificación, **entonces** el estado de la actividad para el alumno pasa a `Corregida`, se emite el evento `grade:published` y se crean notificaciones in-app para el alumno y notificaciones in-app + email para sus padres vinculados (`RN-07`, `RN-16`).
  3. **Dada** una entrega ya calificada que el profesor decide recalificar con una nueva nota, **cuando** confirma la modificación, **entonces** el servidor actualiza la nota conservando trazabilidad y registra un asiento compensatorio en `PointTransaction` por la diferencia exacta de puntos, sin editar ni eliminar el asiento original (`RN-07`, `RN-18`).

#### RF-ACT-005 · Historial académico y métricas de actividad del alumno (`ActivityMetric`)
- **Prioridad:** Should · **Fase:** MVP Core · **Actor:** `Alumno`, `Profesor`, `Dueño / Admin`
- **Precondiciones:** El usuario tiene acceso al aula (como profesor/admin para ver el curso, o como alumno para ver su propio boletín).
- **Postcondiciones:** Se exponen las calificaciones, devoluciones, estado de entregas y métricas agregadas de participación.
- **Descripción:** El sistema debe consolidar en el boletín/libro de notas las calificaciones obtenidas por el alumno, el promedio/progreso de entregas y la métrica agregada `ActivityMetric` (tiempo conectado reportado por Colyseus en intervalos agregados, cantidad de entregas y participación en el aula).
- **Criterios de aceptación:**
  1. **Dado** un profesor consultando el panel de seguimiento de su aula, **cuando** selecciona la vista de desempeño, **entonces** visualiza para cada alumno sus trabajos completados, pendientes, calificaciones y los indicadores agregados de `ActivityMetric` (tiempo conectado, entregas y participación) (`RN-19`).
  2. **Dado** un alumno consultando su boletín de notas, **entonces** visualiza únicamente sus propias calificaciones, devoluciones y métricas, sin acceso a las notas ni métricas de sus compañeros (`RN-01`, `RN-04`).

#### RF-ACT-006 · Vista de seguimiento académico para Padre / Tutor
- **Prioridad:** Should · **Fase:** MVP Extendido · **Actor:** `Padre / Tutor`
- **Precondiciones:** El usuario posee rol `Padre / Tutor` con un vínculo `ParentStudentLink` activo y el aula del hijo tiene `adult_mode = false`.
- **Postcondiciones:** El padre visualiza el estado académico actualizado de su hijo y recibe alertas por correo e in-app.
- **Descripción:** El sistema debe ofrecer al `Padre / Tutor` una interfaz simplificada de solo lectura donde pueda consultar las calificaciones publicadas, el estado de las actividades (`Pendiente`, `Entregada`, `Corregida`, `Vencida`) y las métricas de actividad de cada uno de sus hijos vinculados.
- **Criterios de aceptación:**
  1. **Dado** un padre con vínculo activo sobre uno o más hijos, **cuando** ingresa a su panel familiar, **entonces** visualiza las calificaciones, el estado de entregas y las notificaciones de cada hijo vinculado (`RN-16`).
  2. **Dado** un padre autenticado, **cuando** intenta consultar calificaciones, entregas o métricas de un alumno con el que no posee un `ParentStudentLink` activo, **entonces** el servidor responde `404 Not Found` (`RN-04`, `RN-16`).

---

### 5.5 Módulo `RF-GAM` · Puntos Ponderados, Racha, Medallas, Tienda y Mascota del Aula

#### RF-GAM-001 · Billetera de puntos ponderados e historial de movimientos (`PointTransaction`)
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Alumno`, `Profesor`, `Padre / Tutor` (solo lectura de su hijo)
- **Precondiciones:** El alumno está matriculado en el aula.
- **Postcondiciones:** Se calcula el saldo actual como suma de los asientos inmutables del libro mayor (`PointTransaction`) y se expone el historial auditable de movimientos.
- **Descripción:** El sistema debe gestionar una billetera de puntos por alumno respaldada por un libro mayor inmutable (`PointTransaction`), donde cada acreditación por calificación, ajuste compensatorio o débito por compra en tienda/aporte a la mascota quede registrado con su motivo, fecha y referencia de origen.
- **Criterios de aceptación:**
  1. **Dado** un alumno que consulta su billetera de puntos, **cuando** se abre el panel, **entonces** visualiza su saldo actual calculado en el servidor y el listado cronológico de transacciones (`acreditación por nota ponderada`, `compra en tienda`, `aporte a mascota`, `ajuste compensatorio`) (`RN-07`).
  2. **Dada** una solicitud o reintento de acreditación sobre una misma entrega calificada `(source_type, source_id)`, **entonces** la restricción de unicidad del libro mayor impide cualquier duplicación de puntos (`RN-07`).
  3. **Dado** un cliente que intenta enviar un saldo o modificar directamente sus puntos, **entonces** el servidor rechaza la operación; los alumnos tampoco pueden transferir puntos a otros alumnos (`RN-07`, `RN-09`).

#### RF-GAM-002 · Racha diaria de estudio (`Streak`) y otorgamiento de Medallas (`Badge`)
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Alumno`, `Sistema`
- **Precondiciones:** El alumno realiza una actividad académica calificable durante el día calendario en `America/Argentina/Buenos_Aires`.
- **Postcondiciones:** Se actualiza de forma idempotente la racha del alumno (máximo 1 incremento por día local) y, si cumple las condiciones de un logro, se le adjudica la medalla correspondiente (`StudentBadge`).
- **Descripción:** El sistema debe contabilizar la racha de días consecutivos en los que el alumno registra una acción académica real (entrega en término, examen aprobado o respuesta a la pregunta diaria de repaso del Bot) y otorgar medallas por hitos alcanzados.
- **Criterios de aceptación:**
  1. **Dado** un alumno que inicia sesión y camina por el aula 3D sin realizar ninguna entrega ni completar el repaso diario, **cuando** finaliza su sesión, **entonces** su racha diaria **no** se incrementa (`RN-08`).
  2. **Dado** un alumno que entrega un TP en término y el mismo día aprueba un examen y responde la pregunta diaria en horario `America/Argentina/Buenos_Aires`, **cuando** el servidor procesa los eventos, **entonces** contabiliza exactamente **1 hito diario** para esa fecha local sin duplicar el incremento (`RN-08`).
  3. **Dado** un alumno que alcanza la condición de una medalla definida en el catálogo (`Badge`), **cuando** el servidor verifica el logro, **entonces** registra `StudentBadge` de forma idempotente `(student_id, badge_id)` y notifica al alumno (`RN-08`).

#### RF-GAM-003 · Compra de ítems en la Tienda del Aula (`ShopItem` / `StudentPurchase`)
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Alumno`
- **Precondiciones:** El ítem está habilitado en el catálogo (`ShopItem`), posee funcionalidad real implementada y el alumno cuenta con saldo suficiente en su billetera.
- **Postcondiciones:** En una única transacción atómica se debita `points_cost` mediante un asiento negativo en `PointTransaction` y se registra la adquisición (`StudentPurchase` / `ClassroomItem`).
- **Descripción:** El sistema debe permitir a los alumnos canjear sus puntos ponderados en la tienda del aula por ítems funcionales del aula (mejoras, minijuegos habilitables), accesorios para su avatar/pupitre o accesorios para la mascota del aula.
- **Criterios de aceptación:**
  1. **Dado** un alumno con saldo mayor o igual al `points_cost` del ítem fijado en el servidor, **cuando** confirma la compra, **entonces** el servidor verifica disponibilidad y saldo bajo bloqueo transaccional, registra el débito en `PointTransaction` y otorga el ítem de forma idempotente (`RN-09`).
  2. **Dado** un alumno con saldo insuficiente o dos peticiones concurrentes que excederían su saldo disponible, **cuando** el servidor las procesa, **entonces** rechaza la compra excedente garantizando que el saldo jamás quede negativo (`RN-09`).

#### RF-GAM-004 · Mascota grupal del aula (`ClassroomPet`) y aportes colaborativos
- **Prioridad:** Should · **Fase:** MVP Extendido (base de entidad en MVP Core) · **Actor:** `Alumno`, `Profesor`
- **Precondiciones:** El aula cuenta con su instancia única `ClassroomPet`.
- **Postcondiciones:** Se actualizan los puntos de contribución grupal (`pet_contribution`) o los accesorios equipados de la mascota del aula tras debitar los puntos del alumno comprador.
- **Descripción:** El sistema debe mantener una única **Mascota del Aula** por cada aula como objetivo motivacional grupal (independiente del Bot IA), permitiendo que los alumnos utilicen sus puntos para desbloquearle accesorios o realizar aportes colaborativos que mejoren su estado visual en el aula.
- **Criterios de aceptación:**
  1. **Dado** un alumno matriculado en el aula, **cuando** realiza un aporte de puntos o compra un accesorio para la `ClassroomPet`, **entonces** el servidor debita el costo de su billetera individual, registra el accesorio o incremento en la mascota del aula y sincroniza el nuevo estado visual para todos los miembros del curso (`RN-09`).
  2. **Dada** la existencia de la mascota del aula y del Bot Guía de Estudio, **entonces** ambos operan como entidades y personajes completamente independientes en datos y funciones (`RN-09`, `RN-12`).

#### RF-GAM-005 · Configuración docente del catálogo de premios y control de minijuegos
- **Prioridad:** Should · **Fase:** MVP Extendido · **Actor:** `Profesor`, `Dueño / Admin de Escuela`
- **Precondiciones:** El actor tiene autoridad de `Profesor` sobre el aula.
- **Postcondiciones:** Se actualiza la disponibilidad/precios futuros del catálogo del aula o el estado persistido `games_disabled` de los minijuegos.
- **Descripción:** El sistema debe permitir al profesor habilitar o ajustar qué premios e ítems están disponibles en la tienda del aula (sin alterar el precio histórico de compras ya asentadas en `PointTransaction`) y habilitar o deshabilitar los minijuegos del aula en cualquier momento.
- **Criterios de aceptación:**
  1. **Dado** un profesor que modifica el costo o disponibilidad de un `ShopItem`, **cuando** guarda el cambio, **entonces** el nuevo valor rige para compras futuras sin alterar los asientos históricos ya registrados en `PointTransaction` (`RN-09`).
  2. **Dado** un profesor que activa la restricción `Deshabilitar minijuegos` (`games_disabled = true`) durante la clase, **cuando** un alumno intenta iniciar una partida o enviar puntaje (incluso tras reconectarse), **entonces** el servidor rechaza la acción y difunde el bloqueo en vivo a toda el aula (`RN-09`, `RN-10`).

---

### 5.6 Módulo `RF-COM` · Comunicación del Aula, Avisos, Chat y Foro de Consultas

#### RF-COM-001 · Tablón de avisos importantes con notificación in-app y por email
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Dueño / Admin de Escuela`, `Alumno`, `Padre / Tutor`
- **Precondiciones:** El autor posee autoridad de `Profesor` sobre el aula.
- **Postcondiciones:** Se persiste el aviso (`Announcement`) en la cartelera del aula y se encolan notificaciones in-app para alumnos y notificaciones in-app + correo electrónico para los padres vinculados.
- **Descripción:** El sistema debe permitir a los profesores publicar, editar y dar de baja avisos importantes en el tablón de anuncios del aula (con soporte para `@menciones`), disparando de forma asíncrona e idempotente avisos in-app y por correo electrónico.
- **Criterios de aceptación:**
  1. **Dado** un profesor en su aula, **cuando** publica un anuncio en la cartelera, **entonces** el servidor lo persiste en PostgreSQL y, tras confirmar la transacción, genera notificaciones in-app para los alumnos del aula y notificaciones in-app y por correo electrónico para los padres vinculados (cuando `adult_mode = false`) (`RN-16`, `RN-20`).
  2. **Dado** un fallo temporal en el proveedor externo de correo electrónico (`Amazon SES`), **entonces** la publicación del anuncio y su notificación in-app no se revierten, y el envío por correo se reintenta de forma asíncrona e idempotente sin duplicar mensajes.

#### RF-COM-002 · Chat del aula en tiempo real con `@menciones` y moderación docente
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Alumno`, `Dueño / Admin de Escuela`
- **Precondiciones:** El usuario es alumno matriculado o personal docente del aula; para que un alumno escriba, el chat no debe estar silenciado (`chat_muted = false`).
- **Postcondiciones:** El mensaje (`ChatMessage` / `Message`) y sus `@menciones` (`Mention`) se validan y persisten en PostgreSQL antes de difundirse en tiempo real por Colyseus.
- **Descripción:** El sistema debe proveer un canal de chat grupal por aula donde alumnos y profesores conversen en tiempo real, resuelvan `@menciones` contra el padrón del aula y donde el profesor pueda ocultar/moderar mensajes o silenciar el chat conservando el historial completo para auditoría docente.
- **Criterios de aceptación:**
  1. **Dado** un alumno o profesor en un aula con `chat_muted = false`, **cuando** envía un mensaje de texto válido con una `@mención` a un miembro del aula, **entonces** el servidor asigna autor y hora oficial, persiste el mensaje y la entidad `Mention`, difunde el mensaje en vivo y notifica al usuario mencionado (`RN-01`).
  2. **Dado** un profesor que modera/oculta un mensaje inapropiado en el chat del aula, **cuando** se ejecuta la acción, **entonces** el servidor registra quién y cuándo lo moderó (`RN-18`): los alumnos dejan de ver el texto original, pero el cuerpo docente conserva el registro completo en el historial.
  3. **Dado** un usuario con rol `Padre / Tutor`, **cuando** intenta leer o enviar mensajes en el canal de chat grupal del aula, **entonces** el servidor rechaza la petición con `403 Forbidden` (`RN-04`, `RN-16`).

#### RF-COM-003 · Foro de consultas por actividad y mensajería Padre ↔ Profesor
- **Prioridad:** Should · **Fase:** MVP Core (foro de dudas) / MVP Extendido (mensajería parental) · **Actor:** `Alumno`, `Profesor`, `Padre / Tutor`
- **Precondiciones:** El usuario tiene acceso al aula de la actividad (para el foro) o posee un `ParentStudentLink` activo en un aula con `adult_mode = false` (para mensajería parental).
- **Postcondiciones:** Se persiste la consulta/respuesta o el mensaje directo en su contexto aislado y se notifica a los destinatarios autorizados.
- **Descripción:** El sistema debe permitir a los alumnos plantear dudas vinculadas a una actividad para que el profesor (o el curso) responda de forma ordenada, y proveer un canal de mensajería privada entre el `Padre / Tutor`, el `Profesor` y el hijo vinculado.
- **Criterios de aceptación:**
  1. **Dado** un alumno con dudas sobre una actividad publicada, **cuando** publica una consulta en el hilo/foro de la actividad y el profesor responde, **entonces** la respuesta queda visible para los miembros autorizados del aula y notifica al autor de la consulta.
  2. **Dado** un padre con un `ParentStudentLink` activo en un aula con `adult_mode = false`, **cuando** envía un mensaje al profesor de su hijo, **entonces** el servidor verifica el vínculo en cada lectura y escritura e impide que otros padres o alumnos ajenos accedan a esa conversación (`RN-16`).

#### RF-COM-004 · Centro de notificaciones in-app y alertas por correo electrónico
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Alumno`, `Padre / Tutor`, `Dueño / Admin`
- **Precondiciones:** Ocurre un evento de negocio confirmado en `NestJS` (nueva actividad, calificación publicada, anuncio, `@mención`, mensaje parental o invitación).
- **Postcondiciones:** Se crea el registro `Notification` con estado de lectura (`is_read`) y estado de entrega por canal, respetando los permisos vigentes del destinatario.
- **Descripción:** El sistema debe ofrecer un centro de notificaciones in-app donde el usuario consulte sus avisos pendientes, los marque como leídos y reciba actualizaciones en vivo, complementado con el envío por correo electrónico para invitaciones y alertas a padres.
- **Criterios de aceptación:**
  1. **Dado** un usuario autenticado, **cuando** abre su centro de notificaciones o marca avisos como leídos, **entonces** el servidor devuelve únicamente las notificaciones correspondientes a aulas o hijos sobre los cuales mantiene acceso vigente (`RN-01`, `RN-04`).
  2. **Dado** un miembro cuya membresía en un aula fue dada de baja, **entonces** deja de inmediato de recibir nuevas notificaciones y de visualizar contenido histórico protegido de esa aula (`RN-18`).

---

### 5.7 Módulo `RF-VIV` · Herramientas de Clase en Vivo

#### RF-VIV-001 · Congelar alumnos en sus pupitres (`Freeze`) y dirigir la atención
- **Prioridad:** Must · **Fase:** MVP Extendido (control base previsto desde el núcleo de Colyseus) · **Actor:** `Profesor`, `Dueño / Admin de Escuela`
- **Precondiciones:** El actor tiene autoridad de `Profesor` en el aula y existe una sesión activa en Colyseus.
- **Postcondiciones:** Todos los avatares de alumnos conectados (y los que se unan o reconecten mientras dure el estado) son ubicados en su pupitre asignado (`Desk`) y su movimiento queda bloqueado en el servidor hasta que el profesor desactive el control.
- **Descripción:** El sistema debe permitir al profesor activar y desactivar el control **Congelar (`Freeze`)**, enviando a cada alumno a su pupitre asignado e impidiendo en el servidor cualquier desplazamiento de avatares de alumnos mientras el profesor conserva libre movimiento.
- **Criterios de aceptación:**
  1. **Dado** un profesor en el aula que activa el control `Congelar`, **cuando** Colyseus valida su rol docente actual, **entonces** asigna y teletransporta a cada alumno a su pupitre, difunde el evento `classroom:frozen` y rechaza en el servidor cualquier input de movimiento enviado por clientes de alumnos (`RN-10`).
  2. **Dado** un alumno que ingresa o se reconecta a un aula mientras se encuentra congelada, **cuando** se une a la `Room`, **entonces** el servidor lo ubica directamente en su pupitre con el bloqueo activo (`RN-10`).
  3. **Dado** un alumno o padre que intenta enviar el comando de congelar o descongelar el aula, **entonces** el servidor ignora/rechaza el mensaje sin efectos secundarios y registra el intento en auditoría (`RN-04`, `RN-10`).

#### RF-VIV-002 · Silenciar micrófonos de toda la sala y silenciar el chat del aula (`Mute`)
- **Prioridad:** Should · **Fase:** MVP Extendido (silenciado de chat en MVP Core; silenciado de voz/video en MVP Extendido) · **Actor:** `Profesor`, `Dueño / Admin de Escuela`
- **Precondiciones:** El actor tiene autoridad de `Profesor` sobre el aula.
- **Postcondiciones:** Se persiste el bloqueo de chat (`chat_muted`) en PostgreSQL y/o se revocan los permisos de publicación de audio de los alumnos en el servicio de medios WebRTC, difundiendo el cambio en vivo.
- **Descripción:** El sistema debe permitir al profesor silenciar y reactivar de forma idempotente tanto el canal de chat del aula como los micrófonos de todos los alumnos en una llamada en vivo, haciendo cumplir la restricción en el servidor y en el servicio de medios.
- **Criterios de aceptación:**
  1. **Dado** un profesor que activa `Silenciar chat` (`chat_muted = true`), **cuando** un alumno intenta enviar un mensaje por REST o WebSocket (incluso tras recargar la página), **entonces** el servidor rechaza el envío mientras que el profesor puede seguir escribiendo (`RN-10`).
  2. **Dado** un profesor que activa `Silenciar a todos` durante una clase en vivo, **cuando** se ejecuta la orden, **entonces** el servidor revoca o retiene el permiso de publicación de audio de los alumnos en el servicio de medios e impide que un alumno se reactive el micrófono por su cuenta mientras dure el bloqueo (`RN-10`).

#### RF-VIV-003 · Llamadas de audio/video y presentaciones en vivo (WebRTC)
- **Prioridad:** Should · **Fase:** MVP Extendido · **Actor:** `Profesor`, `Alumno`, `Dueño / Admin de Escuela`
- **Precondiciones:** El usuario posee membresía activa en el aula; la sesión de clase o presentación es iniciada por personal con autoridad de `Profesor`.
- **Postcondiciones:** `NestJS` emite credenciales efímeras de corta duración con los permisos exactos del rol para conectarse a la sesión WebRTC del aula.
- **Descripción:** El sistema debe permitir al profesor iniciar videollamadas, llamadas de voz y presentaciones en vivo dentro del aula, emitiendo desde el backend tokens de acceso de corta duración hacia el servicio de medios WebRTC y desconectando de inmediato a quien pierda acceso o cierre sesión.
- **Criterios de aceptación:**
  1. **Dado** un miembro autorizado del aula que se une a una llamada o presentación en vivo, **cuando** solicita acceso a `NestJS`, **entonces** el servidor verifica su membresía actual, resuelve internamente la sala de medios del aula (sin confiar en nombres de sala enviados por el cliente) y emite una credencial efímera acorde a su rol y al estado de `mute` (`RN-04`, `RN-10`).
  2. **Dado** que el servicio externo de medios no se encuentre disponible temporalmente, **entonces** el aula 3D, el Modo 2D Clásico, el chat y las actividades continúan operando con normalidad y el cliente muestra un aviso comprensible sin errores técnicos internos.

#### RF-VIV-004 · Pizarrón interactivo colaborativo con gráficos matemáticos y fórmulas LaTeX
- **Prioridad:** Should · **Fase:** MVP Extendido · **Actor:** `Profesor`, `Alumno`, `Dueño / Admin de Escuela`
- **Precondiciones:** El usuario se encuentra en el aula; si es alumno, la edición requiere que el bloqueo de colaboración esté desactivado (`collaboration_locked = false`).
- **Postcondiciones:** Se sincronizan en tiempo real los trazos del pizarrón, las funciones en el graficador matemático y las expresiones **LaTeX**, con opción de bloquear la edición estudiantil desde el control docente.
- **Descripción:** El sistema debe proveer en la pizarra del aula un espacio colaborativo en tiempo real que soporte trazos/anotaciones, representación de gráficos de funciones matemáticas y edición de fórmulas **LaTeX** (renderizadas de forma segura como datos), incluyendo un interruptor docente de **Bloquear colaboración (`collaboration_locked`)**.
- **Criterios de aceptación:**
  1. **Dado** un profesor explicando un tema en la pizarra del aula con `collaboration_locked = false`, **cuando** él o los alumnos trazan en el pizarrón, ingresan una función matemática para graficar o escriben una expresión LaTeX válida, **entonces** el estado se sincroniza en vivo para los integrantes del aula y se renderiza sin ejecutar HTML ni scripts (`RN-11`).
  2. **Dado** un profesor que activa `Bloquear colaboración` (`collaboration_locked = true`), **cuando** un alumno intenta enviar cualquier edición al pizarrón, al graficador o al editor LaTeX (incluso en una sesión ya abierta o tras reconectarse), **entonces** el servidor rechaza la edición en cada mensaje mientras el profesor conserva la edición habilitada (`RN-10`, `RN-11`).

---

### 5.8 Módulo `RF-BOT` · Bot Guía de Estudio (RAG) y Repaso Diario

#### RF-BOT-001 · Ingesta y habilitación docente de bibliografía para el Bot (`StudyMaterial` / `AllowedMaterial`)
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Profesor`, `Dueño / Admin de Escuela`
- **Precondiciones:** El profesor subió material de estudio validado a su aula.
- **Postcondiciones:** Se indexa el documento particionado por aula y se actualiza la configuración `BotConfig` / `AllowedMaterial` (`is_bot_enabled`), entrando en vigor en la siguiente consulta al Bot.
- **Descripción:** El sistema debe permitir al profesor seleccionar qué archivos del material de estudio de su aula están habilitados para ser utilizados como base de conocimiento (RAG) por el **Bot Guía de Estudio**, excluyendo de inmediato del índice cualquier documento deshabilitado o dado de baja.
- **Criterios de aceptación:**
  1. **Dado** un profesor en su aula, **cuando** marca un archivo de `StudyMaterial` como habilitado para el Bot (`is_bot_enabled = true`), **entonces** el backend indexa el contenido asociado exclusivamente al identificador de esa aula (`RN-12`).
  2. **Dado** un material que el profesor deshabilita o elimina lógicamente, **cuando** un alumno realiza una consulta posterior al Bot, **entonces** el servidor ya no recupera ni reutiliza fragmentos de ese documento (`RN-12`).
  3. **Dado** un fallo en el proceso de indexación RAG de un archivo recién subido, **entonces** el archivo sigue estando disponible para descarga normal de los alumnos y el sistema informa el estado de indexación al profesor (`RN-12`).

#### RF-BOT-002 · Consulta al Bot Guía de Estudio con RAG, citas al material, regla anticopia y bloqueo en exámenes
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Alumno`, `Profesor`
- **Precondiciones:** El usuario tiene acceso al aula y, si es `Alumno`, no tiene ningún examen en curso en ese momento según el reloj del servidor.
- **Postcondiciones:** `NestJS` recupera fragmentos únicamente del material aprobado del aula, invoca a `Amazon Bedrock` con guardarraíles pedagógicos, registra el log de auditoría y devuelve una orientación de estudio citando la fuente.
- **Descripción:** El sistema debe permitir a los alumnos (tanto desde el personaje del tutor en el Aula 3D como desde el Modo 2D Clásico) realizar consultas de estudio al Bot IA, el cual responde únicamente sobre el material habilitado por el docente, cita los documentos utilizados, orienta sin resolver tareas ni entregar respuestas de actividades y se bloquea automáticamente mientras haya un examen en curso.
- **Criterios de aceptación:**
  1. **Dado** un alumno sin examen en curso que realiza una pregunta conceptual, **cuando** el servidor procesa la consulta, **entonces** filtra la búsqueda RAG estrictamente por los documentos habilitados de su aula, invoca a Amazon Bedrock desde `NestJS` y devuelve una explicación orientadora citando el `StudyMaterial` de origen (`RN-12`).
  2. **Dado** un alumno que pide al Bot que le resuelva un Trabajo Práctico, que elija la opción correcta de un cuestionario o que responda sobre un tema ausente en la bibliografía aprobada, **cuando** el Bot genera la respuesta, **entonces** se niega a entregar la solución resuelta (ofreciendo en su lugar pistas o preguntas guía) o informa que el tema no figura en el material habilitado por el profesor, sin que las claves de respuestas de las actividades entren jamás al contexto del modelo (`RN-12`, `RN-13`).
  3. **Dado** un alumno cuya aula tiene un `Examen` en curso según la hora oficial del servidor, **cuando** intenta abrir o enviar una consulta al Bot (o cuando una respuesta iniciada antes termina después del comienzo del examen), **entonces** el servidor bloquea la entrega y devuelve un aviso claro indicando que el tutor IA no está disponible durante exámenes (`RN-13`).
  4. **Dado** un usuario con rol `Padre / Tutor` o un alumno que solicita al Bot modificar una nota, entrega o tarea, **entonces** el servidor rechaza el uso del Bot para padres (`403`) y declina cualquier modificación de datos (`RN-14`, `RN-16`).

#### RF-BOT-003 · Repaso Diario en la primera conexión y pregunta diaria de estudio para sumar racha
- **Prioridad:** Must · **Fase:** MVP Core · **Actor:** `Alumno`, `Profesor`, `Dueño / Admin`, `Sistema`
- **Precondiciones:** Primera conexión autenticada del usuario en la fecha calendario actual bajo la zona horaria `America/Argentina/Buenos_Aires`, rol distinto de `Padre / Tutor` y sin examen en curso.
- **Postcondiciones:** Se inserta de forma atómica el registro `DailyReviewDelivery (user_id, local_date)`, se presenta el resumen diario (con fallback estructurado si falla la IA) y, cuando el alumno responde correctamente la pregunta diaria de repaso sobre el material del aula, se acredita su hito diario de racha (`RN-08`, `RN-15`).
- **Descripción:** El sistema debe presentar proactivamente una sola vez por día (en hora de Argentina) un **Repaso Diario** personalizado con actividades próximas a vencer, calificaciones y avisos recientes, e incluir para el alumno una pregunta breve de repaso sobre el material habilitado cuya resolución válida contabiliza para su **Racha Diaria**.
- **Criterios de aceptación:**
  1. **Dado** un alumno o profesor en su primera conexión autenticada del día según `America/Argentina/Buenos_Aires`, **cuando** ingresa a la aplicación (incluso si abre múltiples pestañas concurrentes), **entonces** el servidor registra de manera atómica `DailyReviewDelivery` y muestra el Repaso Diario exactamente una vez en ese día calendario (`RN-15`).
  2. **Dado** un alumno que responde correctamente la pregunta diaria de repaso propuesta sobre el material aprobado del aula, **cuando** el servidor valida la respuesta, **entonces** registra la actividad académica del día e incrementa su `Streak` si aún no había sumado su hito diario (`RN-08`, `RN-15`).
  3. **Dado** que Amazon Bedrock no esté disponible o exceda el tiempo de espera durante la primera conexión del día, **entonces** el servidor entrega un resumen estructurado construido directamente desde los datos persistidos en PostgreSQL sin bloquear el ingreso del usuario (`RN-15`).

#### RF-BOT-004 · Auditoría y métricas docentes de consultas frecuentes al Bot (`BotConversationLog`)
- **Prioridad:** Should · **Fase:** MVP Extendido · **Actor:** `Profesor`, `Dueño / Admin de Escuela`
- **Precondiciones:** El actor tiene autoridad de `Profesor` sobre el aula.
- **Postcondiciones:** El docente visualiza un resumen de uso, temas consultados y trazabilidad pedagógica del Bot en su aula.
- **Descripción:** El sistema debe registrar metadatos y registros auditables de las interacciones con el Bot por aula (`BotConversationLog` / `BotConversation`) para que el profesor pueda identificar qué materiales o temas generan mayor cantidad de dudas entre sus alumnos y ajustar su enseñanza.
- **Criterios de aceptación:**
  1. **Dado** un profesor en el panel de su aula, **cuando** consulta la sección de auditoría del Bot Guía de Estudio, **entonces** visualiza las métricas de uso y los temas/materiales más consultados dentro de su aula, sin poder acceder a registros de aulas ajenas (`RN-01`, `RN-14`).

---

## 6. Requerimientos No Funcionales (`RNF-001` a `RNF-010`)

| ID | Categoría | Especificación y criterio de verificación |
| --- | --- | --- |
| **RNF-001** | **Rendimiento 3D y alternativa 2D** | La escena del Aula 3D en Three.js + React Three Fiber debe mantener una navegación fluida en equipos de escritorio estándar y ofrecer en todo momento la conmutación inmediata al **Modo 2D Clásico** para dispositivos móviles, redes limitadas o equipos sin aceleración WebGL óptima. |
| **RNF-002** | **Seguridad de credenciales y sesiones** | Las contraseñas se almacenan exclusivamente mediante hash seguro con sal por contraseña (`Argon2` o `bcrypt`). Los secretos de invitaciones y tokens de sesión persistidos en servidor se guardan hasheados. El cierre de sesión o restablecimiento de contraseña invalida las sesiones activas en el servidor. |
| **RNF-003** | **Control de acceso basado en roles y contexto (RBAC)** | Todo endpoint HTTP en `NestJS` y todo evento o ingreso a sala en `Colyseus` verifica autenticación, membresía escolar/de aula o vínculo parental y rol en servidor, devolviendo `401`, `403` o `404` según `RN-04`. Ninguna respuesta pública expone hashes, trazas internas ni consultas SQL. |
| **RNF-004** | **Privacidad y protección de datos de menores** | Se recolecta únicamente la información mínima necesaria para la actividad escolar. Los datos de alumnos nunca se cruzan entre aulas o escuelas; los padres solo acceden a sus hijos vinculados; los archivos adjuntos residen en S3 privado con URLs firmadas temporales; y los logs de servidor y de IA redactan/omiten cuerpos de mensajes, correos y prompts con información personal. |
| **RNF-005** | **Accesibilidad e inclusión** | Todas las funciones esenciales del producto (actividades, entregas, calificaciones, material, avisos, chat, tienda y Bot IA) son operables sin depender de precisión con el mouse sobre el lienzo 3D gracias al **Modo 2D Clásico**, con soporte de teclado, foco visible y equivalentes táctiles. |
| **RNF-006** | **Integridad transaccional e idempotencia** | Operaciones compuestas (registro con creación de escuela/aula, aceptación de invitación, calificación con acreditación de puntos ponderados, compras en tienda y entrega única del Repaso Diario) se ejecutan dentro de transacciones ACID en PostgreSQL mediante Prisma ORM y cuentan con llaves de unicidad/idempotencia ante peticiones concurrentes. |
| **RNF-007** | **Aislamiento de IA y límites de consumo** | Toda invocación a **Amazon Bedrock** se realiza desde `NestJS` mediante roles IAM de mínimo privilegio (nunca desde el navegador ni desde Colyseus), con límites de tasa (*rate limiting*) por usuario y aula, tiempos de espera acotados y degradación elegante (*fallback*) cuando el servicio externo falle. |
| **RNF-008** | **Separación arquitectónica y escalabilidad** | `NestJS` (API REST, reglas de negocio y persistencia en RDS PostgreSQL) y `Colyseus` (estado efímero de salas en vivo, avatares y controles sincrónicos) operan como servicios lógicamente desacoplados sobre contenedores en `AWS ECS / Fargate` detrás de un `Application Load Balancer` con TLS (`HTTPS`/`WSS`). |
| **RNF-009** | **Mantenibilidad e infraestructura como código** | El esquema relacional se gestiona exclusivamente mediante migraciones versionadas de **Prisma** y la infraestructura en AWS mediante **Terraform** en el repositorio backend, verificados por pipelines de integración continua (`GitHub Actions`). |
| **RNF-010** | **Manejo de zonas horarias y tiempo** | Los instantes se almacenan sin ambigüedad horaria; las reglas de corte diario (Repaso Diario y Racha) se calculan exclusivamente con el reloj del servidor en la zona horaria `America/Argentina/Buenos_Aires` ([`rules/data-and-time.md`](../rules/data-and-time.md)). |

---

## 7. Entidades Conceptuales

Esta sección describe el modelo conceptual de entidades del dominio escolar derivado de los requerimientos funcionales y alineado con el contrato relacional de [`rules/data.md`](../rules/data.md) y la sección 6.4 del [`master-document.md`](../master-document.md#64-modelo-de-información-general):

| Entidad conceptual (`docs` / `rules/data.md`) | Propósito en el dominio escolar | Atributos y relaciones principales |
| --- | --- | --- |
| **`School`** | Unidad institucional de aislamiento en el camino Escuela. | Posee un único `Owner`, múltiples membresías institucionales (`SchoolMember`) y múltiples aulas (`Classroom`). Soporta baja lógica (`deleted_at`). |
| **`User` / `Session` / `AvatarConfiguration`** | Cuenta de usuario, sesión autenticada y apariencia persistente del avatar 3D. | Email único normalizado, `display_name`, hash de contraseña, configuración visual 1:1 (`AvatarConfiguration`) y sesiones revocables (`Session`). |
| **`SchoolMember`** | Membresía de un usuario dentro de una `School`. | Une `User` y `School` con rol institucional (`Owner`, `Admin`, `Teacher`) y estado activo/inactivo. Otorga a `Owner`/`Admin` autoridad docente sobre todas las aulas de la escuela. |
| **`Classroom`** | Aula virtual persistente (núcleo del producto). | Pertenece exactamente a una `School` o a un `Profesor independiente`. Conserva banderas de estado (`adult_mode`, `chat_muted`, `collaboration_locked`, `games_disabled`, `deleted_at`) y agrupa miembros, pupitres, actividades, material, chat, avisos, tienda y una mascota. |
| **`ClassroomMembership` (`Enrollment`)** | Membresía de un usuario dentro de un aula (`Profesor` titular o `Alumno` matriculado). | Une `User` y `Classroom` con unicidad por `(classroom_id, user_id)` y soporte de baja lógica (`deleted_at`). |
| **`ParentStudentLink` (`ParentLink`)** | Vínculo familiar explícito entre un `Padre / Tutor` y un `Alumno` en el contexto escolar. | Une al usuario padre con el usuario hijo (máximo **2** tutores activos por alumno). Es la única fuente de autorización para la vista de padres y se rechaza si `adult_mode = true`. |
| **`Invitation`** | Invitación por email o código/enlace de incorporación a una escuela o aula. | Almacena únicamente el hash del secreto, email o alcance destino, rol asignado, fecha de expiración (`expires_at`), creador y estado (vigente, usada, revocada). |
| **`Desk`** | Pupitre / asiento asignable dentro del aula virtual. | Pertenece a un `Classroom` y puede asociarse a un alumno matriculado para interacciones de pupitre, personalización visual y bloqueo de posición durante `Freeze`. |
| **`StudyMaterial` (`Material` / `BotConfig` / `AllowedMaterial`)** | Bibliografía y archivos docentes subidos al aula y configuración de uso por el Bot IA. | Pertenece a un `Classroom` y a su autor docente; referencia el objeto privado en `Amazon S3` e indica si está habilitado e indexado para consultas RAG del Bot (`is_bot_enabled`). |
| **`Activity` (`Question` / `Option`)** | Actividad académica publicada por el profesor (`TP` o `Examen`). | Pertenece a un `Classroom`; define formato (`Archivo` u `Opción Múltiple`), consigna, `due_date`/ventana de examen, `max_score` (`0–100`), `allow_late`, `weight_multiplier` y preguntas/opciones con respuesta correcta protegida en servidor. |
| **`Submission` y `Grade`** | Entrega realizada por un alumno para una actividad y su calificación docente o automática. | `Submission` une `Activity` y `Alumno` (referenciando archivos en S3 o respuestas elegidas, timestamp del servidor e indicador `is_late`). `Grade` registra nota `0–100`, `feedback`, docente evaluador y referencia al asiento de puntos generado. |
| **`PointTransaction` (`PointsTransaction`)** | Asiento inmutable en el libro mayor de puntos del alumno. | Pertenece al `Alumno`; registra monto positivo (nota ponderada) o negativo (compra en tienda / aporte a mascota) o ajuste compensatorio, con restricción única `(source_type, source_id)` para evitar duplicados. |
| **`Streak`** | Estado de racha de estudio del alumno. | Uno por alumno; almacena racha actual, mejor racha histórica y la última fecha local (`America/Argentina/Buenos_Aires`) en que completó un hito académico válido (máximo 1 por día). |
| **`Badge` (`Medal`) y `StudentBadge`** | Catálogo de medallas/logros y adjudicaciones por alumno. | `StudentBadge` une de forma única `(student_id, badge_id)` con la fecha de obtención del logro. |
| **`ShopItem` y `StudentPurchase` (`ClassroomItem`)** | Catálogo de ítems de la tienda y compras/inventario del alumno o del aula. | `ShopItem` define tipo (ítem de aula, accesorio de avatar/pupitre o accesorio de mascota) y `points_cost`. `StudentPurchase` / `ClassroomItem` registra la adquisición atómica e idempotente. |
| **`ClassroomPet` (`Pet` / `PetAccessory`)** | Mascota motivacional única del aula y sus accesorios/aportes grupales. | Relación 1:1 con `Classroom` (independiente del Bot IA); registra nivel/contribución acumulada (`pet_contribution`) y accesorios desbloqueados y equipados. |
| **`Announcement`, `ChatMessage` (`Message`) y `Mention`** | Comunicaciones persistentes del aula y conversaciones Padre ↔ Profesor. | `Announcement` pertenece al tablón del aula; `ChatMessage` pertenece al canal del aula o a una conversación `ParentStudentLink`, incluye estado de moderación docente y referencias `@` resueltas en `Mention`. |
| **`BotConversationLog` (`BotConversation` / `DailyReviewDelivery`)** | Registro de consultas al Bot Guía de Estudio y control de entrega única del Repaso Diario. | `BotConversationLog` vincula usuario, aula y material citado para auditoría pedagógica docente. `DailyReviewDelivery` garantiza unicidad por `(user_id, local_date)` en hora de Argentina. |
| **`Notification` y `ActivityMetric`** | Notificaciones al usuario y métricas agregadas de participación escolar. | `Notification` registra estado de lectura in-app y envío idempotente por email `(notification_id, channel)`. `ActivityMetric` consolida tiempo conectado por intervalo, entregas y participación por alumno y aula. |

---

## 8. Matriz de Trazabilidad

### 8.1 Trazabilidad entre Requerimientos Funcionales (`RF`), Reglas de Negocio (`RN`) e Historias de Usuario (`HU`)

| ID Requerimiento | Nombre del Requerimiento Funcional | Prioridad | Fase | Reglas de Negocio (`RN`) | Historias de Usuario (`HU`) |
| --- | --- | --- | --- | --- | --- |
| **RF-AUT-001** | Registro de cuenta y elección de camino organizacional | Must | MVP Core | RN-01, RN-02, RN-20 | HU-AUT-001 |
| **RF-AUT-002** | Inicio de sesión, renovación y cierre de sesión | Must | MVP Core | RN-04, RN-20 | HU-AUT-002 |
| **RF-AUT-003** | Gestión de perfil y configuración de avatar base | Must | MVP Core | RN-04, RN-09 | HU-AUT-003 |
| **RF-AUT-004** | Vinculación Padre-Alumno (`ParentStudentLink`) | Should | MVP Extendido | RN-02, RN-04, RN-16 | HU-AUT-004 |
| **RF-AUL-001** | Creación y configuración de aula | Must | MVP Core | RN-01, RN-03, RN-09 | HU-AUL-001 |
| **RF-AUL-002** | Incorporación al aula por invitación o código/enlace de acceso | Must | MVP Core | RN-01, RN-02, RN-04 | HU-AUL-002 |
| **RF-AUL-003** | Gestión de miembros, roles y bajas lógicas en el aula | Must | MVP Core | RN-01, RN-03, RN-04, RN-18 | HU-AUL-003 |
| **RF-AUL-004** | Gestión institucional multi-aula para Dueño / Admin de Escuela | Should | MVP Extendido | RN-01, RN-02, RN-03, RN-04 | HU-AUL-004 |
| **RF-AUL-005** | Aislamiento de recursos y verificación de acceso en servidor | Must | MVP Core | RN-01, RN-03, RN-04 | HU-AUL-005 |
| **RF-ESP-001** | Navegación en Aula 3D isométrica y sincronización de presencia | Must | MVP Core | RN-01, RN-04, RN-19 | HU-ESP-001 |
| **RF-ESP-002** | Interacción con pupitres (`Desk`) y objetos educativos del aula | Must | MVP Core | RN-04, RN-10, RN-17 | HU-ESP-002 |
| **RF-ESP-003** | Conmutación en un clic al Modo 2D Clásico accesible | Must | MVP Core | RN-04, RN-17 | HU-ESP-003 |
| **RF-ESP-004** | Personalización visual de avatar y pupitre con ítems del aula | Should | MVP Core | RN-09, RN-17 | HU-ESP-004 |
| **RF-ACT-001** | Publicación y gestión de Actividades (TPs, Exámenes y Material) | Must | MVP Core | RN-01, RN-05, RN-06, RN-18, RN-20 | HU-ACT-001 |
| **RF-ACT-002** | Bandeja de actividades del alumno y estados del ciclo de vida | Must | MVP Core | RN-01, RN-05, RN-17 | HU-ACT-002 |
| **RF-ACT-003** | Realización de entregas con archivos adjuntos o respuestas de opción múltiple | Must | MVP Core | RN-04, RN-05, RN-06, RN-20 | HU-ACT-003 |
| **RF-ACT-004** | Corrección docente, devolución (`feedback`) y acreditación automática de puntos | Must | MVP Core | RN-06, RN-07, RN-16, RN-18 | HU-ACT-004 |
| **RF-ACT-005** | Historial académico y métricas de actividad del alumno (`ActivityMetric`) | Should | MVP Core | RN-01, RN-04, RN-19 | HU-ACT-005 |
| **RF-ACT-006** | Vista de seguimiento académico para Padre / Tutor | Should | MVP Extendido | RN-01, RN-04, RN-16 | HU-ACT-006 |
| **RF-GAM-001** | Billetera de puntos ponderados e historial de movimientos (`PointTransaction`) | Must | MVP Core | RN-04, RN-07, RN-18 | HU-GAM-001 |
| **RF-GAM-002** | Racha diaria de estudio (`Streak`) y otorgamiento de Medallas (`Badge`) | Must | MVP Core | RN-08, RN-15 | HU-GAM-002 |
| **RF-GAM-003** | Compra de ítems en la Tienda del Aula (`ShopItem` / `StudentPurchase`) | Must | MVP Core | RN-07, RN-09, RN-17 | HU-GAM-003 |
| **RF-GAM-004** | Mascota grupal del aula (`ClassroomPet`) y aportes colaborativos | Should | MVP Extendido | RN-07, RN-09, RN-12 | HU-GAM-004 |
| **RF-GAM-005** | Configuración docente del catálogo de premios y control de minijuegos | Should | MVP Extendido | RN-09, RN-10 | HU-GAM-005 |
| **RF-COM-001** | Tablón de avisos importantes con notificación in-app y por email | Must | MVP Core | RN-01, RN-16, RN-18, RN-20 | HU-COM-001 |
| **RF-COM-002** | Chat del aula en tiempo real con `@menciones` y moderación docente | Must | MVP Core | RN-01, RN-04, RN-10, RN-16, RN-18 | HU-COM-002 |
| **RF-COM-003** | Foro de consultas por actividad y mensajería Padre ↔ Profesor | Should | MVP Core / Extendido | RN-01, RN-04, RN-16 | HU-COM-003 |
| **RF-COM-004** | Centro de notificaciones in-app y alertas por correo electrónico | Must | MVP Core | RN-01, RN-04, RN-16, RN-18, RN-20 | HU-COM-004 |
| **RF-VIV-001** | Congelar alumnos en sus pupitres (`Freeze`) y dirigir la atención | Must | MVP Extendido | RN-04, RN-10, RN-19 | HU-VIV-001 |
| **RF-VIV-002** | Silenciar micrófonos de toda la sala y silenciar el chat del aula (`Mute`) | Should | MVP Extendido | RN-04, RN-10 | HU-VIV-002 |
| **RF-VIV-003** | Llamadas de audio/video y presentaciones en vivo (WebRTC) | Should | MVP Extendido | RN-04, RN-10, RN-20 | HU-VIV-003 |
| **RF-VIV-004** | Pizarrón interactivo colaborativo con gráficos matemáticos y fórmulas LaTeX | Should | MVP Extendido | RN-04, RN-10, RN-11, RN-19 | HU-VIV-004 |
| **RF-BOT-001** | Ingesta y habilitación docente de bibliografía para el Bot (`StudyMaterial`) | Must | MVP Core | RN-01, RN-12, RN-20 | HU-BOT-001 |
| **RF-BOT-002** | Consulta al Bot Guía de Estudio con RAG, citas, regla anticopia y bloqueo en exámenes | Must | MVP Core | RN-04, RN-12, RN-13, RN-14, RN-16 | HU-BOT-002 |
| **RF-BOT-003** | Repaso Diario en la primera conexión y pregunta diaria para sumar racha | Must | MVP Core | RN-08, RN-13, RN-14, RN-15, RN-16 | HU-BOT-003 |
| **RF-BOT-004** | Auditoría y métricas docentes de consultas frecuentes al Bot (`BotConversationLog`) | Should | MVP Extendido | RN-01, RN-04, RN-14 | HU-BOT-004 |

### 8.2 Cobertura de los Requisitos Obligatorios del Curso (`R1`–`R8`)

| Código | Requisito obligatorio IntegrarTEC 2026 | Cobertura en esta ERS |
| --- | --- | --- |
| **R1** | Frontend, backend y base de datos relacional con al menos 3 entidades relacionadas (una `User`). | Sección 7: `User`, `School`, `Classroom`, `ClassroomMembership`, `Activity`, `Submission`, `Grade`, `PointTransaction`, entre otras. |
| **R2** | Registro, login, logout, hash de contraseña, sesión expirable, rutas protegidas, al menos 2 roles, respuestas `401`/`403` y aislamiento entre usuarios. | `RF-AUT-001` a `RF-AUT-004`, `RF-AUL-001` a `RF-AUL-005`, `RNF-002`, `RNF-003`, `RN-01` a `RN-04`, `RN-16`. |
| **R5** | Flujo principal funcional en producción y CRUD completo de entidad de negocio con doble validación y estados de interfaz. | `RF-ACT-001` a `RF-ACT-005` (ciclo completo de Actividades, Entregas, Calificaciones y acreditación de Puntos Ponderados), `RNF-006`. |
| **IA recomendada** | Integración real de modelo de IA consumido desde el backend con claves protegidas, límites y manejo de errores. | `RF-BOT-001` a `RF-BOT-004` (Bot Guía de Estudio con RAG sobre Amazon Bedrock y Repaso Diario), `RNF-007`, `RN-12` a `RN-15`. |
