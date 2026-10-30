# Proyecto Final — Plataforma de Aulas Virtuales 3D para Escuelas

> **Documento maestro del proyecto** · IntegrarTEC 2026 — Programación Web con IA aplicada  
> **Alcance documental:** aquí se describe **qué tendrá el producto**, sus decisiones estructurales y cómo se verificará el cumplimiento del proyecto integrador. Las reglas específicas de cada módulo se desarrollarán por separado en `rules/`.

### Control de versiones

| Versión | Fecha | Autor | Cambios principales |
|---|---|---|---|
| 0.1 | 2026-10-22 | Equipo | Documento maestro inicial y alcance arquitectónico base. |
| 0.2 | 2026-10-26 | Luis Calegari | Alineación con la ERS (`docs/functional-requirements.md`): modelo de Oficinas y Habitaciones, matriz de roles por oficina sin Superadmin, invitaciones por enlace único con vencimiento, chat de oficina/habitación para MVP y bot de IA acotado a consultas y resúmenes. |
| 0.3 | 2026-10-30 | Agustin Tabarcache | Cambio de nicho a educación: escuelas, profesores, alumnos y padres. Se reemplazan Oficinas/Habitaciones, Kanban, tareas genéricas y reuniones por aulas, actividades (TP y exámenes), calificaciones, puntos y tienda, mascota, herramientas de clase en vivo y modo 2D clásico. Bot con RAG sobre material aprobado. División del MVP en núcleo y extendido. |

## 1. Visión y objetivo

Aplicación web de **aulas virtuales tridimensionales para escuelas**, presentada desde una **cámara isométrica**. Profesores, alumnos y padres se organizan en escuelas y aulas; profesores y alumnos se representan mediante avatares personalizables, se desplazan por el aula y acceden a las herramientas educativas mediante interacciones con el entorno.

El valor central es facilitar la enseñanza, el seguimiento y la participación en un espacio compartido con presencia social, **no crear un MMO ni un videojuego competitivo**. Los elementos de juego (puntos, tienda, racha, mascota) existen para motivar la participación en la actividad escolar. La ambientación concreta se especifica en `rules/art-direction.md`.

El producto combinará escuelas y aulas virtuales persistentes; actividades con calificaciones; comunicación y avisos; seguimiento del desempeño; herramientas de clase en vivo; economía de puntos; y un asistente de IA que guía el estudio sobre el material aprobado por el profesor.

### 1.1 Usuarios y problema

- **Usuarios objetivo:** profesores independientes, escuelas (dueños/administradores y profesores), alumnos y padres o tutores.
- **Problema:** la enseñanza a distancia o híbrida suele repartirse entre herramientas dispersas (videollamadas, mensajería, planillas de notas, carpetas de archivos) que no reflejan la presencia del grupo, resultan poco motivadoras para el alumno y dificultan el seguimiento por parte del profesor y la familia.
- **Propuesta:** un aula navegable donde el profesor dicta la clase, publica material, propone actividades, califica y modera; el alumno participa, entrega y gana puntos; y el padre sigue el progreso de su hijo con una vista simple. Quien prefiera una interfaz convencional dispone de un **modo 2D clásico** equivalente.

## 2. Alcance funcional del producto

### 2.1 Escuelas, profesores y aulas

Al registrarse se elige entre **dos caminos de organización**:

| Camino | Estructura | Quién lo usa |
|---|---|---|
| **Profesor independiente** | Profesor → aulas | Un docente que dicta por su cuenta y crea sus propias aulas. |
| **Escuela** | Escuela → profesores → aulas | Una institución cuyo Dueño/Admin invita profesores, y estos gestionan sus aulas. |

- El **aula** es el espacio persistente del producto: agrupa a su profesor, alumnos, material, actividades, chat, tablón de anuncios y mascota. Existe independientemente de si hay avatares conectados; la presencia es temporal.
- Cada aula tiene **una mascota** propia.
- El acceso al aula se verifica siempre en el servidor según la membresía del usuario.
- **Distinción técnica importante:** un aula almacenada en PostgreSQL no equivale necesariamente a una instancia `Room` de Colyseus. Esta última gestiona la sesión de tiempo real asociada al aula y sus usuarios conectados.
- **Incorporación por invitación por email:** profesores, alumnos y padres se suman mediante invitaciones enviadas por correo (ver 2.2).

### 2.2 Roles, permisos e invitaciones

- **Sin Superadministrador global:** los roles se gestionan dentro de cada escuela o, para el profesor independiente, dentro de sus propias aulas.
- **Roles:** Dueño/Admin de escuela, Profesor, Alumno y Padre.
- Un **padre puede tener varios hijos** vinculados.
- **Modo educación de adultos:** los alumnos usan su propio email y el rol Padre queda deshabilitado (el área de padres es intencionalmente pequeña).
- Validación estricta en backend: cada endpoint HTTP o mensaje de red verifica membresía y permisos. Un usuario no puede acceder ni modificar recursos ajenos manipulando identificadores.

| Capacidad | Dueño/Admin | Profesor | Alumno | Padre |
|---|---|---|---|---|
| Gestionar escuela, invitar profesores y transferir/eliminar la escuela | Sí (Dueño; Admin según delegación) | No | No | No |
| Crear y configurar aulas propias | Sí | Sí | No | No |
| Invitar alumnos y padres a un aula | Sí | Sí | No | No |
| Publicar material, anuncios y actividades; calificar | Sí | Sí (en sus aulas) | No | No |
| Moderar chat y controlar el aula (congelar, silenciar, bloquear) | Sí | Sí (en sus aulas) | No | No |
| Configurar el bot y el material permitido | Sí | Sí (en sus aulas) | No | No |
| Ver métricas de actividad de alumnos | Sí | Sí (en sus aulas) | Solo las propias | Solo las de su hijo |
| Ver y entregar actividades, ver notas, usar tienda | No | No | Sí | Notas de su hijo |
| Chatear con compañeros | No | Sí | Sí | No |
| Mensajes con el profesor | No | Sí | Sí | Sí (profesor e hijo) |

### 2.3 Herramientas del profesor

- Ver qué hizo cada alumno: trabajos completados y pendientes, y su nivel de actividad.
- Subir archivos (PDF, imágenes y otros) como material del aula.
- **Tablón de anuncios** del aula y **@menciones** a alumnos.
- Cargar actividades y revisarlas de forma cómoda; cargar calificaciones.
- Moderar el chat y disponer de su historial.
- Configurar el bot: material permitido (ver sección 4).
- Controles de clase (ver 2.8).

### 2.4 Funciones del alumno

- Ver actividades pendientes, material subido y calificaciones.
- Ver medallas, puntos y racha; usar la tienda.
- Interactuar con compañeros mediante chat abierto entre alumnos (moderado por el profesor) y @menciones.
- Entregar actividades y consultar al bot.

### 2.5 Vista de padres

Interfaz lo más simple posible:

- Notificaciones sobre el estado de su hijo, **dentro de la aplicación y por email**.
- Calificaciones de su hijo.
- Mensajes con el profesor y con su hijo.

### 2.6 Actividades y calificaciones

- **Tipos:** trabajo práctico/tarea (TP) y examen.
- **Formatos:** entrega de archivo y opción múltiple.
- El profesor crea, publica y revisa entregas; carga la **calificación**, que se convierte en **puntos ponderados por tipo** (un examen vale más que un TP).
- Estados visibles para alumno y profesor: pendiente, entregada, calificada.
- **Métrica de nivel de actividad:** tiempo conectado, entregas y participación.
- Los exámenes bloquean al bot mientras están en curso (ver sección 4).

### 2.7 Puntos, tienda, racha, mascota y minijuegos

- **Moneda única de puntos**, obtenida por calificaciones de actividades.
- Los puntos compran **ítems del aula** (juegos, mejoras) y **accesorios de la mascota**. Los ítems deben aportar funcionalidad real.
- **Racha de conexión:** cuenta solo cuando ocurre una actividad real, no por el mero inicio de sesión.
- **Mascota:** una por aula, con accesorios comprados con puntos; es un elemento de motivación y no está vinculada al bot IA.
- **Minijuegos del aula** (por ejemplo Tetris, Pong): no pueden jugarse durante la clase; el profesor los deshabilita cuando quiera.
- **Medallas** por logros.

### 2.8 Controles de aula y herramientas en vivo

Controles del profesor:

- **Congelar:** envía a cada avatar a su asiento y lo bloquea allí.
- **Silenciar el chat** y **silenciar a todos**.
- **Bloquear la colaboración** en pizarra, gráficos y LaTeX.
- **Deshabilitar los minijuegos**.

Herramientas de clase en vivo:

- **Videollamadas y llamadas de voz**, y **presentaciones en vivo**.
- **Pizarra, herramienta de gráficos y LaTeX colaborativos.**

### 2.9 Modo 3D y modo 2D clásico

Tanto el profesor como el alumno pueden **alternar entre el mundo 3D y una interfaz 2D clásica**. El modo 2D da acceso a las mismas funciones esenciales (actividades, material, chat, notas, tienda, bot) sin depender del escenario 3D.

### 2.10 Objetos y elementos interactuables

Los siguientes son **ejemplos, no una lista cerrada**. Se podrán incorporar nuevos objetos sin cambiar el concepto general del producto.

| Elemento de ejemplo | Interacción o funcionalidad posible |
|---|---|
| Pizarra | Pizarra colaborativa, gráficos y LaTeX; presentaciones en vivo. |
| Escritorio del profesor | Cargar actividades, revisar entregas y calificar. |
| Pupitre del alumno | Ver actividades pendientes y entregar. |
| Estantería o carpeta | Material subido por el profesor. |
| Cartelera | Tablón de anuncios del aula. |
| Boletín o libro de notas | Calificaciones, puntos y medallas. |
| Tienda | Comprar ítems del aula y accesorios de la mascota. |
| Mascota | Ver la mascota del aula y sus accesorios. |
| Bot tutor | Conversar con el bot IA (guía de estudio). |
| Consola o máquina de juegos | Minijuegos (deshabilitables por el profesor). |
| Puertas y accesos | Entrar o salir del aula con control de permisos. |
| Pantalla o proyector | Videollamada y presentación en vivo. |

**Separación visual y funcional:** Three.js representa la escena 3D, detecta selecciones e interacciones con los objetos y comunica la intención a la aplicación. **React implementa las interfaces de los elementos interactuables cuando corresponda** (formularios, ventanas, paneles, chat, tablas de notas). No toda interacción necesita una interfaz React: una puerta puede ejecutar una transición directamente y un elemento decorativo puede responder con una animación 3D.

Las acciones con efectos de negocio se validan en el backend; interactuar con un objeto no otorga por sí mismo permisos sobre el recurso correspondiente. Los ítems de la tienda deben vincularse a una funcionalidad real del aula.

### 2.11 Movimiento, avatares y presencia

- Cada profesor o alumno dispone de un avatar visible para los demás miembros autorizados que compartan el aula.
- Desplazamiento mediante **WASD** y **mouse**, incluido el desplazamiento por clic a un destino. Las acciones con mouse disponen de equivalentes táctiles. El comportamiento fino de navegación e interacción se define en `rules/`.
- Movimiento en un mundo **3D real**, principalmente sobre superficies transitables, con obstáculos y colisiones.
- Cámara **isométrica** que mantiene la lectura espacial prevista; no se asume cámara libre como requisito inicial.
- El movimiento será fluido en el cliente y sincronizado con otros usuarios mediante Colyseus.
- El servidor validará, en lo necesario, posiciones, acceso al aula y acciones (incluido el bloqueo en asiento por **congelar**); no se guardará un registro de base de datos por cada paso.
- Se contempla reconexión, desaparición de avatares desconectados e interpolación/ajuste visual de los movimientos remotos.
- Los avatares serán personalizables y su configuración persistirá.

### 2.12 Comunicación

- **Chat del aula** abierto entre alumnos; el profesor lo modera y dispone del historial. El profesor puede silenciarlo.
- **@menciones** con notificación al mencionado.
- Mensajes entre padre, profesor e hijo.
- Presencia en tiempo real de los integrantes conectados.
- Notificaciones dentro de la aplicación y, para padres, también por email.

## 3. Experiencia y dirección visual

### 3.1 Entorno tridimensional isométrico

- **Representación:** escenas tridimensionales con geometría, modelos, materiales, iluminación y animaciones 3D.
- **Tecnología principal:** **Three.js**, integrada en una aplicación **React**. **React Three Fiber** permite organizar declarativamente la escena Three.js desde React.
- **Cámara:** perspectiva isométrica, con proyección ortográfica y encuadre definido en `rules/`.
- **Referencia de estética:** el lenguaje visual 3D de **Pokémon Pokopia** como referencia general de tono, claridad y legibilidad; no se copiarán personajes, modelos ni recursos del juego.
- **Dirección artística detallada:** se especifica en `rules/art-direction.md`, sin fijar aquí paleta, proporciones, materiales ni características particulares.
- Se mantiene la personalización de avatares; al adoptar 3D se descarta el sistema anterior de sprites y variantes por orientación.

### 3.2 Interfaz y accesibilidad

- React renderiza navegación, autenticación y las interfaces funcionales de los objetos cuando se necesiten.
- Las interacciones pueden abrir paneles, modales o overlays sin salir del aula.
- El usuario recibe feedback contextual de lo que puede utilizar; las interacciones por mouse deben tener un equivalente táctil.
- La accesibilidad de las funciones esenciales queda satisfecha por el **modo 2D clásico** (ver 2.9): todo lo esencial puede utilizarse sin apuntar con el mouse a un objeto 3D, con acceso por teclado y lectura convencional.
- El escenario y las interfaces serán utilizables mediante mouse y entradas táctiles equivalentes. Se adaptarán a celulares y pantallas táctiles; gestos, disposición y rendimiento se especifican en `rules/`. WASD se mantiene en dispositivos con teclado.

## 4. Bot con inteligencia artificial

El bot forma parte del mundo como un personaje propio (el tutor del aula), independiente de la mascota, y también está disponible desde el modo 2D. Funciona como **guía de estudio**: responde consultas sobre el material del aula y orienta al alumno sin resolverle las tareas.

**Capacidades y reglas del bot:**

- **RAG sobre material aprobado por el profesor:** el bot responde únicamente a partir del material que el profesor habilitó para el aula. El profesor configura qué material está permitido (sin horario).
- **Bloqueo en exámenes:** el bot no está disponible mientras un examen esté en curso.
- **Regla anticopia:** actúa como guía y nunca entrega soluciones de actividades.
- **Sin modificaciones directas en la base de datos**, para acotar la superficie de riesgo en la entrega inicial.
- **Evolución futura:** acciones autónomas mediante tools sujetas a confirmación explícita.

### 4.1 Repaso diario en la primera conexión

En la **primera conexión autenticada de cada día**, el bot presentará proactivamente un repaso diario personalizado a **todos los roles excepto Padre**. Podrá incluir:

- Actividades pendientes y próximas a vencer.
- Calificaciones y avisos recientes del aula.
- Repaso de contenidos del material permitido.
- Propuestas de siguientes pasos, sin ejecutar modificaciones no solicitadas.

La aplicación identificará que se trata de la primera conexión del día mediante un registro persistente por usuario y fecha, según la zona horaria **America/Argentina/Buenos_Aires (Argentina)**. La rutina no debe repetirse con cada recarga, cambio de sala o reconexión durante el mismo día. Debe prever indisponibilidad del proveedor de IA: se podrá mostrar un resumen estructurado sin generación de texto. Se evitarán repeticiones concurrentes mediante una verificación atómica o mecanismo equivalente.

### 4.2 Integración y seguridad

El bot utiliza un servicio de IA coordinado por NestJS. Las claves del proveedor se almacenan solo en el servidor; se aplican autenticación, autorización contextual, límites de consumo y manejo de errores. La inferencia se realiza con **Amazon Bedrock** desde NestJS, mediante credenciales y permisos IAM del servidor. Para el RAG se contempla **Amazon Bedrock Knowledge Bases o equivalente** (candidato, a confirmar y justificar en `docs/technical-justification.md` para R6). La IA **no elude las reglas de acceso**: solo recupera material del aula a la que pertenece el usuario y que el profesor haya permitido.

## 5. Stack y responsabilidades técnicas

| Área | Tecnología | Responsabilidad |
|---|---|---|
| Aplicación web | **React + TypeScript + Vite** | Shell, navegación, autenticación y UI de funciones (incluido el modo 2D clásico). |
| Mundo virtual | **Three.js** | Renderizado 3D isométrico, modelos, cámara, animaciones e interacciones. |
| Integración declarativa 3D | **React Three Fiber** | Organización de escenas Three.js desde React. |
| Estilos/componentes | **Tailwind CSS + shadcn/ui** | Paneles y formularios de la aplicación. |
| Estado cliente | **Zustand** | Estado de UI, interacciones y preferencias locales. |
| Datos API | **TanStack Query** | Consultas, caché e invalidación de datos persistentes. |
| API y negocio | **NestJS + TypeScript** | REST, auth, permisos, CRUD de actividades y calificaciones, y herramientas IA. |
| Multijugador | **Colyseus** | Sesiones de aula, presencia, movimiento y estado sincronizado. |
| Tiempo real adicional | **Socket.IO (uso puntual)** | Solo funcionalidades independientes para las que resulte técnicamente necesario; no sustituye a Colyseus. |
| Base de datos | **Amazon RDS for PostgreSQL** | Persistencia de usuarios, escuelas, aulas, actividades, notas, puntos y mensajes. |
| Acceso a datos | **Prisma ORM** | Consultas, relaciones y migraciones sobre PostgreSQL alojado en RDS; Prisma **no es** la base de datos. |
| Repositorios | **Frontend:** `Agustin742/integratec-final-front`; **backend:** `Agustin742/integratec-final-back`. | Repositorios independientes, con CI, build y responsabilidad de despliegue propios. La distribución y propiedad de contratos entre repositorios siguen pendientes de decisión. |
| IA | **Amazon Bedrock + herramientas NestJS** | Inferencia del bot (guía de estudio). |
| RAG | **Bedrock Knowledge Bases o equivalente** *(candidato, a definir)* | Recuperación sobre material aprobado por el profesor. |
| Video y voz | **Servicio de medios WebRTC** *(a definir; candidatos: LiveKit, Amazon Chime SDK)* | Videollamadas, llamadas de voz y presentaciones en vivo. |
| Sincronización colaborativa | **Colyseus o un CRDT como Yjs** *(candidato, a definir)* | Pizarra, gráficos y LaTeX colaborativos con bloqueo de colaboración. |
| Renderizado de LaTeX | **KaTeX** *(candidato, a definir)* | Fórmulas matemáticas en la herramienta LaTeX. |
| Correo electrónico | **Amazon SES** *(candidato, a definir)* | Invitaciones y notificaciones por email a padres. |
| Formularios y validación | **React Hook Form + Zod** | Formularios React y validación de entradas; el backend vuelve a validar. |
| Sonido | **Librerías de audio web** | Efectos y control de reproducción del entorno. |
| Pruebas | **Vitest + Playwright** | Pruebas unitarias/integración y recorridos end-to-end. |
| Calidad de código | **ESLint + Prettier** | Análisis estático y formato. |
| Automatización | **GitHub Actions** | Ejecución de lint, tests y pipeline de despliegue. |
| Infraestructura | **AWS** | Frontend, servicios persistentes, datos, archivos, identidad de servicios y observabilidad. |
| Infraestructura como código | **Terraform** | Definición versionada y revisable de los recursos AWS; estado remoto en S3 y planes revisados antes de aplicar. Vive en el repositorio backend. |

Las filas marcadas como *candidato* o *a definir* no constituyen decisiones tomadas; se resolverán y justificarán en `docs/technical-justification.md`.

## 6. Arquitectura general actualizada

### 6.1 Componentes

```text
                       NAVEGADOR (React + Vite)
  ┌──────────────────────────────────────────────────────┐
  │ React: autenticación, paneles, actividades, chat, 2D  │
  │ Three.js: aula 3D, cámara isométrica, avatares        │
  │ Estado cliente + cliente HTTP + SDK de Colyseus      │
  │ Cliente de medios (video/voz)                         │
  └───────┬───────────────────┬───────────────┬──────────┘
          │ HTTPS / REST      │ WSS / Colyseus│ WebRTC
          ▼                   ▼               ▼
 ┌────────────────┐  ┌─────────────────────┐  ┌──────────────┐
 │ NestJS API     │  │ Servidor Colyseus   │  │ Servicio de  │
 │ Auth / roles   │  │ Instancias de Room  │  │ medios       │
 │ Escuelas/aulas │  │ Estado sincronizado │  │ (a definir)  │
 │ Actividades    │  │ Avatares / presencia│  │ Video / voz  │
 │ Chat / avisos  │  │ Congelar / controles│  └──────────────┘
 │ Bot IA / RAG   │  └──────────┬──────────┘
 └───────┬────────┘             │
         │                      │
         ├── contratos lógicos dentro del backend ──┤
         │                      │
         ▼                      ▼
  RDS PostgreSQL         Estado efímero por Room
         │               (sin DB por movimiento)
         ├── S3: material/archivos/assets
         ├── Amazon Bedrock (y RAG) desde NestJS
         └── Amazon SES: email (a definir)
```

**Decisión de separación:** NestJS y Colyseus son responsabilidades lógicas distintas y, de inicio, **servicios desplegables separados**. Colyseus no reemplaza la API REST ni PostgreSQL. Los contratos lógicos entre NestJS y Colyseus pertenecen al backend; la distribución y propiedad de contratos necesarios entre los repositorios frontend y backend siguen sin decidirse. Para coordinar operaciones persistentes, Colyseus utilizará contratos y servicios de aplicación seguros; nunca confiará en permisos aportados solo por el cliente. La integración específica entre ambos servicios se documentará en `rules/architecture.md`.

### 6.2 Canales y propiedad de los datos

| Información o acción | Autoridad principal | Canal habitual |
|---|---|---|
| Registro, login, roles, invitaciones | NestJS / PostgreSQL | REST/HTTPS |
| CRUD de aulas, actividades, entregas y calificaciones | NestJS / PostgreSQL | REST/HTTPS |
| Puntos, tienda y racha | NestJS / PostgreSQL | REST/HTTPS |
| Historial de mensajes y anuncios | NestJS / PostgreSQL | REST/HTTPS |
| Posición de avatares y presencia | Colyseus (estado de aula) | Colyseus/WSS |
| Entrada, salida y reconexión | Colyseus + verificación de permisos | Colyseus/WSS |
| Controles de aula (congelar, silenciar, bloquear colaboración, desactivar juegos) | Colyseus, tras verificar rol de profesor | Colyseus/WSS |
| Estado persistente de ítems del aula | NestJS / PostgreSQL | REST; difusión a clientes cuando corresponda |
| Notificación de cambio en un aula activa | Colyseus, tras confirmar la operación | Colyseus/WSS |
| Consultas y acciones del bot | NestJS + proveedor IA | HTTPS; eventos si se necesita actualización en vivo |
| Mensajería en vivo | Colyseus en aulas activas o canal dedicado justificado | Colyseus/WSS por defecto |
| Video y voz | Servicio de medios (a definir); NestJS emite credenciales de acceso | WebRTC |
| Pizarra/gráficos/LaTeX colaborativos | Colyseus o CRDT (a definir) | WSS |
| Email de invitaciones y notificaciones | NestJS vía servicio de correo (a definir) | API del servicio de correo |

**Eventos y contratos ilustrativos (no definitivos):** `avatar:input`, `avatar:state`, `presence:changed`, `classroom:joined`, `classroom:frozen`, `chat:message`, `chat:muted`, `mention:created`, `activity:published`, `grade:published`, `points:changed`, `whiteboard:update`, `notification:created`, `bot:summary-ready`. Los cambios de datos persistentes ocurren primero a través de la autoridad de negocio y luego se difunden; se evitarán escrituras duplicadas o mensajes que no correspondan al estado confirmado.

**Colyseus:** se emplean sus Rooms, estado sincronizado y mecanismos de conexión/reconexión. El cliente recibe estado y cambios del servidor, y los renderiza con Three.js. La sincronización multijugador se separa de la representación gráfica y del UI de React. La identificación de un aula persistente y de una instancia activa debe estar controlada por el servidor.

**Socket.IO:** se admite únicamente para casos puntuales que requieran un canal separado de Colyseus. No se duplica la sincronización multijugador ni se instala por defecto.

### 6.3 Autenticación entre servicios

- NestJS valida las credenciales y gestiona las sesiones con expiración.
- El ingreso a una instancia Colyseus requiere una identidad verificable y autorización para el aula asociada.
- Las operaciones en NestJS y los mensajes/acciones recibidos en Colyseus aplican controles de permisos coherentes; los controles de aula solo los ejecuta el profesor del aula.
- Se separan los roles globales (si se implementan) de las membresías y permisos particulares de una escuela o aula.
- El backend debe responder correctamente **401** ante ausencia/invalidación de autenticación y **403** ante falta de permisos en endpoints HTTP protegidos. Los rechazos de conexión/mensajes de Colyseus deben representar los mismos principios, aunque no necesariamente tengan códigos de respuesta HTTP equivalentes.

### 6.4 Modelo de información (general)

Entidades del dominio: `School`, `User`, `Session`, `AvatarConfiguration`, `SchoolMember`, `Classroom`, `ClassroomMember`/`Enrollment`, `ParentLink`, `Invitation`, `Material`, `Activity`, `Question`/`Option`, `Submission`, `Grade`, `PointsTransaction`, `ShopItem`, `ClassroomItem`, `Pet`/`PetAccessory`, `Streak`, `Announcement`, `Message`, `Mention`, `Notification`, `BotConfig`/`AllowedMaterial`, `BotConversation`, `DailyReviewDelivery`, `ActivityMetric`.

Las relaciones esenciales incluyen usuario↔escuelas y aulas mediante membresía, escuela→aulas, aula→material/actividades/mensajes/ítems/mascota, actividad→entregas→calificación→puntos, y padre→hijos mediante `ParentLink`. Esta lista es **general**; el modelo relacional, sus restricciones y atributos se definirán en `rules/data.md`.

**No son filas persistentes por defecto:** cada frame del movimiento, posiciones transitorias, conexiones activas o estados interpolados de avatares. El tiempo conectado se agrega como métrica, no como registro por instante.

## 7. Integración y despliegue en AWS

AWS aloja y conecta **las mismas tecnologías elegidas para el producto**: el navegador ejecuta React y Three.js; NestJS conserva las reglas de negocio; Colyseus conserva las sesiones multijugador; RDS ejecuta PostgreSQL; Bedrock atiende la IA. Los servicios de AWS no reemplazan estas herramientas, sino que aportan alojamiento, networking, persistencia y operación. El servicio de medios para video/voz y el servicio de correo siguen **pendientes de decisión** (ver sección 5).

### 7.1 Topología

```text
                     Usuario (navegador / celular)
                                 │
          ┌──────────────────────┴──────────────────────┐
          │ HTTPS                                      │ HTTPS / WSS
          ▼                                            ▼
   AWS Amplify Hosting                      Application Load Balancer
   React + Vite + Three.js                   Certificado TLS (ACM)
   React Three Fiber + UI                     │
          │                           ┌───────────────┴─────────────────┐
          │                           ▼                                 ▼
          │                   ECS / Fargate                        ECS / Fargate
          │                   NestJS API                           Colyseus
          │                   REST / Auth / IA                     Rooms / estado vivo
          │                           │                                 │
          │                           ├──── autorización / eventos ─────┤
          │                           │
          │                 ┌─────────┼───────────────┬─────────────┐
          │                 ▼         ▼               ▼             ▼
          │             RDS PG      Bedrock        Amazon S3     Amazon SES
          │             (datos)    (bot IA/RAG)   (material)    (email, a definir)
          │
          ├── WebRTC ──► Servicio de medios (video/voz, a definir)
          └── Descarga assets web/3D públicos desde hosting o S3 según corresponda

   Amazon ECR: imágenes Docker de NestJS y Colyseus
   AWS Secrets Manager: secretos y credenciales de los servicios
   IAM: permisos mínimos de ECS para Bedrock, RDS/S3/SES y otros servicios
   CloudWatch: logs, métricas y alarmas; AWS Budgets: control de costos
   GitHub Actions: tests, build y publicación a Amplify / ECR / ECS
```

### 7.2 Rol de cada servicio y conexión entre componentes

| Servicio AWS | Qué ejecuta o almacena | Cómo se conecta al proyecto |
|---|---|---|
| **Amplify Hosting** | Build estática de React + Vite, que incluye la aplicación Three.js/R3F, el modo 2D y paneles React. | Sirve por HTTPS los archivos del frontend; el navegador consume la API NestJS y abre sesiones Colyseus. |
| **Application Load Balancer (ALB)** | Entrada pública HTTPS y conexiones WebSocket seguras (WSS). | Enruta rutas de API a un target group de NestJS y rutas de Colyseus a su target group; admite la actualización de HTTP a WebSocket. |
| **ECS con Fargate** | Dos servicios de contenedores Node.js persistentes: NestJS y Colyseus. | Mantiene vivos los procesos y conexiones de aulas; no se utiliza Lambda para hospedar las Rooms. |
| **ECR** | Imágenes Docker versionadas de cada servicio. | GitHub Actions publica las imágenes; ECS despliega las versiones correspondientes. |
| **RDS for PostgreSQL** | Base de datos relacional persistente. | NestJS se conecta por red privada y utiliza Prisma ORM para consultas/migraciones. Colyseus obtiene/verifica datos persistentes a través de la capa de negocio. |
| **Amazon Bedrock** | Inferencia de modelos para el bot y, como candidato, Knowledge Bases para el RAG. | NestJS invoca Bedrock desde el servidor con permisos IAM y ejecuta sus propias herramientas autorizadas. |
| **S3** | Material y archivos subidos (PDF, imágenes), entregas y recursos del mundo 3D que requieran almacenamiento de objetos. | Acceso controlado desde el backend; recursos públicos se entregan con políticas de distribución adecuadas. |
| **Amazon SES** *(candidato, a definir)* | Envío de invitaciones y notificaciones por email. | NestJS lo invoca desde el servidor con permisos IAM; requiere verificación de dominio/remitente. |
| **Servicio de medios WebRTC** *(a definir)* | Video, voz y presentaciones en vivo. | NestJS emite credenciales de acceso por aula; el navegador se conecta por WebRTC. Su alojamiento (servicio administrado o propio) se decidirá en la justificación técnica. |
| **Secrets Manager + IAM** | Secretos de la aplicación y permisos entre servicios. | Credenciales y secretos no quedan en Git ni en el bundle del frontend. |
| **CloudWatch + AWS Budgets** | Registros, observabilidad, alarmas y presupuesto. | Supervisión de fallos, latencia, consumo y costos continuos. |

### 7.3 Flujo completo de uso

1. El usuario entra a la URL pública servida por **Amplify** y descarga React, Three.js, React Three Fiber y demás recursos del cliente.
2. Al registrarse elige su camino (profesor independiente o escuela) o acepta una **invitación por email**. El navegador llama por **HTTPS** a la API **NestJS** a través del **ALB**; NestJS valida la identidad y consulta o modifica los datos en **RDS PostgreSQL** mediante **Prisma**.
3. El profesor crea el aula, sube material a **S3**, configura el material permitido para el bot e invita a alumnos y padres por email.
4. Al entrar al aula (3D o 2D), el cliente solicita conexión a **Colyseus** por HTTPS/WSS. Colyseus valida la identidad y la pertenencia al aula con el backend de negocio y vincula la sesión activa con el aula persistente.
5. **Colyseus** sincroniza movimientos, presencia y estado efímero (incluidos congelar y silenciar); **Three.js** representa estos cambios. No se escriben posiciones de cada fotograma en RDS.
6. El profesor publica actividades; el alumno las ve en su pupitre (o en la vista 2D) y entrega. Las acciones persistentes se envían a **NestJS**, se validan y guardan en **RDS**; el profesor revisa y califica, la nota se convierte en puntos ponderados y se notifica a los clientes conectados por Colyseus. Los padres reciben la notificación en la aplicación y por email.
7. En la primera conexión autenticada del día, para todos los roles salvo Padre, **NestJS** consulta pendientes y novedades en RDS, determina el repaso según **America/Argentina/Buenos_Aires**, invoca a **Bedrock** (con recuperación sobre el material permitido) y entrega el resultado al cliente. El marcador diario persistente evita repetir el repaso ese mismo día.
8. Durante la clase el profesor puede iniciar videollamada o presentación (servicio de medios) y usar pizarra, gráficos y LaTeX colaborativos. Logs y métricas de los servicios se supervisan con **CloudWatch**.

### 7.4 Despliegue, red y operación

- Los repositorios frontend y backend tienen **CI, build y responsabilidad de despliegue independientes**. El frontend produce su build web de React/Vite; el backend produce imágenes Docker para la API NestJS y el servidor Colyseus.
- Cada repositorio administra su propio flujo de **GitHub Actions** y sus verificaciones. La publicación del frontend en Amplify y de las imágenes backend en ECR, seguida de la actualización de ECS, corresponde a sus respectivos flujos; la coordinación entre ellos no presupone un workspace compartido.
- Los recursos AWS se definen y modifican con **Terraform** desde el repositorio backend (`infra/`), sin cambios manuales en la consola sobre recursos gestionados. El detalle está en `rules/infrastructure-as-code.md` del backend.
- El **ALB** termina TLS con certificado de **AWS Certificate Manager**; dirige `/api/*` a NestJS y una ruta/host reservado al servicio Colyseus. Se configuran explícitamente endpoints de matchmaking, conexiones WebSocket y orígenes permitidos sin mezclar los servicios.
- Los servicios ECS tienen **Security Groups** específicos. **RDS permanece en subredes privadas**, accesible solo desde los componentes autorizados. Las tareas ECS usan roles IAM de mínimo privilegio; Bedrock y el servicio de correo se invocan desde NestJS, nunca desde el navegador.
- Las credenciales, claves de sesión y cadenas de conexión se inyectan por configuración segura. El frontend recibe únicamente valores públicos (por ejemplo, URL de API y URL de Colyseus).
- Colyseus inicia con una instancia del servicio para simplificar la coherencia de las Rooms del MVP. La ampliación horizontal exige una estrategia Colyseus compatible de presencia, matchmaking, ruteo y reconexión; no basta con duplicar tareas ECS detrás del balanceador.
- Se mantienen health checks, logs, políticas de reinicio, alarmas y un presupuesto de AWS, porque ECS/Fargate, ALB, RDS y red pueden generar cargos continuos incluso con poco tráfico.
- El desarrollo local usa los mismos componentes de aplicación con contenedores y PostgreSQL local; la prueba y entrega final utiliza los servicios **AWS** descritos y URLs públicas HTTPS/WSS.

## 8. Seguridad y calidad transversal

- Contraseñas almacenadas mediante hash seguro (Argon2 o bcrypt, o servicio de identidad equivalente), jamás en texto plano.
- Tokens o sesiones con vencimiento; protección de rutas y endpoints.
- Verificación de roles, membresía y propiedad de recursos en toda acción relevante; un padre solo accede a datos de sus hijos vinculados.
- Validación de datos en cliente y servidor; ORM y consultas parametrizadas.
- CORS restringido a orígenes autorizados en producción.
- Respuestas públicas sin hashes, claves, trazas internas ni consultas de base de datos.
- Variables sensibles fuera del repositorio; `.env.example` sin valores secretos.
- Estados de carga, vacío y error comprensibles para el usuario.
- Datos de menores: mínimo de información personal, acceso restringido por rol y sin exposición entre aulas ni escuelas.
- Logs, manejo de reconexión, límites de uso de IA y medidas básicas de robustez.
- Pruebas de autenticación, autorización y aislamiento de datos como prioridad.

## 9. Alcance de entrega: MVP y ampliaciones

**Se espera presentar ambos MVP, el núcleo y el extendido.** La división solo establece la **prioridad de construcción**: lo del núcleo se completa primero y lo del extendido se aborda en el orden indicado.

### 9.1 MVP núcleo

El núcleo debe completar **un recorrido utilizable en producción**:

1. Caminos de organización (profesor independiente o escuela), roles e **invitaciones por email**.
2. Aula 3D con avatares y **modo 2D clásico**, con presencia en tiempo real.
3. Chat del aula con moderación, silenciado del chat y @menciones; tablón de anuncios.
4. Subida de material (S3).
5. **Actividades** (TP y examen; entrega de archivo y opción múltiple) con revisión, calificaciones y **puntos ponderados**.
6. Métricas de seguimiento del alumno (tiempo conectado, entregas, participación).
7. **Congelar** y bloqueo en asientos.
8. Racha de conexión.
9. Tienda de puntos con **al menos un ítem de aula funcional**.
10. **Bot de IA**: guía con RAG, bloqueo en exámenes y repaso diario.
11. Vista de padres con calificaciones, mensajes y notificaciones en la aplicación y por email.
12. Cierre de sesión; el sistema impide accesos no autorizados y conserva los datos luego de recargas y reinicios.

### 9.2 MVP extendido (en orden de prioridad)

1. Videollamadas y llamadas de voz, presentaciones en vivo y silenciar a todos.
2. Pizarra, herramienta de gráficos y LaTeX colaborativos, con bloqueo de colaboración.
3. Minijuegos del aula con deshabilitación por el profesor.
4. Mascota del aula y accesorios.
5. Medallas.

### 9.3 Evoluciones futuras

- Acciones autónomas del bot mediante tools con confirmación explícita.
- Más tipos de actividad y formatos de evaluación, y más ítems de tienda.
- Personalización y decoración ampliadas, más objetos interactivos y animaciones.
- Mayor concurrencia, múltiples instancias de servidor y herramientas administrativas.

## 10. Cumplimiento del enunciado IntegrarTEC 2026

Esta sección **traduce los criterios del PDF en verificaciones del proyecto**. La inclusión en el documento **no significa que ya estén implementados**; deben completarse y probarse.

### 10.1 Requisitos obligatorios R1–R8

| Código | Requisito del enunciado | Cómo se cumplirá y comprobará |
|---|---|---|
| **R1** | Frontend, backend y base de datos; al menos **3 entidades relacionadas**, una `User`. | React/Three.js consume NestJS; RDS PostgreSQL persiste usuarios, escuelas, aulas, membresías, actividades, entregas y calificaciones. Revisar diagrama, código y persistencia tras recargar. |
| **R2** | Registro, login, logout, hash, sesión expirable, rutas/endpoints protegidos, **2 roles**, **401/403** y aislamiento entre usuarios. | Autenticación en NestJS y autorización también en Colyseus; roles Profesor y Alumno como mínimo (además de Dueño/Admin y Padre); pruebas directas de API sin token, con rol insuficiente y con IDs ajenos o de otra aula. |
| **R3** | GitHub con historial real de todos, README completo, `.gitignore`, `.env.example` y ningún secreto. | Auditar historial, contribuciones, árbol del repositorio y variables publicadas. |
| **R4** | Frontend/backend con URL pública **HTTPS**, DB en nube, variables de entorno, disponibilidad hasta terminar defensas y credenciales de cada rol. | Desplegar en AWS; verificar acceso externo desde otra red, sesiones WSS y cuentas de prueba para profesor, alumno y padre. |
| **R5** | Flujo principal funcional en producción, **CRUD completo** de entidad asociada al usuario, validación doble y errores/cargas/vacíos visibles. | Demostrar el flujo de **Actividades** (crear, listar, editar, eliminar por el profesor; entrega y calificación) desde el aula, con errores de formulario y persistencia. |
| **R6** | Documento justificando herramientas relevantes, alternativas y concesiones. | Crear `docs/technical-justification.md`: stack principal, autenticación, DB/ORM, despliegue, IA/RAG, servicio de medios, sincronización colaborativa y correo. |
| **R7** | ORM/consultas seguras, CORS adecuado y respuestas sin errores internos ni hashes. | Pruebas de API, revisión de configuración de producción y de DTOs/serialización. |
| **R8** | Defensa en vivo **sobre producción**, con explicación de problema, solución, arquitectura y decisiones; dominio individual del código. | Ensayo con todas las cuentas, demo de control de acceso y participación explicativa de cada integrante. |

**Condición crítica del enunciado:** todos los R1–R8 son obligatorios. **Sin R2 o R4, el trabajo no se considera completo**, aunque otras funciones estén terminadas.

### 10.2 Uso de inteligencia artificial

- **Obligatorio en el proceso:** documentar en el repositorio herramientas de IA usadas, tareas donde ayudaron, **un caso acertado** y **uno que debió corregirse**, incluyendo verificación humana (`docs/ai-usage.md`).
- **Recomendado en el producto:** integrar al menos una funcionalidad que consuma una API de modelo de IA desde el backend. El bot guía y el repaso diario cubrirían esta recomendación si funcionan de verdad en el deploy, con manejo de errores, límites y claves protegidas.
- Todo integrante debe comprender y poder defender el código independientemente de quién o qué lo haya generado.

### 10.3 Recomendaciones valoradas en la evaluación

| Recomendación | Aplicación en el proyecto |
|---|---|
| Video de 3–5 minutos | Mostrar registro, login, flujo principal, roles y producto en funcionamiento; enlace en README. |
| Documentación técnica | Diagrama de arquitectura, entidad-relación, endpoints (Swagger/OpenAPI u otro) y guía local. |
| Tests | Al menos autenticación/autorización; ampliar a CRUD de actividades y flujos de aula. |
| CI/CD | Pipeline de lint/tests y, si es viable, publicación automática. |
| Git colaborativo | Ramas, pull requests, revisiones e issues/tablero. |
| UI de calidad | Responsive, coherencia y accesibilidad básica; el modo 2D clásico cubre la estrategia diferenciada para móvil y accesibilidad. |
| Autenticación avanzada | Recuperación de contraseña, OAuth, verificación de cuenta o límite de intentos, según tiempo. |

### 10.4 Entregables e hitos del curso

| Hito | Entrega solicitada |
|---|---|
| **1 — Propuesta** | Documento de 1–2 páginas: problema, usuarios, roles, MVP, entidades, stack, riesgos, integrantes y repositorio. |
| **2 — Avance** | Autenticación funcionando, **primer deploy**, modelo de datos y revisión docente. |
| **3 — Final y defensa** | MVP en producción, repositorio, README, justificación del stack, declaración de IA, credenciales de prueba y defensa; video/documentación adicional recomendados. |

El **README obligatorio** contendrá al menos: descripción, enlaces de frontend/API, credenciales por rol, funcionalidades, stack, arquitectura, pasos de instalación local, integrantes y aportes, y referencia a la declaración de uso de IA. Las fechas las comunicará el equipo docente.

### 10.5 Checklist de verificación antes de entregar

**Autenticación y permisos**

- [ ] Registro, login y logout funcionan en producción.
- [ ] Contraseñas hasheadas; sesión expira y logout invalida el acceso protegido.
- [ ] Endpoint sin credenciales devuelve 401; rol sin permiso devuelve 403.
- [ ] Alterar un ID no expone datos ajenos (otra aula, otra escuela u otro hijo); respuestas no incluyen hashes.
- [ ] Colyseus rechaza entradas a aulas ajenas y acciones sin autorización (por ejemplo, un alumno intentando congelar el aula).

**Producto y datos**

- [ ] Flujo principal completo y CRUD de actividades demostrable (creación, entrega, calificación y puntos).
- [ ] Datos permanecen tras recarga y reinicio del servidor.
- [ ] Formularios incluyen validación, cargas, vacíos y errores claros.
- [ ] Movimiento e interacción 3D funcionan; React abre interfaces cuando corresponde; el modo 2D clásico ofrece las funciones esenciales.
- [ ] Dos usuarios autorizados comparten un aula y se sincroniza su presencia.
- [ ] El repaso diario se activa una sola vez por día y usuario para los roles distintos de Padre.
- [ ] El bot se bloquea durante un examen y no entrega soluciones.
- [ ] La invitación por email llega y permite unirse al aula con el rol correcto.

**Repositorio, infraestructura y documentación**

- [ ] Commits reales de todos los integrantes y README reproducible.
- [ ] `.env.example` incluido; ningún secreto en archivos ni historial Git.
- [ ] Frontend/API HTTPS y Colyseus WSS accesibles desde otra red.
- [ ] RDS PostgreSQL desplegado en AWS y servicios disponibles durante defensas.
- [ ] Credenciales de prueba válidas para al menos dos roles (Profesor y Alumno).
- [ ] Documento de decisiones técnicas con alternativas y trade-offs.
- [ ] Declaración de uso de IA con caso exitoso y caso corregido.
- [ ] (Recomendado) Tests, video, documentación y pipeline CI/CD.
- [ ] Demo ensayada sobre producción y todos pueden explicar el código.

## 11. Justificación arquitectónica de alto nivel

Esta sección resume el fundamento; la comparación formal requerida por **R6** se desarrollará en `docs/technical-justification.md`.

| Decisión | Motivo en este proyecto | Alternativas y costo principal |
|---|---|---|
| Three.js | Aula **3D real** con cámara isométrica e interacciones espaciales (asientos, pizarra, objetos). | PixiJS 2.5D descartado por cambio de estética; Three.js exige controlar assets, rendimiento, cámara y colisiones. |
| React + Vite | Interfaz interactiva autenticada, paneles independientes del mundo 3D y modo 2D clásico. | Next.js como alternativa; se renuncia a SSR como elemento central. |
| Colyseus | Room lifecycle, estado multijugador autoritativo y sincronización diseñada para aulas (congelar, asientos, presencia). | Socket.IO requeriría implementar más lógica de salas y estado; Colyseus incorpora otro servicio y aprendizaje. |
| NestJS | API estructurada, módulos, validación y autorización del dominio escolar. | Express/Fastify directos como opciones más livianas; NestJS agrega estructura y convenciones. |
| RDS PostgreSQL + Prisma ORM | Relaciones fuertes entre escuelas, aulas, roles, actividades, notas y puntos. | MongoDB/otros ORM; cambios de esquema y migraciones requieren disciplina. |
| AWS con ECS/Fargate | Hospeda procesos persistentes para NestJS y Colyseus. | PaaS administrados o EC2; Fargate/ALB/RDS añaden costo fijo y operación. |
| Amazon Bedrock desde NestJS (RAG: Knowledge Bases o equivalente, a confirmar) | IA gestionada en AWS con IAM y autorización centralizadas en NestJS; el RAG limita al bot al material aprobado. | Llamada directa desde frontend descartada por seguridad; RAG propio con vector store (más control, más operación); dependencia y costos de inferencia de AWS. |
| Servicio de medios WebRTC (LiveKit o Amazon Chime SDK, a definir) | Video, voz y presentaciones sin construir infraestructura WebRTC propia. | Mesh P2P (no escala) o servidor propio (más operación); un servicio administrado añade costo y dependencia. |
| Sincronización colaborativa (Colyseus o Yjs, a definir) | Pizarra, gráficos y LaTeX compartidos con bloqueo del profesor. | Colyseus reutiliza infraestructura existente; un CRDT ofrece mejor resolución de conflictos a costa de otra pieza. |
| Amazon SES (a definir) | Invitaciones y notificaciones por email dentro de AWS. | Proveedores externos de correo; SES exige verificación de dominio y salida del modo sandbox. |

## 12. Roadmap general

| Fase | Objetivo |
|---|---|
| **0** | Repositorio, organización, propuesta del hito 1, reglas mínimas y primer esquema técnico. |
| **1** | Auth, roles (escuela/profesor/alumno/padre), invitaciones por email, modelo relacional, flujo REST, primera versión desplegada (**hito 2**). |
| **2** | Escena Three.js isométrica del aula, avatar, WASD/mouse, acceso básico a aulas y modo 2D clásico. |
| **3** | Servidor Colyseus, sincronización, presencia, control de acceso, reconexión, congelar y controles de aula. |
| **4** | Objetos interactivos y paneles React; material, actividades (CRUD completo), calificaciones y puntos; chat con moderación, @menciones y anuncios. |
| **5** | Bot IA con RAG, bloqueo en exámenes y repaso diario con persistencia y fallback; vista de padres y notificaciones. |
| **6** | Tienda con ítem funcional, racha y métricas (cierre del **MVP núcleo**); pruebas de roles/seguridad, documentación R6 y declaración de IA. |
| **7** | Deploy completo, QA en producción, README, pruebas externas y defensa (**hito 3**). |
| **7+ (priorizado)** | **MVP extendido** en orden: video/voz y presentaciones; pizarra, gráficos y LaTeX; minijuegos; mascota y accesorios; medallas. Se abordan en paralelo o a continuación según capacidad del equipo, siempre sobre un núcleo estable. |

La implementación seguirá entregas incrementales, con despliegue desde etapas tempranas para verificar integración real con AWS.

## 13. Organización documental

Este documento es el **índice conceptual y fuente de decisiones generales**. El detalle técnico y funcional se desarrolla en los archivos de `rules/` y `docs/` de este repositorio (backend). Los archivos marcados como *(frontend)* son responsabilidad del repositorio frontend y **no existen en este repositorio**; los demás reflejan los nombres reales:

```text
master-document.md
rules/
  architecture.md
  3d-world-and-camera.md                (frontend)
  movement-and-interactions.md          (frontend)
  art-direction.md                      (frontend)
  avatars-and-customization.md          (frontend)
  realtime-and-presence.md
  classrooms-and-roles.md
  activities-and-grading.md
  points-and-shop.md
  live-classroom-tools.md
  communication-and-notifications.md    (chat, anuncios, @menciones, mensajes de padres, notificaciones y email)
  ai-bot-and-daily-briefing.md
  data.md
  authentication-and-session.md
  aws-infrastructure.md
  infrastructure-as-code.md
  quality-and-testing.md
docs/
  technical-justification.md
  ai-usage.md
  architecture.md
```

**Seguimiento pendiente:** los archivos `rules/` de este repositorio ya están realineados con el modelo escolar. Los archivos de `docs/` (requisitos funcionales, historias de usuario, decisiones de requisitos, justificación técnica y arquitectura) todavía describen el modelo anterior de oficinas y habitaciones y deben realinearse; hasta entonces, ante contradicción, prevalece este documento maestro.

Los archivos `rules/` desarrollan los detalles de implementación y experiencia sin contradecir este contrato general.
