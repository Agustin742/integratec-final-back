# Proyecto Final — Plataforma de Salas de Convivencia y Organización

> **Documento maestro del proyecto** · IntegrarTEC 2026 — Programación Web con IA aplicada  
> **Alcance documental:** aquí se describe **qué tendrá el producto**, sus decisiones estructurales y cómo se verificará el cumplimiento del proyecto integrador. Las reglas específicas de cada módulo se desarrollarán por separado en `rules/`.

## 1. Visión y objetivo

Aplicación web de **convivencia, comunicación y organización en salas virtuales tridimensionales**, presentada desde una **cámara isométrica**. Los usuarios se representan mediante avatares personalizables, se desplazan por el escenario y acceden a herramientas de productividad mediante interacciones con el entorno.

El valor central es facilitar la organización y la colaboración en un espacio compartido con presencia social, **no crear un MMO ni un videojuego competitivo**. La ambientación concreta se especifica en `rules/direccion-artistica.md`.

El producto combinará salas personales, compartidas y generales; tareas, comunicación, reuniones, interacciones espaciales y un asistente de IA capaz de informar y ejecutar acciones autorizadas.

### 1.1 Usuarios y problema

- **Usuarios objetivo:** personas o grupos que quieren organizar actividades y comunicarse en espacios virtuales compartidos.
- **Problema:** las tareas, mensajes y reuniones suelen estar dispersos entre interfaces inconexas y no reflejan fácilmente la presencia de otras personas.
- **Propuesta:** un entorno navegable desde el que se puedan consultar, gestionar y compartir recursos, sin perder las ventajas de una aplicación web convencional.

## 2. Alcance funcional del producto

### 2.1 Salas

| Tipo de sala | Acceso | Función |
|---|---|---|
| **Personal** | Privada por defecto; visibilidad configurable | Espacio propio, organización personal, avatar y personalización. |
| **Compartida** | Según membresía, permisos o invitación | Colaboración, mensajes, tareas y presencia de integrantes. |
| **General** | Usuarios habilitados | Punto de encuentro, anuncios, reuniones y acceso a otras salas. |

- Una sala personal se crea automáticamente al registrar un usuario.
- Las salas representan **espacios persistentes del producto**, aunque no haya personas conectadas; la presencia de los avatares es temporal.
- El acceso entre salas puede realizarse mediante puertas u otros mecanismos espaciales; el servidor siempre verifica permisos.
- Se podrán crear salas compartidas e invitar a otros usuarios por enlace o código.
- La configuración de privacidad y visibilidad será administrable por quienes tengan los permisos adecuados.
- **Distinción técnica importante:** una sala del producto almacenada en PostgreSQL no equivale necesariamente a una instancia `Room` de Colyseus. Esta última gestiona una sesión de tiempo real asociada al espacio y sus usuarios conectados.

### 2.2 Objetos y elementos interactuables 

Los siguientes son **ejemplos, no una lista cerrada ni un límite de funcionalidades**. Se podrán incorporar nuevos objetos, interacciones y herramientas sin cambiar el concepto general del producto.

| Elemento de ejemplo | Interacción o funcionalidad posible |
|---|---|
| Tablero o corcho | Consultar y administrar tareas; vista Kanban. |
| Teléfono | Mensajes privados. |
| Cartelera | Publicar anuncios, reuniones y confirmaciones. |
| Puertas y accesos | Cambiar de sala con control de permisos. |
| Computadora o pizarra | Abrir chat, notas o herramientas compartidas. |
| Calendario | Revisar eventos, vencimientos y reuniones. |
| Mascota o robot | Iniciar conversaciones y acciones con el bot IA. |
| Indicador de estado | Consultar o actualizar disponibilidad/actividad. |

**Separación visual y funcional:** Three.js representa la escena 3D, detecta selecciones e interacciones con los objetos y comunica la intención a la aplicación. **React implementa las interfaces de los elementos interactuables cuando corresponda** (formularios, ventanas, paneles, chat, Kanban, calendarios y configuraciones). No toda interacción necesita una interfaz React: una puerta puede ejecutar una transición directamente, y un elemento decorativo puede responder con una animación 3D.

Las acciones con efectos de negocio se validan en el backend; interactuar con un objeto no otorga por sí mismo permisos sobre el recurso correspondiente.

### 2.3 Movimiento, avatares y presencia 

- Cada usuario dispone de un avatar visible para los demás miembros autorizados que compartan la sala.
- Desplazamiento mediante **WASD** y **mouse**, incluido el desplazamiento por clic a un destino. Las acciones con mouse disponen de equivalentes táctiles. El comportamiento fino de navegación e interacción se define en `rules/`.
- Movimiento en un mundo **3D real**, principalmente sobre superficies transitables, con obstáculos y colisiones.
- Cámara **isométrica** que mantiene la lectura espacial prevista; no se asume cámara libre como requisito inicial.
- El movimiento será fluido en el cliente y sincronizado con otros jugadores mediante Colyseus.
- El servidor validará, en lo necesario, posiciones, acceso a salas y acciones; no se guardará un registro de base de datos por cada paso.
- Se contempla reconexión, desaparición de avatares desconectados e interpolación/ajuste visual de los movimientos remotos.
- Los avatares serán personalizables y su configuración persistirá.

### 2.4 Comunicación y reuniones

- Chat asociado a salas, con historial persistente según sus reglas de acceso.
- Mensajería privada mediante interfaz contextual, vinculada a interfaces como la del teléfono.
- Reuniones y avisos desde la sala general y otros espacios habilitados; posibilidad de confirmar asistencia.
- Presencia y estados de actividad de los integrantes.

### 2.5 Productividad

- CRUD completo de tareas asociadas a usuarios y/o salas autorizadas.
- Listado y tablero Kanban para organización.
- Fechas, estados y responsables de tareas según las reglas del módulo.
- Calendario y reuniones vinculados a los espacios correspondientes.
- Validación de datos, feedback de errores y actualización de vistas sin perder el contexto del entorno 3D.

### 2.6 Acceso, roles y permisos 

- Registro, inicio de sesión y cierre de sesión.
- Dos niveles de autorización diferenciados como mínimo: **administrador de sala (dueño)** y **miembro**. El alcance exacto de permisos, además de posibles administradores de plataforma o invitados, se especifica en `rules/`.
- Rutas y operaciones privadas protegidas; pertenencia a sala y propiedad de recursos verificadas en el servidor.
- Las salas personales son privadas por defecto. Se contempla visibilidad configurable, acceso directo o solicitud de ingreso.
- Un usuario no puede leer ni alterar recursos ajenos manipulando identificadores o mensajes de red.

## 3. Experiencia y dirección visual

### 3.1 Entorno tridimensional isométrico 

- **Representación:** escenas tridimensionales con geometría, modelos, materiales, iluminación y animaciones 3D.
- **Tecnología principal:** **Three.js**, integrada en una aplicación **React**. **React Three Fiber** permite organizar declarativamente la escena Three.js desde React.
- **Cámara:** perspectiva isométrica, con proyección ortográfica y encuadre definido en `rules/`.
- **Referencia de estética:** el lenguaje visual 3D de **Pokémon Pokopia** como referencia general de tono, claridad y legibilidad; no se copiarán personajes, modelos ni recursos del juego.
- **Dirección artística detallada:** se especifica en `rules/direccion-artistica.md`, sin fijar aquí paleta, proporciones, materiales ni características particulares.
- Se mantiene la personalización de avatares; al adoptar 3D se descarta el sistema anterior de sprites y variantes por orientación.

### 3.2 Interfaz y accesibilidad 

- React renderiza navegación, autenticación y las interfaces funcionales de los objetos cuando se necesiten.
- Las interacciones pueden abrir paneles, modales o overlays sin salir de la sala.
- El usuario recibe feedback contextual de lo que puede utilizar; las interacciones por mouse deben tener un equivalente táctil.
- Las funciones esenciales deben poder utilizarse sin depender exclusivamente de apuntar con el mouse a un objeto 3D; se contempla acceso por teclado o interfaz alternativa.
- El escenario y las interfaces serán utilizables mediante mouse y entradas táctiles equivalentes. Se adaptarán a celulares y pantallas táctiles; gestos, disposición y rendimiento se especifican en `rules/`. WASD se mantiene en dispositivos con teclado.

## 4. Bot con inteligencia artificial

El bot forma parte del mundo como personaje o entidad interactiva; permite conversaciones, consultas y acciones a través de herramientas del backend.

**Capacidades del bot:**

- Responder preguntas y ayudar con la organización dentro del alcance autorizado.
- Consultar tareas, reuniones, anuncios y pendientes relevantes para el usuario.
- Crear, actualizar o completar tareas y realizar otras operaciones **mediante herramientas del servidor**, sujetas a permisos.
- Resumir actividad de conversaciones o espacios a los que el usuario tiene acceso.
- Reaccionar a eventos pertinentes del sistema; la personalidad y representación concreta se definirán luego.

### 4.1 Rutina de repaso del día en la primera conexión 

En la **primera conexión autenticada del usuario de cada día**, el bot presentará proactivamente un repaso diario personalizado. Este podrá incluir:

- Tareas pendientes, prioritarias y próximas a vencer.
- Reuniones o eventos programados para ese día.
- Avisos y novedades relevantes de sus salas autorizadas.
- Propuestas de siguientes pasos, sin ejecutar modificaciones no solicitadas.

La aplicación identificará que se trata de la primera conexión del día mediante un registro persistente por usuario y fecha, según la zona horaria **America/Argentina/Buenos_Aires (Argentina)**. La rutina no debe repetirse con cada recarga, cambio de sala o reconexión durante el mismo día. Debe prever indisponibilidad del proveedor de IA: se podrá mostrar un resumen estructurado sin generación de texto. Se evitarán repeticiones concurrentes mediante una verificación atómica o mecanismo equivalente.

### 4.2 Integración y seguridad

El bot utiliza un servicio de IA coordinado por NestJS. Las claves del proveedor se almacenan solo en el servidor; se aplican autenticación, autorización contextual, límites de consumo y manejo de errores. La inferencia se realiza con **Amazon Bedrock** desde NestJS, mediante credenciales y permisos IAM del servidor. La IA **no elude las reglas de acceso** ni lee automáticamente salas privadas de terceros.

## 5. Stack y responsabilidades técnicas

| Área | Tecnología | Responsabilidad |
|---|---|---|
| Aplicación web | **React + TypeScript + Vite** | Shell, navegación, autenticación y UI de funciones. |
| Mundo virtual | **Three.js** | Renderizado 3D isométrico, modelos, cámara, animaciones e interacciones. |
| Integración declarativa 3D | **React Three Fiber** | Organización de escenas Three.js desde React. |
| Estilos/componentes | **Tailwind CSS + shadcn/ui** | Paneles y formularios de la aplicación. |
| Estado cliente | **Zustand** | Estado de UI, interacciones y preferencias locales. |
| Datos API | **TanStack Query** | Consultas, caché e invalidación de datos persistentes. |
| API y negocio | **NestJS + TypeScript** | REST, auth, permisos, CRUD, reuniones y herramientas IA. |
| Multijugador | **Colyseus** | Sesiones de sala, presencia, movimiento y estado sincronizado. |
| Tiempo real adicional | **Socket.IO (uso puntual)** | Solo funcionalidades independientes para las que resulte técnicamente necesario; no sustituye a Colyseus. |
| Base de datos | **Amazon RDS for PostgreSQL** | Persistencia de usuarios, salas, membresías, tareas y mensajes. |
| Acceso a datos | **Prisma ORM** | Consultas, relaciones y migraciones sobre PostgreSQL alojado en RDS; Prisma **no es** la base de datos. |
| Monorepo | **pnpm workspaces** | Código compartido entre cliente, API, tiempo real y contratos. |
| IA | **Amazon Bedrock + herramientas NestJS** | Inferencia y ejecución de acciones autorizadas por el bot. |
| Formularios y validación | **React Hook Form + Zod** | Formularios React y validación de entradas; el backend vuelve a validar. |
| Kanban | **dnd-kit** | Interacciones de arrastrar y soltar en paneles React. |
| Sonido | **Librerías de audio web** | Efectos y control de reproducción del entorno. |
| Pruebas | **Vitest + Playwright** | Pruebas unitarias/integración y recorridos end-to-end. |
| Calidad de código | **ESLint + Prettier** | Análisis estático y formato. |
| Automatización | **GitHub Actions** | Ejecución de lint, tests y pipeline de despliegue. |
| Infraestructura | **AWS** | Frontend, servicios persistentes, datos, archivos, identidad de servicios y observabilidad. |

## 6. Arquitectura general actualizada 

### 6.1 Componentes

```text
                       NAVEGADOR (React + Vite)
  ┌──────────────────────────────────────────────────────┐
  │ React: autenticación, paneles, tareas, chat, UI       │
  │ Three.js: mundo 3D, cámara isométrica, avatares       │
  │ Estado cliente + cliente HTTP + SDK de Colyseus      │
  └───────────────┬───────────────────┬──────────────────┘
                  │ HTTPS / REST      │ WSS / Colyseus
                  ▼                   ▼
         ┌────────────────┐  ┌─────────────────────────┐
         │ NestJS API     │  │ Servidor Colyseus       │
         │ Auth / roles   │  │ Instancias de Room      │
         │ Salas / tareas │  │ Estado sincronizado     │
         │ Chat / eventos │  │ Avatares / presencia    │
         │ Bot IA / tools │  │ Validación de ingreso   │
         └───────┬────────┘  └──────────┬──────────────┘
                 │                      │
                 ├── servicios/contratos compartidos ──┤
                 │                      │
                 ▼                      ▼
        RDS PostgreSQL         Estado efímero por Room
                 │              (sin DB por movimiento)
                 ├── S3: archivos/assets
                 └── Amazon Bedrock desde NestJS
```

**Decisión de separación:** NestJS y Colyseus son responsabilidades lógicas distintas y, de inicio, **servicios desplegables separados**. Colyseus no reemplaza la API REST ni PostgreSQL. Para coordinar operaciones persistentes, Colyseus utilizará contratos y servicios de aplicación seguros; nunca confiará en permisos aportados solo por el cliente. La integración específica entre ambos servicios se documentará en `rules/arquitectura.md`.

### 6.2 Canales y propiedad de los datos

| Información o acción | Autoridad principal | Canal habitual |
|---|---|---|
| Registro, login, roles | NestJS / PostgreSQL | REST/HTTPS |
| CRUD de tareas, salas y reuniones | NestJS / PostgreSQL | REST/HTTPS |
| Historial de mensajes | NestJS / PostgreSQL | REST/HTTPS |
| Posición de avatares y presencia | Colyseus (estado de sala) | Colyseus/WSS |
| Entrada, salida y reconexión | Colyseus + verificación de permisos | Colyseus/WSS |
| Estado persistente de objetos | NestJS / PostgreSQL | REST; difusión a clientes cuando corresponda |
| Notificación de cambio en una sala activa | Colyseus, tras confirmar la operación | Colyseus/WSS |
| Consultas y acciones del bot | NestJS + proveedor IA | HTTPS; eventos si se necesita actualización en vivo |
| Mensajería en vivo | Colyseus en salas activas o canal dedicado justificado | Colyseus/WSS por defecto |

**Eventos y contratos ilustrativos (no definitivos):** `avatar:input`, `avatar:state`, `presence:changed`, `room:joined`, `chat:message`, `task:changed`, `meeting:announced`, `bot:summary-ready`. Los cambios de datos persistentes ocurren primero a través de la autoridad de negocio y luego se difunden; se evitarán escrituras duplicadas o mensajes que no correspondan al estado confirmado.

**Colyseus:** se emplean sus Rooms, estado sincronizado y mecanismos de conexión/reconexión. El cliente recibe estado y cambios del servidor, y los renderiza con Three.js. La sincronización multijugador se separa de la representación gráfica y del UI de React. La identificación de una sala persistente y de una instancia activa debe estar controlada por el servidor.

**Socket.IO:** se admite únicamente para casos puntuales que requieran un canal separado de Colyseus. No se duplica la sincronización multijugador ni se instala por defecto.

### 6.3 Autenticación entre servicios

- NestJS valida las credenciales y gestiona las sesiones con expiración.
- El ingreso a una instancia Colyseus requiere una identidad verificable y autorización para la sala asociada.
- Las operaciones en NestJS y los mensajes/acciones recibidos en Colyseus aplican controles de permisos coherentes.
- Se separan los roles globales (si se implementan) de las membresías y permisos particulares de una sala.
- El backend debe responder correctamente **401** ante ausencia/invalidación de autenticación y **403** ante falta de permisos en endpoints HTTP protegidos. Los rechazos de conexión/mensajes de Colyseus deben representar los mismos principios, aunque no necesariamente tengan códigos de respuesta HTTP equivalentes.

### 6.4 Modelo de información (general)

Entidades del dominio: `User`, `Session`, `AvatarConfiguration`, `Room`, `Membership`, `RoomItem`, `Task`, `Message`, `Meeting`/`Announcement`, `BotConversation`, `DailyReviewDelivery`. Las relaciones esenciales incluyen usuario→sala personal, usuario↔salas compartidas mediante membresía, sala→tareas/mensajes/elementos y usuario→resumen diario.

**No son filas persistentes por defecto:** cada frame del movimiento, posiciones transitorias, conexiones activas o estados interpolados de avatares. El modelo relacional y sus restricciones se definirán en `rules/datos.md`.

## 7. Integración y despliegue en AWS

AWS aloja y conecta **las mismas tecnologías elegidas para el producto**: el navegador ejecuta React y Three.js; NestJS conserva las reglas de negocio; Colyseus conserva las sesiones multijugador; RDS ejecuta PostgreSQL; Bedrock atiende la IA. Los servicios de AWS no reemplazan estas herramientas, sino que aportan alojamiento, networking, persistencia y operación.

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
          │                 ┌─────────┼──────────────────┐
          │                 ▼         ▼                  ▼
          │             RDS PG      Bedrock            Amazon S3
          │             (datos)    (bot IA)         (archivos / assets)
          │
          └── Descarga assets web/3D públicos desde hosting o S3 según corresponda

   Amazon ECR: imágenes Docker de NestJS y Colyseus
   AWS Secrets Manager: secretos y credenciales de los servicios
   IAM: permisos mínimos de ECS para Bedrock, RDS/S3 y otros servicios
   CloudWatch: logs, métricas y alarmas; AWS Budgets: control de costos
   GitHub Actions: tests, build y publicación a Amplify / ECR / ECS
```

### 7.2 Rol de cada servicio y conexión entre componentes

| Servicio AWS | Qué ejecuta o almacena | Cómo se conecta al proyecto |
|---|---|---|
| **Amplify Hosting** | Build estática de React + Vite, que incluye la aplicación Three.js/R3F y paneles React. | Sirve por HTTPS los archivos del frontend; el navegador consume la API NestJS y abre sesiones Colyseus. |
| **Application Load Balancer (ALB)** | Entrada pública HTTPS y conexiones WebSocket seguras (WSS). | Enruta rutas de API a un target group de NestJS y rutas de Colyseus a su target group; admite la actualización de HTTP a WebSocket. |
| **ECS con Fargate** | Dos servicios de contenedores Node.js persistentes: NestJS y Colyseus. | Mantiene vivos los procesos y conexiones de salas; no se utiliza Lambda para hospedar las Rooms. |
| **ECR** | Imágenes Docker versionadas de cada servicio. | GitHub Actions publica las imágenes; ECS despliega las versiones correspondientes. |
| **RDS for PostgreSQL** | Base de datos relacional persistente. | NestJS se conecta por red privada y utiliza Prisma ORM para consultas/migraciones. Colyseus obtiene/verifica datos persistentes a través de la capa de negocio. |
| **Amazon Bedrock** | Inferencia de modelos para el bot. | NestJS invoca Bedrock desde el servidor con permisos IAM y ejecuta sus propias herramientas autorizadas. |
| **S3** | Archivos subidos y recursos del mundo 3D que requieran almacenamiento de objetos. | Acceso controlado desde el backend; recursos públicos se entregan con políticas de distribución adecuadas. |
| **Secrets Manager + IAM** | Secretos de la aplicación y permisos entre servicios. | Credenciales y secretos no quedan en Git ni en el bundle del frontend. |
| **CloudWatch + AWS Budgets** | Registros, observabilidad, alarmas y presupuesto. | Supervisión de fallos, latencia, consumo y costos continuos. |

### 7.3 Flujo completo de uso

1. El usuario entra a la URL pública servida por **Amplify** y descarga React, Three.js, React Three Fiber y demás recursos del cliente.
2. El navegador llama por **HTTPS** a la API **NestJS** a través del **ALB** para registro, inicio de sesión y consulta de salas. NestJS valida la identidad y consulta o modifica los datos en **RDS PostgreSQL** mediante **Prisma**.
3. Al entrar en un espacio virtual, el cliente solicita conexión a **Colyseus** por HTTPS/WSS. Colyseus valida la identidad y autorización con el backend de negocio y vincula la sesión activa con la sala persistente.
4. **Colyseus** sincroniza movimientos, presencia y estado efímero entre usuarios; **Three.js** representa estos cambios en el navegador. No se escriben posiciones de cada fotograma en RDS.
5. Al interactuar con un objeto que abre un formulario, tablero o chat, **React** presenta la interfaz. Las acciones persistentes se envían a **NestJS**, se validan y guardan en **RDS**; luego se notifica a los clientes conectados a la sala mediante Colyseus.
6. En la primera conexión autenticada del día, **NestJS** consulta las tareas y reuniones en RDS, determina el repaso según **America/Argentina/Buenos_Aires**, invoca a **Bedrock** para generar el texto y entrega el resultado al cliente. El marcador diario persistente evita repetir el repaso ese mismo día.
7. Los recursos subidos se almacenan en **S3**. Logs y métricas de los servicios se supervisan con **CloudWatch**.

### 7.4 Despliegue, red y operación

- El monorepo produce una **build web** de React/Vite y **dos imágenes Docker** independientes: API NestJS y servidor Colyseus.
- **GitHub Actions** ejecuta ESLint, Prettier (verificación), Vitest y Playwright; publica el frontend en Amplify y las imágenes en ECR; luego actualiza los servicios de ECS.
- El **ALB** termina TLS con certificado de **AWS Certificate Manager**; dirige `/api/*` a NestJS y una ruta/host reservado al servicio Colyseus. Se configuran explícitamente endpoints de matchmaking, conexiones WebSocket y orígenes permitidos sin mezclar los servicios.
- Los servicios ECS tienen **Security Groups** específicos. **RDS permanece en subredes privadas**, accesible solo desde los componentes autorizados. Las tareas ECS usan roles IAM de mínimo privilegio; Bedrock se invoca desde NestJS, nunca desde el navegador.
- Las credenciales, claves de sesión y cadenas de conexión se inyectan por configuración segura. El frontend recibe únicamente valores públicos (por ejemplo, URL de API y URL de Colyseus).
- Colyseus inicia con una instancia del servicio para simplificar la coherencia de las Rooms del MVP. La ampliación horizontal exige una estrategia Colyseus compatible de presencia, matchmaking, ruteo y reconexión; no basta con duplicar tareas ECS detrás del balanceador.
- Se mantienen health checks, logs, políticas de reinicio, alarmas y un presupuesto de AWS, porque ECS/Fargate, ALB, RDS y red pueden generar cargos continuos incluso con poco tráfico.
- El desarrollo local usa los mismos componentes de aplicación con contenedores y PostgreSQL local; la prueba y entrega final utiliza los servicios **AWS** descritos y URLs públicas HTTPS/WSS.

## 8. Seguridad y calidad transversal 

- Contraseñas almacenadas mediante hash seguro (Argon2 o bcrypt, o servicio de identidad equivalente), jamás en texto plano.
- Tokens o sesiones con vencimiento; protección de rutas y endpoints.
- Verificación de roles, membresía y propiedad de recursos en toda acción relevante.
- Validación de datos en cliente y servidor; ORM y consultas parametrizadas.
- CORS restringido a orígenes autorizados en producción.
- Respuestas públicas sin hashes, claves, trazas internas ni consultas de base de datos.
- Variables sensibles fuera del repositorio; `.env.example` sin valores secretos.
- Estados de carga, vacío y error comprensibles para el usuario.
- Logs, manejo de reconexión, límites de uso de IA y medidas básicas de robustez.
- Pruebas de autenticación, autorización y aislamiento de datos como prioridad.

## 9. Alcance de entrega: MVP y ampliaciones

### 9.1 MVP para el proyecto integrador  (objetivo de entrega)

El MVP debe completar **un recorrido utilizable en producción**:

1. Una persona se registra, inicia sesión y obtiene su sala personal.
2. Ingresa a la escena 3D isométrica, controla su avatar con WASD y mouse y puede interactuar con un elemento.
3. Crea una sala compartida o accede a una autorizada y observa la presencia de otros usuarios cuando están conectados.
4. Abre desde un objeto una interfaz React y administra tareas con **CRUD completo y persistencia real**.
5. Intercambia mensajes en el contexto de una sala con autorización válida.
6. Consulta anuncios o reuniones en la sala general.
7. Interactúa con el bot y, en su primera conexión diaria, recibe el repaso de su día.
8. Puede cerrar sesión; el sistema impide accesos no autorizados y conserva los datos luego de recargas y reinicios.

Este es el **MVP funcional objetivo del producto**. El alcance descrito constituye el compromiso funcional de la entrega y se verificará junto con los requisitos obligatorios R1–R8.

### 9.2 Funcionalidades complementarias

- Estados de actividad más elaborados, solicitudes de entrada y permisos avanzados.
- Personalización y decoración ampliadas, más objetos interactivos y animaciones.
- Mensajería directa más completa, recordatorios y resúmenes de actividad avanzados.
- Sonidos, emotes y acciones sociales adicionales.
- Mayor concurrencia, múltiples instancias de servidor y herramientas administrativas.

## 10. Cumplimiento del enunciado IntegrarTEC 2026

Esta sección **traduce los criterios del PDF en verificaciones del proyecto**. La inclusión en el documento **no significa que ya estén implementados**; deben completarse y probarse.

### 10.1 Requisitos obligatorios R1–R8

| Código | Requisito del enunciado | Cómo se cumplirá y comprobará |
|---|---|---|
| **R1** | Frontend, backend y base de datos; al menos **3 entidades relacionadas**, una `User`. | React/Three.js consume NestJS; RDS PostgreSQL persiste usuarios, salas, membresías, tareas. Revisar diagrama, código y persistencia tras recargar. |
| **R2** | Registro, login, logout, hash, sesión expirable, rutas/endpoints protegidos, **2 roles**, **401/403** y aislamiento entre usuarios. | Autenticación en NestJS y autorización también en Colyseus; pruebas directas de API sin token, con rol insuficiente y con IDs ajenos. |
| **R3** | GitHub con historial real de todos, README completo, `.gitignore`, `.env.example` y ningún secreto. | Auditar historial, contribuciones, árbol del repositorio y variables publicadas. |
| **R4** | Frontend/backend con URL pública **HTTPS**, DB en nube, variables de entorno, disponibilidad hasta terminar defensas y credenciales de cada rol. | Desplegar en AWS; verificar acceso externo desde otra red, sesiones WSS y cuentas de prueba. |
| **R5** | Flujo principal funcional en producción, **CRUD completo** de entidad asociada al usuario, validación doble y errores/cargas/vacíos visibles. | Demostrar el flujo de tareas desde la sala 3D con crear/listar/editar/eliminar, errores de formulario y persistencia. |
| **R6** | Documento justificando herramientas relevantes, alternativas y concesiones. | Crear `docs/justificacion-tecnica.md`: stack principal, autenticación, DB/ORM, despliegue e IA. |
| **R7** | ORM/consultas seguras, CORS adecuado y respuestas sin errores internos ni hashes. | Pruebas de API, revisión de configuración de producción y de DTOs/serialización. |
| **R8** | Defensa en vivo **sobre producción**, con explicación de problema, solución, arquitectura y decisiones; dominio individual del código. | Ensayo con todas las cuentas, demo de control de acceso y participación explicativa de cada integrante. |

**Condición crítica del enunciado:** todos los R1–R8 son obligatorios. **Sin R2 o R4, el trabajo no se considera completo**, aunque otras funciones estén terminadas.

### 10.2 Uso de inteligencia artificial

- **Obligatorio en el proceso:** documentar en el repositorio herramientas de IA usadas, tareas donde ayudaron, **un caso acertado** y **uno que debió corregirse**, incluyendo verificación humana (`docs/uso-de-ia.md`).
- **Recomendado en el producto:** integrar al menos una funcionalidad que consuma una API de modelo de IA desde el backend. El asistente y el repaso diario cubrirían esta recomendación si funcionan de verdad en el deploy, con manejo de errores, límites y claves protegidas.
- Todo integrante debe comprender y poder defender el código independientemente de quién o qué lo haya generado.

### 10.3 Recomendaciones valoradas en la evaluación

| Recomendación | Aplicación en el proyecto |
|---|---|
| Video de 3–5 minutos | Mostrar registro, login, flujo principal, roles y producto en funcionamiento; enlace en README. |
| Documentación técnica | Diagrama de arquitectura, entidad-relación, endpoints (Swagger/OpenAPI u otro) y guía local. |
| Tests | Al menos autenticación/autorización; ampliar a CRUD y flujos de sala. |
| CI/CD | Pipeline de lint/tests y, si es viable, publicación automática. |
| Git colaborativo | Ramas, pull requests, revisiones e issues/tablero. |
| UI de calidad | Responsive, coherencia y accesibilidad básica; estrategia diferenciada para 3D móvil. |
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
- [ ] Alterar un ID no expone datos ajenos; respuestas no incluyen hashes.
- [ ] Colyseus rechaza entradas a salas ajenas y acciones sin autorización.

**Producto y datos**

- [ ] Flujo principal completo y CRUD de tareas demostrable.
- [ ] Datos permanecen tras recarga y reinicio del servidor.
- [ ] Formularios incluyen validación, cargas, vacíos y errores claros.
- [ ] Movimiento e interacción 3D funcionan; React abre interfaces cuando corresponde.
- [ ] Dos usuarios autorizados comparten una sala y se sincroniza su presencia.
- [ ] La rutina de primer ingreso diario se activa una sola vez por día y usuario.

**Repositorio, infraestructura y documentación**

- [ ] Commits reales de todos los integrantes y README reproducible.
- [ ] `.env.example` incluido; ningún secreto en archivos ni historial Git.
- [ ] Frontend/API HTTPS y Colyseus WSS accesibles desde otra red.
- [ ] RDS PostgreSQL desplegado en AWS y servicios disponibles durante defensas.
- [ ] Credenciales de prueba válidas para al menos dos roles.
- [ ] Documento de decisiones técnicas con alternativas y trade-offs.
- [ ] Declaración de uso de IA con caso exitoso y caso corregido.
- [ ] (Recomendado) Tests, video, documentación y pipeline CI/CD.
- [ ] Demo ensayada sobre producción y todos pueden explicar el código.

## 11. Justificación arquitectónica de alto nivel

Esta sección resume el fundamento; la comparación formal requerida por **R6** se desarrollará en `docs/justificacion-tecnica.md`.

| Decisión | Motivo en este proyecto | Alternativas y costo principal |
|---|---|---|
| Three.js | Mundo **3D real** con cámara isométrica e interacciones espaciales. | PixiJS 2.5D descartado por cambio de estética; Three.js exige controlar assets, rendimiento, cámara y colisiones. |
| React + Vite | Interfaz interactiva autenticada y paneles independientes del mundo 3D. | Next.js como alternativa; se renuncia a SSR como elemento central. |
| Colyseus | Room lifecycle, estado multijugador autoritativo y sincronización diseñada para salas. | Socket.IO requeriría implementar más lógica de salas y estado; Colyseus incorpora otro servicio y aprendizaje. |
| NestJS | API estructurada, módulos, validación y autorización del dominio. | Express/Fastify directos como opciones más livianas; NestJS agrega estructura y convenciones. |
| RDS PostgreSQL + Prisma ORM | Relaciones fuertes entre usuarios, salas, roles, tareas y reuniones. | MongoDB/otros ORM; cambios de esquema y migraciones requieren disciplina. |
| AWS con ECS/Fargate | Hospeda procesos persistentes para NestJS y Colyseus. | PaaS administrados o EC2; Fargate/ALB/RDS añaden costo fijo y operación. |
| Amazon Bedrock desde NestJS | IA gestionada en AWS con IAM, herramientas y autorización centralizadas en NestJS. | Llamada directa desde frontend descartada por seguridad; dependencia y costos de inferencia de AWS. |

## 12. Roadmap general

| Fase | Objetivo |
|---|---|
| **0** | Repositorio, organización, propuesta del hito 1, reglas mínimas y primer esquema técnico. |
| **1** | Auth, roles, modelo relacional, flujo REST, primera versión desplegada (**hito 2**). |
| **2** | Escena Three.js isométrica, avatar, WASD/mouse, acceso básico a salas. |
| **3** | Servidor Colyseus, sincronización, presencia, control de acceso y reconexión. |
| **4** | Objetos interactivos y paneles React; CRUD de tareas completo, chat y reuniones. |
| **5** | Bot IA y repaso en la primera conexión diaria con persistencia y fallback. |
| **6** | Pruebas de roles/seguridad, mejoras de UX, documentación R6 y declaración de IA. |
| **7** | Deploy completo, QA en producción, README, pruebas externas y defensa (**hito 3**). |

La implementación seguirá entregas incrementales, con despliegue desde etapas tempranas para verificar integración real con AWS.

## 13. Organización documental

Este documento será el **índice conceptual y fuente de decisiones generales**. El detalle técnico y funcional se desarrollará en archivos de `rules/`, por ejemplo:

```text
PROYECTO_GENERAL_ACTUALIZADO.md
rules/
  arquitectura.md
  mundo-3d-y-camara.md
  movimiento-e-interacciones.md
  direccion-artistica.md
  avatares-y-personalizacion.md
  colyseus-y-multijugador.md
  salas-y-permisos.md
  tareas-y-productividad.md
  comunicacion-y-reuniones.md
  bot-ia-y-repaso-diario.md
  datos.md
  seguridad-y-autenticacion.md
  infraestructura-aws.md
  pruebas-y-calidad.md
docs/
  justificacion-tecnica.md
  uso-de-ia.md
  arquitectura.md
```

Los archivos `rules/` desarrollan los detalles de implementación y experiencia sin contradecir este contrato general.
