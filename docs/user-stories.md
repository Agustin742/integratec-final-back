# Catálogo de Historias de Usuario (v0.2 · Aula Virtual 3D para Escuelas)

Derivadas de la [Especificación de Requerimientos Funcionales (ERS v0.2)](./functional-requirements.md) y alineadas con el [documento maestro v0.3](../master-document.md) y las reglas de dominio en [`rules/`](../rules/README.md). Cada historia mantiene trazabilidad directa hacia el requerimiento funcional (`RF-XXX-NNN`) y las reglas de negocio (`RN-NN`) que implementa.

## Estructura de cada Historia de Usuario

| Campo | Descripción |
| --- | --- |
| **ID** | Identificador único con formato `HU-MÓDULO-NNN`. |
| **Trazabilidad** | Requerimiento funcional de origen (`RF-MÓDULO-NNN`) y reglas de negocio asociadas (`RN-NN`). |
| **Módulo / Prioridad / Fase** | Módulo funcional, prioridad en escala MoSCoW (`Must`, `Should`, `Could`) y fase de entrega (`MVP Core` o `MVP Extendido`). |
| **Repos** | `ambos`, `back` o `front` para la apertura de issues y sub-issues en GitHub Projects ([`rules/github-projects.md`](../rules/github-projects.md)). |
| **Historia (Rol)** | Narrativa en formato *Como [actor], quiero [acción], para [beneficio pedagógico o funcional]*. |
| **Criterios de aceptación** | Escenarios verificables en formato *Dado / Cuando / Entonces*. |
| **Tareas técnicas** | Desglose orientativo para los repositorios `[back]` (`NestJS`, `Colyseus`, `Prisma/PostgreSQL`, `AWS`) y `[front]` (`React`, `Three.js + R3F`, `Modo 2D Clásico`). |

---

## 1. Módulo `AUT` · Autenticación, Perfiles y Cuentas

### HU-AUT-001 · Registro de cuenta y elección de camino organizacional
- **Trazabilidad:** `RF-AUT-001` · `RN-01`, `RN-02`, `RN-20`
- **Módulo:** `AUT` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **visitante**, quiero **registrarme con mi correo electrónico, nombre visible y contraseña eligiendo mi camino organizacional (Profesor independiente o Escuela, o aceptando una invitación)**, para **obtener mi cuenta y comenzar a enseñar o participar en un aula virtual**.
- **Criterios de aceptación:**
  1. **Dado** un visitante con datos válidos que elige el camino de Profesor independiente o de Escuela, **cuando** envía el formulario de registro, **entonces** el sistema crea de forma atómica su cuenta (`User`), su configuración base de avatar (`AvatarConfiguration`) y su estructura organizacional inicial, almacenando la contraseña mediante hash seguro (`Argon2` o `bcrypt`).
  2. **Dado** un correo electrónico que ya existe en el sistema (tras normalización), **cuando** un visitante intenta registrarse con él, **entonces** recibe un mensaje claro de error y no se duplica la cuenta.
  3. **Dados** datos inválidos (correo mal formado, contraseña menor a 8 caracteres o campos vacíos), **cuando** el visitante intenta registrarse, **entonces** el formulario señala los errores por campo y el backend rechaza la solicitud con `400 Bad Request`.
- **Tareas técnicas:**
  - `[back]` Endpoint `POST /auth/register` en NestJS con validación DTO/Zod, hash de contraseña (`Argon2`/`bcrypt`) y transacción Prisma que crea `User`, `AvatarConfiguration` y la estructura inicial según el camino elegido.
  - `[front]` Pantalla de registro con selección de camino (`Profesor independiente` / `Escuela` / `Invitación`), validación con React Hook Form + Zod y manejo de estados de carga y error.

### HU-AUT-002 · Inicio de sesión, renovación y cierre de sesión
- **Trazabilidad:** `RF-AUT-002` · `RN-04`, `RN-20`
- **Módulo:** `AUT` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **usuario registrado (`Profesor`, `Alumno`, `Padre / Tutor` o `Dueño / Admin`)**, quiero **iniciar sesión, mantener mi sesión renovada mientras trabajo, recuperar mi contraseña si la olvido y cerrar sesión de forma segura**, para **acceder a mis aulas protegiendo mi identidad**.
- **Criterios de aceptación:**
  1. **Dadas** credenciales válidas, **cuando** el usuario inicia sesión, **entonces** el servidor emite una sesión con expiración y redirige al usuario a sus aulas o panel según su rol.
  2. **Dadas** credenciales incorrectas, **cuando** intenta iniciar sesión, **entonces** el servidor devuelve `401 Unauthorized` con un mensaje genérico que no revela si falló el correo o la contraseña.
  3. **Dado** un usuario autenticado que cierra sesión (`logout`), **cuando** se procesa la solicitud, **entonces** el servidor invalida la sesión, desconecta a su avatar de cualquier `Room` activa en Colyseus y responde `401` ante usos posteriores de la credencial anterior.
  4. **Dado** un usuario que solicita restablecer su contraseña por correo electrónico, **cuando** envía la solicitud con cualquier email, **entonces** ve el mismo mensaje de confirmación y, si la cuenta existe, recibe un enlace de un solo uso con expiración que al aplicarse invalida todas sus sesiones previas.
- **Tareas técnicas:**
  - `[back]` Endpoints de login, refresh/renovación, logout e inicio/confirmación de restablecimiento de contraseña; invalidación de sesión en servidor y notificación a Colyseus para desconectar sesiones activas.
  - `[front]` Formularios de login y recuperación de contraseña, manejo de expiración/renovación de sesión y botón de cierre de sesión con limpieza de estado en Zustand y TanStack Query.

### HU-AUT-003 · Gestión de perfil y configuración de avatar base
- **Trazabilidad:** `RF-AUT-003` · `RN-04`, `RN-09`
- **Módulo:** `AUT` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Profesor` o `Alumno`**, quiero **editar mi nombre visible y configurar el aspecto base de mi avatar 3D**, para **identificarme frente a mi curso y conservar mi apariencia entre sesiones**.
- **Criterios de aceptación:**
  1. **Dado** un usuario con sesión activa, **cuando** actualiza su nombre visible y las opciones base de su avatar y guarda los cambios, **entonces** los datos se persisten en `User` y `AvatarConfiguration` y se mantienen al recargar o iniciar sesión desde otro dispositivo.
  2. **Dado** un usuario conectado a un aula, **cuando** guarda cambios válidos en su avatar, **entonces** los demás miembros presentes ven reflejada su nueva apariencia.
  3. **Dado** un usuario que intenta equipar en su perfil un ítem de tienda que no ha adquirido, **entonces** el servidor rechaza la petición con `403 Forbidden`.
- **Tareas técnicas:**
  - `[back]` Endpoints `GET /users/me` y `PATCH /users/me/profile` + `PATCH /users/me/avatar` con validación de propiedad de ítems desbloqueados.
  - `[front]` Panel de edición de perfil y selector interactivo de avatar base con previsualización y guardado persistente.

### HU-AUT-004 · Vinculación Padre-Alumno (`ParentStudentLink`)
- **Trazabilidad:** `RF-AUT-004` · `RN-02`, `RN-04`, `RN-16`
- **Módulo:** `AUT` · **Prioridad:** Should · **Fase:** MVP Extendido · **Repos:** ambos
- **Historia:** Como **`Profesor` o `Padre / Tutor`**, quiero **vincular la cuenta de un padre o tutor con la de su hijo matriculado mediante una invitación verificada**, para **habilitar el seguimiento académico familiar con aislamiento estricto**.
- **Criterios de aceptación:**
  1. **Dado** un profesor de un aula con `adult_mode = false`, **cuando** emite una invitación parental asociada a un alumno y el padre/tutor autenticado la acepta, **entonces** el servidor crea de forma atómica el vínculo `ParentStudentLink` (`ParentLink`).
  2. **Dado** un alumno que ya cuenta con **2** tutores activos vinculados, **cuando** se intenta asociar un tercer tutor, **entonces** el servidor rechaza la solicitud informando que se alcanzó el máximo permitido.
  3. **Dada** un aula configurada en modo educación de adultos (`adult_mode = true`), **cuando** se intenta emitir o aceptar una vinculación parental para esa aula, **entonces** el servidor rechaza la operación con `403`/`400`.
- **Tareas técnicas:**
  - `[back]` Servicio y endpoints para emisión y aceptación atómica de invitaciones parentales (`ParentStudentLink`), validando tope de 2 tutores por alumno y estado `adult_mode`.
  - `[front]` Modal docente para invitar padre/tutor desde la ficha del alumno y pantalla de aceptación de vínculo para la cuenta familiar.

---

## 2. Módulo `AUL` · Aulas, Escuelas, Membresías y Roles

### HU-AUL-001 · Crear y configurar un aula virtual
- **Trazabilidad:** `RF-AUL-001` · `RN-01`, `RN-03`, `RN-09`
- **Módulo:** `AUL` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Profesor` (o `Dueño / Admin de Escuela`)**, quiero **crear y configurar un aula virtual definiendo su nombre, materia/descripción y modalidad (escolar con padres o educación de adultos)**, para **disponer de un espacio persistente donde dictar mi materia**.
- **Criterios de aceptación:**
  1. **Dado** un profesor autenticado, **cuando** completa el alta de un aula con datos válidos, **entonces** el servidor crea en una sola transacción el `Classroom`, su mascota inicial (`ClassroomPet`), los pupitres iniciales (`Desk`) y los estados de control por defecto.
  2. **Dado** un usuario con rol `Alumno` o `Padre / Tutor`, **cuando** intenta crear o modificar la configuración de un aula, **entonces** el servidor responde `403 Forbidden`.
  3. **Dada** el aula creada, **entonces** queda asociada exactamente a una `School` o a un `Profesor independiente` y aparece en el listado de aulas del docente.
- **Tareas técnicas:**
  - `[back]` CRUD de `Classroom` en NestJS con invariante de pertenencia (`school_id` XOR `independent_teacher_id`) e inicialización transaccional de `ClassroomPet` y configuración del aula.
  - `[front]` Formulario de creación y configuración de aula y vista de listado de aulas del usuario.

### HU-AUL-002 · Unirse a un aula mediante invitación por email o código/enlace de acceso
- **Trazabilidad:** `RF-AUL-002` · `RN-01`, `RN-02`, `RN-04`
- **Módulo:** `AUL` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Alumno` (o `Profesor` que invita)**, quiero **enviar y aceptar una invitación o código/enlace de acceso con vencimiento para unirme a un aula**, para **quedar matriculado de forma segura en el curso que me corresponde**.
- **Criterios de aceptación:**
  1. **Dado** un profesor del aula, **cuando** genera una invitación por correo electrónico o un enlace/código de invitación con fecha de vencimiento, **entonces** el servidor persiste únicamente el hash del secreto junto al aula destino, el rol (`Student`) y su expiración.
  2. **Dada** una invitación vigente y no revocada, **cuando** el alumno autenticado la acepta, **entonces** el servidor crea su `ClassroomMembership` (`Enrollment`) de forma atómica e idempotente y le asigna un pupitre (`Desk`) en el aula.
  3. **Dada** una invitación vencida, ya consumida o revocada por el profesor, **cuando** alguien intenta usarla, **entonces** el servidor la rechaza con un error claro sin crear membresía.
- **Tareas técnicas:**
  - `[back]` Emisión, revocación y aceptación atómica de `Invitation` con hash de secreto, control de expiración, envío asíncrono de correo y creación de `ClassroomMembership` + asignación de `Desk`.
  - `[front]` Panel docente de generación/revocación de invitaciones y flujo de aceptación de invitación para alumnos.

### HU-AUL-003 · Gestión de miembros, roles y bajas lógicas en el aula
- **Trazabilidad:** `RF-AUL-003` · `RN-01`, `RN-03`, `RN-04`, `RN-18`
- **Módulo:** `AUL` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Profesor` (o `Dueño / Admin de Escuela`)**, quiero **consultar el padrón de integrantes de mi aula y dar de baja lógica la membresía de un alumno cuando sea necesario**, para **mantener controlada la matrícula del curso sin perder el historial académico**.
- **Criterios de aceptación:**
  1. **Dado** un profesor en su aula, **cuando** abre la sección de miembros, **entonces** visualiza la lista paginada de alumnos inscritos, su estado y los tutores vinculados.
  2. **Dado** un profesor que da de baja a un alumno de su aula, **cuando** confirma la acción, **entonces** la membresía registra `deleted_at`, Colyseus cierra de inmediato cualquier conexión activa de ese alumno en el aula y sus entregas, notas y mensajes anteriores se conservan atribuidos.
  3. **Dado** un profesor que intenta gestionar miembros de un aula que no dicta, **entonces** el servidor responde `404 Not Found`.
- **Tareas técnicas:**
  - `[back]` Endpoints paginados de nómina del aula y baja lógica de `ClassroomMembership` con evento hacia Colyseus para expulsión inmediata de la `Room`.
  - `[front]` Vista de padrón del aula con filtros, estado de actividad y confirmación de baja de miembro.

### HU-AUL-004 · Vista institucional y gestión multi-aula de Escuela
- **Trazabilidad:** `RF-AUL-004` · `RN-01`, `RN-02`, `RN-03`, `RN-04`
- **Módulo:** `AUL` · **Prioridad:** Should · **Fase:** MVP Extendido · **Repos:** ambos
- **Historia:** Como **`Dueño / Admin de Escuela`**, quiero **invitar profesores a mi institución, supervisar todas las aulas de la escuela y ejercer autoridad docente sobre ellas**, para **coordinar múltiples cursos bajo una misma organización escolar**.
- **Criterios de aceptación:**
  1. **Dado** el `Dueño` o `Admin` de una escuela, **cuando** invita a un profesor y este acepta, **entonces** el profesor se incorpora a `SchoolMember` y puede crear o dictar aulas dentro de esa escuela.
  2. **Dado** el `Dueño` o `Admin` de una escuela, **cuando** ingresa a cualquier aula perteneciente a su institución, **entonces** el servidor le otorga autoridad de nivel `Profesor` derivada de su membresía en `SchoolMember`.
  3. **Dado** el `Dueño` o `Admin` de una escuela, **cuando** intenta acceder a recursos de otra escuela o de un profesor independiente ajeno, **entonces** el servidor responde `404 Not Found`.
- **Tareas técnicas:**
  - `[back]` Gestión de `School` y `SchoolMember`, invitaciones de plantel docente y resolución de permisos jerárquicos `School → Classroom` en el servicio central de autorización.
  - `[front]` Panel institucional de escuela con listado de profesores, aulas activas y métricas generales por curso.

### HU-AUL-005 · Aislamiento de recursos y verificación de acceso en servidor
- **Trazabilidad:** `RF-AUL-005` · `RN-01`, `RN-03`, `RN-04`
- **Módulo:** `AUL` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** back
- **Historia:** Como **usuario de la plataforma**, quiero **que el servidor verifique en cada operación mi sesión, mi membresía en el aula o escuela y mi rol antes de leer o modificar cualquier recurso**, para **garantizar que ningún usuario acceda a datos de aulas o hijos ajenos**.
- **Criterios de aceptación:**
  1. **Dada** una petición HTTP o WebSocket sin credencial válida o con sesión expirada, **cuando** llega al backend, **entonces** es rechazada con `401 Unauthorized`.
  2. **Dada** una petición de un miembro autenticado que intenta ejecutar una acción para la cual su rol en esa aula no tiene permiso, **cuando** el servidor la evalúa, **entonces** responde `403 Forbidden`.
  3. **Dada** una petición que referencia el ID de un aula, actividad, entrega o alumno con el que el usuario no tiene vínculo, **cuando** el servidor resuelve el recurso desde la base de datos, **entonces** responde `404 Not Found` sin revelar su existencia.
- **Tareas técnicas:**
  - `[back]` Guardas globales y servicio compartido de autorización contextual (`School` / `Classroom` / `ParentStudentLink`) en NestJS y validación en `onAuth`/`onJoin` de Colyseus, cubiertos por tests de integración por fila de la matriz de permisos.

---

## 3. Módulo `ESP` · Espacio 3D, Avatar, Pupitres y Modo 2D Clásico

### HU-ESP-001 · Navegación en Aula 3D isométrica y presencia en tiempo real
- **Trazabilidad:** `RF-ESP-001` · `RN-01`, `RN-04`, `RN-19`
- **Módulo:** `ESP` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Profesor` o `Alumno`**, quiero **recorrer el aula tridimensional vista desde una cámara isométrica usando teclado (`WASD`), clic o gestos táctiles y ver en tiempo real a mis compañeros conectados**, para **compartir presencia social durante la actividad escolar**.
- **Criterios de aceptación:**
  1. **Dado** un miembro autorizado que entra al Aula 3D, **cuando** se conecta a la `Room` de Colyseus, **entonces** visualiza la escena 3D en Three.js + React Three Fiber, su propio avatar y los avatares e indicadores de presencia de los demás miembros conectados.
  2. **Dado** un avatar en movimiento por el aula, **cuando** se desplaza hacia paredes, pupitres u obstáculos, **entonces** respeta las colisiones de la superficie transitable y sincroniza su movimiento de forma fluida con los demás clientes sin escribir filas por paso en PostgreSQL.
  3. **Dado** un corte de conexión o salida del aula, **cuando** el usuario se desconecta o reconecta, **entonces** Colyseus actualiza la presencia en vivo y reporta el tiempo conectado de manera agregada a NestJS.
- **Tareas técnicas:**
  - `[back]` Definición de `ClassroomRoom` en Colyseus con verificación de membresía contra NestJS, sincronización de esquema de avatares/presencia, interpolación/reconexión y reporte agregado de tiempo conectado para `ActivityMetric`.
  - `[front]` Escena isométrica en Three.js + React Three Fiber, controlador de movimiento (`WASD`, clic a destino y táctil), malla de colisiones e interpolación de avatares remotos.

### HU-ESP-002 · Interacción con pupitres (`Desk`) y zonas educativas del aula
- **Trazabilidad:** `RF-ESP-002` · `RN-04`, `RN-10`, `RN-17`
- **Módulo:** `ESP` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Profesor` o `Alumno`**, quiero **interactuar con mi pupitre, el escritorio docente, la pizarra, la estantería de material, la cartelera, la tienda, la mascota y el Bot Guía dentro del Aula 3D**, para **abrir las herramientas educativas desde el entorno espacial**.
- **Criterios de aceptación:**
  1. **Dado** un usuario en el Aula 3D, **cuando** apunta, toca o se acerca a un objeto interactuable (pupitre, estantería, cartelera, tienda, mascota o Bot tutor), **entonces** recibe feedback visual y al seleccionarlo se abre el panel React correspondiente.
  2. **Dado** un alumno que interactúa con un objeto del aula, **cuando** el panel solicita o modifica datos, **entonces** el backend valida sus permisos reales sobre el recurso sin otorgar privilegios por el mero hecho de haber interactuado con el objeto 3D.
  3. **Dada** la matrícula del aula, **entonces** el servidor mantiene asignado un pupitre (`Desk`) para cada alumno inscrito.
- **Tareas técnicas:**
  - `[back]` Gestión de asientos/pupitres (`Desk`) por aula y validación de permisos en cada endpoint invocado por los paneles de los objetos.
  - `[front]` Sistema extensible de objetos interactuables en React Three Fiber (resaltado, equivalentes táctiles y apertura de modales/paneles React para pupitre, pizarra, material, avisos, notas, tienda, mascota y bot).

### HU-ESP-003 · Cambio en un clic a Modo 2D Clásico accesible
- **Trazabilidad:** `RF-ESP-003` · `RN-04`, `RN-17`
- **Módulo:** `ESP` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** front
- **Historia:** Como **`Profesor` o `Alumno`**, quiero **alternar en un solo clic entre la vista del Aula 3D y el Modo 2D Clásico**, para **acceder a todas las herramientas del aula con lectura convencional, navegación por teclado o desde dispositivos móviles**.
- **Criterios de aceptación:**
  1. **Dado** un usuario dentro de un aula en vista 3D, **cuando** presiona el botón o atajo de **Modo 2D Clásico**, **entonces** la interfaz conmuta de inmediato a un panel 2D estructurado sin cerrar su sesión ni perder su contexto en el aula.
  2. **Dado** un usuario utilizando el Modo 2D Clásico, **cuando** gestiona actividades, realiza entregas, consulta notas, descarga bibliografía, usa el chat, compra en la tienda o conversa con el Bot Guía, **entonces** dispone de las mismas funciones esenciales que en la vista 3D y puede operarlas íntegramente con teclado o pantalla táctil.
- **Tareas técnicas:**
  - `[front]` Conmutador persistente `3D ↔ Modo 2D Clásico` en Zustand y layout accesible en React/Tailwind/shadcn que integra los paneles de Actividades, Material, Calificaciones, Chat, Avisos, Tienda, Mascota y Bot IA sin requerir el canvas de Three.js.

### HU-ESP-004 · Personalización visual de avatar y pupitre con ítems del aula
- **Trazabilidad:** `RF-ESP-004` · `RN-09`, `RN-17`
- **Módulo:** `ESP` · **Prioridad:** Should · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Alumno`**, quiero **equipar en mi avatar y en mi pupitre los accesorios y mejoras que compré en la tienda del aula**, para **ver reflejado mi progreso dentro del espacio compartido con mis compañeros**.
- **Criterios de aceptación:**
  1. **Dado** un alumno que adquirió un accesorio o mejora en la tienda, **cuando** lo selecciona para equiparlo en su avatar o pupitre (`Desk`), **entonces** el servidor verifica que el ítem le pertenezca en `StudentPurchase` / `ClassroomItem`, guarda la configuración y sincroniza el aspecto visual en el aula 3D.
  2. **Dado** un alumno que intenta equipar un ítem no comprado, **entonces** el servidor rechaza la operación con `403 Forbidden`.
- **Tareas técnicas:**
  - `[back]` Endpoint para equipar/desequipar ítems comprados sobre `AvatarConfiguration` y `Desk` con verificación de propiedad en base de datos.
  - `[front]` Renderizado de accesorios equipados sobre el modelo 3D del avatar/pupitre y selector de inventario.

---

## 4. Módulo `ACT` · Actividades, TPs, Exámenes, Entregas y Calificaciones

### HU-ACT-001 · Publicar TP, Examen o Material de estudio con ponderación de puntos
- **Trazabilidad:** `RF-ACT-001` · `RN-01`, `RN-05`, `RN-06`, `RN-18`, `RN-20`
- **Módulo:** `ACT` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Profesor`**, quiero **subir bibliografía al aula y publicar actividades de tipo Trabajo Práctico (`TP`) o `Examen` (en formato de entrega de archivo u opción múltiple) configurando su fecha de vencimiento, política de entrega tardía (`allow_late`) y peso en puntos**, para **evaluar y guiar el aprendizaje de mis alumnos**.
- **Criterios de aceptación:**
  1. **Dado** un profesor en su aula, **cuando** crea y publica un `TP` o `Examen` válido, **entonces** el servidor persiste la `Activity` (y sus preguntas/opciones si es opción múltiple, resguardando las respuestas correctas en el servidor), emite `activity:published` y notifica a los alumnos matriculados.
  2. **Dado** un profesor que sube un archivo de bibliografía (`StudyMaterial`), **cuando** el servidor valida el archivo, **entonces** lo guarda en `Amazon S3` privado y habilita su descarga mediante URLs firmadas para los miembros del aula.
  3. **Dada** una actividad que ya posee entregas o calificaciones, **cuando** el profesor solicita eliminarla, **entonces** el servidor impide el borrado físico y aplica baja lógica/desactivación conservando las entregas y notas existentes.
- **Tareas técnicas:**
  - `[back]` CRUD de `Activity` (`TP`/`Exam`, `File`/`MultipleChoice`, `due_date`, `max_score`, `allow_late`, `weight_multiplier`) y servicio de carga/descarga privada en S3 con URLs firmadas para `StudyMaterial`.
  - `[front]` Editor docente de actividades (formulario de TP/Examen, constructor de preguntas de opción múltiple y gestor de bibliografía) disponible desde el escritorio del profesor en 3D y desde el Modo 2D Clásico.

### HU-ACT-002 · Ver bandeja de actividades y vencimientos del alumno
- **Trazabilidad:** `RF-ACT-002` · `RN-01`, `RN-05`, `RN-17`
- **Módulo:** `ACT` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Alumno`**, quiero **consultar desde mi pupitre o desde el Modo 2D Clásico mi bandeja de actividades con sus fechas límite y su estado (`Pendiente`, `Entregada`, `Corregida`, `Vencida`)**, para **organizar mis entregas a tiempo**.
- **Criterios de aceptación:**
  1. **Dado** un alumno matriculado en el aula, **cuando** consulta sus actividades, **entonces** ve únicamente las actividades publicadas de su aula junto con el estado derivado en el servidor (`Pendiente`, `Entregada`, `Corregida` o `Vencida`), la fecha límite y el peso en puntos.
  2. **Dada** una actividad cuya `due_date` ya venció según el reloj del servidor sin entrega registrada y con `allow_late = false`, **cuando** el alumno abre la bandeja, **entonces** la ve marcada como `Vencida` y con el envío deshabilitado.
- **Tareas técnicas:**
  - `[back]` Endpoint paginado `GET /classrooms/:id/activities` que calcula el estado por alumno a partir de `Submission`, `Grade` y hora del servidor, ocultando borradores y respuestas correctas de exámenes.
  - `[front]` Bandeja de actividades del alumno con filtros por estado (`Pendiente`, `Entregada`, `Corregida`, `Vencida`) e indicadores de próximo vencimiento.

### HU-ACT-003 · Realizar entrega con archivos adjuntos o cuestionario de opción múltiple
- **Trazabilidad:** `RF-ACT-003` · `RN-04`, `RN-05`, `RN-06`, `RN-20`
- **Módulo:** `ACT` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Alumno`**, quiero **entregar la resolución de un Trabajo Práctico subiendo mis archivos o responder un Examen de opción múltiple dentro del plazo establecido**, para **cumplir con la actividad y recibir mi calificación**.
- **Criterios de aceptación:**
  1. **Dado** un alumno matriculado y una actividad publicada en plazo, **cuando** sube archivos válidos (tipo y tamaño permitidos) o envía sus respuestas de opción múltiple, **entonces** el servidor registra la `Submission` de forma idempotente con fecha/hora oficial, almacena los adjuntos en S3 privado y cambia el estado a `Entregada` (o calcula la nota automática si es opción múltiple autoevaluable).
  2. **Dada** una actividad vencida con `allow_late = true`, **cuando** el alumno envía su trabajo, **entonces** el servidor registra la entrega marcándola con `is_late = true`.
  3. **Dado** un alumno que intenta consultar o modificar la entrega de otro compañero, **entonces** el servidor responde `403` o `404`.
- **Tareas técnicas:**
  - `[back]` Endpoint idempotente `POST /activities/:id/submissions` con validación de ventana temporal/vencimiento, subida segura a S3, evaluador automático en servidor para opción múltiple y actualización de racha si la entrega fue en término.
  - `[front]` Interfaz de entrega de archivos y resolución de cuestionarios de opción múltiple con confirmación de envío y estados de carga/error.

### HU-ACT-004 · Calificar entrega, dar devolución y acreditar puntos ponderados automáticamente
- **Trazabilidad:** `RF-ACT-004` · `RN-06`, `RN-07`, `RN-16`, `RN-18`
- **Módulo:** `ACT` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Profesor`**, quiero **revisar las entregas de mis alumnos, asignarles una calificación (`0–100`) con una devolución escrita (`feedback`) y que el sistema acredite automáticamente los puntos ponderados correspondientes**, para **retroalimentar su aprendizaje y recompensar su esfuerzo sin cálculos manuales**.
- **Criterios de aceptación:**
  1. **Dado** un profesor revisando una entrega de su aula, **cuando** guarda una nota entre `0` y `100` y su devolución, **entonces** el servidor persiste en una misma transacción el registro `Grade` y el asiento inmutable `PointTransaction` por `redondear(nota * peso_actividad)`, cambiando el estado a `Corregida`.
  2. **Dada** la confirmación de la calificación, **entonces** el sistema notifica en vivo e in-app al alumno, y envía notificación in-app y por correo electrónico a sus padres vinculados (`ParentStudentLink`).
  3. **Dado** un profesor que recalifica una entrega ya corregida, **cuando** guarda la nueva nota, **entonces** el servidor actualiza la calificación y crea un asiento compensatorio en `PointTransaction` por la diferencia de puntos, sin borrar ni sobrescribir el asiento original.
- **Tareas técnicas:**
  - `[back]` Servicio transaccional de calificación y recalificación en NestJS (`Grade` + `PointTransaction` con compensación + control de concurrencia/versión + disparo de `Notification` y evento `grade:published`).
  - `[front]` Bandeja docente de corrección paginada y filtrable por actividad/estado, visor de entregas y formulario de calificación y devolución.

### HU-ACT-005 · Consultar historial académico y métricas de participación (`ActivityMetric`)
- **Trazabilidad:** `RF-ACT-005` · `RN-01`, `RN-04`, `RN-19`
- **Módulo:** `ACT` · **Prioridad:** Should · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Alumno` o `Profesor`**, quiero **consultar el boletín de calificaciones, las devoluciones recibidas y las métricas agregadas de actividad (`ActivityMetric`: tiempo conectado, entregas y participación)**, para **hacer seguimiento del progreso académico en el aula**.
- **Criterios de aceptación:**
  1. **Dado** un alumno que abre su boletín de notas, **cuando** consulta su historial, **entonces** visualiza todas sus calificaciones, devoluciones, puntos ganados por actividad y sus métricas propias de participación.
  2. **Dado** un profesor que abre el seguimiento de su aula, **cuando** consulta la planilla del curso, **entonces** visualiza el desempeño y los valores de `ActivityMetric` de cada alumno matriculado en su aula.
- **Tareas técnicas:**
  - `[back]` Agregación periódica de `ActivityMetric` (tiempo conectado reportado por Colyseus, conteo de entregas y mensajes) y endpoints de boletín individual y resumen docente por aula.
  - `[front]` Vista de boletín de calificaciones para el alumno y panel de métricas de seguimiento para el profesor.

### HU-ACT-006 · Vista de seguimiento académico para Padre / Tutor
- **Trazabilidad:** `RF-ACT-006` · `RN-01`, `RN-04`, `RN-16`
- **Módulo:** `ACT` · **Prioridad:** Should · **Fase:** MVP Extendido · **Repos:** ambos
- **Historia:** Como **`Padre / Tutor`**, quiero **acceder a una vista simple con las calificaciones, el estado de las actividades y las notificaciones de mis hijos vinculados**, para **acompañar su trayectoria escolar desde casa**.
- **Criterios de aceptación:**
  1. **Dado** un padre autenticado con uno o más vínculos `ParentStudentLink` activos en aulas con `adult_mode = false`, **cuando** ingresa a la aplicación, **entonces** visualiza una interfaz simplificada con las notas, entregas pendientes/vencidas y avisos de cada hijo vinculado.
  2. **Dado** un padre que intenta consultar datos de un alumno no vinculado o de un aula en modo educación de adultos, **entonces** el servidor rechaza el acceso con `404` o `403`.
- **Tareas técnicas:**
  - `[back]` Endpoints dedicados de lectura familiar (`GET /parent/children`, `GET /parent/children/:studentId/overview`) protegidos por verificación estricta de `ParentStudentLink` y `adult_mode = false`.
  - `[front]` Dashboard simplificado de `Padre / Tutor` con selector de hijo vinculado, tabla de calificaciones, estado de actividades y bandeja de avisos.

---

## 5. Módulo `GAM` · Puntos Ponderados, Racha, Medallas, Tienda y Mascota del Aula

### HU-GAM-001 · Consultar billetera de puntos ponderados y movimientos (`PointTransaction`)
- **Trazabilidad:** `RF-GAM-001` · `RN-04`, `RN-07`, `RN-18`
- **Módulo:** `GAM` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Alumno`**, quiero **consultar mi saldo actual de puntos ponderados y el historial detallado de movimientos de mi billetera**, para **saber cuántos puntos gané en cada TP o examen y cuántos utilicé en la tienda o en la mascota del aula**.
- **Criterios de aceptación:**
  1. **Dado** un alumno autenticado, **cuando** abre su billetera de puntos, **entonces** ve su saldo total calculado por el servidor a partir de `PointTransaction` y la lista paginada de ingresos, compras y ajustes con fecha y motivo.
  2. **Dado** cualquier intento desde el cliente de alterar un saldo o transferir puntos a otro alumno, **entonces** el servidor rechaza la operación.
- **Tareas técnicas:**
  - `[back]` Servicio de libro mayor `PointTransaction` con cálculo de saldo por suma de asientos inmutables y endpoint paginado de movimientos del alumno.
  - `[front]` Componente de billetera de puntos e historial de transacciones accesible en la barra superior, el boletín y la tienda.

### HU-GAM-002 · Mantener racha diaria de estudio (`Streak`) y obtener medallas (`Badge`)
- **Trazabilidad:** `RF-GAM-002` · `RN-08`, `RN-15`
- **Módulo:** `GAM` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Alumno`**, quiero **sumar días a mi racha de estudio al entregar tareas en término, aprobar exámenes o responder la pregunta diaria de repaso, y ganar medallas por mis logros**, para **mantener mi constancia en la materia**.
- **Criterios de aceptación:**
  1. **Dado** un alumno que completa una acción académica válida en el día (entrega en término, examen aprobado o pregunta diaria respondida), **cuando** el servidor la registra bajo la zona horaria `America/Argentina/Buenos_Aires`, **entonces** incrementa su `Streak` como máximo **1 vez por día calendario**.
  2. **Dado** un alumno que únicamente inicia sesión sin realizar ninguna actividad académica real, **entonces** su racha no se incrementa.
  3. **Dado** que el alumno alcanza la condición de una medalla del catálogo (`Badge`), **cuando** el servidor evalúa el evento, **entonces** adjudica `StudentBadge` de manera idempotente y notifica el nuevo logro.
- **Tareas técnicas:**
  - `[back]` Motor de `Streak` con unicidad por `(student_id, local_date)` en `America/Argentina/Buenos_Aires` y evaluador idempotente de `Badge` / `StudentBadge`.
  - `[front]` Indicador visual de racha diaria activa/mejor racha y vitrina de medallas desbloqueadas en el perfil y boletín del alumno.

### HU-GAM-003 · Comprar ítems en la tienda del aula para el aula, avatar o pupitre
- **Trazabilidad:** `RF-GAM-003` · `RN-07`, `RN-09`, `RN-17`
- **Módulo:** `GAM` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Alumno`**, quiero **canjear mis puntos ponderados en la tienda del aula por ítems funcionales del aula o accesorios para mi avatar y mi pupitre**, para **personalizar mi experiencia con los puntos obtenidos por mis calificaciones**.
- **Criterios de aceptación:**
  1. **Dado** un alumno con saldo suficiente que selecciona un `ShopItem` con funcionalidad activa, **cuando** confirma la compra, **entonces** el servidor verifica y debita `points_cost` bajo bloqueo transaccional e idempotencia, crea el asiento negativo en `PointTransaction` y registra el ítem en `StudentPurchase` / `ClassroomItem`.
  2. **Dado** un alumno con saldo menor al precio del ítem o que envía dos compras simultáneas sin saldo para ambas, **entonces** el servidor rechaza la operación garantizando que el saldo nunca sea negativo.
- **Tareas técnicas:**
  - `[back]` Endpoint transaccional `POST /classrooms/:id/shop/purchase` con llave de idempotencia, bloqueo de saldo del alumno, débito en `PointTransaction` y alta de `StudentPurchase` / `ClassroomItem`.
  - `[front]` Interfaz de Tienda del Aula (accesible desde el objeto Tienda en 3D y desde el Modo 2D Clásico) con catálogo, precios, saldo disponible y confirmación de compra.

### HU-GAM-004 · Aportar puntos y equipar accesorios a la mascota grupal del aula (`ClassroomPet`)
- **Trazabilidad:** `RF-GAM-004` · `RN-07`, `RN-09`, `RN-12`
- **Módulo:** `GAM` · **Prioridad:** Should · **Fase:** MVP Extendido · **Repos:** ambos
- **Historia:** Como **`Alumno`**, quiero **aportar puntos o comprar accesorios para la mascota grupal de nuestra aula (`ClassroomPet`)**, para **alcanzar metas colaborativas junto con mis compañeros de curso**.
- **Criterios de aceptación:**
  1. **Dado** un alumno del aula con puntos suficientes, **cuando** realiza un aporte colaborativo (`pet_contribution`) o adquiere un accesorio para la mascota del aula, **entonces** el servidor debita sus puntos en `PointTransaction`, actualiza el estado o inventario de la `ClassroomPet` y sincroniza el cambio para todos los miembros del aula.
  2. **Dado** un usuario que intenta equipar en la mascota un accesorio que el aula aún no ha desbloqueado, **entonces** el servidor rechaza la petición con `403`/`400`.
- **Tareas técnicas:**
  - `[back]` Endpoints de contribución y equipamiento de `ClassroomPet` / `PetAccessory` con débito atómico en `PointTransaction` y difusión de estado a la `Room` del aula.
  - `[front]` Representación 3D y panel 2D de la Mascota del Aula con barra de progreso grupal y selector de accesorios desbloqueados.

### HU-GAM-005 · Configurar catálogo de premios y habilitar/deshabilitar minijuegos del aula
- **Trazabilidad:** `RF-GAM-005` · `RN-09`, `RN-10`
- **Módulo:** `GAM` · **Prioridad:** Should · **Fase:** MVP Extendido · **Repos:** ambos
- **Historia:** Como **`Profesor`**, quiero **configurar el catálogo de ítems disponibles en la tienda de mi aula y deshabilitar los minijuegos durante el horario de clase**, para **mantener los premios alineados con mi curso y evitar distracciones mientras explico**.
- **Criterios de aceptación:**
  1. **Dado** un profesor en su aula, **cuando** ajusta la disponibilidad o el costo futuro de un ítem del catálogo, **entonces** el cambio aplica a las nuevas compras sin modificar los importes históricos ya registrados en `PointTransaction`.
  2. **Dado** un profesor que activa el bloqueo de minijuegos (`games_disabled = true`), **cuando** un alumno intenta abrir o jugar un minijuego del aula (incluso si recarga la página), **entonces** el servidor rechaza la sesión de juego y notifica en vivo que los minijuegos están deshabilitados por el docente.
- **Tareas técnicas:**
  - `[back]` Endpoints docentes de configuración de catálogo por aula y persistencia/difusión del estado `games_disabled` en `Classroom` y Colyseus.
  - `[front]` Panel docente de administración de tienda y control rápido de habilitación/bloqueo de minijuegos.

---

## 6. Módulo `COM` · Comunicación del Aula, Avisos, Chat y Foro de Consultas

### HU-COM-001 · Publicar avisos importantes en la cartelera con notificación in-app y por email
- **Trazabilidad:** `RF-COM-001` · `RN-01`, `RN-16`, `RN-18`, `RN-20`
- **Módulo:** `COM` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Profesor`**, quiero **publicar, editar o dar de baja avisos importantes en el tablón de anuncios del aula y que se notifique automáticamente en la aplicación y por correo electrónico a las familias**, para **comunicar fechas de examen y novedades a todo el curso**.
- **Criterios de aceptación:**
  1. **Dado** un profesor en su aula, **cuando** publica un anuncio en la cartelera, **entonces** el servidor guarda el `Announcement`, crea notificaciones in-app para los alumnos del aula y encola notificaciones in-app y por correo electrónico (`Amazon SES`) para los padres vinculados.
  2. **Dado** un alumno o padre vinculado con acceso vigente, **cuando** consulta la cartelera de avisos, **entonces** visualiza los anuncios ordenados cronológicamente sin permisos de edición ni borrado.
- **Tareas técnicas:**
  - `[back]` CRUD de `Announcement` en NestJS, resolución de `@menciones`, creación de `Notification` tras el commit y cola asíncrona idempotente de envío de correos por `Amazon SES`.
  - `[front]` Panel de Cartelera de Avisos (accesible desde la cartelera 3D y el Modo 2D Clásico) con formulario de publicación docente.

### HU-COM-002 · Chat del aula en tiempo real con `@menciones` y moderación docente
- **Trazabilidad:** `RF-COM-002` · `RN-01`, `RN-04`, `RN-10`, `RN-16`, `RN-18`
- **Módulo:** `COM` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Alumno` o `Profesor`**, quiero **conversar en tiempo real en el canal de chat de mi aula utilizando `@menciones`, y como `Profesor` poder moderar/ocultar mensajes inapropiados conservando el historial**, para **fomentar una participación ordenada y segura**.
- **Criterios de aceptación:**
  1. **Dado** un miembro autorizado del aula (alumno o profesor) cuando `chat_muted = false`, **cuando** envía un mensaje válido con `@menciones`, **entonces** el servidor persiste el `ChatMessage` (`Message`) y las `Mention` antes de difundirlo en tiempo real por Colyseus.
  2. **Dado** un profesor que modera u oculta un mensaje del chat, **cuando** confirma la moderación, **entonces** el mensaje deja de mostrarse a los alumnos pero permanece en el historial de auditoría del profesor con registro de quién y cuándo lo moderó.
  3. **Dado** un usuario con rol `Padre / Tutor`, **cuando** intenta acceder al chat grupal del aula, **entonces** el servidor responde `403 Forbidden`.
- **Tareas técnicas:**
  - `[back]` Persistencia paginada de `ChatMessage` y `Mention`, límite de tasa (*rate limit*) por usuario/aula, endpoint de moderación lógica y difusión por Colyseus.
  - `[front]` Panel de chat en tiempo real con autocompletado de `@menciones`, historial paginado y controles de moderación para el profesor.

### HU-COM-003 · Foro de consultas por actividad y mensajería directa Padre ↔ Profesor
- **Trazabilidad:** `RF-COM-003` · `RN-01`, `RN-04`, `RN-16`
- **Módulo:** `COM` · **Prioridad:** Should · **Fase:** MVP Core (foro de actividad) / MVP Extendido (mensajería parental) · **Repos:** ambos
- **Historia:** Como **`Alumno`, `Profesor` o `Padre / Tutor`**, quiero **plantear y responder dudas específicas dentro del hilo de cada actividad y, en el caso de padres y profesores, intercambiar mensajes directos sobre el alumno vinculado**, para **resolver consultas académicas y mantener el contacto escuela-familia en canales separados**.
- **Criterios de aceptación:**
  1. **Dado** un alumno matriculado, **cuando** publica una consulta en el foro de una actividad y el profesor responde, **entonces** el hilo queda asociado a la actividad para consulta del curso y se notifica al alumno.
  2. **Dado** un padre con un `ParentStudentLink` activo en un aula con `adult_mode = false`, **cuando** envía un mensaje al profesor de su hijo, **entonces** el servidor valida el vínculo en cada lectura y escritura e impide que terceros accedan a esa conversación.
- **Tareas técnicas:**
  - `[back]` Hilos de consulta por `Activity` y canal de mensajes vinculado a `ParentStudentLink` con restricción en base de datos de contexto único e inspección de permisos.
  - `[front]` Pestaña de foro de dudas dentro del detalle de cada actividad y bandeja de mensajes Padre ↔ Profesor.

### HU-COM-004 · Centro de notificaciones in-app y estado de lectura
- **Trazabilidad:** `RF-COM-004` · `RN-01`, `RN-04`, `RN-16`, `RN-18`, `RN-20`
- **Módulo:** `COM` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **usuario autenticado**, quiero **contar con un centro de notificaciones dentro de la aplicación donde vea mis avisos recientes (nuevas actividades, calificaciones, anuncios, `@menciones` y mensajes) y pueda marcarlos como leídos**, para **estar al día con lo que ocurre en mis aulas**.
- **Criterios de aceptación:**
  1. **Dado** un evento confirmado en el servidor (publicación de actividad, nota cargada, anuncio o `@mención`), **cuando** se completa la transacción, **entonces** `NestJS` crea la `Notification` para los destinatarios con acceso vigente y emite el aviso en vivo `notification:created`.
  2. **Dado** un usuario que marca una o todas sus notificaciones como leídas, **cuando** recarga la aplicación, **entonces** el estado de lectura persiste y nunca incluye notificaciones de aulas donde haya perdido acceso.
- **Tareas técnicas:**
  - `[back]` Servicio de `Notification` en NestJS con endpoints `GET /notifications` y `PATCH /notifications/:id/read`, filtrado por membresía vigente.
  - `[front]` Campana y bandeja desplegable de notificaciones con contador de no leídas, actualización en tiempo real y navegación directa al recurso.

---

## 7. Módulo `VIV` · Herramientas de Clase en Vivo

### HU-VIV-001 · Congelar alumnos en sus pupitres (`Freeze`) y dirigir la atención
- **Trazabilidad:** `RF-VIV-001` · `RN-04`, `RN-10`, `RN-19`
- **Módulo:** `VIV` · **Prioridad:** Must · **Fase:** MVP Extendido · **Repos:** ambos
- **Historia:** Como **`Profesor`**, quiero **activar el control `Congelar` para enviar automáticamente a todos los avatares de mis alumnos a sus pupitres asignados y bloquear su movimiento mientras explico**, para **ordenar la clase y concentrar la atención del grupo**.
- **Criterios de aceptación:**
  1. **Dado** un profesor en una sesión activa del aula, **cuando** activa `Congelar`, **entonces** Colyseus verifica su rol docente actual, ubica a cada alumno en su pupitre (`Desk`), bloquea en el servidor cualquier input de desplazamiento de los alumnos y mantiene libre el movimiento del profesor.
  2. **Dado** un alumno que ingresa o se reconecta al aula mientras está congelada, **cuando** entra a la `Room`, **entonces** aparece directamente sentado y bloqueado en su pupitre.
  3. **Dado** que el profesor desactiva `Congelar`, **entonces** el servidor libera el bloqueo de asientos y los alumnos recuperan el desplazamiento libre sin teletransportaciones bruscas.
- **Tareas técnicas:**
  - `[back]` Comando autoritativo `classroom:freeze` / `classroom:unfreeze` en Colyseus con verificación de rol docente, asignación determinística de `Desk` y rechazo de paquetes `avatar:input` de alumnos congelados.
  - `[front]` Botón docente de Congelar/Descongelar en la barra de control del aula, transición visual del avatar al pupitre e indicador en pantalla de aula congelada.

### HU-VIV-002 · Silenciar micrófonos de la sala y silenciar el chat del aula (`Mute`)
- **Trazabilidad:** `RF-VIV-002` · `RN-04`, `RN-10`
- **Módulo:** `VIV` · **Prioridad:** Should · **Fase:** MVP Extendido · **Repos:** ambos
- **Historia:** Como **`Profesor`**, quiero **silenciar de forma general el chat del aula o los micrófonos de todos los alumnos durante una exposición**, para **evitar interrupciones y moderar el uso de la palabra**.
- **Criterios de aceptación:**
  1. **Dado** un profesor que activa `Silenciar chat` (`chat_muted = true`), **cuando** un alumno intenta enviar un mensaje al canal del aula (incluso tras reconectarse), **entonces** el servidor rechaza el mensaje con `403` y notifica el estado `chat:muted` a toda la sala, mientras el profesor conserva permiso de escritura.
  2. **Dado** un profesor que ejecuta `Silenciar a todos` durante una llamada de clase en vivo, **cuando** se procesa la orden, **entonces** el servidor revoca/retiene el permiso de publicación de audio de los alumnos en el servicio de medios e impide que se des-silencien por sí mismos mientras dure el bloqueo.
- **Tareas técnicas:**
  - `[back]` Persistencia de `chat_muted` en `Classroom` verificada en cada envío de mensaje y control de permisos de publicación de audio en el servicio de medios WebRTC desde NestJS.
  - `[front]` Controles docentes de `Silenciar chat` y `Silenciar micrófonos` con estado sincronizado y aviso visual para los alumnos.

### HU-VIV-003 · Llamada de clase en vivo y presentación de pantalla (WebRTC)
- **Trazabilidad:** `RF-VIV-003` · `RN-04`, `RN-10`, `RN-20`
- **Módulo:** `VIV` · **Prioridad:** Should · **Fase:** MVP Extendido · **Repos:** ambos
- **Historia:** Como **`Profesor` o `Alumno`**, quiero **participar en llamadas de voz, videollamadas y presentaciones en vivo dentro del aula**, para **dictar y seguir clases sincrónicas sin depender de herramientas externas**.
- **Criterios de aceptación:**
  1. **Dado** un profesor o alumno con membresía activa en el aula, **cuando** se une a la llamada o presentación en vivo, **entonces** `NestJS` verifica su acceso actual y emite una credencial efímera de corta duración para la sesión del aula en el servicio de medios WebRTC con los permisos correspondientes a su rol.
  2. **Dado** un usuario que cierra sesión o cuya membresía es dada de baja mientras está en llamada, **entonces** es desconectado de inmediato de la sesión de medios.
  3. **Dado** que el servicio de medios falle o no esté disponible, **entonces** el resto del aula (3D/2D, chat y actividades) sigue funcionando y el usuario recibe un mensaje claro.
- **Tareas técnicas:**
  - `[back]` Integración en NestJS con el servicio de medios WebRTC para emisión de tokens de corta duración por aula/rol y revocación al perder acceso.
  - `[front]` Panel de videollamada/voz y pantalla de presentación en vivo integrada en el proyector del Aula 3D y en el Modo 2D Clásico.

### HU-VIV-004 · Pizarrón interactivo colaborativo con gráficos de funciones y LaTeX
- **Trazabilidad:** `RF-VIV-004` · `RN-04`, `RN-10`, `RN-11`, `RN-19`
- **Módulo:** `VIV` · **Prioridad:** Should · **Fase:** MVP Extendido · **Repos:** ambos
- **Historia:** Como **`Profesor` o `Alumno`**, quiero **utilizar un pizarrón colaborativo en tiempo real que permita dibujar, graficar funciones matemáticas y escribir fórmulas en LaTeX, pudiendo el profesor bloquear o habilitar la edición de los alumnos**, para **resolver ejercicios en conjunto durante la clase**.
- **Criterios de aceptación:**
  1. **Dado** un aula con `collaboration_locked = false`, **cuando** el profesor o un alumno realiza trazos en la pizarra, define una función matemática en el graficador o escribe una expresión **LaTeX**, **entonces** el servidor valida el mensaje y sincroniza la actualización en vivo para los demás miembros del aula, renderizando LaTeX de forma segura sin ejecutar HTML.
  2. **Dado** un profesor que activa `Bloquear colaboración` (`collaboration_locked = true`), **cuando** un alumno intenta editar el pizarrón, los gráficos o las fórmulas LaTeX, **entonces** el servidor rechaza la edición en cada mensaje mientras el profesor sigue pudiendo editar.
- **Tareas técnicas:**
  - `[back]` Canal de sincronización colaborativa por aula (Colyseus / CRDT) con validación de tamaño/frecuencia, verificación por mensaje de `collaboration_locked` y guardado opcional de instantáneas (*snapshots*) en NestJS.
  - `[front]` Interfaz de Pizarra Interactiva con lienzo de dibujo, graficador de funciones matemáticas, editor/renderizador seguro de **LaTeX** (`KaTeX`) e interruptor docente de bloqueo de colaboración.

---

## 8. Módulo `BOT` · Bot Guía de Estudio (RAG) y Repaso Diario

### HU-BOT-001 · Subir y habilitar bibliografía docente para el Bot Guía de Estudio
- **Trazabilidad:** `RF-BOT-001` · `RN-01`, `RN-12`, `RN-20`
- **Módulo:** `BOT` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Profesor`**, quiero **seleccionar qué archivos de la bibliografía de mi aula (`StudyMaterial`) están habilitados para el Bot Guía de Estudio**, para **asegurarme de que el asistente de IA responda únicamente sobre el contenido curricular que aprobé**.
- **Criterios de aceptación:**
  1. **Dado** un profesor en su aula, **cuando** sube un documento de estudio y activa su uso para el Bot (`is_bot_enabled = true` / `AllowedMaterial`), **entonces** el backend valida el archivo, lo indexa particionado por el identificador del aula y lo deja disponible para las consultas RAG de ese curso.
  2. **Dado** un documento que el profesor desmarca o da de baja, **cuando** un alumno consulta al Bot inmediatamente después, **entonces** el servidor excluye ese documento de la recuperación RAG sin reutilizar fragmentos previos.
- **Tareas técnicas:**
  - `[back]` Configuración `BotConfig` / `AllowedMaterial` en NestJS e indexación/baja de documentos particionada por `classroom_id` para el motor RAG con Amazon Bedrock.
  - `[front]` Interruptor docente `Habilitado para el Bot Guía` y estado de indexación en el listado de bibliografía del aula.

### HU-BOT-002 · Consultar al Bot Guía de Estudio con citas al material, regla anticopia y bloqueo en exámenes
- **Trazabilidad:** `RF-BOT-002` · `RN-04`, `RN-12`, `RN-13`, `RN-14`, `RN-16`
- **Módulo:** `BOT` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Alumno`**, quiero **hacerle preguntas de estudio al Bot Guía (desde el personaje tutor en 3D o desde el Modo 2D Clásico) recibiendo explicaciones basadas y citadas en el material del profesor**, para **comprender los temas de la materia sin que el bot me resuelva las tareas ni esté activo durante un examen**.
- **Criterios de aceptación:**
  1. **Dado** un alumno matriculado sin examen en curso, **cuando** envía una consulta sobre un tema del curso, **entonces** `NestJS` recupera fragmentos exclusivamente del material habilitado de esa aula, consulta a `Amazon Bedrock` y devuelve una respuesta pedagógica citando el documento fuente.
  2. **Dado** un alumno que pide al Bot la resolución directa de un TP o la respuesta de una pregunta de evaluación, **cuando** el Bot procesa el pedido, **entonces** aplica la regla anticopia orientando con explicaciones o preguntas guía sin entregar la solución, y sin tener acceso en su contexto a las claves de respuesta de las actividades.
  3. **Dado** que hay un `Examen` en curso para el aula según la hora oficial del servidor, **cuando** el alumno intenta consultar al Bot (o si había una consulta en vuelo al iniciar el examen), **entonces** el servidor bloquea la respuesta e informa que el Bot está deshabilitado durante exámenes.
- **Tareas técnicas:**
  - `[back]` Servicio RAG en NestJS con invocación IAM a Amazon Bedrock, filtro estricto por `classroom_id` + `AllowedMaterial`, verificación de examen en curso por reloj del servidor, exclusión de claves de respuestas, *rate limiting* y prompt de sistema anticopia de solo lectura.
  - `[front]` Ventana de conversación con el Bot Guía de Estudio con visualización de fuentes citadas, estados de carga, aviso de bloqueo por examen en curso y manejo de errores.

### HU-BOT-003 · Recibir el Repaso Diario y responder la pregunta diaria para sumar racha
- **Trazabilidad:** `RF-BOT-003` · `RN-08`, `RN-13`, `RN-14`, `RN-15`, `RN-16`
- **Módulo:** `BOT` · **Prioridad:** Must · **Fase:** MVP Core · **Repos:** ambos
- **Historia:** Como **`Alumno` (o `Profesor`)**, quiero **recibir en mi primera conexión del día un Repaso Diario con mis pendientes y novedades, y como `Alumno` responder una pregunta diaria de repaso sobre el material del aula**, para **organizar mi jornada y sumar mi hito diario de racha de estudio**.
- **Criterios de aceptación:**
  1. **Dado** un usuario (con rol distinto de `Padre / Tutor`) en su primera conexión autenticada del día según `America/Argentina/Buenos_Aires`, **cuando** ingresa a la aplicación, **entonces** el servidor registra atómicamente `DailyReviewDelivery (user_id, local_date)` y presenta el Repaso Diario una única vez en el día, sin repetirlo al recargar ni cambiar de pestaña.
  2. **Dado** un alumno que responde correctamente la pregunta diaria de repaso generada sobre la bibliografía habilitada del aula, **cuando** el servidor valida la respuesta, **entonces** acredita el hito académico diario en su `Streak` (máximo 1 por día local).
  3. **Dado** que Amazon Bedrock falle o demore más del tiempo límite, **entonces** el servidor entrega automáticamente un resumen estructurado sin texto generativo basado en las actividades, notas y avisos persistidos en PostgreSQL.
- **Tareas técnicas:**
  - `[back]` Servicio de Repaso Diario con corte en `America/Argentina/Buenos_Aires`, inserción atómica en `DailyReviewDelivery`, fallback estructurado sin IA y endpoint de validación de pregunta diaria conectado al servicio de `Streak`.
  - `[front]` Modal/panel de Repaso Diario al iniciar la jornada con tarjeta interactiva de pregunta de repaso y feedback de incremento de racha.

### HU-BOT-004 · Auditoría docente de consultas frecuentes al Bot (`BotConversationLog`)
- **Trazabilidad:** `RF-BOT-004` · `RN-01`, `RN-04`, `RN-14`
- **Módulo:** `BOT` · **Prioridad:** Should · **Fase:** MVP Extendido · **Repos:** ambos
- **Historia:** Como **`Profesor`**, quiero **consultar un resumen de auditoría pedagógica con los documentos y temas más consultados por mis alumnos al Bot Guía de Estudio**, para **detectar qué contenidos del programa resultan más difíciles y reforzarlos en clase**.
- **Criterios de aceptación:**
  1. **Dado** un profesor en el panel de su aula, **cuando** abre el reporte de actividad del Bot Guía, **entonces** visualiza las estadísticas de consultas realizadas en su aula y los materiales de `StudyMaterial` más referenciados.
  2. **Dado** un profesor o alumno que intenta consultar registros de auditoría del Bot pertenecientes a otra aula, **entonces** el servidor rechaza la petición con `403` o `404`.
- **Tareas técnicas:**
  - `[back]` Registro de metadatos de interacción en `BotConversationLog` (`BotConversation`) y endpoint docente de agregación de consultas y bibliografía citada por aula.
  - `[front]` Vista docente de métricas y temas frecuentes consultados al Bot dentro del panel del aula.

---

## 9. Resumen del Catálogo de Historias de Usuario (v0.2)

| Prefijo | Módulo | Historias (`HU`) | `Must` | `Should` | `MVP Core` | `MVP Extendido` |
| --- | --- | --- | --- | --- | --- | --- |
| **`AUT`** | Autenticación, Perfiles y Cuentas | 4 (`HU-AUT-001` a `004`) | 3 | 1 | 3 | 1 |
| **`AUL`** | Aulas, Escuelas, Membresías y Roles | 5 (`HU-AUL-001` a `005`) | 4 | 1 | 4 | 1 |
| **`ESP`** | Espacio 3D, Avatar, Pupitres y Modo 2D Clásico | 4 (`HU-ESP-001` a `004`) | 3 | 1 | 4 | 0 |
| **`ACT`** | Actividades, TPs, Exámenes, Entregas y Calificaciones | 6 (`HU-ACT-001` a `006`) | 4 | 2 | 5 | 1 |
| **`GAM`** | Puntos Ponderados, Racha, Medallas, Tienda y Mascota | 5 (`HU-GAM-001` a `005`) | 3 | 2 | 3 | 2 |
| **`COM`** | Comunicación del Aula, Avisos, Chat y Foro | 4 (`HU-COM-001` a `004`) | 3 | 1 | 4 | 0 |
| **`VIV`** | Herramientas de Clase en Vivo | 4 (`HU-VIV-001` a `004`) | 1 | 3 | 0 | 4 |
| **`BOT`** | Bot Guía de Estudio (RAG) y Repaso Diario | 4 (`HU-BOT-001` a `004`) | 3 | 1 | 3 | 1 |
| **Total** | **8 módulos del dominio escolar** | **36 historias** | **24** | **12** | **26** | **10** |
