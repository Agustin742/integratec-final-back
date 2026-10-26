# Historias de usuario

Derivadas de `ERS-requisitos-funcionales.md` (v0.1). Cada historia referencia el requisito del que sale (`Origen`) y copia sus criterios de aceptación, de modo que la ERS sigue siendo la fuente de verdad: si cambia un criterio, se actualiza en las dos.

## Cómo leer una historia

| Campo | Significado |
|---|---|
| **ID** | `HU-MÓDULO-NNN`. Si un requisito se parte en varias historias, llevan sufijo `a`, `b`, `c`... (por ejemplo `HU-OFI-008a`). |
| **Origen** | Requisito de la ERS (`RF-MÓDULO-NNN`). |
| **Repos** | `front`, `back` o `ambos`. Para GitHub: `ambos` genera una tarjeta principal con un sub-issue por repo. |
| **Tareas técnicas** | Orientativas: punto de partida que cada equipo refina al trabajar la historia. El prefijo `[back]` o `[front]` indica el repositorio. |
| **Depende de** | Historias que conviene tener antes. Sirve para ordenar el tablero; no es una restricción rígida. |

## Reglas para cargar en GitHub Projects

- Cada historia es un issue titulado `[HU-XXX-NNN] Título`, con etiquetas de módulo, prioridad, fase y repos.
- Cada línea `[back]` o `[front]` de las tareas técnicas se crea como sub-issue en el repositorio correspondiente.
- Las historias `front` o `back` se crean directo en el repositorio que corresponde.
- Los campos Módulo, Prioridad, Fase y Repos se cargan también como campos del proyecto.
- Las historias con Fase `Evolución` van al backlog sin planificar.
- Las reglas de negocio `RN-NN` mencionadas en tareas y criterios están definidas en la sección 4 de la ERS.


---

## Cuenta y autenticación (AUT)

### HU-AUT-001 · Registro de usuario
- **Origen:** RF-AUT-001
- **Repos:** ambos
- **Módulo:** AUT · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como visitante, quiero registrarme con mi email y una contraseña, para tener mi cuenta y mi propia oficina.
- **Criterios de aceptación:**
  1. Dado un Visitante con datos válidos, cuando se registra, entonces se crea su cuenta y, automáticamente, su oficina propia con la habitación principal (RF-OFI-001).
  2. Dado un email ya registrado, cuando intenta registrarse, entonces el sistema muestra un error claro y no crea ninguna cuenta.
  3. Dados datos inválidos (email mal formado, contraseña corta, campos vacíos), cuando envía el formulario, entonces ve el error junto a cada campo y el servidor también rechaza los datos.
  4. Dada una contraseña, entonces nunca se almacena ni se devuelve en texto plano.
- **Tareas técnicas:**
  - [back] Alta de usuario con validación, contraseña protegida y creación de la oficina propia (ver RF-OFI-001).
  - [front] Formulario de registro con validación y errores por campo.
- **Depende de:** —

### HU-AUT-002 · Inicio de sesión
- **Origen:** RF-AUT-002
- **Repos:** ambos
- **Módulo:** AUT · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como visitante, quiero iniciar sesión con mi email y mi contraseña, para acceder a mis oficinas.
- **Criterios de aceptación:**
  1. Dadas credenciales válidas, cuando inicia sesión, entonces accede a su lista de oficinas.
  2. Dadas credenciales inválidas, cuando intenta iniciar sesión, entonces el mensaje no revela si falló el email o la contraseña.
  3. Dado un error del servidor durante el inicio de sesión, entonces el usuario ve un mensaje comprensible y no un detalle interno.
- **Tareas técnicas:**
  - [back] Autenticación con mensaje genérico ante credenciales inválidas.
  - [front] Formulario de inicio de sesión y manejo de errores.
- **Depende de:** HU-AUT-001

### HU-AUT-003 · Sesión con vencimiento y renovación
- **Origen:** RF-AUT-003
- **Repos:** ambos
- **Módulo:** AUT · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como usuario, quiero que mi sesión se renueve mientras uso la aplicación y venza si dejo de usarla, para mantener mi cuenta segura sin interrupciones.
- **Criterios de aceptación:**
  1. Dada una sesión vencida, cuando el usuario realiza una acción protegida, entonces el sistema le pide iniciar sesión de nuevo.
  2. Dado un usuario activo, cuando se acerca el vencimiento de su sesión, entonces esta se renueva sin interrumpirlo.
  3. Dada una sesión vencida, entonces el servidor responde 401 a cualquier operación protegida.
- **Tareas técnicas:**
  - [back] Sesión con vencimiento, renovación y respuesta 401 al vencer.
  - [front] Renovación transparente y redirección al inicio de sesión cuando vence.
- **Depende de:** HU-AUT-002

### HU-AUT-004 · Cierre de sesión
- **Origen:** RF-AUT-004
- **Repos:** ambos
- **Módulo:** AUT · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como usuario, quiero cerrar sesión, para que nadie use mi cuenta en este dispositivo.
- **Criterios de aceptación:**
  1. Dado un usuario que cierra sesión, cuando intenta acceder a una ruta o dato protegido, entonces el sistema lo rechaza.
  2. Dado el cierre de sesión, entonces el avatar desaparece de la presencia de la habitación donde estaba.
- **Tareas técnicas:**
  - [back] Invalidar la sesión y retirar la presencia del usuario.
  - [front] Botón de cierre de sesión y limpieza del estado local.
- **Depende de:** HU-AUT-002

### HU-AUT-005 · Protección de rutas y operaciones
- **Origen:** RF-AUT-005
- **Repos:** back
- **Módulo:** AUT · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como usuario, quiero que mis datos solo sean accesibles con una sesión y los permisos correctos, para que nadie vea ni modifique lo que no le corresponde.
- **Criterios de aceptación:**
  1. Dada una petición sin sesión válida, entonces el sistema responde 401.
  2. Dada una petición con sesión pero sin permiso sobre el recurso, entonces responde 403.
  3. Dado un identificador de recurso ajeno manipulado, entonces el sistema no expone ningún dato de ese recurso.
  4. Dada cualquier respuesta, entonces no contiene hashes de contraseña, claves ni detalles internos del servidor.
- **Tareas técnicas:**
  - [back] Guardas de autenticación y autorización (401 y 403) en todas las rutas privadas, sin devolver datos sensibles.
- **Depende de:** HU-AUT-002

### HU-AUT-006 · Recuperación de contraseña
- **Origen:** RF-AUT-006
- **Repos:** ambos
- **Módulo:** AUT · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como visitante, quiero restablecer mi contraseña con un enlace enviado por email, para recuperar el acceso si la olvido.
- **Criterios de aceptación:**
  1. Dado un email registrado, cuando solicita recuperar la contraseña, entonces recibe un enlace de un solo uso con vencimiento.
  2. Dado un email no registrado, cuando lo solicita, entonces la respuesta en pantalla es idéntica, para no revelar qué cuentas existen.
  3. Dado un enlace vencido o ya usado, cuando intenta usarlo, entonces el sistema lo rechaza con un mensaje claro.
  4. Dado un restablecimiento exitoso, entonces las sesiones anteriores de esa cuenta dejan de ser válidas.
- **Tareas técnicas:**
  - [back] Enlace de un solo uso con vencimiento, envío por email, respuesta idéntica para emails no registrados y cierre de sesiones previas.
  - [front] Pantallas de solicitud y de nueva contraseña.
- **Depende de:** HU-AUT-002

### HU-AUT-007 · Gestión del perfil
- **Origen:** RF-AUT-007
- **Repos:** ambos
- **Módulo:** AUT · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como usuario, quiero editar mi nombre visible y mis datos de perfil, para que los demás me identifiquen.
- **Criterios de aceptación:**
  1. Dado un usuario que edita su perfil con datos válidos, cuando guarda, entonces el cambio persiste tras recargar.
  2. Dado un cambio de nombre visible, entonces se refleja en todas las oficinas donde participa.
  3. Dados datos inválidos, cuando guarda, entonces ve los errores por campo.
- **Tareas técnicas:**
  - [back] Actualización del perfil con validación.
  - [front] Pantalla de perfil con errores por campo.
- **Depende de:** HU-AUT-002

### HU-AUT-008 · Cambio de contraseña con sesión iniciada
- **Origen:** RF-AUT-008
- **Repos:** ambos
- **Módulo:** AUT · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como usuario, quiero cambiar mi contraseña desde mi perfil, para mantener mi cuenta segura.
- **Criterios de aceptación:**
  1. Dada la contraseña actual correcta y una nueva válida, cuando confirma, entonces la contraseña cambia y las demás sesiones se cierran.
- **Tareas técnicas:**
  - [back] Cambio de contraseña exigiendo la actual y cierre de las demás sesiones.
  - [front] Formulario de cambio de contraseña.
- **Depende de:** HU-AUT-007

### HU-AUT-009 · Límite de intentos fallidos de inicio de sesión
- **Origen:** RF-AUT-009
- **Repos:** ambos
- **Módulo:** AUT · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como usuario, quiero que se bloqueen temporalmente los intentos fallidos repetidos de ingreso, para protegerme de accesos no autorizados.
- **Criterios de aceptación:**
  1. Dados varios intentos fallidos seguidos sobre una misma cuenta, cuando se supera el límite, entonces el sistema bloquea temporalmente nuevos intentos e informa cuánto esperar.
- **Tareas técnicas:**
  - [back] Contador de intentos fallidos y bloqueo temporal por cuenta.
  - [front] Mostrar el aviso con el tiempo de espera.
- **Depende de:** HU-AUT-002

### HU-AUT-010 · Verificación de email al registrarse
- **Origen:** RF-AUT-010
- **Repos:** ambos
- **Módulo:** AUT · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como visitante, quiero verificar mi email al registrarme, para confirmar que la cuenta es mía.
- **Criterios de aceptación:**
  1. Dado un registro nuevo, cuando se envía el enlace de verificación y la persona lo abre, entonces la cuenta queda marcada como verificada.
- **Tareas técnicas:**
  - [back] Enlace de verificación y estado de cuenta verificada.
  - [front] Aviso y pantalla de verificación.
- **Depende de:** HU-AUT-001, HU-AUT-006


---

## Oficinas e invitaciones (OFI)

### HU-OFI-001 · Creación automática de la oficina propia
- **Origen:** RF-OFI-001
- **Repos:** back
- **Módulo:** OFI · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como usuario nuevo, quiero tener mi propia oficina con una habitación principal al registrarme, para empezar a usar la plataforma de inmediato.
- **Criterios de aceptación:**
  1. Dado un registro exitoso, entonces el usuario aparece como Dueño de una oficina nueva que contiene una habitación principal.
  2. Dado un usuario existente, entonces no puede crear una segunda oficina propia.
  3. Dada la oficina recién creada, entonces el tablero tiene sus columnas por defecto (RF-TAR-006) y los canales de chat existen.
- **Tareas técnicas:**
  - [back] Al registrarse: crear la oficina, la habitación principal, la membresía de Dueño, las columnas por defecto y los canales de chat.
- **Depende de:** HU-AUT-001

### HU-OFI-002 · Lista de oficinas del usuario
- **Origen:** RF-OFI-002
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como usuario, quiero ver mis oficinas (propia e invitadas) con mi rol en cada una, para elegir a cuál entrar.
- **Criterios de aceptación:**
  1. Dado un usuario con sesión, cuando abre su inicio, entonces ve su oficina propia y las invitadas, cada una con su rol.
  2. Dada una oficina dada de baja, entonces no aparece en la lista de sus miembros (RN-14); el Dueño la ve marcada como dada de baja (RF-OFI-015).
  3. Dado un usuario que fue expulsado de una oficina, entonces esa oficina no aparece en su lista.
  4. Dada una lista vacía de oficinas invitadas, entonces el usuario ve un mensaje que lo indica.
- **Tareas técnicas:**
  - [back] Listado de oficinas del usuario con rol, excluyendo bajas y expulsiones.
  - [front] Pantalla de inicio con la lista y estado vacío.
- **Depende de:** HU-OFI-001, HU-AUT-002

### HU-OFI-003 · Ingreso a una oficina
- **Origen:** RF-OFI-003
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero entrar a una oficina de mi lista, para trabajar desde su habitación principal.
- **Criterios de aceptación:**
  1. Dado un miembro de la oficina, cuando la selecciona, entonces ingresa a la habitación principal.
  2. Dado un usuario que no es miembro, cuando intenta entrar a la oficina por cualquier medio, entonces el sistema responde 403.
  3. Dado un usuario sin sesión, cuando intenta entrar, entonces el sistema responde 401.
- **Tareas técnicas:**
  - [back] Verificar la membresía (401 y 403) y devolver la habitación principal.
  - [front] Entrada a la oficina y carga de la habitación principal.
- **Depende de:** HU-OFI-002, HU-HAB-001

### HU-OFI-004 · Edición de datos de la oficina
- **Origen:** RF-OFI-004
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero editar el nombre y la descripción de mi oficina, para identificarla.
- **Criterios de aceptación:**
  1. Dado un Dueño o Administrador con datos válidos, cuando guarda, entonces los miembros ven el nombre nuevo.
  2. Dado un Miembro o Líder, cuando intenta editar los datos de la oficina, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Edición de datos de la oficina con control de permisos.
  - [front] Formulario de edición.
- **Depende de:** HU-OFI-003

### HU-OFI-005 · Generación de enlace de invitación
- **Origen:** RF-OFI-005
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero generar un enlace de invitación con vencimiento y límite de usos opcional, para sumar gente a mi oficina.
- **Criterios de aceptación:**
  1. Dado un Dueño o Administrador, cuando genera una invitación, entonces obtiene un enlace único y copiable.
  2. Dado el formulario de invitación, cuando define un vencimiento y opcionalmente un máximo de usos, entonces el enlace respeta esos valores.
  3. Dado un Miembro o Líder, cuando intenta generar un enlace, entonces el sistema responde 403.
  4. Dado un enlace de invitación, entonces da acceso únicamente a la oficina para la que fue generado y nunca a otras.
- **Tareas técnicas:**
  - [back] Generar un token único con vencimiento y límite de usos.
  - [front] Formulario de invitación y botón para copiar el enlace.
- **Depende de:** HU-OFI-003

### HU-OFI-006 · Revocación de invitaciones
- **Origen:** RF-OFI-006
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero revocar una invitación vigente, para que el enlace deje de funcionar.
- **Criterios de aceptación:**
  1. Dada una invitación vigente, cuando el Dueño o Administrador la revoca, entonces el enlace deja de funcionar de inmediato.
  2. Dado un usuario que ya se había unido con ese enlace, cuando se revoca, entonces su membresía no cambia.
- **Tareas técnicas:**
  - [back] Revocación de invitaciones sin afectar membresías ya creadas.
  - [front] Acción de revocar en el panel de invitaciones.
- **Depende de:** HU-OFI-005

### HU-OFI-007 · Lista de invitaciones vigentes
- **Origen:** RF-OFI-007
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero ver el estado de las invitaciones, para saber cuáles siguen vigentes.
- **Criterios de aceptación:**
  1. Dada una oficina con invitaciones, cuando el Dueño o Administrador abre el panel, entonces las ve con su estado.
  2. Dado un enlace vencido, entonces aparece como vencido sin intervención manual.
- **Tareas técnicas:**
  - [back] Listado con estado calculado (vigente, vencida, revocada, agotada).
  - [front] Tabla de invitaciones con su estado.
- **Depende de:** HU-OFI-005

### HU-OFI-008a · Unirse a una oficina con sesión iniciada
- **Origen:** RF-OFI-008
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como usuario, quiero abrir un enlace de invitación, para unirme a la oficina como miembro.
- **Criterios de aceptación:**
  1. Dado un Usuario con sesión, cuando abre un enlace vigente, entonces pasa a ser Miembro con acceso solo a la habitación principal.
  2. Dado un usuario que ya es miembro, cuando abre el enlace, entonces no se duplica su membresía y se lo lleva a la oficina.
- **Tareas técnicas:**
  - [back] Aceptar la invitación: crear la membresía de Miembro con acceso solo a la principal, evitando duplicados.
  - [front] Pantalla de aceptación del enlace.
- **Depende de:** HU-OFI-005, HU-HAB-001

### HU-OFI-008b · Registrarse o iniciar sesión desde un enlace de invitación
- **Origen:** RF-OFI-008
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como visitante, quiero registrarme o iniciar sesión al abrir una invitación, para unirme automáticamente a la oficina.
- **Criterios de aceptación:**
  1. Dado un Visitante sin cuenta, cuando abre un enlace vigente, entonces puede registrarse o iniciar sesión y, al terminar, se une automáticamente a la oficina.
- **Tareas técnicas:**
  - [back] Conservar la invitación durante el registro o inicio de sesión y completar la unión al terminar.
  - [front] Flujo de registro e inicio de sesión que retoma la invitación.
- **Depende de:** HU-OFI-008a, HU-AUT-001

### HU-OFI-008c · Rechazar enlaces de invitación inválidos
- **Origen:** RF-OFI-008
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como visitante, quiero un mensaje claro cuando el enlace no sirve, para saber por qué no pude unirme.
- **Criterios de aceptación:**
  1. Dado un enlace vencido, revocado o agotado, cuando lo abre, entonces el sistema lo rechaza con un mensaje que indica el motivo.
  2. Dada una oficina dada de baja, cuando se abre un enlace de invitación, entonces el sistema lo rechaza.
- **Tareas técnicas:**
  - [back] Validar el estado de la invitación y de la oficina, devolviendo el motivo.
  - [front] Mensajes de error según el motivo.
- **Depende de:** HU-OFI-008a

### HU-OFI-008d · Reingresar a una oficina tras una expulsión
- **Origen:** RF-OFI-008
- **Repos:** back
- **Módulo:** OFI · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como usuario expulsado, quiero poder volver si me invitan de nuevo, para retomar mi lugar en la oficina.
- **Criterios de aceptación:**
  1. Dado un usuario expulsado, cuando abre un enlace vigente, entonces se une de nuevo como Miembro sin acceso a lo que tenía antes.
- **Tareas técnicas:**
  - [back] Reactivar la membresía sin recuperar los accesos anteriores.
- **Depende de:** HU-OFI-008a, HU-OFI-012

### HU-OFI-009 · Vencimiento automático de invitaciones
- **Origen:** RF-OFI-009
- **Repos:** back
- **Módulo:** OFI · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero que las invitaciones dejen de valer al vencer o agotarse, para que un enlace viejo no permita entrar a la oficina.
- **Criterios de aceptación:**
  1. Dada una invitación vencida, cuando alguien la abre, entonces no se une a la oficina.
  2. Dada una invitación con límite de usos alcanzado, cuando alguien la abre, entonces no se une a la oficina.
- **Tareas técnicas:**
  - [back] Validar el vencimiento y los usos al aceptar una invitación.
- **Depende de:** HU-OFI-005

### HU-OFI-010 · Lista de miembros
- **Origen:** RF-OFI-010
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero ver quiénes forman parte de la oficina y su rol, para saber con quién trabajo.
- **Criterios de aceptación:**
  1. Dado un miembro, cuando abre la lista, entonces ve nombre visible y rol de cada miembro activo.
  2. Dado un Dueño o Administrador, cuando abre la lista, entonces además ve las acciones de gestión que le corresponden.
  3. Dado un usuario no miembro, cuando intenta ver la lista, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Listado de miembros activos con rol, con control de membresía.
  - [front] Lista de miembros con las acciones que corresponden a cada rol.
- **Depende de:** HU-OFI-003

### HU-OFI-011 · Nombrar y quitar Administradores
- **Origen:** RF-OFI-011
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como Dueño, quiero nombrar y quitar Administradores, para delegar la gestión de mi oficina.
- **Criterios de aceptación:**
  1. Dado el Dueño, cuando asigna el rol a un miembro, entonces este puede ejecutar las acciones de Administrador de la matriz de permisos.
  2. Dado el Dueño, cuando quita el rol, entonces el miembro vuelve a Miembro y pierde esas acciones de inmediato.
  3. Dado un Administrador, cuando intenta nombrar o quitar Administradores, entonces el sistema responde 403.
  4. Dado el Dueño, entonces no puede asignarse ni quitarse un rol a sí mismo.
- **Tareas técnicas:**
  - [back] Asignar y quitar el rol, exclusivo del Dueño, con efecto inmediato.
  - [front] Acciones de rol en la lista de miembros.
- **Depende de:** HU-OFI-010

### HU-OFI-012 · Expulsión de un miembro
- **Origen:** RF-OFI-012
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero expulsar a un miembro, para que deje de tener acceso a la oficina.
- **Criterios de aceptación:**
  1. Dado un miembro expulsado, entonces pierde acceso a todas las habitaciones y a los chats de la oficina, y la oficina desaparece de su lista.
  2. Dado un miembro expulsado que estaba conectado, entonces su avatar sale de la habitación y es desconectado de la oficina.
  3. Dado un miembro expulsado, entonces sus mensajes, tareas y anuncios se conservan y sus tareas asignadas quedan huérfanas.
  4. Dado un Administrador, cuando intenta expulsar al Dueño, entonces el sistema responde 403 (RN-08).
  5. Dado un Miembro o Líder, cuando intenta expulsar a alguien, entonces el sistema responde 403.
  6. Dado un Administrador, cuando intenta expulsar a otro Administrador, entonces el sistema responde 403. ⚠️ Supuesto: solo el Dueño gestiona Administradores.
- **Tareas técnicas:**
  - [back] Baja lógica de la membresía, cierre de conexiones, tareas huérfanas y reglas de jerarquía (403 sobre el Dueño y otros Administradores).
  - [front] Acción de expulsar con confirmación.
- **Depende de:** HU-OFI-010, HU-HAB-010

### HU-OFI-013 · Abandono de la oficina
- **Origen:** RF-OFI-013
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como miembro, quiero abandonar una oficina, para dejar de participar en ella.
- **Criterios de aceptación:**
  1. Dado un miembro que confirma que abandona, entonces pierde acceso y la oficina desaparece de su lista.
  2. Dado el abandono, entonces lo que generó se conserva y sus tareas asignadas quedan huérfanas.
  3. Dado el Dueño, cuando intenta abandonar su oficina, entonces el sistema se lo impide y le indica que puede darla de baja (RN-15).
- **Tareas técnicas:**
  - [back] Baja de la membresía propia; el Dueño no puede abandonar.
  - [front] Acción de abandonar con confirmación y mensaje para el Dueño.
- **Depende de:** HU-OFI-010

### HU-OFI-014 · Baja lógica de la oficina
- **Origen:** RF-OFI-014
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como Dueño, quiero dar de baja mi oficina, para cerrarla con posibilidad de recuperarla.
- **Criterios de aceptación:**
  1. Dado el Dueño, cuando confirma la baja (con una confirmación explícita), entonces la oficina deja de estar disponible para todos sus miembros.
  2. Dados los miembros conectados, cuando se da de baja la oficina, entonces son sacados de ella.
  3. Dado un Administrador, Líder o Miembro, cuando intenta dar de baja la oficina, entonces el sistema responde 403.
  4. Dada la baja, entonces ningún dato se elimina todavía.
- **Tareas técnicas:**
  - [back] Baja lógica con fecha, sacar a los conectados y ocultar la oficina a los miembros.
  - [front] Acción con confirmación explícita.
- **Depende de:** HU-OFI-003

### HU-OFI-015 · Recuperación de la oficina
- **Origen:** RF-OFI-015
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como Dueño, quiero recuperar mi oficina dentro de los 15 días, para volver a abrirla si me arrepiento.
- **Criterios de aceptación:**
  1. Dado el Dueño con una oficina dada de baja, cuando abre su lista, entonces la ve marcada como dada de baja con los días que le quedan.
  2. Dado el Dueño, cuando la recupera dentro del plazo, entonces la oficina vuelve exactamente como estaba, con sus miembros, accesos y datos.
  3. Dado el plazo vencido, entonces la recuperación ya no es posible.
- **Tareas técnicas:**
  - [back] Recuperar la oficina dentro del plazo con todos sus datos.
  - [front] Mostrar la oficina dada de baja con los días restantes y la acción de recuperar.
- **Depende de:** HU-OFI-014

### HU-OFI-016 · Eliminación definitiva tras el plazo
- **Origen:** RF-OFI-016
- **Repos:** back
- **Módulo:** OFI · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como Dueño, quiero que la oficina dada de baja se elimine definitivamente a los 15 días, para no conservar datos que ya no se usan.
- **Criterios de aceptación:**
  1. Dada una oficina con más de 15 días de baja, entonces se elimina junto con habitaciones, tareas, anuncios, reuniones y mensajes.
  2. Dada la eliminación definitiva, entonces la oficina propia no se vuelve a crear automáticamente; el usuario queda sin oficina propia. ⚠️ A decidir: si debe poder crear una nueva.
- **Tareas técnicas:**
  - [back] Proceso programado de eliminación definitiva de la oficina y todo su contenido.
- **Depende de:** HU-OFI-014

### HU-OFI-017 · Invitación por email
- **Origen:** RF-OFI-017
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como Dueño o Administrador, quiero enviar la invitación directamente por email, para no tener que compartir el enlace a mano.
- **Criterios de aceptación:**
  1. Dado un email válido, cuando el Dueño o Administrador envía la invitación, entonces la persona recibe un enlace de invitación.
- **Tareas técnicas:**
  - [back] Envío del enlace de invitación por email.
  - [front] Campo de email en el panel de invitaciones.
- **Depende de:** HU-OFI-005, HU-AUT-006

### HU-OFI-018 · Solicitud de ingreso a una oficina
- **Origen:** RF-OFI-018
- **Repos:** ambos
- **Módulo:** OFI · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como usuario, quiero pedir ingreso a una oficina, para que el Dueño o un Administrador lo apruebe.
- **Criterios de aceptación:**
  1. Dada una solicitud pendiente, cuando el Dueño o Administrador la aprueba, entonces el usuario pasa a ser Miembro.
- **Tareas técnicas:**
  - [back] Solicitudes de ingreso con aprobación y rechazo.
  - [front] Pedido de ingreso y bandeja de solicitudes.
- **Depende de:** HU-OFI-003


---

## Habitaciones y accesos (HAB)

### HU-HAB-001 · Habitación principal
- **Origen:** RF-HAB-001
- **Repos:** back
- **Módulo:** HAB · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero que toda oficina tenga una habitación principal a la que siempre pueda entrar, para tener un punto de encuentro.
- **Criterios de aceptación:**
  1. Dada una oficina nueva, entonces tiene exactamente una habitación principal.
  2. Dado un miembro nuevo, entonces puede entrar a la habitación principal sin que se le otorgue acceso explícito.
  3. Dada la habitación principal, entonces nadie puede eliminarla ni quitarle acceso a un miembro.
  4. Dado un miembro que ingresa a la oficina, entonces comienza en la habitación principal.
- **Tareas técnicas:**
  - [back] Garantizar una única habitación principal, accesible a todos los miembros y no eliminable.
- **Depende de:** HU-OFI-001

### HU-HAB-002 · Creación de habitaciones
- **Origen:** RF-HAB-002
- **Repos:** ambos
- **Módulo:** HAB · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero crear habitaciones, para organizar el trabajo por equipos.
- **Criterios de aceptación:**
  1. Dado un Dueño o Administrador con un nombre válido, cuando crea la habitación, entonces aparece en la oficina y aún nadie más que el Dueño y los Administradores puede entrar.
  2. Dado un Líder o Miembro, cuando intenta crear una habitación, entonces el sistema responde 403.
  3. Dado un nombre vacío o repetido dentro de la misma oficina, entonces el sistema muestra un error claro.
  4. Dada una habitación nueva, entonces tiene su tablero con las columnas por defecto, cartelera, reuniones y chat propios.
- **Tareas técnicas:**
  - [back] Crear la habitación con nombre único, tablero con columnas por defecto y canal de chat.
  - [front] Formulario de nueva habitación.
- **Depende de:** HU-HAB-001

### HU-HAB-003 · Límite de habitaciones adicionales
- **Origen:** RF-HAB-003
- **Repos:** ambos
- **Módulo:** HAB · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero que el sistema me avise al llegar al límite de habitaciones, para saber cuántas puedo crear.
- **Criterios de aceptación:**
  1. Dada una oficina con 5 habitaciones adicionales, cuando se intenta crear otra, entonces el sistema la rechaza con un mensaje que indica el límite.
  2. Dada una habitación eliminada, entonces el cupo se libera.
  3. Dada la habitación principal, entonces no cuenta para el límite.
- **Tareas técnicas:**
  - [back] Validar el máximo de 5 habitaciones adicionales con un mensaje claro.
  - [front] Mostrar el aviso y deshabilitar la creación al llegar al límite.
- **Depende de:** HU-HAB-002

### HU-HAB-004 · Edición de habitaciones
- **Origen:** RF-HAB-004
- **Repos:** ambos
- **Módulo:** HAB · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero renombrar una habitación, para que su nombre refleje su uso.
- **Criterios de aceptación:**
  1. Dado un nombre válido, cuando se guarda, entonces los usuarios con acceso ven el nombre nuevo.
  2. Dado un Líder o Miembro, cuando intenta renombrarla, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Edición del nombre con permisos y validación.
  - [front] Formulario de edición.
- **Depende de:** HU-HAB-002

### HU-HAB-005 · Eliminación de habitaciones
- **Origen:** RF-HAB-005
- **Repos:** ambos
- **Módulo:** HAB · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero eliminar una habitación adicional, para liberar un lugar cuando ya no se usa.
- **Criterios de aceptación:**
  1. Dada una habitación con contenido, cuando se intenta eliminar, entonces el sistema advierte qué se perderá (tareas, anuncios, reuniones y mensajes) y pide confirmación.
  2. Dada la confirmación, entonces la habitación y su contenido se eliminan y los usuarios conectados en ella son llevados a la habitación principal.
  3. Dada la habitación principal, entonces no se puede eliminar.
  4. ⚠️ Supuesto: eliminar una habitación borra su contenido; no hay recuperación.
- **Tareas técnicas:**
  - [back] Eliminar la habitación con su contenido y llevar a los conectados a la principal.
  - [front] Diálogo de confirmación que detalla lo que se pierde.
- **Depende de:** HU-HAB-002

### HU-HAB-006a · Dar y quitar acceso a una habitación como Dueño o Administrador
- **Origen:** RF-HAB-006
- **Repos:** ambos
- **Módulo:** HAB · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero dar o quitar acceso a una habitación a un miembro, para controlar quién entra.
- **Criterios de aceptación:**
  1. Dado un Dueño o Administrador, cuando otorga acceso a un miembro, entonces este puede entrar a la habitación.
  2. Dado un acceso quitado, entonces se aplica RN-12 de inmediato, incluso si el usuario está conectado en la habitación.
- **Tareas técnicas:**
  - [back] Alta y baja de accesos con efecto inmediato (ver RN-12).
  - [front] Control de accesos por habitación.
- **Depende de:** HU-HAB-002, HU-OFI-010

### HU-HAB-006b · Dar acceso a mi habitación como Líder
- **Origen:** RF-HAB-006
- **Repos:** ambos
- **Módulo:** HAB · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Líder, quiero dar acceso a mi habitación a miembros de la oficina, para sumar gente a mi equipo.
- **Criterios de aceptación:**
  1. Dado un Líder, cuando otorga acceso a su habitación a un miembro de la oficina, entonces este puede entrar.
  2. Dado un Líder, cuando intenta dar acceso a una habitación que no lidera, entonces el sistema responde 403.
  3. Dado un Líder, cuando intenta dar acceso a alguien que no es miembro de la oficina, entonces el sistema lo rechaza.
  4. Dado un Miembro sin rol de Líder, cuando intenta otorgar acceso, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Validar que el Líder solo gestione su habitación y solo a miembros de la oficina.
  - [front] Selector de miembros dentro de la habitación.
- **Depende de:** HU-HAB-006a, HU-HAB-008

### HU-HAB-007 · Panel de accesos
- **Origen:** RF-HAB-007
- **Repos:** ambos
- **Módulo:** HAB · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero un panel que muestre quién tiene acceso a qué habitación, para gestionarlo en un solo lugar.
- **Criterios de aceptación:**
  1. Dado un Dueño o Administrador, cuando abre el panel, entonces ve a todos los miembros y todas las habitaciones con su acceso y liderazgo.
  2. Dado un cambio en el panel, cuando se guarda, entonces se aplica de inmediato y persiste.
  3. Dado un Líder, cuando abre el panel, entonces solo puede gestionar el acceso de su propia habitación.
  4. Dado un Miembro sin rol de Líder, cuando intenta abrir el panel, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Datos consolidados de accesos y liderazgos por miembro y habitación.
  - [front] Panel de accesos con edición.
- **Depende de:** HU-HAB-006a

### HU-HAB-008 · Asignación de Líderes
- **Origen:** RF-HAB-008
- **Repos:** ambos
- **Módulo:** HAB · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero asignar y quitar Líderes de una habitación, para delegar su gestión.
- **Criterios de aceptación:**
  1. Dado un miembro con acceso a una habitación, cuando se lo asigna como Líder, entonces puede ejecutar las acciones de Líder de la matriz de permisos en esa habitación.
  2. Dada una habitación con dos Líderes, entonces ambos tienen los mismos permisos.
  3. Dado un miembro sin acceso a la habitación, cuando se intenta asignarlo como Líder, entonces el sistema lo rechaza.
  4. Dado un Líder al que se le quita el acceso, entonces deja de ser Líder de esa habitación.
  5. Dado un Líder o Miembro, cuando intenta asignar Líderes, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Asignar y quitar el rol de Líder exigiendo acceso a la habitación; permitir varios.
  - [front] Acción de Líder en el panel de accesos.
- **Depende de:** HU-HAB-006a

### HU-HAB-009 · Cambio de habitación
- **Origen:** RF-HAB-009
- **Repos:** ambos
- **Módulo:** HAB · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero pasar de una habitación a otra de mi oficina, para trabajar con distintos equipos.
- **Criterios de aceptación:**
  1. Dado un usuario con acceso a varias habitaciones, cuando elige una, entonces su avatar pasa a ella y su presencia se actualiza para los demás.
  2. Dado el selector, entonces solo habilita las habitaciones a las que el usuario tiene acceso.
  3. Dado un usuario que intenta entrar a una habitación sin acceso, por cualquier medio, entonces el sistema responde 403.
  4. Dado un cambio de habitación, entonces el canal de chat por defecto pasa a ser el de la nueva habitación.
- **Tareas técnicas:**
  - [back] Autorizar el cambio de habitación y actualizar la presencia.
  - [front] Selector de habitación y cambio del canal de chat por defecto.
- **Depende de:** HU-HAB-001, HU-MUN-001

### HU-HAB-010 · Efecto de la pérdida de acceso
- **Origen:** RF-HAB-010
- **Repos:** ambos
- **Módulo:** HAB · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Dueño o Administrador, quiero que quien pierde el acceso a una habitación deje de verla de inmediato, para proteger su contenido.
- **Criterios de aceptación:**
  1. Dado un usuario conectado en una habitación, cuando pierde el acceso, entonces es llevado a la habitación principal.
  2. Dada la pérdida de acceso, entonces el usuario ya no ve tablero, cartelera, reuniones ni historial de chat de esa habitación.
  3. Dadas las tareas asignadas a ese usuario, entonces quedan marcadas como huérfanas (RF-TAR-009).
  4. Dado un anuncio o reunión creados por ese usuario, entonces se conservan.
- **Tareas técnicas:**
  - [back] Aplicar RN-12: sacar de la habitación, ocultar contenido y marcar tareas huérfanas.
  - [front] Reaccionar a la pérdida de acceso llevando al usuario a la habitación principal.
- **Depende de:** HU-HAB-006a

### HU-HAB-011 · Verificación de acceso en el servidor
- **Origen:** RF-HAB-011
- **Repos:** back
- **Módulo:** HAB · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero que cada operación sobre una habitación verifique mi acceso en el servidor, para que nadie pueda saltarse los permisos desde la interfaz.
- **Criterios de aceptación:**
  1. Dada una petición directa a un recurso de una habitación sin acceso, entonces el sistema responde 403.
  2. Dada una petición con un identificador de otra oficina, entonces el sistema no revela si el recurso existe.
  3. Dada la conexión a la presencia de una habitación, entonces el sistema también verifica el acceso antes de permitirla.
- **Tareas técnicas:**
  - [back] Verificación de membresía y acceso en todos los recursos de habitación, sin revelar si existen.
- **Depende de:** HU-AUT-005

### HU-HAB-012 · Acceso de solo lectura a una habitación
- **Origen:** RF-HAB-012
- **Repos:** ambos
- **Módulo:** HAB · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como Dueño, Administrador o Líder, quiero dar acceso de solo lectura a una habitación, para que alguien pueda ver sin modificar.
- **Criterios de aceptación:**
  1. Dado un miembro con acceso de solo lectura, cuando intenta crear o editar contenido, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Nivel de acceso de solo lectura aplicado a todas las operaciones de escritura.
  - [front] Opción de solo lectura y ocultar las acciones de edición.
- **Depende de:** HU-HAB-006a

### HU-HAB-013 · Límite configurable de habitaciones
- **Origen:** RF-HAB-013
- **Repos:** ambos
- **Módulo:** HAB · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como Dueño, quiero ampliar el límite de habitaciones, para crecer más allá de 5.
- **Criterios de aceptación:**
  1. Dado un nuevo límite configurado, cuando el Dueño crea habitaciones, entonces se respeta ese límite.
- **Tareas técnicas:**
  - [back] Límite de habitaciones configurable por oficina.
  - [front] Opción para ampliarlo.
- **Depende de:** HU-HAB-003


---

## Mundo 3D, avatar y presencia (MUN)

### HU-MUN-001 · Escena isométrica de la habitación
- **Origen:** RF-MUN-001
- **Repos:** front
- **Módulo:** MUN · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero ver la habitación en 3D con cámara isométrica, para ubicarme en el espacio.
- **Criterios de aceptación:**
  1. Dado un usuario con acceso, cuando entra a una habitación, entonces ve su escena y su propio avatar.
  2. Dada la cámara, entonces mantiene la perspectiva isométrica y no requiere control libre por parte del usuario.
  3. Dada una escena en carga, entonces el usuario ve un indicador de carga y, si falla, un mensaje de error con opción de reintentar.
- **Tareas técnicas:**
  - [front] Escena con piso, paredes y objetos, cámara isométrica fija, y estados de carga y error con reintento.
- **Depende de:** HU-OFI-003

### HU-MUN-002 · Movimiento con teclado
- **Origen:** RF-MUN-002
- **Repos:** front
- **Módulo:** MUN · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero moverme con las teclas W, A, S y D, para desplazar mi avatar.
- **Criterios de aceptación:**
  1. Dado un usuario en una habitación, cuando presiona una tecla de movimiento, entonces su avatar se desplaza en esa dirección de forma fluida.
  2. Dado un usuario escribiendo en un campo de texto (por ejemplo el chat), cuando presiona esas teclas, entonces el avatar no se mueve.
- **Tareas técnicas:**
  - [front] Movimiento por teclado que se ignora mientras se escribe en un campo de texto.
- **Depende de:** HU-MUN-001

### HU-MUN-003 · Movimiento por clic a destino
- **Origen:** RF-MUN-003
- **Repos:** front
- **Módulo:** MUN · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero hacer clic en una superficie de la habitación, para que mi avatar camine hasta ese punto.
- **Criterios de aceptación:**
  1. Dado un clic sobre una superficie transitable, entonces el avatar se desplaza hasta ese punto.
  2. Dado un clic sobre una superficie no transitable u obstáculo, entonces el avatar no atraviesa el obstáculo.
- **Tareas técnicas:**
  - [front] Detectar el clic sobre la superficie y calcular el recorrido esquivando obstáculos.
- **Depende de:** HU-MUN-001

### HU-MUN-004 · Controles táctiles
- **Origen:** RF-MUN-004
- **Repos:** front
- **Módulo:** MUN · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como miembro con dispositivo táctil, quiero moverme y usar objetos con toques, para jugar sin teclado ni mouse.
- **Criterios de aceptación:**
  1. Dado un dispositivo táctil, cuando el usuario toca una superficie transitable, entonces el avatar se desplaza hasta allí.
  2. Dado un dispositivo táctil, cuando toca un objeto interactuable, entonces se ejecuta la misma acción que con el mouse.
  3. Dado un dispositivo táctil sin teclado, entonces el usuario puede moverse sin usar WASD.
- **Tareas técnicas:**
  - [front] Controles táctiles equivalentes al mouse, incluido el movimiento sin WASD.
- **Depende de:** HU-MUN-003

### HU-MUN-005 · Colisiones y límites del espacio
- **Origen:** RF-MUN-005
- **Repos:** front
- **Módulo:** MUN · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero que mi avatar no atraviese paredes ni objetos, para que el espacio se sienta sólido.
- **Criterios de aceptación:**
  1. Dado un avatar que avanza contra una pared u objeto sólido, entonces se detiene o lo bordea.
  2. Dado un avatar, entonces no puede quedar fuera del área navegable.
- **Tareas técnicas:**
  - [front] Colisiones con paredes y objetos y límites del área navegable.
- **Depende de:** HU-MUN-001

### HU-MUN-006 · Avatar propio y de otros
- **Origen:** RF-MUN-006
- **Repos:** ambos
- **Módulo:** MUN · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero ver los avatares de quienes están en mi habitación, para saber con quién comparto el espacio.
- **Criterios de aceptación:**
  1. Dados dos usuarios con acceso en la misma habitación, entonces cada uno ve el avatar del otro.
  2. Dado un avatar, entonces muestra el nombre visible de su usuario.
  3. Dado un usuario en otra habitación, entonces su avatar no se muestra, pero sí figura en la lista de presencia (RF-MUN-010).
- **Tareas técnicas:**
  - [back] Estado de presencia por habitación con control de acceso.
  - [front] Mostrar los avatares con su nombre visible.
- **Depende de:** HU-MUN-001, HU-HAB-011

### HU-MUN-007 · Sincronización de movimiento en tiempo real
- **Origen:** RF-MUN-007
- **Repos:** ambos
- **Módulo:** MUN · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero ver moverse a los demás en tiempo real, para sentir su presencia.
- **Criterios de aceptación:**
  1. Dado un usuario que se mueve, entonces los demás en la habitación ven el movimiento sin necesidad de recargar.
  2. Dado el movimiento de otro usuario, entonces se ve continuo y no a saltos bruscos.
  3. Dado un movimiento imposible (atravesar paredes o saltar de lugar), entonces no es aceptado por el servidor.
- **Tareas técnicas:**
  - [back] Recibir y validar movimientos (rechazar los imposibles) y difundirlos.
  - [front] Enviar el propio movimiento y mostrar el de otros de forma continua.
- **Depende de:** HU-MUN-006

### HU-MUN-008 · Entrada, salida y desconexión de avatares
- **Origen:** RF-MUN-008
- **Repos:** ambos
- **Módulo:** MUN · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero que los avatares aparezcan y desaparezcan cuando alguien entra, sale o se desconecta, para ver quién está realmente.
- **Criterios de aceptación:**
  1. Dado un usuario que entra a la habitación, entonces su avatar aparece para los demás.
  2. Dado un usuario que sale, cambia de habitación o cierra sesión, entonces su avatar desaparece de la habitación anterior.
  3. Dado un usuario que pierde la conexión, entonces su avatar desaparece pasado un tiempo breve.
- **Tareas técnicas:**
  - [back] Detectar entradas, salidas y desconexiones.
  - [front] Alta y baja de avatares en la escena.
- **Depende de:** HU-MUN-006

### HU-MUN-009 · Reconexión
- **Origen:** RF-MUN-009
- **Repos:** ambos
- **Módulo:** MUN · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como miembro, quiero que la aplicación me reconecte si se corta la conexión, para volver a mi habitación sin esfuerzo.
- **Criterios de aceptación:**
  1. Dada una desconexión breve, cuando se recupera la red, entonces el usuario vuelve a su habitación sin acción manual.
  2. Dada una reconexión fallida, entonces el usuario ve un aviso y una opción para reintentar.
  3. Dada una reconexión luego de perder acceso, entonces no se le permite volver a la habitación.
- **Tareas técnicas:**
  - [back] Permitir reanudar la sesión validando que el acceso siga vigente.
  - [front] Reintento automático y aviso si falla.
- **Depende de:** HU-MUN-008

### HU-MUN-010 · Lista de presencia
- **Origen:** RF-MUN-010
- **Repos:** ambos
- **Módulo:** MUN · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero ver una lista de quién está conectado y en qué habitación, para encontrar a mis compañeros.
- **Criterios de aceptación:**
  1. Dado un miembro de la oficina, cuando abre la lista, entonces ve quién está conectado y en qué habitación.
  2. Dado un usuario que cambia de habitación, entonces la lista se actualiza sin recargar.
  3. Dado un usuario que se desconecta, entonces deja de figurar como conectado.
  4. Dada una habitación sin acceso, entonces la lista muestra quién está allí pero no su contenido.
  5. Dado un usuario de otra oficina, entonces nunca aparece en la lista.
- **Tareas técnicas:**
  - [back] Presencia por oficina y habitación, sin cruzar oficinas.
  - [front] Lista de presencia actualizada en vivo.
- **Depende de:** HU-MUN-008

### HU-MUN-011 · Personalización y persistencia del avatar
- **Origen:** RF-MUN-011
- **Repos:** ambos
- **Módulo:** MUN · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como usuario, quiero personalizar mi avatar y que se conserve, para expresar mi identidad.
- **Criterios de aceptación:**
  1. Dado un usuario que modifica su avatar, cuando guarda, entonces su nuevo aspecto persiste tras recargar y cerrar sesión.
  2. Dado un avatar modificado, entonces los demás usuarios lo ven actualizado.
  3. Dado un usuario nuevo, entonces tiene un avatar por defecto.
- **Tareas técnicas:**
  - [back] Persistir la configuración del avatar con uno por defecto.
  - [front] Editor de avatar con vista previa.
- **Depende de:** HU-AUT-002, HU-MUN-006

### HU-MUN-012 · Acceso a las funciones sin apuntar a objetos 3D
- **Origen:** RF-MUN-012
- **Repos:** front
- **Módulo:** MUN · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como miembro, quiero un menú para abrir las herramientas sin apuntar a objetos 3D, para poder usarlas con teclado o desde cualquier dispositivo.
- **Criterios de aceptación:**
  1. Dado un usuario con teclado, cuando usa el menú, entonces puede abrir cada herramienta sin usar el mouse sobre la escena.
  2. Dado un usuario que abre una herramienta desde el menú, entonces ve la misma interfaz que desde el objeto.
  3. Dado un usuario sin acceso a una herramienta, entonces el menú no la muestra habilitada.
- **Tareas técnicas:**
  - [front] Menú con tareas, cartelera, reuniones, chat, habitaciones y bot, navegable con teclado.
- **Depende de:** HU-MUN-001

### HU-MUN-013 · Uso en pantallas pequeñas
- **Origen:** RF-MUN-013
- **Repos:** front
- **Módulo:** MUN · **Prioridad:** Could · **Fase:** MVP
- **Historia:** Como miembro con celular, quiero una disposición adaptada, para usar la plataforma desde un teléfono.
- **Criterios de aceptación:**
  1. Dado un celular, cuando el usuario ingresa a una habitación, entonces puede ver la escena, moverse y abrir los paneles de herramientas.
- **Tareas técnicas:**
  - [front] Diseño adaptable y paneles de herramientas aptos para pantallas pequeñas.
- **Depende de:** HU-MUN-004

### HU-MUN-014 · Estados de actividad
- **Origen:** RF-MUN-014
- **Repos:** ambos
- **Módulo:** MUN · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como miembro, quiero indicar mi disponibilidad, para que los demás sepan si pueden contar conmigo.
- **Criterios de aceptación:**
  1. Dado un cambio de estado, entonces los demás miembros lo ven junto al avatar y en la lista de presencia.
- **Tareas técnicas:**
  - [back] Guardar y difundir el estado de actividad.
  - [front] Selector de estado y visualización junto al avatar y en la lista de presencia.
- **Depende de:** HU-MUN-010

### HU-MUN-015 · Emotes y acciones sociales
- **Origen:** RF-MUN-015
- **Repos:** ambos
- **Módulo:** MUN · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como miembro, quiero hacer gestos con mi avatar, para comunicarme de forma más expresiva.
- **Criterios de aceptación:**
  1. Dado un emote elegido, entonces los demás usuarios en la habitación ven la animación en su avatar.
- **Tareas técnicas:**
  - [back] Difundir el emote a la habitación.
  - [front] Selector de emotes y animación en el avatar.
- **Depende de:** HU-MUN-007

### HU-MUN-016 · Sonido ambiente y efectos
- **Origen:** RF-MUN-016
- **Repos:** front
- **Módulo:** MUN · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como usuario, quiero sonidos ambientales que pueda silenciar, para personalizar mi experiencia.
- **Criterios de aceptación:**
  1. Dado un usuario que silencia el sonido, entonces la preferencia se conserva.
- **Tareas técnicas:**
  - [front] Reproducción de sonidos y control de silencio recordado en el dispositivo.
- **Depende de:** HU-MUN-001


---

## Tareas (Kanban) (TAR)

### HU-TAR-001 · Ver el tablero de una habitación
- **Origen:** RF-TAR-001
- **Repos:** ambos
- **Módulo:** TAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero ver su tablero Kanban, para saber qué hay por hacer.
- **Criterios de aceptación:**
  1. Dado un usuario con acceso, cuando abre el tablero, entonces ve las columnas en orden y las tareas de cada una.
  2. Dado un tablero sin tareas, entonces el usuario ve un estado vacío que invita a crear la primera.
  3. Dado un usuario sin acceso a la habitación, cuando intenta ver el tablero, entonces el sistema responde 403.
  4. Dada una carga lenta o fallida, entonces el usuario ve un indicador de carga o un mensaje de error.
- **Tareas técnicas:**
  - [back] Obtener tablero, columnas y tareas de la habitación con control de acceso (403).
  - [front] Vista del tablero con estados de carga, vacío y error.
- **Depende de:** HU-HAB-011, HU-TAR-006

### HU-TAR-002 · Crear tarea
- **Origen:** RF-TAR-002
- **Repos:** ambos
- **Módulo:** TAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero crear una tarea con título, descripción, responsable, fecha límite y prioridad, para registrar el trabajo pendiente.
- **Criterios de aceptación:**
  1. Dado un título válido, cuando el usuario guarda, entonces la tarea aparece en la primera columna del tablero.
  2. Dado un título vacío, cuando intenta guardar, entonces ve un error y el servidor también rechaza la tarea.
  3. Dada una tarea creada, entonces persiste tras recargar y los demás usuarios de la habitación la ven.
  4. Dado un usuario sin acceso a la habitación, cuando intenta crear una tarea, entonces el sistema responde 403.
  5. Dado un título o descripción que superan el máximo permitido, entonces el sistema muestra un error claro.
- **Tareas técnicas:**
  - [back] Crear la tarea con validación y persistencia.
  - [front] Formulario de tarea con errores por campo.
- **Depende de:** HU-TAR-001

### HU-TAR-003 · Editar tarea
- **Origen:** RF-TAR-003
- **Repos:** ambos
- **Módulo:** TAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero editar una tarea, para mantenerla actualizada.
- **Criterios de aceptación:**
  1. Dada una tarea, cuando un usuario con acceso modifica sus campos con datos válidos, entonces los cambios persisten y los demás los ven.
  2. Dados datos inválidos, cuando intenta guardar, entonces ve el error por campo.
  3. Dado un usuario sin acceso, cuando intenta editar, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Edición de tareas con validación y control de acceso.
  - [front] Edición de la tarea con errores por campo.
- **Depende de:** HU-TAR-002

### HU-TAR-004 · Mover tarea entre columnas
- **Origen:** RF-TAR-004
- **Repos:** ambos
- **Módulo:** TAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero mover una tarea a otra columna, para reflejar el avance del trabajo.
- **Criterios de aceptación:**
  1. Dado un usuario con acceso, cuando arrastra la tarea a otra columna, entonces queda en la nueva columna y el cambio persiste al recargar.
  2. Dado un usuario sin acceso a la habitación, cuando intenta moverla, entonces el sistema responde 403.
  3. Dados otros usuarios conectados a esa habitación, cuando se mueve la tarea, entonces ven el cambio sin recargar.
  4. Dado un dispositivo táctil, entonces existe una forma de mover la tarea sin arrastrar (por ejemplo un menú).
- **Tareas técnicas:**
  - [back] Operación para mover la tarea: validar acceso (403), persistir y difundir el cambio.
  - [front] Arrastrar y soltar en el tablero, alternativa táctil y actualización en vivo.
- **Depende de:** HU-TAR-001, HU-HAB-011

### HU-TAR-005 · Eliminar tarea
- **Origen:** RF-TAR-005
- **Repos:** ambos
- **Módulo:** TAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero eliminar una tarea, para sacar del tablero lo que ya no corresponde.
- **Criterios de aceptación:**
  1. Dada una tarea, cuando el usuario confirma la eliminación, entonces desaparece del tablero y no vuelve al recargar.
  2. Dada la eliminación, entonces el sistema pide confirmación antes de ejecutarla.
  3. Dado un usuario sin acceso, cuando intenta eliminarla, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Eliminar la tarea con control de acceso.
  - [front] Acción con confirmación previa.
- **Depende de:** HU-TAR-002

### HU-TAR-006 · Columnas por defecto
- **Origen:** RF-TAR-006
- **Repos:** back
- **Módulo:** TAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero que cada tablero nuevo tenga columnas Pendiente, En curso y Hecho, para empezar a trabajar de inmediato.
- **Criterios de aceptación:**
  1. Dada una habitación nueva, entonces su tablero tiene esas tres columnas en ese orden.
- **Tareas técnicas:**
  - [back] Crear las tres columnas por defecto al crear cada habitación.
- **Depende de:** HU-HAB-002

### HU-TAR-007 · Configurar columnas del tablero
- **Origen:** RF-TAR-007
- **Repos:** ambos
- **Módulo:** TAR · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como Líder, Administrador o Dueño, quiero crear, renombrar, reordenar y eliminar columnas, para adaptar el tablero al equipo.
- **Criterios de aceptación:**
  1. Dado un Líder, Administrador o Dueño, cuando agrega o renombra una columna con un nombre válido, entonces el cambio se refleja para todos los usuarios con acceso.
  2. Dada una columna con tareas, cuando se intenta eliminar, entonces el sistema exige elegir a qué columna se mueven las tareas.
  3. Dado un tablero, entonces no puede quedar sin columnas.
  4. Dado un Miembro sin rol de Líder, cuando intenta cambiar la estructura del tablero, entonces el sistema responde 403.
  5. Dados dos columnas con el mismo nombre en el mismo tablero, entonces el sistema lo rechaza.
- **Tareas técnicas:**
  - [back] Gestión de columnas con permisos, sin dejar el tablero vacío y reubicando tareas al eliminar.
  - [front] Edición de columnas en el tablero.
- **Depende de:** HU-TAR-001

### HU-TAR-008 · Asignar responsable
- **Origen:** RF-TAR-008
- **Repos:** ambos
- **Módulo:** TAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero asignar una tarea a alguien de la habitación, para que haya un responsable.
- **Criterios de aceptación:**
  1. Dada una tarea, cuando se asigna a un usuario con acceso a la habitación, entonces el responsable queda visible en la tarea.
  2. Dado un usuario sin acceso a la habitación, cuando se intenta asignarlo, entonces el sistema lo rechaza.
  3. Dada una asignación, entonces el responsable recibe una notificación (RF-NOT-002).
- **Tareas técnicas:**
  - [back] Validar que el responsable tenga acceso y notificar la asignación.
  - [front] Selector de responsable.
- **Depende de:** HU-TAR-002

### HU-TAR-009 · Tareas huérfanas
- **Origen:** RF-TAR-009
- **Repos:** ambos
- **Módulo:** TAR · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero ver marcadas las tareas sin responsable activo, para reasignarlas.
- **Criterios de aceptación:**
  1. Dado un responsable que pierde acceso, entonces sus tareas siguen en el tablero pero con una marca visible de "sin responsable activo".
  2. Dado el responsable que ya no tiene acceso, entonces no puede ver ni editar la tarea.
  3. Dada una tarea huérfana que alguien reasigna, entonces la marca desaparece.
- **Tareas técnicas:**
  - [back] Marcar tareas cuyo responsable perdió acceso o dejó la oficina.
  - [front] Marca visual en la tarea y reasignación.
- **Depende de:** HU-TAR-008, HU-HAB-010

### HU-TAR-010 · Vista de lista y filtros
- **Origen:** RF-TAR-010
- **Repos:** ambos
- **Módulo:** TAR · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero ver las tareas en lista y filtrarlas, para encontrar lo que busco.
- **Criterios de aceptación:**
  1. Dado el listado, cuando el usuario aplica un filtro, entonces solo ve las tareas que coinciden.
  2. Dado un filtro sin resultados, entonces el usuario ve un estado vacío que lo indica.
- **Tareas técnicas:**
  - [back] Consulta de tareas con filtros por responsable, columna y prioridad.
  - [front] Vista de lista con filtros y estado vacío.
- **Depende de:** HU-TAR-001

### HU-TAR-011 · Actualización del tablero en vivo
- **Origen:** RF-TAR-011
- **Repos:** ambos
- **Módulo:** TAR · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero ver los cambios de otros en el tablero sin recargar, para trabajar en equipo.
- **Criterios de aceptación:**
  1. Dados dos usuarios con el tablero abierto, cuando uno crea, edita, mueve o elimina una tarea, entonces el otro ve el cambio en pocos segundos.
  2. Dados cambios simultáneos sobre una misma tarea, entonces el sistema conserva un estado coherente y avisa al usuario si su cambio no se aplicó.
- **Tareas técnicas:**
  - [back] Difundir cambios de tareas a los conectados y resolver cambios simultáneos.
  - [front] Actualizar el tablero en vivo y avisar si un cambio no se aplicó.
- **Depende de:** HU-TAR-004

### HU-TAR-012 · Fecha límite y vencidas
- **Origen:** RF-TAR-012
- **Repos:** front
- **Módulo:** TAR · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero ver destacadas las tareas vencidas o próximas a vencer, para priorizar.
- **Criterios de aceptación:**
  1. Dada una tarea con fecha límite pasada y que no está en la última columna, entonces se muestra como vencida.
  2. Dada una tarea que vence en los próximos días, entonces se muestra como próxima a vencer.
- **Tareas técnicas:**
  - [front] Resaltar tareas vencidas y próximas a vencer según su fecha límite.
- **Depende de:** HU-TAR-002

### HU-TAR-013 · Mis tareas
- **Origen:** RF-TAR-013
- **Repos:** ambos
- **Módulo:** TAR · **Prioridad:** Could · **Fase:** MVP
- **Historia:** Como usuario, quiero ver todas las tareas que tengo asignadas en mis oficinas, para tener una visión conjunta.
- **Criterios de aceptación:**
  1. Dado un usuario con tareas en varias oficinas, entonces las ve agrupadas por oficina y habitación.
  2. Dado un usuario sin acceso a una habitación, entonces sus tareas de esa habitación no se listan.
- **Tareas técnicas:**
  - [back] Listado de tareas del usuario limitado a las habitaciones con acceso.
  - [front] Vista Mis tareas agrupada por oficina y habitación.
- **Depende de:** HU-TAR-008

### HU-TAR-014 · Comentarios, etiquetas y adjuntos en tareas
- **Origen:** RF-TAR-014
- **Repos:** ambos
- **Módulo:** TAR · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como miembro con acceso a la habitación, quiero comentar y etiquetar tareas y adjuntar archivos, para dar más contexto.
- **Criterios de aceptación:**
  1. Dada una tarea, cuando un usuario con acceso agrega un comentario, entonces los demás lo ven.
- **Tareas técnicas:**
  - [back] Comentarios, etiquetas y adjuntos de tareas.
  - [front] Secciones de comentarios, etiquetas y adjuntos en la tarea.
- **Depende de:** HU-TAR-003


---

## Cartelera y reuniones (CAR)

### HU-CAR-001 · Ver la cartelera
- **Origen:** RF-CAR-001
- **Repos:** ambos
- **Módulo:** CAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero ver su cartelera, para enterarme de los avisos.
- **Criterios de aceptación:**
  1. Dado un usuario con acceso, cuando abre la cartelera, entonces ve los anuncios con título, contenido, autor y fecha.
  2. Dada una cartelera sin anuncios, entonces el usuario ve un estado vacío.
  3. Dado un usuario sin acceso a la habitación, cuando intenta verla, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Listado de anuncios por habitación con control de acceso.
  - [front] Cartelera con estado vacío.
- **Depende de:** HU-HAB-011, HU-HAB-001

### HU-CAR-002 · Publicar un anuncio
- **Origen:** RF-CAR-002
- **Repos:** ambos
- **Módulo:** CAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Líder, Administrador o Dueño, quiero publicar anuncios en la cartelera, para informar al equipo.
- **Criterios de aceptación:**
  1. Dado un título y contenido válidos, cuando se publica, entonces el anuncio aparece en la cartelera y persiste.
  2. Dado un Miembro sin rol de Líder, cuando intenta publicar, entonces el sistema responde 403.
  3. Dado un Líder, cuando intenta publicar en una habitación que no lidera, entonces el sistema responde 403.
  4. Dados datos inválidos, entonces ve el error por campo.
- **Tareas técnicas:**
  - [back] Publicar anuncios con permisos de Líder en su habitación.
  - [front] Formulario de anuncio con errores por campo.
- **Depende de:** HU-CAR-001, HU-HAB-008

### HU-CAR-003 · Editar y eliminar anuncios propios
- **Origen:** RF-CAR-003
- **Repos:** ambos
- **Módulo:** CAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como autor de un anuncio, quiero editarlo o eliminarlo, para mantenerlo actualizado.
- **Criterios de aceptación:**
  1. Dado un autor, cuando edita su anuncio, entonces el cambio persiste y los demás lo ven.
  2. Dado un autor, cuando confirma la eliminación, entonces el anuncio desaparece de la cartelera.
  3. Dado un Líder, cuando intenta editar o eliminar un anuncio de otra persona, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Edición y baja de anuncios propios, rechazando los ajenos a los Líderes.
  - [front] Acciones de editar y eliminar en mis anuncios.
- **Depende de:** HU-CAR-002

### HU-CAR-004 · Gestionar anuncios ajenos
- **Origen:** RF-CAR-004
- **Repos:** ambos
- **Módulo:** CAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Administrador o Dueño, quiero editar o eliminar anuncios de cualquier autor, para moderar la cartelera.
- **Criterios de aceptación:**
  1. Dado un Administrador o Dueño, cuando edita o elimina un anuncio ajeno, entonces el cambio persiste.
  2. Dado un Líder o Miembro, cuando intenta lo mismo, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Edición y baja de anuncios ajenos para Administrador y Dueño.
  - [front] Acciones de moderación en todos los anuncios.
- **Depende de:** HU-CAR-002

### HU-CAR-005 · Crear una reunión
- **Origen:** RF-CAR-005
- **Repos:** ambos
- **Módulo:** CAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como Líder, Administrador o Dueño, quiero crear una reunión con fecha y hora, para convocar al equipo.
- **Criterios de aceptación:**
  1. Dados datos válidos, cuando se crea, entonces la reunión aparece en la habitación para quienes tienen acceso.
  2. Dada una hora de fin anterior a la de inicio, entonces el sistema la rechaza con un error claro.
  3. Dado un Miembro sin rol de Líder, cuando intenta crear una reunión, entonces el sistema responde 403.
  4. Dada una reunión creada, entonces los miembros con acceso reciben una notificación (RF-NOT-002).
- **Tareas técnicas:**
  - [back] Crear reuniones con validación de horario y notificar a los miembros con acceso.
  - [front] Formulario de reunión.
- **Depende de:** HU-HAB-011, HU-HAB-008

### HU-CAR-006 · Editar y cancelar reuniones
- **Origen:** RF-CAR-006
- **Repos:** ambos
- **Módulo:** CAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como creador de una reunión, quiero editarla o cancelarla, para reflejar cambios de planes.
- **Criterios de aceptación:**
  1. Dado el creador, cuando edita fecha u hora, entonces los asistentes confirmados reciben una notificación del cambio.
  2. Dado el creador, cuando cancela la reunión, entonces queda marcada como cancelada y los confirmados son notificados.
  3. Dado un Líder, cuando intenta editar o cancelar una reunión de otra persona, entonces el sistema responde 403.
  4. Dado un Administrador o Dueño, cuando lo hace con una reunión ajena, entonces el cambio persiste.
- **Tareas técnicas:**
  - [back] Edición y cancelación con permisos y notificación a los confirmados.
  - [front] Acciones de editar y cancelar.
- **Depende de:** HU-CAR-005

### HU-CAR-007 · Confirmar asistencia
- **Origen:** RF-CAR-007
- **Repos:** ambos
- **Módulo:** CAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero confirmar o declinar mi asistencia a una reunión, para que el equipo sepa si voy.
- **Criterios de aceptación:**
  1. Dado un usuario con acceso, cuando confirma o declina, entonces su respuesta persiste y puede cambiarla antes de la reunión.
  2. Dada una reunión cancelada o pasada, entonces no se puede cambiar la respuesta.
  3. Dado un usuario sin acceso a la habitación, cuando intenta responder, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Registrar y cambiar la respuesta hasta el inicio de la reunión.
  - [front] Botones de asistencia.
- **Depende de:** HU-CAR-005

### HU-CAR-008 · Ver asistentes
- **Origen:** RF-CAR-008
- **Repos:** ambos
- **Módulo:** CAR · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero ver quién confirmó su asistencia, para saber con quién cuento.
- **Criterios de aceptación:**
  1. Dada una reunión con respuestas, entonces el usuario ve las listas de confirmados y de quienes declinaron.
  2. Dada una reunión sin respuestas, entonces el usuario ve que aún nadie respondió.
- **Tareas técnicas:**
  - [back] Listado de respuestas por reunión.
  - [front] Listas de confirmados y de quienes declinaron.
- **Depende de:** HU-CAR-007

### HU-CAR-009 · Lista de reuniones
- **Origen:** RF-CAR-009
- **Repos:** ambos
- **Módulo:** CAR · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero ver las reuniones en una lista ordenada por fecha, para saber qué viene.
- **Criterios de aceptación:**
  1. Dado un usuario con acceso, cuando abre la lista, entonces ve las próximas primero, con su estado de asistencia propio.
  2. Dada una lista sin reuniones, entonces ve un estado vacío.
- **Tareas técnicas:**
  - [back] Listado de reuniones separando próximas y pasadas.
  - [front] Lista de reuniones con mi estado de asistencia y estado vacío.
- **Depende de:** HU-CAR-005

### HU-CAR-010 · Vista de calendario
- **Origen:** RF-CAR-010
- **Repos:** front
- **Módulo:** CAR · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero ver las reuniones en un calendario, para planificar mejor mi tiempo.
- **Criterios de aceptación:**
  1. Dado el calendario, cuando el usuario elige un día con reuniones, entonces ve su detalle.
  2. Dado el calendario, entonces las fechas y horas se muestran en la zona horaria de Argentina (RN-19).
- **Tareas técnicas:**
  - [front] Vista mensual o semanal con detalle por día, en zona horaria de Argentina.
- **Depende de:** HU-CAR-009

### HU-CAR-011 · Anuncio para toda la oficina
- **Origen:** RF-CAR-011
- **Repos:** ambos
- **Módulo:** CAR · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como Administrador o Dueño, quiero publicar un anuncio visible en todas las habitaciones, para avisar a toda la oficina.
- **Criterios de aceptación:**
  1. Dado un anuncio de oficina, entonces los miembros lo ven al entrar a cualquiera de sus habitaciones.
- **Tareas técnicas:**
  - [back] Anuncios de oficina visibles en todas las habitaciones.
  - [front] Mostrar los anuncios de oficina en cada cartelera.
- **Depende de:** HU-CAR-002

### HU-CAR-012 · Recordatorios y reuniones recurrentes
- **Origen:** RF-CAR-012
- **Repos:** ambos
- **Módulo:** CAR · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como Líder, Administrador o Dueño, quiero reuniones recurrentes con recordatorios, para no repetir su carga.
- **Criterios de aceptación:**
  1. Dada una reunión con recordatorio, entonces los confirmados reciben una notificación antes del inicio.
- **Tareas técnicas:**
  - [back] Repetición de reuniones y envío de recordatorios.
  - [front] Opciones de recurrencia y recordatorio en el formulario.
- **Depende de:** HU-CAR-005, HU-NOT-001


---

## Chat (CHA)

### HU-CHA-001 · Canal de la oficina
- **Origen:** RF-CHA-001
- **Repos:** ambos
- **Módulo:** CHA · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero un chat de toda la oficina, para hablar con todos sin importar en qué habitación esté.
- **Criterios de aceptación:**
  1. Dado un miembro de la oficina, cuando abre el canal de la oficina, entonces puede leer y escribir mensajes sin importar en qué habitación esté.
  2. Dado un usuario que no es miembro, cuando intenta leer o escribir, entonces el sistema responde 403.
  3. Dado un mensaje en el canal de la oficina, entonces nunca es visible en otra oficina.
- **Tareas técnicas:**
  - [back] Canal de oficina con acceso por membresía.
  - [front] Panel de chat con el canal de la oficina.
- **Depende de:** HU-OFI-003

### HU-CHA-002 · Canal de la habitación
- **Origen:** RF-CHA-002
- **Repos:** ambos
- **Módulo:** CHA · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro con acceso a la habitación, quiero un chat propio de la habitación, para hablar con quienes trabajan conmigo allí.
- **Criterios de aceptación:**
  1. Dado un usuario con acceso, cuando abre el canal de la habitación, entonces lee y escribe mensajes.
  2. Dado un usuario sin acceso a la habitación, cuando intenta leer o escribir en su canal, entonces el sistema responde 403.
  3. Dado un usuario que pierde el acceso, entonces ya no puede leer el historial de ese canal (RN-12).
- **Tareas técnicas:**
  - [back] Canal de habitación con control de acceso (403).
  - [front] Canal de habitación en el panel de chat.
- **Depende de:** HU-CHA-001, HU-HAB-011

### HU-CHA-003 · Elegir el canal de envío
- **Origen:** RF-CHA-003
- **Repos:** front
- **Módulo:** CHA · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero elegir en qué canal envío mi mensaje, para dirigirme a la habitación o a toda la oficina.
- **Criterios de aceptación:**
  1. Dada la caja de mensaje, entonces muestra de forma visible el canal de destino actual.
  2. Dado un usuario que cambia el canal, cuando envía, entonces el mensaje llega solo a ese canal.
  3. Dado un cambio de habitación, entonces el canal de habitación por defecto pasa a ser el de la nueva habitación.
  4. Dado un usuario que no está en ninguna habitación con acceso (por ejemplo, tras perderlo), entonces solo puede elegir el canal de la oficina.
- **Tareas técnicas:**
  - [front] Selector de canal visible con el de la habitación actual por defecto.
- **Depende de:** HU-CHA-002

### HU-CHA-004 · Enviar mensaje
- **Origen:** RF-CHA-004
- **Repos:** ambos
- **Módulo:** CHA · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero enviar mensajes de texto, para comunicarme con mi equipo.
- **Criterios de aceptación:**
  1. Dado un mensaje válido, cuando lo envía, entonces aparece en el canal con su nombre visible y la hora.
  2. Dado un mensaje vacío o solo con espacios, entonces no se envía.
  3. Dado un mensaje que supera el máximo de caracteres, entonces el sistema muestra un error claro.
  4. Dado un mensaje con texto con formato especial o código, entonces se muestra como texto y no se interpreta (no ejecuta contenido).
- **Tareas técnicas:**
  - [back] Validar largo y contenido vacío, y guardar el mensaje.
  - [front] Caja de mensaje con validaciones y texto mostrado como texto plano.
- **Depende de:** HU-CHA-001

### HU-CHA-005 · Recepción en tiempo real
- **Origen:** RF-CHA-005
- **Repos:** ambos
- **Módulo:** CHA · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero recibir mensajes nuevos sin recargar, para conversar con fluidez.
- **Criterios de aceptación:**
  1. Dados dos usuarios con el canal abierto, cuando uno envía un mensaje, entonces el otro lo ve en pocos segundos.
  2. Dado un usuario que pierde conexión, cuando se reconecta, entonces recibe los mensajes que se perdió.
- **Tareas técnicas:**
  - [back] Difundir mensajes a los conectados y entregar los perdidos al reconectar.
  - [front] Mostrar los mensajes nuevos en vivo.
- **Depende de:** HU-CHA-004

### HU-CHA-006 · Historial persistente
- **Origen:** RF-CHA-006
- **Repos:** ambos
- **Módulo:** CHA · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero consultar el historial de un canal, para retomar conversaciones previas.
- **Criterios de aceptación:**
  1. Dado un canal con mensajes previos, cuando el usuario lo abre, entonces ve los más recientes ordenados cronológicamente.
  2. Dado un historial largo, cuando el usuario se desplaza hacia arriba, entonces se cargan mensajes más antiguos.
  3. Dado un canal sin mensajes, entonces el usuario ve un estado vacío.
  4. Dado un reinicio del sistema, entonces el historial se conserva.
- **Tareas técnicas:**
  - [back] Historial paginado y persistente.
  - [front] Desplazamiento con carga progresiva y estado vacío.
- **Depende de:** HU-CHA-004

### HU-CHA-007 · Control de acceso del historial
- **Origen:** RF-CHA-007
- **Repos:** back
- **Módulo:** CHA · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero que solo quienes tienen acceso vigente lean un canal, para que mis conversaciones queden protegidas.
- **Criterios de aceptación:**
  1. Dado un usuario expulsado o que abandonó la oficina, entonces no puede leer ningún canal de esa oficina, aunque conserve los mensajes que ya generó (RN-13).
  2. Dado un usuario al que se le otorga acceso nuevamente, entonces puede volver a leer el historial de esa habitación. ⚠️ Supuesto.
- **Tareas técnicas:**
  - [back] Restringir la lectura del historial a quienes tienen acceso vigente, incluso si se quita y se vuelve a dar.
- **Depende de:** HU-CHA-006, HU-HAB-010

### HU-CHA-008 · Indicador de mensajes no leídos
- **Origen:** RF-CHA-008
- **Repos:** ambos
- **Módulo:** CHA · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como miembro, quiero ver cuándo hay mensajes sin leer en un canal, para no perderme conversaciones.
- **Criterios de aceptación:**
  1. Dado un canal con mensajes sin leer, entonces se muestra un indicador junto a su nombre.
  2. Dado el usuario que abre el canal, entonces el indicador desaparece.
- **Tareas técnicas:**
  - [back] Estado de lectura por usuario y canal.
  - [front] Indicador de no leídos que desaparece al abrir el canal.
- **Depende de:** HU-CHA-005

### HU-CHA-009 · Mensajería privada
- **Origen:** RF-CHA-009
- **Repos:** ambos
- **Módulo:** CHA · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como miembro, quiero enviar mensajes privados a otro miembro, para hablar sin que lo vea el resto.
- **Criterios de aceptación:**
  1. Dados dos miembros de la oficina, cuando uno escribe al otro, entonces solo ellos ven la conversación.
- **Tareas técnicas:**
  - [back] Conversaciones privadas entre miembros de la oficina.
  - [front] Interfaz de mensajes privados, accesible desde un objeto.
- **Depende de:** HU-CHA-004, HU-OBJ-006

### HU-CHA-010 · Editar y eliminar mensajes
- **Origen:** RF-CHA-010
- **Repos:** ambos
- **Módulo:** CHA · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como autor, quiero editar o eliminar mis mensajes, para corregirme; y como Administrador o Dueño, quiero eliminar mensajes ajenos, para moderar.
- **Criterios de aceptación:**
  1. Dado el autor, cuando elimina su mensaje, entonces deja de verse en el canal.
  2. Dado un Miembro, cuando intenta eliminar un mensaje ajeno, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Edición y baja de mensajes con permisos.
  - [front] Acciones de editar y eliminar en los mensajes.
- **Depende de:** HU-CHA-004


---

## Notificaciones (NOT)

### HU-NOT-001 · Centro de notificaciones
- **Origen:** RF-NOT-001
- **Repos:** ambos
- **Módulo:** NOT · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como usuario, quiero un centro de notificaciones con contador de no leídas, para enterarme de lo que me afecta.
- **Criterios de aceptación:**
  1. Dado un usuario con notificaciones, cuando abre el centro, entonces las ve ordenadas de la más reciente a la más antigua.
  2. Dado un usuario con notificaciones sin leer, entonces ve el contador en un lugar visible.
  3. Dado un usuario sin notificaciones, entonces ve un estado vacío.
- **Tareas técnicas:**
  - [back] Listado y contador de notificaciones del usuario.
  - [front] Campana con contador, lista y estado vacío.
- **Depende de:** HU-AUT-002

### HU-NOT-002a · Notificar tareas, accesos, roles y expulsión
- **Origen:** RF-NOT-002
- **Repos:** ambos
- **Módulo:** NOT · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como usuario, quiero que me avisen cuando me asignan una tarea o cambian mis accesos y roles, para enterarme sin tener que revisar.
- **Criterios de aceptación:**
  1. Dado que se le asigna una tarea, entonces recibe una notificación indicando la tarea y la habitación.
  2. Dado que se le otorga o quita acceso a una habitación, entonces recibe una notificación.
  3. Dado que se lo nombra o se le quita el rol de Administrador o de Líder, entonces recibe una notificación.
  4. Dado que se lo expulsa de una oficina, entonces recibe una notificación; la oficina ya no aparece en su lista.
- **Tareas técnicas:**
  - [back] Generar notificaciones por esos eventos.
  - [front] Mostrarlas en el centro de notificaciones.
- **Depende de:** HU-NOT-001, HU-TAR-008, HU-HAB-006a, HU-OFI-011, HU-OFI-012

### HU-NOT-002b · Notificar reuniones, anuncios y baja de oficina
- **Origen:** RF-NOT-002
- **Repos:** ambos
- **Módulo:** NOT · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como usuario, quiero que me avisen de reuniones, anuncios y de la baja de mi oficina, para estar al tanto.
- **Criterios de aceptación:**
  1. Dado que se crea, modifica o cancela una reunión en una habitación a la que tiene acceso, entonces recibe una notificación.
  2. Dado que se publica un anuncio en una habitación a la que tiene acceso, entonces recibe una notificación.
  3. Dado que se da de baja su oficina (siendo miembro o Dueño), entonces recibe una notificación. ⚠️ A confirmar si los miembros deben enterarse.
- **Tareas técnicas:**
  - [back] Generar notificaciones por esos eventos.
  - [front] Mostrarlas en el centro de notificaciones.
- **Depende de:** HU-NOT-002a, HU-CAR-005, HU-CAR-002, HU-OFI-014

### HU-NOT-003 · Marcar notificaciones como leídas
- **Origen:** RF-NOT-003
- **Repos:** ambos
- **Módulo:** NOT · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como usuario, quiero marcar mis notificaciones como leídas, para llevar el contador al día.
- **Criterios de aceptación:**
  1. Dada una notificación, cuando el usuario la abre o la marca, entonces deja de contar como no leída.
  2. Dadas varias no leídas, cuando elige marcar todas, entonces el contador vuelve a cero.
- **Tareas técnicas:**
  - [back] Marcar una o todas las notificaciones como leídas.
  - [front] Acciones de marcar una o todas.
- **Depende de:** HU-NOT-001

### HU-NOT-004 · Notificaciones respetan permisos
- **Origen:** RF-NOT-004
- **Repos:** back
- **Módulo:** NOT · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como usuario, quiero que las notificaciones no muestren contenido al que ya no tengo acceso, para no exponer información.
- **Criterios de aceptación:**
  1. Dado un usuario que perdió el acceso a una habitación, cuando abre una notificación antigua de ella, entonces el sistema responde 403 y no muestra el contenido.
  2. Dado un usuario, entonces solo ve sus propias notificaciones.
- **Tareas técnicas:**
  - [back] Validar el acceso al abrir una notificación y devolver solo las propias.
- **Depende de:** HU-NOT-001, HU-HAB-011

### HU-NOT-005 · Notificaciones en tiempo real
- **Origen:** RF-NOT-005
- **Repos:** ambos
- **Módulo:** NOT · **Prioridad:** Could · **Fase:** MVP
- **Historia:** Como usuario, quiero que las notificaciones aparezcan mientras uso la aplicación, para enterarme al instante.
- **Criterios de aceptación:**
  1. Dado un usuario conectado, cuando ocurre un evento que lo afecta, entonces ve la notificación y el contador actualizado en pocos segundos.
- **Tareas técnicas:**
  - [back] Difundir las notificaciones nuevas al usuario conectado.
  - [front] Actualizar el contador y la lista en vivo.
- **Depende de:** HU-NOT-001

### HU-NOT-006 · Notificaciones por email
- **Origen:** RF-NOT-006
- **Repos:** back
- **Módulo:** NOT · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como usuario, quiero recibir también notificaciones por email, para enterarme aunque no esté en la aplicación.
- **Criterios de aceptación:**
  1. Dado un evento que genera notificación, cuando el usuario tiene habilitado el email, entonces recibe un mensaje con el resumen del evento.
- **Tareas técnicas:**
  - [back] Envío de email por evento de notificación.
- **Depende de:** HU-NOT-002a

### HU-NOT-007 · Preferencias de notificación
- **Origen:** RF-NOT-007
- **Repos:** ambos
- **Módulo:** NOT · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como usuario, quiero elegir qué eventos me notifican y por qué canal, para recibir solo lo que me interesa.
- **Criterios de aceptación:**
  1. Dado un tipo de evento desactivado, entonces el usuario deja de recibir esa notificación.
- **Tareas técnicas:**
  - [back] Guardar preferencias de notificación por tipo de evento y canal.
  - [front] Pantalla de preferencias.
- **Depende de:** HU-NOT-006


---

## Bot y repaso diario (BOT)

### HU-BOT-001 · Conversar con el bot
- **Origen:** RF-BOT-001
- **Repos:** ambos
- **Módulo:** BOT · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como usuario, quiero conversar con el bot, para hacerle consultas sobre mi trabajo.
- **Criterios de aceptación:**
  1. Dado un usuario con sesión, cuando abre el bot, entonces puede escribir una consulta y recibir una respuesta.
  2. Dada una respuesta en preparación, entonces el usuario ve un indicador de espera.
  3. Dado un error o indisponibilidad del servicio de IA, entonces el usuario ve un mensaje claro y puede reintentar.
  4. Dado un uso excesivo, entonces el sistema aplica un límite e informa al usuario.
- **Tareas técnicas:**
  - [back] Servicio de consulta con IA, manejo de errores y límite de uso.
  - [front] Ventana de conversación con indicador de espera y mensaje de error con reintento.
- **Depende de:** HU-AUT-002

### HU-BOT-002 · Consultar tareas, reuniones y anuncios
- **Origen:** RF-BOT-002
- **Repos:** back
- **Módulo:** BOT · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como usuario, quiero preguntarle al bot por mis tareas, reuniones y anuncios, para saber qué tengo pendiente en todas mis oficinas.
- **Criterios de aceptación:**
  1. Dada la consulta "¿qué tareas tengo pendientes?", entonces el bot lista las tareas asignadas al usuario, indicando oficina y habitación.
  2. Dada la consulta sobre reuniones o anuncios, entonces responde con datos de las habitaciones a las que el usuario tiene acceso.
  3. Dada una consulta sobre una habitación sin acceso, entonces el bot no revela su contenido.
- **Tareas técnicas:**
  - [back] Obtener tareas, reuniones y anuncios según los permisos del usuario como contexto del bot.
- **Depende de:** HU-BOT-001, HU-TAR-008, HU-CAR-005

### HU-BOT-003 · Respeto de permisos
- **Origen:** RF-BOT-003
- **Repos:** back
- **Módulo:** BOT · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como usuario, quiero que el bot solo use lo que yo puedo ver, para que no revele información a la que no tengo acceso.
- **Criterios de aceptación:**
  1. Dado un usuario sin acceso a una habitación, entonces el bot nunca incluye su contenido en una respuesta ni en el repaso.
  2. Dado un usuario que perdió el acceso, entonces el bot deja de usar ese contenido de inmediato.
  3. Dado un usuario que le pide al bot ignorar los permisos, entonces el bot lo rechaza.
- **Tareas técnicas:**
  - [back] Filtrar todo el contexto del bot por permisos y rechazar pedidos de saltearlos.
- **Depende de:** HU-BOT-002

### HU-BOT-004 · Solo lectura
- **Origen:** RF-BOT-004
- **Repos:** back
- **Módulo:** BOT · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como usuario, quiero que el bot solo consulte y resuma sin modificar nada, para evitar cambios no deseados.
- **Criterios de aceptación:**
  1. Dado un pedido del tipo "creá una tarea" o "borrá este anuncio", entonces el bot responde que no puede hacerlo y, si corresponde, indica cómo hacerlo desde la aplicación.
  2. Dada cualquier conversación con el bot, entonces no se modifica ninguna tarea, anuncio, reunión, acceso ni mensaje.
- **Tareas técnicas:**
  - [back] Sin herramientas de escritura y respuesta estándar ante pedidos de modificar datos.
- **Depende de:** HU-BOT-001

### HU-BOT-005 · Resumen de actividad
- **Origen:** RF-BOT-005
- **Repos:** back
- **Módulo:** BOT · **Prioridad:** Could · **Fase:** MVP
- **Historia:** Como usuario, quiero que el bot resuma la actividad reciente de una habitación u oficina, para ponerme al día rápido.
- **Criterios de aceptación:**
  1. Dado un pedido de resumen de una habitación con acceso, entonces el bot resume la actividad reciente.
  2. Dado un pedido sobre una habitación sin acceso, entonces el bot lo rechaza.
- **Tareas técnicas:**
  - [back] Resumen de mensajes, tareas y anuncios recientes respetando los permisos.
- **Depende de:** HU-BOT-003, HU-CHA-006

### HU-BOT-006 · Repaso diario en la primera conexión
- **Origen:** RF-BOT-006
- **Repos:** ambos
- **Módulo:** BOT · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como usuario, quiero ver un repaso de mi día al conectarme por primera vez, para empezar sabiendo qué tengo pendiente.
- **Criterios de aceptación:**
  1. Dado un usuario que inicia sesión por primera vez en el día, entonces ve el repaso sin pedirlo.
  2. Dado el repaso, entonces agrupa la información por oficina y habitación.
  3. Dado un usuario sin nada pendiente, entonces el repaso lo indica en lugar de quedar vacío.
  4. Dado el repaso, entonces solo informa y sugiere próximos pasos; no ejecuta ninguna acción.
- **Tareas técnicas:**
  - [back] Armar el repaso agrupado por oficina y habitación solo con acceso vigente.
  - [front] Mostrar el repaso al iniciar sesión, con aviso si no hay pendientes.
- **Depende de:** HU-BOT-003, HU-TAR-012, HU-CAR-009

### HU-BOT-007 · Una sola vez por día
- **Origen:** RF-BOT-007
- **Repos:** back
- **Módulo:** BOT · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como usuario, quiero que el repaso aparezca una sola vez por día, para que no se repita al recargar.
- **Criterios de aceptación:**
  1. Dado un usuario que ya vio el repaso hoy, cuando recarga, cambia de habitación o se reconecta, entonces no se muestra de nuevo.
  2. Dado un cambio de día en Argentina, entonces el repaso vuelve a mostrarse en la siguiente primera conexión.
  3. Dadas dos conexiones simultáneas del mismo usuario, entonces el repaso se presenta una sola vez.
  4. Dado un usuario que cierra el repaso, entonces puede volver a consultarlo desde el bot durante el día.
- **Tareas técnicas:**
  - [back] Registro por usuario y fecha en zona horaria de Argentina con verificación atómica.
- **Depende de:** HU-BOT-006

### HU-BOT-008 · Repaso sin IA
- **Origen:** RF-BOT-008
- **Repos:** back
- **Módulo:** BOT · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como usuario, quiero recibir el repaso aunque la IA falle, para no quedarme sin información.
- **Criterios de aceptación:**
  1. Dado un servicio de IA no disponible, entonces el usuario ve igualmente sus tareas, reuniones y anuncios del día.
  2. Dado el repaso sin IA, entonces se cuenta como entregado ese día.
- **Tareas técnicas:**
  - [back] Resumen estructurado con los datos del usuario cuando la IA no está disponible.
- **Depende de:** HU-BOT-006

### HU-BOT-009 · Redacción del repaso con IA
- **Origen:** RF-BOT-009
- **Repos:** back
- **Módulo:** BOT · **Prioridad:** Could · **Fase:** MVP
- **Historia:** Como usuario, quiero que el repaso se redacte en lenguaje natural, para leerlo con comodidad.
- **Criterios de aceptación:**
  1. Dado un servicio de IA disponible, entonces el repaso se muestra con texto generado que no incluye datos fuera de los permisos del usuario.
  2. Dada una respuesta de IA con error, entonces se aplica RF-BOT-008.
- **Tareas técnicas:**
  - [back] Redacción del repaso con IA respetando los permisos y con respaldo al resumen estructurado.
- **Depende de:** HU-BOT-008

### HU-BOT-010 · Ejecución de acciones por el bot
- **Origen:** RF-BOT-010
- **Repos:** ambos
- **Módulo:** BOT · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como usuario, quiero pedirle al bot que cree o actualice tareas con mi confirmación, para ahorrar pasos.
- **Criterios de aceptación:**
  1. Dado un pedido de crear una tarea en una habitación con acceso, cuando el usuario confirma, entonces la tarea se crea.
  2. Dado un pedido en una habitación sin acceso, entonces el bot lo rechaza.
- **Tareas técnicas:**
  - [back] Herramientas de escritura del bot con confirmación explícita y permisos del usuario.
  - [front] Confirmación de la acción antes de ejecutarla.
- **Depende de:** HU-BOT-003, HU-TAR-002

### HU-BOT-011 · Reacción del bot a eventos
- **Origen:** RF-BOT-011
- **Repos:** back
- **Módulo:** BOT · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como usuario, quiero que el bot me avise por su cuenta de eventos relevantes, para no tener que preguntar.
- **Criterios de aceptación:**
  1. Dado un evento relevante para el usuario, entonces el bot lo comunica sin que el usuario deba preguntar.
- **Tareas técnicas:**
  - [back] Disparar avisos del bot ante eventos relevantes para el usuario.
- **Depende de:** HU-BOT-006, HU-NOT-001


---

## Objetos interactuables (OBJ)

### HU-OBJ-001 · Interacción con un objeto
- **Origen:** RF-OBJ-001
- **Repos:** front
- **Módulo:** OBJ · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero interactuar con los objetos de la habitación, para abrir sus herramientas.
- **Criterios de aceptación:**
  1. Dado un objeto interactuable, cuando el usuario lo selecciona o se acerca, entonces se abre su interfaz o se ejecuta su acción.
  2. Dado un objeto con el que el usuario puede interactuar, entonces el sistema lo indica visualmente (por ejemplo, resaltándolo).
  3. Dado un objeto cuya herramienta requiere un permiso que el usuario no tiene, entonces el sistema no abre la herramienta y muestra un mensaje.
- **Tareas técnicas:**
  - [front] Detectar selección o cercanía, resaltar objetos interactuables y avisar si falta un permiso.
- **Depende de:** HU-MUN-001, HU-MUN-003

### HU-OBJ-002a · Objeto tablero que abre las tareas
- **Origen:** RF-OBJ-002
- **Repos:** front
- **Módulo:** OBJ · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero interactuar con el tablero de la pared, para abrir las tareas de la habitación.
- **Criterios de aceptación:**
  1. Dado el objeto de tablero (por ejemplo, un corcho), cuando el usuario interactúa, entonces se abre el tablero de tareas de esa habitación.
- **Tareas técnicas:**
  - [front] Modelo del objeto tablero y apertura del tablero de tareas.
- **Depende de:** HU-OBJ-001, HU-OBJ-003, HU-TAR-001

### HU-OBJ-002b · Objeto cartelera que abre anuncios y reuniones
- **Origen:** RF-OBJ-002
- **Repos:** front
- **Módulo:** OBJ · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero interactuar con la cartelera, para ver anuncios y reuniones de la habitación.
- **Criterios de aceptación:**
  1. Dado el objeto de cartelera, cuando el usuario interactúa, entonces se abre la cartelera y la lista de reuniones de esa habitación.
- **Tareas técnicas:**
  - [front] Modelo del objeto cartelera y apertura de la cartelera y la lista de reuniones.
- **Depende de:** HU-OBJ-001, HU-OBJ-003, HU-CAR-001, HU-CAR-009

### HU-OBJ-002c · Objeto puerta para cambiar de habitación
- **Origen:** RF-OBJ-002
- **Repos:** front
- **Módulo:** OBJ · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero interactuar con una puerta, para pasar a otra habitación a la que tengo acceso.
- **Criterios de aceptación:**
  1. Dado el objeto de puerta, cuando el usuario interactúa, entonces ve las habitaciones a las que puede pasar y puede cambiar de habitación (RF-HAB-009).
- **Tareas técnicas:**
  - [front] Modelo del objeto puerta con la lista de habitaciones accesibles.
- **Depende de:** HU-OBJ-001, HU-OBJ-003, HU-HAB-009

### HU-OBJ-002d · Objeto del bot
- **Origen:** RF-OBJ-002
- **Repos:** front
- **Módulo:** OBJ · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero interactuar con el robot o mascota, para conversar con el bot.
- **Criterios de aceptación:**
  1. Dado el objeto del bot (por ejemplo, un robot o mascota), cuando el usuario interactúa, entonces se abre la conversación con el bot (RF-BOT-001).
- **Tareas técnicas:**
  - [front] Modelo del objeto del bot y apertura de la conversación.
- **Depende de:** HU-OBJ-001, HU-OBJ-003, HU-BOT-001

### HU-OBJ-003 · Registro extensible de tipos de objeto
- **Origen:** RF-OBJ-003
- **Repos:** front
- **Módulo:** OBJ · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como equipo de desarrollo, quiero un registro de tipos de objeto, para sumar objetos nuevos sin tocar los existentes.
- **Criterios de aceptación:**
  1. Dado un tipo de objeto nuevo registrado, entonces puede colocarse en una habitación y funcionar sin cambios en los objetos ya existentes.
  2. Dado un tipo de objeto, entonces declara qué permiso requiere para usarse.
  3. Dado un tipo de objeto sin interfaz (decorativo), entonces puede responder solo con una animación.
- **Tareas técnicas:**
  - [front] Registro de tipos con nombre, interfaz y permiso requerido, con soporte para objetos solo decorativos.
- **Depende de:** HU-OBJ-001

### HU-OBJ-004 · Permisos del objeto
- **Origen:** RF-OBJ-004
- **Repos:** ambos
- **Módulo:** OBJ · **Prioridad:** Must · **Fase:** MVP
- **Historia:** Como miembro, quiero que interactuar con un objeto no me dé permisos que no tengo, para que la interfaz no pueda usarse para saltear reglas.
- **Criterios de aceptación:**
  1. Dado un usuario sin permiso de Líder, cuando interactúa con la cartelera, entonces puede leerla pero no ve la opción de publicar.
  2. Dado un usuario que intenta una acción protegida saltándose la interfaz del objeto, entonces el sistema responde 403.
- **Tareas técnicas:**
  - [back] Rechazar con 403 las acciones protegidas aunque se llamen sin pasar por el objeto.
  - [front] Ocultar las acciones que el usuario no puede realizar.
- **Depende de:** HU-OBJ-001

### HU-OBJ-005 · Posición de los objetos
- **Origen:** RF-OBJ-005
- **Repos:** ambos
- **Módulo:** OBJ · **Prioridad:** Should · **Fase:** MVP
- **Historia:** Como miembro, quiero que los objetos de cada habitación estén siempre en el mismo lugar, para orientarme.
- **Criterios de aceptación:**
  1. Dada una habitación, cuando un usuario entra, entonces ve los objetos en la misma posición que la última vez.
  2. Dada una habitación nueva, entonces se crea con la distribución inicial por defecto (con los objetos del MVP).
- **Tareas técnicas:**
  - [back] Guardar la distribución de objetos por habitación y la distribución inicial por defecto.
  - [front] Cargar los objetos según la distribución guardada.
- **Depende de:** HU-OBJ-003, HU-HAB-002

### HU-OBJ-006 · Objetos adicionales
- **Origen:** RF-OBJ-006
- **Repos:** ambos
- **Módulo:** OBJ · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como miembro, quiero objetos nuevos como calendario, teléfono, pizarra e indicador de estado, para tener más herramientas en el entorno.
- **Criterios de aceptación:**
  1. Dado un objeto nuevo registrado, entonces el usuario puede usar su herramienta como cualquier otro objeto.
- **Tareas técnicas:**
  - [back] Soporte de datos para los nuevos tipos de objeto.
  - [front] Modelos e interfaces de los nuevos objetos.
- **Depende de:** HU-OBJ-003

### HU-OBJ-007 · Personalización de la habitación
- **Origen:** RF-OBJ-007
- **Repos:** ambos
- **Módulo:** OBJ · **Prioridad:** Could · **Fase:** Evolución
- **Historia:** Como Dueño o Administrador, quiero mover y decorar los objetos de una habitación, para personalizarla.
- **Criterios de aceptación:**
  1. Dado un cambio de distribución, cuando se guarda, entonces los usuarios que entran después ven la nueva disposición.
- **Tareas técnicas:**
  - [back] Guardar cambios de distribución con permisos.
  - [front] Modo de edición de la habitación.
- **Depende de:** HU-OBJ-005

---

## Índice y conteos

| ID | Historia | Repos | Prioridad | Fase |
|---|---|---|---|---|
| HU-AUT-001 | Registro de usuario | ambos | Must | MVP |
| HU-AUT-002 | Inicio de sesión | ambos | Must | MVP |
| HU-AUT-003 | Sesión con vencimiento y renovación | ambos | Must | MVP |
| HU-AUT-004 | Cierre de sesión | ambos | Must | MVP |
| HU-AUT-005 | Protección de rutas y operaciones | back | Must | MVP |
| HU-AUT-006 | Recuperación de contraseña | ambos | Should | MVP |
| HU-AUT-007 | Gestión del perfil | ambos | Should | MVP |
| HU-AUT-008 | Cambio de contraseña con sesión iniciada | ambos | Could | Evolución |
| HU-AUT-009 | Límite de intentos fallidos de inicio de sesión | ambos | Could | Evolución |
| HU-AUT-010 | Verificación de email al registrarse | ambos | Could | Evolución |
| HU-OFI-001 | Creación automática de la oficina propia | back | Must | MVP |
| HU-OFI-002 | Lista de oficinas del usuario | ambos | Must | MVP |
| HU-OFI-003 | Ingreso a una oficina | ambos | Must | MVP |
| HU-OFI-004 | Edición de datos de la oficina | ambos | Should | MVP |
| HU-OFI-005 | Generación de enlace de invitación | ambos | Must | MVP |
| HU-OFI-006 | Revocación de invitaciones | ambos | Must | MVP |
| HU-OFI-007 | Lista de invitaciones vigentes | ambos | Should | MVP |
| HU-OFI-008a | Unirse a una oficina con sesión iniciada | ambos | Must | MVP |
| HU-OFI-008b | Registrarse o iniciar sesión desde un enlace de invitación | ambos | Must | MVP |
| HU-OFI-008c | Rechazar enlaces de invitación inválidos | ambos | Must | MVP |
| HU-OFI-008d | Reingresar a una oficina tras una expulsión | back | Must | MVP |
| HU-OFI-009 | Vencimiento automático de invitaciones | back | Must | MVP |
| HU-OFI-010 | Lista de miembros | ambos | Must | MVP |
| HU-OFI-011 | Nombrar y quitar Administradores | ambos | Should | MVP |
| HU-OFI-012 | Expulsión de un miembro | ambos | Must | MVP |
| HU-OFI-013 | Abandono de la oficina | ambos | Should | MVP |
| HU-OFI-014 | Baja lógica de la oficina | ambos | Should | MVP |
| HU-OFI-015 | Recuperación de la oficina | ambos | Should | MVP |
| HU-OFI-016 | Eliminación definitiva tras el plazo | back | Should | MVP |
| HU-OFI-017 | Invitación por email | ambos | Could | Evolución |
| HU-OFI-018 | Solicitud de ingreso a una oficina | ambos | Could | Evolución |
| HU-HAB-001 | Habitación principal | back | Must | MVP |
| HU-HAB-002 | Creación de habitaciones | ambos | Must | MVP |
| HU-HAB-003 | Límite de habitaciones adicionales | ambos | Must | MVP |
| HU-HAB-004 | Edición de habitaciones | ambos | Should | MVP |
| HU-HAB-005 | Eliminación de habitaciones | ambos | Should | MVP |
| HU-HAB-006a | Dar y quitar acceso a una habitación como Dueño o Administrador | ambos | Must | MVP |
| HU-HAB-006b | Dar acceso a mi habitación como Líder | ambos | Must | MVP |
| HU-HAB-007 | Panel de accesos | ambos | Must | MVP |
| HU-HAB-008 | Asignación de Líderes | ambos | Should | MVP |
| HU-HAB-009 | Cambio de habitación | ambos | Must | MVP |
| HU-HAB-010 | Efecto de la pérdida de acceso | ambos | Must | MVP |
| HU-HAB-011 | Verificación de acceso en el servidor | back | Must | MVP |
| HU-HAB-012 | Acceso de solo lectura a una habitación | ambos | Could | Evolución |
| HU-HAB-013 | Límite configurable de habitaciones | ambos | Could | Evolución |
| HU-MUN-001 | Escena isométrica de la habitación | front | Must | MVP |
| HU-MUN-002 | Movimiento con teclado | front | Must | MVP |
| HU-MUN-003 | Movimiento por clic a destino | front | Must | MVP |
| HU-MUN-004 | Controles táctiles | front | Should | MVP |
| HU-MUN-005 | Colisiones y límites del espacio | front | Must | MVP |
| HU-MUN-006 | Avatar propio y de otros | ambos | Must | MVP |
| HU-MUN-007 | Sincronización de movimiento en tiempo real | ambos | Must | MVP |
| HU-MUN-008 | Entrada, salida y desconexión de avatares | ambos | Must | MVP |
| HU-MUN-009 | Reconexión | ambos | Should | MVP |
| HU-MUN-010 | Lista de presencia | ambos | Must | MVP |
| HU-MUN-011 | Personalización y persistencia del avatar | ambos | Should | MVP |
| HU-MUN-012 | Acceso a las funciones sin apuntar a objetos 3D | front | Should | MVP |
| HU-MUN-013 | Uso en pantallas pequeñas | front | Could | MVP |
| HU-MUN-014 | Estados de actividad | ambos | Could | Evolución |
| HU-MUN-015 | Emotes y acciones sociales | ambos | Could | Evolución |
| HU-MUN-016 | Sonido ambiente y efectos | front | Could | Evolución |
| HU-TAR-001 | Ver el tablero de una habitación | ambos | Must | MVP |
| HU-TAR-002 | Crear tarea | ambos | Must | MVP |
| HU-TAR-003 | Editar tarea | ambos | Must | MVP |
| HU-TAR-004 | Mover tarea entre columnas | ambos | Must | MVP |
| HU-TAR-005 | Eliminar tarea | ambos | Must | MVP |
| HU-TAR-006 | Columnas por defecto | back | Must | MVP |
| HU-TAR-007 | Configurar columnas del tablero | ambos | Should | MVP |
| HU-TAR-008 | Asignar responsable | ambos | Must | MVP |
| HU-TAR-009 | Tareas huérfanas | ambos | Should | MVP |
| HU-TAR-010 | Vista de lista y filtros | ambos | Should | MVP |
| HU-TAR-011 | Actualización del tablero en vivo | ambos | Should | MVP |
| HU-TAR-012 | Fecha límite y vencidas | front | Should | MVP |
| HU-TAR-013 | Mis tareas | ambos | Could | MVP |
| HU-TAR-014 | Comentarios, etiquetas y adjuntos en tareas | ambos | Could | Evolución |
| HU-CAR-001 | Ver la cartelera | ambos | Must | MVP |
| HU-CAR-002 | Publicar un anuncio | ambos | Must | MVP |
| HU-CAR-003 | Editar y eliminar anuncios propios | ambos | Must | MVP |
| HU-CAR-004 | Gestionar anuncios ajenos | ambos | Must | MVP |
| HU-CAR-005 | Crear una reunión | ambos | Must | MVP |
| HU-CAR-006 | Editar y cancelar reuniones | ambos | Must | MVP |
| HU-CAR-007 | Confirmar asistencia | ambos | Must | MVP |
| HU-CAR-008 | Ver asistentes | ambos | Should | MVP |
| HU-CAR-009 | Lista de reuniones | ambos | Must | MVP |
| HU-CAR-010 | Vista de calendario | front | Should | MVP |
| HU-CAR-011 | Anuncio para toda la oficina | ambos | Could | Evolución |
| HU-CAR-012 | Recordatorios y reuniones recurrentes | ambos | Could | Evolución |
| HU-CHA-001 | Canal de la oficina | ambos | Must | MVP |
| HU-CHA-002 | Canal de la habitación | ambos | Must | MVP |
| HU-CHA-003 | Elegir el canal de envío | front | Must | MVP |
| HU-CHA-004 | Enviar mensaje | ambos | Must | MVP |
| HU-CHA-005 | Recepción en tiempo real | ambos | Must | MVP |
| HU-CHA-006 | Historial persistente | ambos | Must | MVP |
| HU-CHA-007 | Control de acceso del historial | back | Must | MVP |
| HU-CHA-008 | Indicador de mensajes no leídos | ambos | Should | MVP |
| HU-CHA-009 | Mensajería privada | ambos | Could | Evolución |
| HU-CHA-010 | Editar y eliminar mensajes | ambos | Could | Evolución |
| HU-NOT-001 | Centro de notificaciones | ambos | Should | MVP |
| HU-NOT-002a | Notificar tareas, accesos, roles y expulsión | ambos | Should | MVP |
| HU-NOT-002b | Notificar reuniones, anuncios y baja de oficina | ambos | Should | MVP |
| HU-NOT-003 | Marcar notificaciones como leídas | ambos | Should | MVP |
| HU-NOT-004 | Notificaciones respetan permisos | back | Must | MVP |
| HU-NOT-005 | Notificaciones en tiempo real | ambos | Could | MVP |
| HU-NOT-006 | Notificaciones por email | back | Could | Evolución |
| HU-NOT-007 | Preferencias de notificación | ambos | Could | Evolución |
| HU-BOT-001 | Conversar con el bot | ambos | Should | MVP |
| HU-BOT-002 | Consultar tareas, reuniones y anuncios | back | Should | MVP |
| HU-BOT-003 | Respeto de permisos | back | Must | MVP |
| HU-BOT-004 | Solo lectura | back | Must | MVP |
| HU-BOT-005 | Resumen de actividad | back | Could | MVP |
| HU-BOT-006 | Repaso diario en la primera conexión | ambos | Should | MVP |
| HU-BOT-007 | Una sola vez por día | back | Should | MVP |
| HU-BOT-008 | Repaso sin IA | back | Should | MVP |
| HU-BOT-009 | Redacción del repaso con IA | back | Could | MVP |
| HU-BOT-010 | Ejecución de acciones por el bot | ambos | Could | Evolución |
| HU-BOT-011 | Reacción del bot a eventos | back | Could | Evolución |
| HU-OBJ-001 | Interacción con un objeto | front | Must | MVP |
| HU-OBJ-002a | Objeto tablero que abre las tareas | front | Must | MVP |
| HU-OBJ-002b | Objeto cartelera que abre anuncios y reuniones | front | Must | MVP |
| HU-OBJ-002c | Objeto puerta para cambiar de habitación | front | Must | MVP |
| HU-OBJ-002d | Objeto del bot | front | Must | MVP |
| HU-OBJ-003 | Registro extensible de tipos de objeto | front | Must | MVP |
| HU-OBJ-004 | Permisos del objeto | ambos | Must | MVP |
| HU-OBJ-005 | Posición de los objetos | ambos | Should | MVP |
| HU-OBJ-006 | Objetos adicionales | ambos | Could | Evolución |
| HU-OBJ-007 | Personalización de la habitación | ambos | Could | Evolución |

| | Total | Must | Should | Could |
|---|---|---|---|---|
| MVP | 105 | 66 | 34 | 5 |
| Evolución | 21 | 0 | 0 | 21 |
| **Total** | **126** | **66** | **34** | **26** |

| Repos | MVP | Evolución |
|---|---|---|
| back | 17 | 2 |
| front | 16 | 1 |
| ambos | 72 | 18 |

Tareas técnicas orientativas: 216 en total (177 en historias del MVP).
