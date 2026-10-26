# Especificación de Requisitos Funcionales (ERS)

## Plataforma de Oficinas Virtuales 3D — Proyecto Integrador Final

| Campo | Valor |
|---|---|
| Proyecto | Proyecto integrador final · Fundación Integrar (IntegrarTEC 2026) |
| Documento | Especificación de Requisitos Funcionales (ERS) |
| Versión | 0.1 (borrador para revisión del equipo) |
| Fecha | 2026-10-26 |
| Equipo | 4 integrantes: Alejo Martínez, Agustín Tabarcache, Matías Sousa, Luis Calegari   |
| Documento de origen | `master-document.md` (documento maestro del proyecto) |
| Estado | Borrador. Los puntos marcados con ⚠️ son supuestos a validar |

### Control de cambios

| Versión | Fecha | Cambios | Autor |
|---|---|---|---|
| 0.1 | 2026-10-26 | Primera redacción completa a partir del documento maestro y de las decisiones de alcance acordadas | Luis Calegari |

---

## 1. Introducción

### 1.1 Propósito

Este documento especifica **qué debe hacer el sistema** desde el punto de vista del usuario. Está pensado para dos usos:

1. Servir de acuerdo del equipo sobre el alcance funcional del MVP y de su evolución.
2. Ser la fuente de las **historias de usuario** del tablero Kanban del proyecto: cada historia debe referenciar el requisito `RF-MÓDULO-NNN` del que proviene.

### 1.2 Alcance

La ERS cubre **únicamente requisitos funcionales**. Quedan fuera, y se tratan en otros documentos:

- Requisitos no funcionales (rendimiento, seguridad detallada, accesibilidad, compatibilidad).
- Decisiones de tecnología, arquitectura, infraestructura y despliegue.
- Dirección artística y diseño visual.
- Contratos técnicos entre frontend y backend.

Cuando un requisito funcional depende de un aspecto técnico (por ejemplo, "en tiempo real"), se expresa como comportamiento observable por el usuario, sin fijar cómo se implementa.

### 1.3 Relación con el documento maestro

Esta ERS **precede** a los documentos técnicos `rules/` del documento maestro: define el comportamiento esperado, y los `rules/` bajarán a detalle técnico sin contradecirla.

Durante la definición de requisitos se tomaron decisiones que **cambian partes del documento maestro**. Hasta que éste se actualice, esta ERS prevalece en los siguientes puntos:

| Tema | Documento maestro | Esta ERS |
|---|---|---|
| Unidad de organización | Salas personales, compartidas y una general | **Oficina** (contenedor) con **habitaciones** dentro |
| Sala personal | Sala privada por usuario, aparte | La oficina propia del usuario, creada al registrarse |
| Sala general global | Una sala general para todos los usuarios | No existe. Cada oficina tiene su **habitación principal** |
| Rol de plataforma | Se mencionan administradores de plataforma | **No hay Superadmin**: los roles son por oficina |
| Invitaciones | Enlace o código | **Enlace único** con vencimiento y revocable |
| Mensajería | Chat de sala y mensajería privada | MVP: solo chat de oficina y de habitación. La mensajería privada pasa a evolución |
| Bot de IA | Informa y ejecuta acciones | MVP: **solo consulta y resume**; no ejecuta acciones |

### 1.4 Convenciones del documento

**Identificadores.** Cada requisito tiene un ID con formato `RF-MÓDULO-NNN`. Las reglas de negocio transversales usan `RN-NN`. Los IDs no se reutilizan: si un requisito se elimina, su número queda vacío.

**Prioridad (MoSCoW).**

| Valor | Significado |
|---|---|
| Must | Imprescindible para que el MVP sea utilizable y cumpla los requisitos obligatorios del curso |
| Should | Importante; entra en el MVP salvo que el tiempo no alcance |
| Could | Deseable; se hace si sobra tiempo |
| Won't | Descartado explícitamente en esta versión |

**Fase.** `MVP` (objetivo de entrega) o `Evolución` (después de la entrega).

**Criterios de aceptación.** Se redactan en formato *Dado / Cuando / Entonces*, de modo que cada uno pueda convertirse en un caso de prueba y en un criterio de la historia de usuario.

### 1.5 Glosario

| Término | Definición |
|---|---|
| **Instancia** | La plataforma completa: una sola aplicación y una sola base de usuarios. |
| **Usuario** | Persona con cuenta registrada. Los usuarios son globales a la instancia. |
| **Visitante** | Persona sin sesión iniciada. |
| **Oficina** | Espacio de trabajo que agrupa habitaciones, miembros y recursos. Cada usuario tiene una propia, creada al registrarse, y puede ser invitado a muchas otras. Es la unidad de aislamiento de datos y permisos. |
| **Dueño** | Usuario que creó la oficina. Uno por oficina, no transferible. |
| **Administrador** | Miembro al que el Dueño delegó la gestión de la oficina. |
| **Miembro** | Usuario que pertenece a una oficina. |
| **Líder** | Rol asignado dentro de una habitación concreta. Puede haber varios por habitación. |
| **Habitación** | Espacio navegable 3D dentro de una oficina. Tiene tablero, cartelera, reuniones y chat propios. |
| **Habitación principal** | Habitación creada por defecto con la oficina. Accesible para todos sus miembros. No se puede eliminar y no cuenta para el límite de habitaciones adicionales. |
| **Acceso a habitación** | Permiso binario: un miembro puede entrar a una habitación o no. |
| **Invitación** | Enlace único, con vencimiento y revocable, que permite unirse a una oficina como Miembro. |
| **Canal de chat** | Ámbito de un mensaje: el de la oficina (lo leen todos sus miembros) o el de una habitación (solo quienes tienen acceso). |
| **Tablero** | Vista Kanban de las tareas de una habitación, con columnas configurables. |
| **Tarea** | Unidad de trabajo de un tablero. Queda "huérfana" si su responsable pierde acceso a la habitación. |
| **Cartelera** | Lista de anuncios persistentes de una habitación. |
| **Anuncio** | Aviso publicado en una cartelera. |
| **Reunión** | Evento con fecha y hora, asociado a una habitación, con confirmación de asistencia. |
| **Presencia** | Estado de conexión del usuario y habitación donde se encuentra. |
| **Objeto interactuable** | Elemento modelado en la habitación que abre una herramienta o ejecuta una acción. Es extensible. |
| **Bot** | Asistente de IA de consulta y resumen, que ve solo lo que el usuario tiene permiso de ver. |
| **Repaso diario** | Resumen que el bot presenta en la primera conexión del día. |
| **Baja lógica** | Estado de una oficina eliminada pero recuperable por el Dueño durante 15 días. |

---

## 2. Descripción general

### 2.1 Visión del producto

Aplicación web de **convivencia, comunicación y organización** presentada como una oficina virtual 3D con cámara isométrica. Cada usuario tiene su **oficina**, que se compone de **habitaciones** que simulan espacios de trabajo (por ejemplo "Frontend", "Backend", "Diseño"). Los usuarios se representan con avatares, se desplazan por las habitaciones y usan herramientas de productividad (tareas, cartelera, reuniones, chat) a través de objetos del entorno o de un acceso alternativo.

No es un videojuego ni busca ser un entorno competitivo: el valor central es organizarse y colaborar con presencia social.

### 2.2 Modelo de espacios

Se trabaja con una **sola instancia** y una base de usuarios global. El aislamiento de datos se hace por oficina y por habitación.

- Al registrarse, cada usuario obtiene una **oficina propia** con una **habitación principal**. Es su Dueño.
- El Dueño puede agregar hasta **5 habitaciones adicionales** (la principal no cuenta).
- Cada usuario puede ser invitado a **muchas oficinas ajenas**, donde actúa como Miembro (o Administrador, si el Dueño lo nombró).
- Todos los miembros de una oficina acceden a su habitación principal. Al resto se entra solo con acceso explícito.
- No existe un espacio común a todos los usuarios de la plataforma.

### 2.3 Actores

| Actor | Tipo | Descripción |
|---|---|---|
| **Visitante** | Humano | Persona sin sesión. Puede registrarse, iniciar sesión, recuperar su contraseña y abrir un enlace de invitación. |
| **Usuario** | Humano | Persona con sesión iniciada. Gestiona su perfil y avatar, y ve las oficinas propia e invitadas. |
| **Dueño** | Rol de oficina | Creó la oficina. Uno por oficina, no transferible. Tiene todos los permisos. |
| **Administrador** | Rol de oficina | Miembro con gestión delegada por el Dueño. |
| **Miembro** | Rol de oficina | Usuario que pertenece a una oficina, sin permisos de gestión. |
| **Líder** | Rol de habitación | Miembro con gestión sobre una habitación concreta. Es independiente del rol de oficina. |
| **Bot** | Sistema | Asistente de consulta y resumen. Actúa con los permisos del usuario que lo consulta. |
| **Sistema** | Sistema | Ejecuta tareas automáticas: vencimiento de invitaciones, eliminación definitiva de oficinas dadas de baja y disparo del repaso diario. |

**Combinación de roles.**

- El rol de oficina es uno solo por usuario en cada oficina: Dueño, Administrador o Miembro. Una persona puede tener roles distintos en oficinas distintas.
- El rol de Líder se suma por habitación.
- El Dueño y el Administrador tienen acceso a todas las habitaciones y los mismos permisos que un Líder en cada una. ⚠️ Supuesto: evita que el Dueño deba otorgarse acceso a sus propias habitaciones.

### 2.4 Supuestos y dependencias

- ⚠️ El identificador de login es el **email**; el nombre visible es aparte y puede repetirse.
- ⚠️ La contraseña exige un mínimo de 8 caracteres, sin reglas de composición.
- ⚠️ El email se usa en el MVP al menos para recuperar la contraseña. Las notificaciones por email son evolución.
- ⚠️ La duración de la sesión y de las invitaciones son parámetros configurables, sin valor fijo en esta ERS.
- Todas las fechas y horas se muestran y almacenan en la zona horaria **America/Argentina/Buenos_Aires**.
- El sistema es utilizable desde navegadores de escritorio y de dispositivos táctiles.

---

## 3. Permisos

### 3.1 Cuenta y acceso (independiente de la oficina)

| Acción | Visitante | Usuario |
|---|---|---|
| Registrarse (crea su oficina con la habitación principal) | ✅ | ❌ |
| Iniciar sesión / recuperar contraseña | ✅ | ❌ |
| Cerrar sesión | ❌ | ✅ |
| Editar su perfil y avatar | ❌ | ✅ |
| Ver su lista de oficinas (propia e invitadas) | ❌ | ✅ |
| Abrir un enlace de invitación | ✅ (debe registrarse o iniciar sesión) | ✅ |

### 3.2 Gestión de la oficina

| Acción | Dueño | Admin | Líder | Miembro |
|---|---|---|---|---|
| Dar de baja la oficina | ✅ | ❌ | ❌ | ❌ |
| Recuperar la oficina (dentro de 15 días) | ✅ | ❌ | ❌ | ❌ |
| Nombrar o quitar Administradores | ✅ | ❌ | ❌ | ❌ |
| Editar nombre y datos de la oficina | ✅ | ✅ | ❌ | ❌ |
| Generar y revocar enlaces de invitación | ✅ | ✅ | ❌ | ❌ |
| Expulsar a un miembro (baja lógica de su membresía) | ✅ | ✅ (salvo al Dueño) | ❌ | ❌ |
| Abandonar la oficina | ❌ | ✅ | ✅ | ✅ |
| Crear, editar y eliminar habitaciones adicionales | ✅ | ✅ | ❌ | ❌ |
| Asignar o quitar Líderes | ✅ | ✅ | ❌ | ❌ |
| Dar o quitar acceso a una habitación | ✅ | ✅ | ✅ (solo a su habitación y solo a miembros de la oficina) | ❌ |

El Dueño no puede abandonar su oficina: debe darla de baja, porque la propiedad no se transfiere.

### 3.3 Dentro de una habitación (requiere acceso a ella)

| Acción | Dueño | Admin | Líder | Miembro |
|---|---|---|---|---|
| Entrar y ver la presencia de la habitación | ✅ | ✅ | ✅ | ✅ |
| Crear, editar, mover y eliminar tareas | ✅ | ✅ | ✅ | ✅ |
| Configurar las columnas del tablero | ✅ | ✅ | ✅ | ❌ |
| Ver la cartelera | ✅ | ✅ | ✅ | ✅ |
| Publicar anuncios | ✅ | ✅ | ✅ | ❌ |
| Editar o eliminar anuncios propios | ✅ | ✅ | ✅ | ❌ |
| Editar o eliminar anuncios ajenos | ✅ | ✅ | ❌ | ❌ |
| Ver reuniones (lista y calendario) | ✅ | ✅ | ✅ | ✅ |
| Crear reuniones | ✅ | ✅ | ✅ | ❌ |
| Editar o cancelar reuniones propias | ✅ | ✅ | ✅ | ❌ |
| Editar o cancelar reuniones ajenas | ✅ | ✅ | ❌ | ❌ |
| Confirmar asistencia a una reunión | ✅ | ✅ | ✅ | ✅ |
| Leer y escribir en el chat de la habitación | ✅ | ✅ | ✅ | ✅ |

### 3.4 Transversales a la oficina

| Acción | Dueño | Admin | Líder | Miembro |
|---|---|---|---|---|
| Leer y escribir en el chat de la oficina | ✅ | ✅ | ✅ | ✅ |
| Ver la lista de presencia (quién está en qué habitación, aunque no tenga acceso a ella) | ✅ | ✅ | ✅ | ✅ |
| Consultar al bot y recibir el repaso diario | ✅ | ✅ | ✅ | ✅ |

---

## 4. Reglas de negocio transversales

Las siguientes reglas se aplican a todos los módulos. Los requisitos las referencian por su ID.

| ID | Regla |
|---|---|
| RN-01 | Cada usuario tiene exactamente **una oficina propia**, creada al registrarse. Puede ser miembro de muchas oficinas ajenas. |
| RN-02 | Cada oficina tiene un único Dueño. La propiedad no se transfiere. |
| RN-03 | Los datos se aíslan por oficina y por habitación. Un usuario nunca accede a recursos de oficinas de las que no es miembro ni de habitaciones a las que no tiene acceso. |
| RN-04 | Toda oficina tiene una habitación principal, accesible para todos sus miembros, que no se puede eliminar ni cuenta para el límite de habitaciones adicionales. |
| RN-05 | Una oficina puede tener como máximo **5 habitaciones adicionales** además de la principal. |
| RN-06 | Quien se une por invitación queda como Miembro con acceso únicamente a la habitación principal. |
| RN-07 | El Dueño y el Administrador tienen acceso a todas las habitaciones y los mismos permisos que un Líder en cada una. |
| RN-08 | Un Administrador no puede actuar sobre el Dueño (expulsarlo, quitarle permisos ni modificar su rol). |
| RN-09 | Solo el Dueño nombra y quita Administradores. |
| RN-10 | Un Líder debe tener acceso a su habitación. Puede haber varios Líderes por habitación. El alcance del Líder se limita a su habitación. |
| RN-11 | Un Líder solo otorga acceso a su habitación a usuarios que ya son miembros de la oficina. No invita gente nueva. |
| RN-12 | Si un usuario pierde acceso a una habitación: deja de verla, no puede leer su historial de chat y sus tareas asignadas quedan marcadas como huérfanas hasta que alguien las reasigne. |
| RN-13 | Expulsar a un miembro es una baja lógica de su membresía: pierde acceso a toda la oficina, pero lo que generó (mensajes, tareas, anuncios) se conserva. Puede ser reinvitado. |
| RN-14 | Dar de baja una oficina es una baja lógica recuperable por el Dueño durante **15 días**. Pasado ese plazo se elimina definitivamente. Durante la baja la oficina desaparece de la lista de sus miembros y nadie puede entrar. |
| RN-15 | El Dueño no puede abandonar su oficina; solo puede darla de baja. |
| RN-16 | Toda operación se autoriza en el servidor. Sin sesión válida el sistema responde 401; con sesión pero sin permiso, 403. Ocultar un botón en la interfaz no reemplaza esta validación. |
| RN-17 | Los datos se validan en el cliente para dar feedback inmediato y se vuelven a validar en el servidor. |
| RN-18 | El bot actúa siempre con los permisos del usuario que lo consulta y nunca modifica datos. |
| RN-19 | Las fechas y horas usan la zona horaria America/Argentina/Buenos_Aires. |
| RN-20 | Interactuar con un objeto del entorno no otorga permisos sobre el recurso asociado. |

---

## 5. Requisitos funcionales

Cada módulo lista sus requisitos con el formato definido en la sección 1.4. Las reglas de negocio `RN-NN` se encuentran en la sección 4 y aplican a todos los módulos aunque no se repitan en cada criterio.

### 5.1 Cuenta y autenticación (AUT)

#### RF-AUT-001 · Registro de usuario
**Prioridad:** Must · **Fase:** MVP · **Actor:** Visitante
**Descripción:** El sistema debe permitir crear una cuenta con email, nombre visible y contraseña.
**Criterios de aceptación:**
1. Dado un Visitante con datos válidos, cuando se registra, entonces se crea su cuenta y, automáticamente, su oficina propia con la habitación principal (RF-OFI-001).
2. Dado un email ya registrado, cuando intenta registrarse, entonces el sistema muestra un error claro y no crea ninguna cuenta.
3. Dados datos inválidos (email mal formado, contraseña corta, campos vacíos), cuando envía el formulario, entonces ve el error junto a cada campo y el servidor también rechaza los datos.
4. Dada una contraseña, entonces nunca se almacena ni se devuelve en texto plano.

#### RF-AUT-002 · Inicio de sesión
**Prioridad:** Must · **Fase:** MVP · **Actor:** Visitante
**Descripción:** El sistema debe permitir iniciar sesión con email y contraseña.
**Criterios de aceptación:**
1. Dadas credenciales válidas, cuando inicia sesión, entonces accede a su lista de oficinas.
2. Dadas credenciales inválidas, cuando intenta iniciar sesión, entonces el mensaje no revela si falló el email o la contraseña.
3. Dado un error del servidor durante el inicio de sesión, entonces el usuario ve un mensaje comprensible y no un detalle interno.

#### RF-AUT-003 · Sesión con vencimiento y renovación
**Prioridad:** Must · **Fase:** MVP · **Actor:** Usuario
**Descripción:** La sesión debe expirar y renovarse mientras la persona está activa.
**Criterios de aceptación:**
1. Dada una sesión vencida, cuando el usuario realiza una acción protegida, entonces el sistema le pide iniciar sesión de nuevo.
2. Dado un usuario activo, cuando se acerca el vencimiento de su sesión, entonces esta se renueva sin interrumpirlo.
3. Dada una sesión vencida, entonces el servidor responde 401 a cualquier operación protegida.

#### RF-AUT-004 · Cierre de sesión
**Prioridad:** Must · **Fase:** MVP · **Actor:** Usuario
**Descripción:** El usuario debe poder cerrar su sesión.
**Criterios de aceptación:**
1. Dado un usuario que cierra sesión, cuando intenta acceder a una ruta o dato protegido, entonces el sistema lo rechaza.
2. Dado el cierre de sesión, entonces el avatar desaparece de la presencia de la habitación donde estaba.

#### RF-AUT-005 · Protección de rutas y operaciones
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Toda ruta y operación privada debe exigir sesión válida y permisos suficientes (RN-16).
**Criterios de aceptación:**
1. Dada una petición sin sesión válida, entonces el sistema responde 401.
2. Dada una petición con sesión pero sin permiso sobre el recurso, entonces responde 403.
3. Dado un identificador de recurso ajeno manipulado, entonces el sistema no expone ningún dato de ese recurso.
4. Dada cualquier respuesta, entonces no contiene hashes de contraseña, claves ni detalles internos del servidor.

#### RF-AUT-006 · Recuperación de contraseña
**Prioridad:** Should · **Fase:** MVP · **Actor:** Visitante
**Descripción:** El sistema debe permitir restablecer la contraseña mediante un enlace enviado por email.
**Criterios de aceptación:**
1. Dado un email registrado, cuando solicita recuperar la contraseña, entonces recibe un enlace de un solo uso con vencimiento.
2. Dado un email no registrado, cuando lo solicita, entonces la respuesta en pantalla es idéntica, para no revelar qué cuentas existen.
3. Dado un enlace vencido o ya usado, cuando intenta usarlo, entonces el sistema lo rechaza con un mensaje claro.
4. Dado un restablecimiento exitoso, entonces las sesiones anteriores de esa cuenta dejan de ser válidas.

#### RF-AUT-007 · Gestión del perfil
**Prioridad:** Should · **Fase:** MVP · **Actor:** Usuario
**Descripción:** El usuario debe poder ver y editar su nombre visible y sus datos básicos de perfil.
**Criterios de aceptación:**
1. Dado un usuario que edita su perfil con datos válidos, cuando guarda, entonces el cambio persiste tras recargar.
2. Dado un cambio de nombre visible, entonces se refleja en todas las oficinas donde participa.
3. Dados datos inválidos, cuando guarda, entonces ve los errores por campo.

#### RF-AUT-008 · Cambio de contraseña con sesión iniciada
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Usuario
**Descripción:** El usuario debe poder cambiar su contraseña desde su perfil, indicando la actual.
**Criterios de aceptación:**
1. Dada la contraseña actual correcta y una nueva válida, cuando confirma, entonces la contraseña cambia y las demás sesiones se cierran.

#### RF-AUT-009 · Límite de intentos fallidos de inicio de sesión
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Sistema
**Descripción:** El sistema debe limitar los intentos fallidos consecutivos de inicio de sesión.
**Criterios de aceptación:**
1. Dados varios intentos fallidos seguidos sobre una misma cuenta, cuando se supera el límite, entonces el sistema bloquea temporalmente nuevos intentos e informa cuánto esperar.

#### RF-AUT-010 · Verificación de email al registrarse
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Visitante
**Descripción:** El sistema debe verificar que el email pertenece a quien se registra.
**Criterios de aceptación:**
1. Dado un registro nuevo, cuando se envía el enlace de verificación y la persona lo abre, entonces la cuenta queda marcada como verificada.

---

### 5.2 Oficinas e invitaciones (OFI)

#### RF-OFI-001 · Creación automática de la oficina propia
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Al registrarse un usuario, el sistema debe crear su oficina propia con una habitación principal, y asignarle el rol de Dueño (RN-01).
**Criterios de aceptación:**
1. Dado un registro exitoso, entonces el usuario aparece como Dueño de una oficina nueva que contiene una habitación principal.
2. Dado un usuario existente, entonces no puede crear una segunda oficina propia.
3. Dada la oficina recién creada, entonces el tablero tiene sus columnas por defecto (RF-TAR-006) y los canales de chat existen.

#### RF-OFI-002 · Lista de oficinas del usuario
**Prioridad:** Must · **Fase:** MVP · **Actor:** Usuario
**Descripción:** El usuario debe ver una lista con su oficina propia y las oficinas a las que fue invitado, indicando su rol en cada una.
**Criterios de aceptación:**
1. Dado un usuario con sesión, cuando abre su inicio, entonces ve su oficina propia y las invitadas, cada una con su rol.
2. Dada una oficina dada de baja, entonces no aparece en la lista de sus miembros (RN-14); el Dueño la ve marcada como dada de baja (RF-OFI-015).
3. Dado un usuario que fue expulsado de una oficina, entonces esa oficina no aparece en su lista.
4. Dada una lista vacía de oficinas invitadas, entonces el usuario ve un mensaje que lo indica.

#### RF-OFI-003 · Ingreso a una oficina
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** El usuario debe poder entrar a cualquier oficina de su lista y comenzar en su habitación principal.
**Criterios de aceptación:**
1. Dado un miembro de la oficina, cuando la selecciona, entonces ingresa a la habitación principal.
2. Dado un usuario que no es miembro, cuando intenta entrar a la oficina por cualquier medio, entonces el sistema responde 403.
3. Dado un usuario sin sesión, cuando intenta entrar, entonces el sistema responde 401.

#### RF-OFI-004 · Edición de datos de la oficina
**Prioridad:** Should · **Fase:** MVP · **Actor:** Dueño, Administrador
**Descripción:** El Dueño y el Administrador deben poder editar el nombre y la descripción de la oficina.
**Criterios de aceptación:**
1. Dado un Dueño o Administrador con datos válidos, cuando guarda, entonces los miembros ven el nombre nuevo.
2. Dado un Miembro o Líder, cuando intenta editar los datos de la oficina, entonces el sistema responde 403.

#### RF-OFI-005 · Generación de enlace de invitación
**Prioridad:** Must · **Fase:** MVP · **Actor:** Dueño, Administrador
**Descripción:** El sistema debe permitir generar un enlace único de invitación a la oficina, con vencimiento y, opcionalmente, un límite de usos.
**Criterios de aceptación:**
1. Dado un Dueño o Administrador, cuando genera una invitación, entonces obtiene un enlace único y copiable.
2. Dado el formulario de invitación, cuando define un vencimiento y opcionalmente un máximo de usos, entonces el enlace respeta esos valores.
3. Dado un Miembro o Líder, cuando intenta generar un enlace, entonces el sistema responde 403.
4. Dado un enlace de invitación, entonces da acceso únicamente a la oficina para la que fue generado y nunca a otras.

#### RF-OFI-006 · Revocación de invitaciones
**Prioridad:** Must · **Fase:** MVP · **Actor:** Dueño, Administrador
**Descripción:** El sistema debe permitir revocar un enlace de invitación vigente.
**Criterios de aceptación:**
1. Dada una invitación vigente, cuando el Dueño o Administrador la revoca, entonces el enlace deja de funcionar de inmediato.
2. Dado un usuario que ya se había unido con ese enlace, cuando se revoca, entonces su membresía no cambia.

#### RF-OFI-007 · Lista de invitaciones vigentes
**Prioridad:** Should · **Fase:** MVP · **Actor:** Dueño, Administrador
**Descripción:** El sistema debe mostrar las invitaciones de la oficina con su estado (vigente, vencida, revocada, agotada), vencimiento y usos.
**Criterios de aceptación:**
1. Dada una oficina con invitaciones, cuando el Dueño o Administrador abre el panel, entonces las ve con su estado.
2. Dado un enlace vencido, entonces aparece como vencido sin intervención manual.

#### RF-OFI-008 · Aceptación de una invitación
**Prioridad:** Must · **Fase:** MVP · **Actor:** Visitante, Usuario
**Descripción:** Quien abre un enlace de invitación válido debe unirse a la oficina como Miembro (RN-06).
**Criterios de aceptación:**
1. Dado un Usuario con sesión, cuando abre un enlace vigente, entonces pasa a ser Miembro con acceso solo a la habitación principal.
2. Dado un Visitante sin cuenta, cuando abre un enlace vigente, entonces puede registrarse o iniciar sesión y, al terminar, se une automáticamente a la oficina.
3. Dado un enlace vencido, revocado o agotado, cuando lo abre, entonces el sistema lo rechaza con un mensaje que indica el motivo.
4. Dado un usuario que ya es miembro, cuando abre el enlace, entonces no se duplica su membresía y se lo lleva a la oficina.
5. Dada una oficina dada de baja, cuando se abre un enlace de invitación, entonces el sistema lo rechaza.
6. Dado un usuario expulsado, cuando abre un enlace vigente, entonces se une de nuevo como Miembro sin acceso a lo que tenía antes.

#### RF-OFI-009 · Vencimiento automático de invitaciones
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Las invitaciones deben dejar de ser válidas al llegar a su vencimiento o a su máximo de usos.
**Criterios de aceptación:**
1. Dada una invitación vencida, cuando alguien la abre, entonces no se une a la oficina.
2. Dada una invitación con límite de usos alcanzado, cuando alguien la abre, entonces no se une a la oficina.

#### RF-OFI-010 · Lista de miembros
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** Cada miembro debe poder ver quiénes pertenecen a la oficina y su rol.
**Criterios de aceptación:**
1. Dado un miembro, cuando abre la lista, entonces ve nombre visible y rol de cada miembro activo.
2. Dado un Dueño o Administrador, cuando abre la lista, entonces además ve las acciones de gestión que le corresponden.
3. Dado un usuario no miembro, cuando intenta ver la lista, entonces el sistema responde 403.

#### RF-OFI-011 · Nombrar y quitar Administradores
**Prioridad:** Should · **Fase:** MVP · **Actor:** Dueño
**Descripción:** El Dueño debe poder asignar el rol de Administrador a un miembro y quitárselo (RN-09).
**Criterios de aceptación:**
1. Dado el Dueño, cuando asigna el rol a un miembro, entonces este puede ejecutar las acciones de Administrador de la matriz de permisos.
2. Dado el Dueño, cuando quita el rol, entonces el miembro vuelve a Miembro y pierde esas acciones de inmediato.
3. Dado un Administrador, cuando intenta nombrar o quitar Administradores, entonces el sistema responde 403.
4. Dado el Dueño, entonces no puede asignarse ni quitarse un rol a sí mismo.

#### RF-OFI-012 · Expulsión de un miembro
**Prioridad:** Must · **Fase:** MVP · **Actor:** Dueño, Administrador
**Descripción:** El Dueño y el Administrador deben poder expulsar a un miembro de la oficina mediante baja lógica de su membresía (RN-13).
**Criterios de aceptación:**
1. Dado un miembro expulsado, entonces pierde acceso a todas las habitaciones y a los chats de la oficina, y la oficina desaparece de su lista.
2. Dado un miembro expulsado que estaba conectado, entonces su avatar sale de la habitación y es desconectado de la oficina.
3. Dado un miembro expulsado, entonces sus mensajes, tareas y anuncios se conservan y sus tareas asignadas quedan huérfanas.
4. Dado un Administrador, cuando intenta expulsar al Dueño, entonces el sistema responde 403 (RN-08).
5. Dado un Miembro o Líder, cuando intenta expulsar a alguien, entonces el sistema responde 403.
6. Dado un Administrador, cuando intenta expulsar a otro Administrador, entonces el sistema responde 403. ⚠️ Supuesto: solo el Dueño gestiona Administradores.

#### RF-OFI-013 · Abandono de la oficina
**Prioridad:** Should · **Fase:** MVP · **Actor:** Administrador, Líder, Miembro
**Descripción:** Un miembro debe poder abandonar por su cuenta una oficina ajena.
**Criterios de aceptación:**
1. Dado un miembro que confirma que abandona, entonces pierde acceso y la oficina desaparece de su lista.
2. Dado el abandono, entonces lo que generó se conserva y sus tareas asignadas quedan huérfanas.
3. Dado el Dueño, cuando intenta abandonar su oficina, entonces el sistema se lo impide y le indica que puede darla de baja (RN-15).

#### RF-OFI-014 · Baja lógica de la oficina
**Prioridad:** Should · **Fase:** MVP · **Actor:** Dueño
**Descripción:** El Dueño debe poder dar de baja su oficina; queda recuperable por 15 días (RN-14).
**Criterios de aceptación:**
1. Dado el Dueño, cuando confirma la baja (con una confirmación explícita), entonces la oficina deja de estar disponible para todos sus miembros.
2. Dados los miembros conectados, cuando se da de baja la oficina, entonces son sacados de ella.
3. Dado un Administrador, Líder o Miembro, cuando intenta dar de baja la oficina, entonces el sistema responde 403.
4. Dada la baja, entonces ningún dato se elimina todavía.

#### RF-OFI-015 · Recuperación de la oficina
**Prioridad:** Should · **Fase:** MVP · **Actor:** Dueño
**Descripción:** El Dueño debe poder recuperar su oficina dentro de los 15 días posteriores a la baja.
**Criterios de aceptación:**
1. Dado el Dueño con una oficina dada de baja, cuando abre su lista, entonces la ve marcada como dada de baja con los días que le quedan.
2. Dado el Dueño, cuando la recupera dentro del plazo, entonces la oficina vuelve exactamente como estaba, con sus miembros, accesos y datos.
3. Dado el plazo vencido, entonces la recuperación ya no es posible.

#### RF-OFI-016 · Eliminación definitiva tras el plazo
**Prioridad:** Should · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Pasados 15 días desde la baja, el sistema debe eliminar definitivamente la oficina y sus datos.
**Criterios de aceptación:**
1. Dada una oficina con más de 15 días de baja, entonces se elimina junto con habitaciones, tareas, anuncios, reuniones y mensajes.
2. Dada la eliminación definitiva, entonces la oficina propia no se vuelve a crear automáticamente; el usuario queda sin oficina propia. ⚠️ A decidir: si debe poder crear una nueva.

#### RF-OFI-017 · Invitación por email
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Dueño, Administrador
**Descripción:** El sistema debe permitir enviar la invitación directamente al email de una persona.
**Criterios de aceptación:**
1. Dado un email válido, cuando el Dueño o Administrador envía la invitación, entonces la persona recibe un enlace de invitación.

#### RF-OFI-018 · Solicitud de ingreso a una oficina
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Usuario, Dueño, Administrador
**Descripción:** Un usuario debe poder pedir ingreso a una oficina que lo permita, y el Dueño o Administrador aprobarlo o rechazarlo.
**Criterios de aceptación:**
1. Dada una solicitud pendiente, cuando el Dueño o Administrador la aprueba, entonces el usuario pasa a ser Miembro.

---

### 5.3 Habitaciones y accesos (HAB)

#### RF-HAB-001 · Habitación principal
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Toda oficina debe tener una habitación principal accesible para todos sus miembros (RN-04).
**Criterios de aceptación:**
1. Dada una oficina nueva, entonces tiene exactamente una habitación principal.
2. Dado un miembro nuevo, entonces puede entrar a la habitación principal sin que se le otorgue acceso explícito.
3. Dada la habitación principal, entonces nadie puede eliminarla ni quitarle acceso a un miembro.
4. Dado un miembro que ingresa a la oficina, entonces comienza en la habitación principal.

#### RF-HAB-002 · Creación de habitaciones
**Prioridad:** Must · **Fase:** MVP · **Actor:** Dueño, Administrador
**Descripción:** El Dueño y el Administrador deben poder crear habitaciones adicionales con un nombre.
**Criterios de aceptación:**
1. Dado un Dueño o Administrador con un nombre válido, cuando crea la habitación, entonces aparece en la oficina y aún nadie más que el Dueño y los Administradores puede entrar.
2. Dado un Líder o Miembro, cuando intenta crear una habitación, entonces el sistema responde 403.
3. Dado un nombre vacío o repetido dentro de la misma oficina, entonces el sistema muestra un error claro.
4. Dada una habitación nueva, entonces tiene su tablero con las columnas por defecto, cartelera, reuniones y chat propios.

#### RF-HAB-003 · Límite de habitaciones adicionales
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** El sistema debe impedir superar las 5 habitaciones adicionales por oficina (RN-05).
**Criterios de aceptación:**
1. Dada una oficina con 5 habitaciones adicionales, cuando se intenta crear otra, entonces el sistema la rechaza con un mensaje que indica el límite.
2. Dada una habitación eliminada, entonces el cupo se libera.
3. Dada la habitación principal, entonces no cuenta para el límite.

#### RF-HAB-004 · Edición de habitaciones
**Prioridad:** Should · **Fase:** MVP · **Actor:** Dueño, Administrador
**Descripción:** Se debe poder renombrar una habitación.
**Criterios de aceptación:**
1. Dado un nombre válido, cuando se guarda, entonces los usuarios con acceso ven el nombre nuevo.
2. Dado un Líder o Miembro, cuando intenta renombrarla, entonces el sistema responde 403.

#### RF-HAB-005 · Eliminación de habitaciones
**Prioridad:** Should · **Fase:** MVP · **Actor:** Dueño, Administrador
**Descripción:** Se debe poder eliminar una habitación adicional, con todo su contenido.
**Criterios de aceptación:**
1. Dada una habitación con contenido, cuando se intenta eliminar, entonces el sistema advierte qué se perderá (tareas, anuncios, reuniones y mensajes) y pide confirmación.
2. Dada la confirmación, entonces la habitación y su contenido se eliminan y los usuarios conectados en ella son llevados a la habitación principal.
3. Dada la habitación principal, entonces no se puede eliminar.
4. ⚠️ Supuesto: eliminar una habitación borra su contenido; no hay recuperación.

#### RF-HAB-006 · Otorgar y quitar acceso a una habitación
**Prioridad:** Must · **Fase:** MVP · **Actor:** Dueño, Administrador, Líder
**Descripción:** Se debe poder dar o quitar acceso a una habitación a miembros de la oficina (RN-10, RN-11).
**Criterios de aceptación:**
1. Dado un Dueño o Administrador, cuando otorga acceso a un miembro, entonces este puede entrar a la habitación.
2. Dado un Líder, cuando otorga acceso a su habitación a un miembro de la oficina, entonces este puede entrar.
3. Dado un Líder, cuando intenta dar acceso a una habitación que no lidera, entonces el sistema responde 403.
4. Dado un Líder, cuando intenta dar acceso a alguien que no es miembro de la oficina, entonces el sistema lo rechaza.
5. Dado un Miembro sin rol de Líder, cuando intenta otorgar acceso, entonces el sistema responde 403.
6. Dado un acceso quitado, entonces se aplica RN-12 de inmediato, incluso si el usuario está conectado en la habitación.

#### RF-HAB-007 · Panel de accesos
**Prioridad:** Must · **Fase:** MVP · **Actor:** Dueño, Administrador
**Descripción:** El sistema debe ofrecer un panel que muestre, para cada miembro, a qué habitaciones tiene acceso y su rol en ellas, y permita modificarlos.
**Criterios de aceptación:**
1. Dado un Dueño o Administrador, cuando abre el panel, entonces ve a todos los miembros y todas las habitaciones con su acceso y liderazgo.
2. Dado un cambio en el panel, cuando se guarda, entonces se aplica de inmediato y persiste.
3. Dado un Líder, cuando abre el panel, entonces solo puede gestionar el acceso de su propia habitación.
4. Dado un Miembro sin rol de Líder, cuando intenta abrir el panel, entonces el sistema responde 403.

#### RF-HAB-008 · Asignación de Líderes
**Prioridad:** Should · **Fase:** MVP · **Actor:** Dueño, Administrador
**Descripción:** Se debe poder asignar y quitar el rol de Líder de una habitación; puede haber varios.
**Criterios de aceptación:**
1. Dado un miembro con acceso a una habitación, cuando se lo asigna como Líder, entonces puede ejecutar las acciones de Líder de la matriz de permisos en esa habitación.
2. Dada una habitación con dos Líderes, entonces ambos tienen los mismos permisos.
3. Dado un miembro sin acceso a la habitación, cuando se intenta asignarlo como Líder, entonces el sistema lo rechaza.
4. Dado un Líder al que se le quita el acceso, entonces deja de ser Líder de esa habitación.
5. Dado un Líder o Miembro, cuando intenta asignar Líderes, entonces el sistema responde 403.

#### RF-HAB-009 · Cambio de habitación
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** El usuario debe poder pasar de una habitación a otra de su oficina con un control visible (botón o selector), además de los accesos espaciales (RF-OBJ).
**Criterios de aceptación:**
1. Dado un usuario con acceso a varias habitaciones, cuando elige una, entonces su avatar pasa a ella y su presencia se actualiza para los demás.
2. Dado el selector, entonces solo habilita las habitaciones a las que el usuario tiene acceso.
3. Dado un usuario que intenta entrar a una habitación sin acceso, por cualquier medio, entonces el sistema responde 403.
4. Dado un cambio de habitación, entonces el canal de chat por defecto pasa a ser el de la nueva habitación.

#### RF-HAB-010 · Efecto de la pérdida de acceso
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Cuando un usuario pierde acceso a una habitación, el sistema debe aplicar RN-12.
**Criterios de aceptación:**
1. Dado un usuario conectado en una habitación, cuando pierde el acceso, entonces es llevado a la habitación principal.
2. Dada la pérdida de acceso, entonces el usuario ya no ve tablero, cartelera, reuniones ni historial de chat de esa habitación.
3. Dadas las tareas asignadas a ese usuario, entonces quedan marcadas como huérfanas (RF-TAR-009).
4. Dado un anuncio o reunión creados por ese usuario, entonces se conservan.

#### RF-HAB-011 · Verificación de acceso en el servidor
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Toda operación sobre una habitación y su contenido debe verificar en el servidor la membresía y el acceso (RN-03, RN-16).
**Criterios de aceptación:**
1. Dada una petición directa a un recurso de una habitación sin acceso, entonces el sistema responde 403.
2. Dada una petición con un identificador de otra oficina, entonces el sistema no revela si el recurso existe.
3. Dada la conexión a la presencia de una habitación, entonces el sistema también verifica el acceso antes de permitirla.

#### RF-HAB-012 · Acceso de solo lectura a una habitación
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Dueño, Administrador, Líder
**Descripción:** Se debe poder dar acceso a una habitación con permiso de solo lectura.
**Criterios de aceptación:**
1. Dado un miembro con acceso de solo lectura, cuando intenta crear o editar contenido, entonces el sistema responde 403.

#### RF-HAB-013 · Límite configurable de habitaciones
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Dueño
**Descripción:** El límite de habitaciones adicionales debe poder ampliarse más allá de 5.
**Criterios de aceptación:**
1. Dado un nuevo límite configurado, cuando el Dueño crea habitaciones, entonces se respeta ese límite.


---

### 5.4 Mundo 3D, avatar y presencia (MUN)

#### RF-MUN-001 · Escena isométrica de la habitación
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** Cada habitación debe mostrarse como una escena tridimensional vista desde una cámara isométrica, con superficies transitables y objetos.
**Criterios de aceptación:**
1. Dado un usuario con acceso, cuando entra a una habitación, entonces ve su escena y su propio avatar.
2. Dada la cámara, entonces mantiene la perspectiva isométrica y no requiere control libre por parte del usuario.
3. Dada una escena en carga, entonces el usuario ve un indicador de carga y, si falla, un mensaje de error con opción de reintentar.

#### RF-MUN-002 · Movimiento con teclado
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** El usuario debe poder desplazar su avatar con las teclas W, A, S y D.
**Criterios de aceptación:**
1. Dado un usuario en una habitación, cuando presiona una tecla de movimiento, entonces su avatar se desplaza en esa dirección de forma fluida.
2. Dado un usuario escribiendo en un campo de texto (por ejemplo el chat), cuando presiona esas teclas, entonces el avatar no se mueve.

#### RF-MUN-003 · Movimiento por clic a destino
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** El usuario debe poder hacer clic en una superficie transitable para que su avatar se desplace hasta allí.
**Criterios de aceptación:**
1. Dado un clic sobre una superficie transitable, entonces el avatar se desplaza hasta ese punto.
2. Dado un clic sobre una superficie no transitable u obstáculo, entonces el avatar no atraviesa el obstáculo.

#### RF-MUN-004 · Controles táctiles
**Prioridad:** Should · **Fase:** MVP · **Actor:** Miembro
**Descripción:** Las acciones de mouse deben tener un equivalente táctil.
**Criterios de aceptación:**
1. Dado un dispositivo táctil, cuando el usuario toca una superficie transitable, entonces el avatar se desplaza hasta allí.
2. Dado un dispositivo táctil, cuando toca un objeto interactuable, entonces se ejecuta la misma acción que con el mouse.
3. Dado un dispositivo táctil sin teclado, entonces el usuario puede moverse sin usar WASD.

#### RF-MUN-005 · Colisiones y límites del espacio
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Los avatares no deben atravesar paredes ni objetos sólidos ni salir de los límites de la habitación.
**Criterios de aceptación:**
1. Dado un avatar que avanza contra una pared u objeto sólido, entonces se detiene o lo bordea.
2. Dado un avatar, entonces no puede quedar fuera del área navegable.

#### RF-MUN-006 · Avatar propio y de otros
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** Cada usuario debe tener un avatar visible para los demás usuarios que estén en la misma habitación.
**Criterios de aceptación:**
1. Dados dos usuarios con acceso en la misma habitación, entonces cada uno ve el avatar del otro.
2. Dado un avatar, entonces muestra el nombre visible de su usuario.
3. Dado un usuario en otra habitación, entonces su avatar no se muestra, pero sí figura en la lista de presencia (RF-MUN-010).

#### RF-MUN-007 · Sincronización de movimiento en tiempo real
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** Los movimientos de un avatar deben verse en tiempo real y con fluidez para los demás usuarios de la habitación.
**Criterios de aceptación:**
1. Dado un usuario que se mueve, entonces los demás en la habitación ven el movimiento sin necesidad de recargar.
2. Dado el movimiento de otro usuario, entonces se ve continuo y no a saltos bruscos.
3. Dado un movimiento imposible (atravesar paredes o saltar de lugar), entonces no es aceptado por el servidor.

#### RF-MUN-008 · Entrada, salida y desconexión de avatares
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** El sistema debe mostrar la aparición y desaparición de avatares cuando los usuarios entran, salen o se desconectan.
**Criterios de aceptación:**
1. Dado un usuario que entra a la habitación, entonces su avatar aparece para los demás.
2. Dado un usuario que sale, cambia de habitación o cierra sesión, entonces su avatar desaparece de la habitación anterior.
3. Dado un usuario que pierde la conexión, entonces su avatar desaparece pasado un tiempo breve.

#### RF-MUN-009 · Reconexión
**Prioridad:** Should · **Fase:** MVP · **Actor:** Miembro
**Descripción:** Si se interrumpe la conexión, el sistema debe intentar reconectar al usuario a su habitación.
**Criterios de aceptación:**
1. Dada una desconexión breve, cuando se recupera la red, entonces el usuario vuelve a su habitación sin acción manual.
2. Dada una reconexión fallida, entonces el usuario ve un aviso y una opción para reintentar.
3. Dada una reconexión luego de perder acceso, entonces no se le permite volver a la habitación.

#### RF-MUN-010 · Lista de presencia
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** El usuario debe ver una lista de los miembros de la oficina conectados y en qué habitación está cada uno, incluso en habitaciones a las que no tiene acceso.
**Criterios de aceptación:**
1. Dado un miembro de la oficina, cuando abre la lista, entonces ve quién está conectado y en qué habitación.
2. Dado un usuario que cambia de habitación, entonces la lista se actualiza sin recargar.
3. Dado un usuario que se desconecta, entonces deja de figurar como conectado.
4. Dada una habitación sin acceso, entonces la lista muestra quién está allí pero no su contenido.
5. Dado un usuario de otra oficina, entonces nunca aparece en la lista.

#### RF-MUN-011 · Personalización y persistencia del avatar
**Prioridad:** Should · **Fase:** MVP · **Actor:** Usuario
**Descripción:** El usuario debe poder personalizar la apariencia de su avatar y que esta se conserve.
**Criterios de aceptación:**
1. Dado un usuario que modifica su avatar, cuando guarda, entonces su nuevo aspecto persiste tras recargar y cerrar sesión.
2. Dado un avatar modificado, entonces los demás usuarios lo ven actualizado.
3. Dado un usuario nuevo, entonces tiene un avatar por defecto.

#### RF-MUN-012 · Acceso a las funciones sin apuntar a objetos 3D
**Prioridad:** Should · **Fase:** MVP · **Actor:** Miembro
**Descripción:** Las funciones esenciales (tareas, cartelera, reuniones, chat, cambio de habitación, bot) deben poder usarse desde un menú o interfaz alternativa, sin depender de apuntar a un objeto en la escena.
**Criterios de aceptación:**
1. Dado un usuario con teclado, cuando usa el menú, entonces puede abrir cada herramienta sin usar el mouse sobre la escena.
2. Dado un usuario que abre una herramienta desde el menú, entonces ve la misma interfaz que desde el objeto.
3. Dado un usuario sin acceso a una herramienta, entonces el menú no la muestra habilitada.

#### RF-MUN-013 · Uso en pantallas pequeñas
**Prioridad:** Could · **Fase:** MVP · **Actor:** Miembro
**Descripción:** El sistema debe poder usarse en celulares, con una disposición adaptada.
**Criterios de aceptación:**
1. Dado un celular, cuando el usuario ingresa a una habitación, entonces puede ver la escena, moverse y abrir los paneles de herramientas.

#### RF-MUN-014 · Estados de actividad
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Miembro
**Descripción:** El usuario debe poder indicar su disponibilidad (por ejemplo disponible, ocupado, ausente).
**Criterios de aceptación:**
1. Dado un cambio de estado, entonces los demás miembros lo ven junto al avatar y en la lista de presencia.

#### RF-MUN-015 · Emotes y acciones sociales
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Miembro
**Descripción:** El usuario debe poder realizar gestos o animaciones visibles para los demás.
**Criterios de aceptación:**
1. Dado un emote elegido, entonces los demás usuarios en la habitación ven la animación en su avatar.

#### RF-MUN-016 · Sonido ambiente y efectos
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Usuario
**Descripción:** El entorno debe poder reproducir sonidos y permitir silenciarlos.
**Criterios de aceptación:**
1. Dado un usuario que silencia el sonido, entonces la preferencia se conserva.

---

### 5.5 Tareas (TAR)

Las tareas pertenecen a una **habitación** y se organizan en un tablero Kanban. Cualquier persona con acceso a la habitación puede crear, editar, mover y eliminar tareas; la estructura del tablero (columnas) la gestionan el Líder, el Administrador y el Dueño.

#### RF-TAR-001 · Ver el tablero de una habitación
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** El usuario debe ver el tablero Kanban de la habitación, con sus columnas y tareas.
**Criterios de aceptación:**
1. Dado un usuario con acceso, cuando abre el tablero, entonces ve las columnas en orden y las tareas de cada una.
2. Dado un tablero sin tareas, entonces el usuario ve un estado vacío que invita a crear la primera.
3. Dado un usuario sin acceso a la habitación, cuando intenta ver el tablero, entonces el sistema responde 403.
4. Dada una carga lenta o fallida, entonces el usuario ve un indicador de carga o un mensaje de error.

#### RF-TAR-002 · Crear tarea
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** El usuario debe poder crear una tarea con título (obligatorio), descripción, responsable, fecha límite y prioridad.
**Criterios de aceptación:**
1. Dado un título válido, cuando el usuario guarda, entonces la tarea aparece en la primera columna del tablero.
2. Dado un título vacío, cuando intenta guardar, entonces ve un error y el servidor también rechaza la tarea.
3. Dada una tarea creada, entonces persiste tras recargar y los demás usuarios de la habitación la ven.
4. Dado un usuario sin acceso a la habitación, cuando intenta crear una tarea, entonces el sistema responde 403.
5. Dado un título o descripción que superan el máximo permitido, entonces el sistema muestra un error claro.

#### RF-TAR-003 · Editar tarea
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** Cualquier usuario con acceso debe poder editar los campos de una tarea de su habitación.
**Criterios de aceptación:**
1. Dada una tarea, cuando un usuario con acceso modifica sus campos con datos válidos, entonces los cambios persisten y los demás los ven.
2. Dados datos inválidos, cuando intenta guardar, entonces ve el error por campo.
3. Dado un usuario sin acceso, cuando intenta editar, entonces el sistema responde 403.

#### RF-TAR-004 · Mover tarea entre columnas
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** El usuario debe poder mover una tarea a otra columna del tablero de su habitación, por ejemplo arrastrándola.
**Criterios de aceptación:**
1. Dado un usuario con acceso, cuando arrastra la tarea a otra columna, entonces queda en la nueva columna y el cambio persiste al recargar.
2. Dado un usuario sin acceso a la habitación, cuando intenta moverla, entonces el sistema responde 403.
3. Dados otros usuarios conectados a esa habitación, cuando se mueve la tarea, entonces ven el cambio sin recargar.
4. Dado un dispositivo táctil, entonces existe una forma de mover la tarea sin arrastrar (por ejemplo un menú).

#### RF-TAR-005 · Eliminar tarea
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** Cualquier usuario con acceso debe poder eliminar una tarea de su habitación.
**Criterios de aceptación:**
1. Dada una tarea, cuando el usuario confirma la eliminación, entonces desaparece del tablero y no vuelve al recargar.
2. Dada la eliminación, entonces el sistema pide confirmación antes de ejecutarla.
3. Dado un usuario sin acceso, cuando intenta eliminarla, entonces el sistema responde 403.

#### RF-TAR-006 · Columnas por defecto
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Todo tablero nuevo debe crearse con las columnas "Pendiente", "En curso" y "Hecho".
**Criterios de aceptación:**
1. Dada una habitación nueva, entonces su tablero tiene esas tres columnas en ese orden.

#### RF-TAR-007 · Configurar columnas del tablero
**Prioridad:** Should · **Fase:** MVP · **Actor:** Líder, Administrador, Dueño
**Descripción:** Se debe poder crear, renombrar, reordenar y eliminar columnas del tablero.
**Criterios de aceptación:**
1. Dado un Líder, Administrador o Dueño, cuando agrega o renombra una columna con un nombre válido, entonces el cambio se refleja para todos los usuarios con acceso.
2. Dada una columna con tareas, cuando se intenta eliminar, entonces el sistema exige elegir a qué columna se mueven las tareas.
3. Dado un tablero, entonces no puede quedar sin columnas.
4. Dado un Miembro sin rol de Líder, cuando intenta cambiar la estructura del tablero, entonces el sistema responde 403.
5. Dados dos columnas con el mismo nombre en el mismo tablero, entonces el sistema lo rechaza.

#### RF-TAR-008 · Asignar responsable
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** Una tarea debe poder asignarse a un usuario que tenga acceso a la habitación.
**Criterios de aceptación:**
1. Dada una tarea, cuando se asigna a un usuario con acceso a la habitación, entonces el responsable queda visible en la tarea.
2. Dado un usuario sin acceso a la habitación, cuando se intenta asignarlo, entonces el sistema lo rechaza.
3. Dada una asignación, entonces el responsable recibe una notificación (RF-NOT-002).

#### RF-TAR-009 · Tareas huérfanas
**Prioridad:** Should · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Las tareas cuyo responsable perdió el acceso a la habitación o dejó la oficina deben quedar marcadas como huérfanas (RN-12).
**Criterios de aceptación:**
1. Dado un responsable que pierde acceso, entonces sus tareas siguen en el tablero pero con una marca visible de "sin responsable activo".
2. Dado el responsable que ya no tiene acceso, entonces no puede ver ni editar la tarea.
3. Dada una tarea huérfana que alguien reasigna, entonces la marca desaparece.

#### RF-TAR-010 · Vista de lista y filtros
**Prioridad:** Should · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** Las tareas de la habitación deben poder verse también como listado y filtrarse por responsable, columna o prioridad.
**Criterios de aceptación:**
1. Dado el listado, cuando el usuario aplica un filtro, entonces solo ve las tareas que coinciden.
2. Dado un filtro sin resultados, entonces el usuario ve un estado vacío que lo indica.

#### RF-TAR-011 · Actualización del tablero en vivo
**Prioridad:** Should · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** Los cambios en el tablero hechos por otros usuarios deben verse sin recargar.
**Criterios de aceptación:**
1. Dados dos usuarios con el tablero abierto, cuando uno crea, edita, mueve o elimina una tarea, entonces el otro ve el cambio en pocos segundos.
2. Dados cambios simultáneos sobre una misma tarea, entonces el sistema conserva un estado coherente y avisa al usuario si su cambio no se aplicó.

#### RF-TAR-012 · Fecha límite y vencidas
**Prioridad:** Should · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** Las tareas con fecha límite deben mostrar cuándo vencen y destacarse al estar vencidas o próximas a vencer.
**Criterios de aceptación:**
1. Dada una tarea con fecha límite pasada y que no está en la última columna, entonces se muestra como vencida.
2. Dada una tarea que vence en los próximos días, entonces se muestra como próxima a vencer.

#### RF-TAR-013 · Mis tareas
**Prioridad:** Could · **Fase:** MVP · **Actor:** Usuario
**Descripción:** El usuario debe poder ver todas las tareas que tiene asignadas, de todas sus oficinas, limitadas a las habitaciones a las que tiene acceso.
**Criterios de aceptación:**
1. Dado un usuario con tareas en varias oficinas, entonces las ve agrupadas por oficina y habitación.
2. Dado un usuario sin acceso a una habitación, entonces sus tareas de esa habitación no se listan.

#### RF-TAR-014 · Comentarios, etiquetas y adjuntos en tareas
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Miembro con acceso a la habitación
**Descripción:** Las tareas deben poder tener comentarios, etiquetas y archivos adjuntos.
**Criterios de aceptación:**
1. Dada una tarea, cuando un usuario con acceso agrega un comentario, entonces los demás lo ven.

---

### 5.6 Cartelera y reuniones (CAR)

La cartelera y las reuniones pertenecen a una **habitación**. Los permisos de creación y gestión están en la sección 3.3.

#### RF-CAR-001 · Ver la cartelera
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** El usuario debe poder ver los anuncios de la habitación, del más reciente al más antiguo.
**Criterios de aceptación:**
1. Dado un usuario con acceso, cuando abre la cartelera, entonces ve los anuncios con título, contenido, autor y fecha.
2. Dada una cartelera sin anuncios, entonces el usuario ve un estado vacío.
3. Dado un usuario sin acceso a la habitación, cuando intenta verla, entonces el sistema responde 403.

#### RF-CAR-002 · Publicar un anuncio
**Prioridad:** Must · **Fase:** MVP · **Actor:** Líder, Administrador, Dueño
**Descripción:** El Líder, el Administrador y el Dueño deben poder publicar anuncios en la cartelera de su habitación.
**Criterios de aceptación:**
1. Dado un título y contenido válidos, cuando se publica, entonces el anuncio aparece en la cartelera y persiste.
2. Dado un Miembro sin rol de Líder, cuando intenta publicar, entonces el sistema responde 403.
3. Dado un Líder, cuando intenta publicar en una habitación que no lidera, entonces el sistema responde 403.
4. Dados datos inválidos, entonces ve el error por campo.

#### RF-CAR-003 · Editar y eliminar anuncios propios
**Prioridad:** Must · **Fase:** MVP · **Actor:** Líder, Administrador, Dueño
**Descripción:** Quien publicó un anuncio debe poder editarlo o eliminarlo.
**Criterios de aceptación:**
1. Dado un autor, cuando edita su anuncio, entonces el cambio persiste y los demás lo ven.
2. Dado un autor, cuando confirma la eliminación, entonces el anuncio desaparece de la cartelera.
3. Dado un Líder, cuando intenta editar o eliminar un anuncio de otra persona, entonces el sistema responde 403.

#### RF-CAR-004 · Gestionar anuncios ajenos
**Prioridad:** Must · **Fase:** MVP · **Actor:** Administrador, Dueño
**Descripción:** El Administrador y el Dueño deben poder editar o eliminar anuncios de cualquier autor en cualquier habitación de su oficina.
**Criterios de aceptación:**
1. Dado un Administrador o Dueño, cuando edita o elimina un anuncio ajeno, entonces el cambio persiste.
2. Dado un Líder o Miembro, cuando intenta lo mismo, entonces el sistema responde 403.

#### RF-CAR-005 · Crear una reunión
**Prioridad:** Must · **Fase:** MVP · **Actor:** Líder, Administrador, Dueño
**Descripción:** Se debe poder crear una reunión en una habitación con título, descripción, fecha, hora de inicio y hora de fin.
**Criterios de aceptación:**
1. Dados datos válidos, cuando se crea, entonces la reunión aparece en la habitación para quienes tienen acceso.
2. Dada una hora de fin anterior a la de inicio, entonces el sistema la rechaza con un error claro.
3. Dado un Miembro sin rol de Líder, cuando intenta crear una reunión, entonces el sistema responde 403.
4. Dada una reunión creada, entonces los miembros con acceso reciben una notificación (RF-NOT-002).

#### RF-CAR-006 · Editar y cancelar reuniones
**Prioridad:** Must · **Fase:** MVP · **Actor:** Líder, Administrador, Dueño
**Descripción:** Quien creó una reunión debe poder editarla o cancelarla; el Administrador y el Dueño pueden hacerlo con las de cualquiera.
**Criterios de aceptación:**
1. Dado el creador, cuando edita fecha u hora, entonces los asistentes confirmados reciben una notificación del cambio.
2. Dado el creador, cuando cancela la reunión, entonces queda marcada como cancelada y los confirmados son notificados.
3. Dado un Líder, cuando intenta editar o cancelar una reunión de otra persona, entonces el sistema responde 403.
4. Dado un Administrador o Dueño, cuando lo hace con una reunión ajena, entonces el cambio persiste.

#### RF-CAR-007 · Confirmar asistencia
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** Cada usuario con acceso debe poder indicar si asistirá o no a una reunión, y cambiar su respuesta.
**Criterios de aceptación:**
1. Dado un usuario con acceso, cuando confirma o declina, entonces su respuesta persiste y puede cambiarla antes de la reunión.
2. Dada una reunión cancelada o pasada, entonces no se puede cambiar la respuesta.
3. Dado un usuario sin acceso a la habitación, cuando intenta responder, entonces el sistema responde 403.

#### RF-CAR-008 · Ver asistentes
**Prioridad:** Should · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** El usuario debe poder ver cuántas personas confirmaron y quiénes.
**Criterios de aceptación:**
1. Dada una reunión con respuestas, entonces el usuario ve las listas de confirmados y de quienes declinaron.
2. Dada una reunión sin respuestas, entonces el usuario ve que aún nadie respondió.

#### RF-CAR-009 · Lista de reuniones
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** El usuario debe ver las reuniones de la habitación en una lista ordenada por fecha, separando próximas y pasadas.
**Criterios de aceptación:**
1. Dado un usuario con acceso, cuando abre la lista, entonces ve las próximas primero, con su estado de asistencia propio.
2. Dada una lista sin reuniones, entonces ve un estado vacío.

#### RF-CAR-010 · Vista de calendario
**Prioridad:** Should · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** El usuario debe poder ver las reuniones en un calendario mensual o semanal.
**Criterios de aceptación:**
1. Dado el calendario, cuando el usuario elige un día con reuniones, entonces ve su detalle.
2. Dado el calendario, entonces las fechas y horas se muestran en la zona horaria de Argentina (RN-19).

#### RF-CAR-011 · Anuncio para toda la oficina
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Administrador, Dueño
**Descripción:** El Dueño y el Administrador deben poder publicar un anuncio visible en todas las habitaciones de la oficina. ⚠️ A confirmar.
**Criterios de aceptación:**
1. Dado un anuncio de oficina, entonces los miembros lo ven al entrar a cualquiera de sus habitaciones.

#### RF-CAR-012 · Recordatorios y reuniones recurrentes
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Líder, Administrador, Dueño
**Descripción:** Las reuniones deben poder repetirse y generar recordatorios antes de su inicio.
**Criterios de aceptación:**
1. Dada una reunión con recordatorio, entonces los confirmados reciben una notificación antes del inicio.


---

### 5.7 Chat (CHA)

Hay dos canales: el de la **oficina** (lo leen todos sus miembros) y el de cada **habitación** (solo quienes tienen acceso). El usuario elige en cuál escribe; por defecto, el de la habitación donde se encuentra. La mensajería privada queda fuera del MVP.

#### RF-CHA-001 · Canal de la oficina
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** Cada oficina debe tener un canal de chat común a todos sus miembros.
**Criterios de aceptación:**
1. Dado un miembro de la oficina, cuando abre el canal de la oficina, entonces puede leer y escribir mensajes sin importar en qué habitación esté.
2. Dado un usuario que no es miembro, cuando intenta leer o escribir, entonces el sistema responde 403.
3. Dado un mensaje en el canal de la oficina, entonces nunca es visible en otra oficina.

#### RF-CHA-002 · Canal de la habitación
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro con acceso a la habitación
**Descripción:** Cada habitación debe tener su propio canal de chat, visible solo para quienes tienen acceso a ella.
**Criterios de aceptación:**
1. Dado un usuario con acceso, cuando abre el canal de la habitación, entonces lee y escribe mensajes.
2. Dado un usuario sin acceso a la habitación, cuando intenta leer o escribir en su canal, entonces el sistema responde 403.
3. Dado un usuario que pierde el acceso, entonces ya no puede leer el historial de ese canal (RN-12).

#### RF-CHA-003 · Elegir el canal de envío
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** El usuario debe poder elegir si su mensaje se envía al canal de la oficina o al de la habitación donde está.
**Criterios de aceptación:**
1. Dada la caja de mensaje, entonces muestra de forma visible el canal de destino actual.
2. Dado un usuario que cambia el canal, cuando envía, entonces el mensaje llega solo a ese canal.
3. Dado un cambio de habitación, entonces el canal de habitación por defecto pasa a ser el de la nueva habitación.
4. Dado un usuario que no está en ninguna habitación con acceso (por ejemplo, tras perderlo), entonces solo puede elegir el canal de la oficina.

#### RF-CHA-004 · Enviar mensaje
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** El usuario debe poder enviar mensajes de texto.
**Criterios de aceptación:**
1. Dado un mensaje válido, cuando lo envía, entonces aparece en el canal con su nombre visible y la hora.
2. Dado un mensaje vacío o solo con espacios, entonces no se envía.
3. Dado un mensaje que supera el máximo de caracteres, entonces el sistema muestra un error claro.
4. Dado un mensaje con texto con formato especial o código, entonces se muestra como texto y no se interpreta (no ejecuta contenido).

#### RF-CHA-005 · Recepción en tiempo real
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** Los mensajes nuevos deben aparecer a los demás usuarios del canal sin recargar.
**Criterios de aceptación:**
1. Dados dos usuarios con el canal abierto, cuando uno envía un mensaje, entonces el otro lo ve en pocos segundos.
2. Dado un usuario que pierde conexión, cuando se reconecta, entonces recibe los mensajes que se perdió.

#### RF-CHA-006 · Historial persistente
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** Los mensajes deben conservarse y poder consultarse al volver a abrir el canal, con carga progresiva de los más antiguos.
**Criterios de aceptación:**
1. Dado un canal con mensajes previos, cuando el usuario lo abre, entonces ve los más recientes ordenados cronológicamente.
2. Dado un historial largo, cuando el usuario se desplaza hacia arriba, entonces se cargan mensajes más antiguos.
3. Dado un canal sin mensajes, entonces el usuario ve un estado vacío.
4. Dado un reinicio del sistema, entonces el historial se conserva.

#### RF-CHA-007 · Control de acceso del historial
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** El historial de un canal solo debe ser legible por quienes tienen acceso vigente a él.
**Criterios de aceptación:**
1. Dado un usuario expulsado o que abandonó la oficina, entonces no puede leer ningún canal de esa oficina, aunque conserve los mensajes que ya generó (RN-13).
2. Dado un usuario al que se le otorga acceso nuevamente, entonces puede volver a leer el historial de esa habitación. ⚠️ Supuesto.

#### RF-CHA-008 · Indicador de mensajes no leídos
**Prioridad:** Should · **Fase:** MVP · **Actor:** Miembro
**Descripción:** El usuario debe ver cuándo hay mensajes nuevos en un canal que no está mirando.
**Criterios de aceptación:**
1. Dado un canal con mensajes sin leer, entonces se muestra un indicador junto a su nombre.
2. Dado el usuario que abre el canal, entonces el indicador desaparece.

#### RF-CHA-009 · Mensajería privada
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Miembro
**Descripción:** Los miembros de una oficina deben poder enviarse mensajes privados, accesibles desde un objeto del entorno (por ejemplo, un teléfono).
**Criterios de aceptación:**
1. Dados dos miembros de la oficina, cuando uno escribe al otro, entonces solo ellos ven la conversación.

#### RF-CHA-010 · Editar y eliminar mensajes
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Miembro, Administrador, Dueño
**Descripción:** El autor debe poder editar o eliminar sus mensajes; el Administrador y el Dueño pueden eliminar mensajes ajenos.
**Criterios de aceptación:**
1. Dado el autor, cuando elimina su mensaje, entonces deja de verse en el canal.
2. Dado un Miembro, cuando intenta eliminar un mensaje ajeno, entonces el sistema responde 403.

---

### 5.8 Notificaciones (NOT)

En el MVP las notificaciones se muestran **dentro de la aplicación**. El envío por email es evolución (salvo la recuperación de contraseña, RF-AUT-006).

#### RF-NOT-001 · Centro de notificaciones
**Prioridad:** Should · **Fase:** MVP · **Actor:** Usuario
**Descripción:** El usuario debe tener un lugar donde ver sus notificaciones recientes, con un contador de las no leídas.
**Criterios de aceptación:**
1. Dado un usuario con notificaciones, cuando abre el centro, entonces las ve ordenadas de la más reciente a la más antigua.
2. Dado un usuario con notificaciones sin leer, entonces ve el contador en un lugar visible.
3. Dado un usuario sin notificaciones, entonces ve un estado vacío.

#### RF-NOT-002 · Eventos que generan notificación
**Prioridad:** Should · **Fase:** MVP · **Actor:** Sistema
**Descripción:** El sistema debe notificar al usuario afectado cuando ocurre alguno de estos eventos:
**Criterios de aceptación:**
1. Dado que se le asigna una tarea, entonces recibe una notificación indicando la tarea y la habitación.
2. Dado que se le otorga o quita acceso a una habitación, entonces recibe una notificación.
3. Dado que se lo nombra o se le quita el rol de Administrador o de Líder, entonces recibe una notificación.
4. Dado que se lo expulsa de una oficina, entonces recibe una notificación; la oficina ya no aparece en su lista.
5. Dado que se crea, modifica o cancela una reunión en una habitación a la que tiene acceso, entonces recibe una notificación.
6. Dado que se publica un anuncio en una habitación a la que tiene acceso, entonces recibe una notificación.
7. Dado que se da de baja su oficina (siendo miembro o Dueño), entonces recibe una notificación. ⚠️ A confirmar si los miembros deben enterarse.

#### RF-NOT-003 · Marcar notificaciones como leídas
**Prioridad:** Should · **Fase:** MVP · **Actor:** Usuario
**Descripción:** El usuario debe poder marcar una o todas sus notificaciones como leídas.
**Criterios de aceptación:**
1. Dada una notificación, cuando el usuario la abre o la marca, entonces deja de contar como no leída.
2. Dadas varias no leídas, cuando elige marcar todas, entonces el contador vuelve a cero.

#### RF-NOT-004 · Notificaciones respetan permisos
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Una notificación nunca debe exponer contenido de una habitación u oficina a la que el usuario no tiene acceso.
**Criterios de aceptación:**
1. Dado un usuario que perdió el acceso a una habitación, cuando abre una notificación antigua de ella, entonces el sistema responde 403 y no muestra el contenido.
2. Dado un usuario, entonces solo ve sus propias notificaciones.

#### RF-NOT-005 · Notificaciones en tiempo real
**Prioridad:** Could · **Fase:** MVP · **Actor:** Usuario
**Descripción:** Las notificaciones nuevas deben aparecer mientras el usuario usa la aplicación, sin recargar.
**Criterios de aceptación:**
1. Dado un usuario conectado, cuando ocurre un evento que lo afecta, entonces ve la notificación y el contador actualizado en pocos segundos.

#### RF-NOT-006 · Notificaciones por email
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Usuario
**Descripción:** Los eventos relevantes deben poder enviarse también por email.
**Criterios de aceptación:**
1. Dado un evento que genera notificación, cuando el usuario tiene habilitado el email, entonces recibe un mensaje con el resumen del evento.

#### RF-NOT-007 · Preferencias de notificación
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Usuario
**Descripción:** El usuario debe poder elegir qué eventos le generan notificación y por qué canal.
**Criterios de aceptación:**
1. Dado un tipo de evento desactivado, entonces el usuario deja de recibir esa notificación.

---

### 5.9 Bot y repaso diario (BOT)

El bot es un asistente de **solo consulta y resumen**: no crea, modifica ni elimina datos (RN-18). Siempre actúa con los permisos del usuario que lo consulta.

#### RF-BOT-001 · Conversar con el bot
**Prioridad:** Should · **Fase:** MVP · **Actor:** Usuario
**Descripción:** El usuario debe poder abrir una conversación con el bot desde un objeto del entorno o desde el menú.
**Criterios de aceptación:**
1. Dado un usuario con sesión, cuando abre el bot, entonces puede escribir una consulta y recibir una respuesta.
2. Dada una respuesta en preparación, entonces el usuario ve un indicador de espera.
3. Dado un error o indisponibilidad del servicio de IA, entonces el usuario ve un mensaje claro y puede reintentar.
4. Dado un uso excesivo, entonces el sistema aplica un límite e informa al usuario.

#### RF-BOT-002 · Consultar tareas, reuniones y anuncios
**Prioridad:** Should · **Fase:** MVP · **Actor:** Usuario
**Descripción:** El bot debe poder responder sobre las tareas, reuniones y anuncios del usuario en todas sus oficinas.
**Criterios de aceptación:**
1. Dada la consulta "¿qué tareas tengo pendientes?", entonces el bot lista las tareas asignadas al usuario, indicando oficina y habitación.
2. Dada la consulta sobre reuniones o anuncios, entonces responde con datos de las habitaciones a las que el usuario tiene acceso.
3. Dada una consulta sobre una habitación sin acceso, entonces el bot no revela su contenido.

#### RF-BOT-003 · Respeto de permisos
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** El bot no debe acceder a información que el usuario no podría ver por sí mismo.
**Criterios de aceptación:**
1. Dado un usuario sin acceso a una habitación, entonces el bot nunca incluye su contenido en una respuesta ni en el repaso.
2. Dado un usuario que perdió el acceso, entonces el bot deja de usar ese contenido de inmediato.
3. Dado un usuario que le pide al bot ignorar los permisos, entonces el bot lo rechaza.

#### RF-BOT-004 · Solo lectura
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** El bot no debe poder modificar datos de la plataforma.
**Criterios de aceptación:**
1. Dado un pedido del tipo "creá una tarea" o "borrá este anuncio", entonces el bot responde que no puede hacerlo y, si corresponde, indica cómo hacerlo desde la aplicación.
2. Dada cualquier conversación con el bot, entonces no se modifica ninguna tarea, anuncio, reunión, acceso ni mensaje.

#### RF-BOT-005 · Resumen de actividad
**Prioridad:** Could · **Fase:** MVP · **Actor:** Usuario
**Descripción:** El bot debe poder resumir la actividad reciente de una habitación u oficina (mensajes, tareas y anuncios) a la que el usuario tiene acceso.
**Criterios de aceptación:**
1. Dado un pedido de resumen de una habitación con acceso, entonces el bot resume la actividad reciente.
2. Dado un pedido sobre una habitación sin acceso, entonces el bot lo rechaza.

#### RF-BOT-006 · Repaso diario en la primera conexión
**Prioridad:** Should · **Fase:** MVP · **Actor:** Sistema
**Descripción:** En la primera conexión autenticada de cada día, el bot debe presentar un repaso del día con: tareas pendientes y próximas a vencer, reuniones del día y anuncios nuevos, de todas las oficinas del usuario y solo de las habitaciones a las que tiene acceso.
**Criterios de aceptación:**
1. Dado un usuario que inicia sesión por primera vez en el día, entonces ve el repaso sin pedirlo.
2. Dado el repaso, entonces agrupa la información por oficina y habitación.
3. Dado un usuario sin nada pendiente, entonces el repaso lo indica en lugar de quedar vacío.
4. Dado el repaso, entonces solo informa y sugiere próximos pasos; no ejecuta ninguna acción.

#### RF-BOT-007 · Una sola vez por día
**Prioridad:** Should · **Fase:** MVP · **Actor:** Sistema
**Descripción:** El repaso debe mostrarse una sola vez por usuario y por día, según la zona horaria America/Argentina/Buenos_Aires.
**Criterios de aceptación:**
1. Dado un usuario que ya vio el repaso hoy, cuando recarga, cambia de habitación o se reconecta, entonces no se muestra de nuevo.
2. Dado un cambio de día en Argentina, entonces el repaso vuelve a mostrarse en la siguiente primera conexión.
3. Dadas dos conexiones simultáneas del mismo usuario, entonces el repaso se presenta una sola vez.
4. Dado un usuario que cierra el repaso, entonces puede volver a consultarlo desde el bot durante el día.

#### RF-BOT-008 · Repaso sin IA
**Prioridad:** Should · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Si el servicio de IA no está disponible, el repaso debe mostrarse como un resumen estructurado armado con los datos del usuario, sin texto generado.
**Criterios de aceptación:**
1. Dado un servicio de IA no disponible, entonces el usuario ve igualmente sus tareas, reuniones y anuncios del día.
2. Dado el repaso sin IA, entonces se cuenta como entregado ese día.

#### RF-BOT-009 · Redacción del repaso con IA
**Prioridad:** Could · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Cuando el servicio de IA está disponible, el repaso debe presentarse con un texto redactado en lenguaje natural a partir de los datos del usuario.
**Criterios de aceptación:**
1. Dado un servicio de IA disponible, entonces el repaso se muestra con texto generado que no incluye datos fuera de los permisos del usuario.
2. Dada una respuesta de IA con error, entonces se aplica RF-BOT-008.

#### RF-BOT-010 · Ejecución de acciones por el bot
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Usuario
**Descripción:** El bot debe poder crear, actualizar o completar tareas a pedido del usuario, con confirmación explícita y sujeto a sus permisos.
**Criterios de aceptación:**
1. Dado un pedido de crear una tarea en una habitación con acceso, cuando el usuario confirma, entonces la tarea se crea.
2. Dado un pedido en una habitación sin acceso, entonces el bot lo rechaza.

#### RF-BOT-011 · Reacción del bot a eventos
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Sistema
**Descripción:** El bot debe poder reaccionar a eventos del sistema (por ejemplo, avisar de una tarea próxima a vencer).
**Criterios de aceptación:**
1. Dado un evento relevante para el usuario, entonces el bot lo comunica sin que el usuario deba preguntar.

---

### 5.10 Objetos interactuables (OBJ)

Los objetos están modelados en la habitación y el usuario interactúa con ellos. La estructura debe permitir **sumar objetos nuevos con el tiempo** sin alterar los existentes.

#### RF-OBJ-001 · Interacción con un objeto
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** El usuario debe poder interactuar con los objetos de la habitación (con el mouse, el toque o acercándose) para abrir su herramienta o ejecutar su acción.
**Criterios de aceptación:**
1. Dado un objeto interactuable, cuando el usuario lo selecciona o se acerca, entonces se abre su interfaz o se ejecuta su acción.
2. Dado un objeto con el que el usuario puede interactuar, entonces el sistema lo indica visualmente (por ejemplo, resaltándolo).
3. Dado un objeto cuya herramienta requiere un permiso que el usuario no tiene, entonces el sistema no abre la herramienta y muestra un mensaje.

#### RF-OBJ-002 · Objetos del MVP
**Prioridad:** Must · **Fase:** MVP · **Actor:** Miembro
**Descripción:** Cada habitación debe incluir como mínimo estos objetos:
**Criterios de aceptación:**
1. Dado el objeto de tablero (por ejemplo, un corcho), cuando el usuario interactúa, entonces se abre el tablero de tareas de esa habitación.
2. Dado el objeto de cartelera, cuando el usuario interactúa, entonces se abre la cartelera y la lista de reuniones de esa habitación.
3. Dado el objeto de puerta, cuando el usuario interactúa, entonces ve las habitaciones a las que puede pasar y puede cambiar de habitación (RF-HAB-009).
4. Dado el objeto del bot (por ejemplo, un robot o mascota), cuando el usuario interactúa, entonces se abre la conversación con el bot (RF-BOT-001).
5. ⚠️ Los objetos concretos del MVP están por confirmar; el chat y las notificaciones se acceden desde la interfaz fija.

#### RF-OBJ-003 · Registro extensible de tipos de objeto
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Cada tipo de objeto debe definirse con su nombre, su interfaz y el permiso que exige, de modo que agregar un tipo nuevo no modifique el funcionamiento de los existentes.
**Criterios de aceptación:**
1. Dado un tipo de objeto nuevo registrado, entonces puede colocarse en una habitación y funcionar sin cambios en los objetos ya existentes.
2. Dado un tipo de objeto, entonces declara qué permiso requiere para usarse.
3. Dado un tipo de objeto sin interfaz (decorativo), entonces puede responder solo con una animación.

#### RF-OBJ-004 · Permisos del objeto
**Prioridad:** Must · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Interactuar con un objeto no otorga permisos sobre el recurso asociado (RN-20).
**Criterios de aceptación:**
1. Dado un usuario sin permiso de Líder, cuando interactúa con la cartelera, entonces puede leerla pero no ve la opción de publicar.
2. Dado un usuario que intenta una acción protegida saltándose la interfaz del objeto, entonces el sistema responde 403.

#### RF-OBJ-005 · Posición de los objetos
**Prioridad:** Should · **Fase:** MVP · **Actor:** Sistema
**Descripción:** Cada habitación debe tener una distribución de objetos definida y persistente.
**Criterios de aceptación:**
1. Dada una habitación, cuando un usuario entra, entonces ve los objetos en la misma posición que la última vez.
2. Dada una habitación nueva, entonces se crea con la distribución inicial por defecto (con los objetos del MVP).

#### RF-OBJ-006 · Objetos adicionales
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Miembro
**Descripción:** Se deben poder incorporar nuevos objetos con sus herramientas: calendario, teléfono (mensajes privados), computadora o pizarra (notas compartidas) e indicador de estado.
**Criterios de aceptación:**
1. Dado un objeto nuevo registrado, entonces el usuario puede usar su herramienta como cualquier otro objeto.

#### RF-OBJ-007 · Personalización de la habitación
**Prioridad:** Could · **Fase:** Evolución · **Actor:** Dueño, Administrador
**Descripción:** El Dueño y el Administrador deben poder elegir, mover y decorar los objetos de una habitación.
**Criterios de aceptación:**
1. Dado un cambio de distribución, cuando se guarda, entonces los usuarios que entran después ven la nueva disposición.


---

## 6. Resumen de requisitos

Los conteos se calcularon sobre la sección 5 al armar la versión 0.1. Si se agregan, quitan o repriorizan requisitos a mano, hay que actualizar esta sección y el índice.

| Prefijo | Módulo | Requisitos | Must | Should | Could | MVP | Evolución |
|---|---|---|---|---|---|---|---|
| AUT | Cuenta y autenticación | 10 | 5 | 2 | 3 | 7 | 3 |
| OFI | Oficinas e invitaciones | 18 | 9 | 7 | 2 | 16 | 2 |
| HAB | Habitaciones y accesos | 13 | 8 | 3 | 2 | 11 | 2 |
| MUN | Mundo 3D, avatar y presencia | 16 | 8 | 4 | 4 | 13 | 3 |
| TAR | Tareas (Kanban) | 14 | 7 | 5 | 2 | 13 | 1 |
| CAR | Cartelera y reuniones | 12 | 8 | 2 | 2 | 10 | 2 |
| CHA | Chat | 10 | 7 | 1 | 2 | 8 | 2 |
| NOT | Notificaciones | 7 | 1 | 3 | 3 | 5 | 2 |
| BOT | Bot y repaso diario | 11 | 2 | 5 | 4 | 9 | 2 |
| OBJ | Objetos interactuables | 7 | 4 | 1 | 2 | 5 | 2 |
| **Total** | | **118** | **59** | **33** | **26** | **97** | **21** |

### Índice de requisitos

| ID | Requisito | Prioridad | Fase | Actor |
|---|---|---|---|---|
| RF-AUT-001 | Registro de usuario | Must | MVP | Visitante |
| RF-AUT-002 | Inicio de sesión | Must | MVP | Visitante |
| RF-AUT-003 | Sesión con vencimiento y renovación | Must | MVP | Usuario |
| RF-AUT-004 | Cierre de sesión | Must | MVP | Usuario |
| RF-AUT-005 | Protección de rutas y operaciones | Must | MVP | Sistema |
| RF-AUT-006 | Recuperación de contraseña | Should | MVP | Visitante |
| RF-AUT-007 | Gestión del perfil | Should | MVP | Usuario |
| RF-AUT-008 | Cambio de contraseña con sesión iniciada | Could | Evolución | Usuario |
| RF-AUT-009 | Límite de intentos fallidos de inicio de sesión | Could | Evolución | Sistema |
| RF-AUT-010 | Verificación de email al registrarse | Could | Evolución | Visitante |
| RF-OFI-001 | Creación automática de la oficina propia | Must | MVP | Sistema |
| RF-OFI-002 | Lista de oficinas del usuario | Must | MVP | Usuario |
| RF-OFI-003 | Ingreso a una oficina | Must | MVP | Miembro |
| RF-OFI-004 | Edición de datos de la oficina | Should | MVP | Dueño, Administrador |
| RF-OFI-005 | Generación de enlace de invitación | Must | MVP | Dueño, Administrador |
| RF-OFI-006 | Revocación de invitaciones | Must | MVP | Dueño, Administrador |
| RF-OFI-007 | Lista de invitaciones vigentes | Should | MVP | Dueño, Administrador |
| RF-OFI-008 | Aceptación de una invitación | Must | MVP | Visitante, Usuario |
| RF-OFI-009 | Vencimiento automático de invitaciones | Must | MVP | Sistema |
| RF-OFI-010 | Lista de miembros | Must | MVP | Miembro |
| RF-OFI-011 | Nombrar y quitar Administradores | Should | MVP | Dueño |
| RF-OFI-012 | Expulsión de un miembro | Must | MVP | Dueño, Administrador |
| RF-OFI-013 | Abandono de la oficina | Should | MVP | Administrador, Líder, Miembro |
| RF-OFI-014 | Baja lógica de la oficina | Should | MVP | Dueño |
| RF-OFI-015 | Recuperación de la oficina | Should | MVP | Dueño |
| RF-OFI-016 | Eliminación definitiva tras el plazo | Should | MVP | Sistema |
| RF-OFI-017 | Invitación por email | Could | Evolución | Dueño, Administrador |
| RF-OFI-018 | Solicitud de ingreso a una oficina | Could | Evolución | Usuario, Dueño, Administrador |
| RF-HAB-001 | Habitación principal | Must | MVP | Sistema |
| RF-HAB-002 | Creación de habitaciones | Must | MVP | Dueño, Administrador |
| RF-HAB-003 | Límite de habitaciones adicionales | Must | MVP | Sistema |
| RF-HAB-004 | Edición de habitaciones | Should | MVP | Dueño, Administrador |
| RF-HAB-005 | Eliminación de habitaciones | Should | MVP | Dueño, Administrador |
| RF-HAB-006 | Otorgar y quitar acceso a una habitación | Must | MVP | Dueño, Administrador, Líder |
| RF-HAB-007 | Panel de accesos | Must | MVP | Dueño, Administrador |
| RF-HAB-008 | Asignación de Líderes | Should | MVP | Dueño, Administrador |
| RF-HAB-009 | Cambio de habitación | Must | MVP | Miembro |
| RF-HAB-010 | Efecto de la pérdida de acceso | Must | MVP | Sistema |
| RF-HAB-011 | Verificación de acceso en el servidor | Must | MVP | Sistema |
| RF-HAB-012 | Acceso de solo lectura a una habitación | Could | Evolución | Dueño, Administrador, Líder |
| RF-HAB-013 | Límite configurable de habitaciones | Could | Evolución | Dueño |
| RF-MUN-001 | Escena isométrica de la habitación | Must | MVP | Miembro |
| RF-MUN-002 | Movimiento con teclado | Must | MVP | Miembro |
| RF-MUN-003 | Movimiento por clic a destino | Must | MVP | Miembro |
| RF-MUN-004 | Controles táctiles | Should | MVP | Miembro |
| RF-MUN-005 | Colisiones y límites del espacio | Must | MVP | Sistema |
| RF-MUN-006 | Avatar propio y de otros | Must | MVP | Miembro |
| RF-MUN-007 | Sincronización de movimiento en tiempo real | Must | MVP | Miembro |
| RF-MUN-008 | Entrada, salida y desconexión de avatares | Must | MVP | Sistema |
| RF-MUN-009 | Reconexión | Should | MVP | Miembro |
| RF-MUN-010 | Lista de presencia | Must | MVP | Miembro |
| RF-MUN-011 | Personalización y persistencia del avatar | Should | MVP | Usuario |
| RF-MUN-012 | Acceso a las funciones sin apuntar a objetos 3D | Should | MVP | Miembro |
| RF-MUN-013 | Uso en pantallas pequeñas | Could | MVP | Miembro |
| RF-MUN-014 | Estados de actividad | Could | Evolución | Miembro |
| RF-MUN-015 | Emotes y acciones sociales | Could | Evolución | Miembro |
| RF-MUN-016 | Sonido ambiente y efectos | Could | Evolución | Usuario |
| RF-TAR-001 | Ver el tablero de una habitación | Must | MVP | Miembro con acceso a la habitación |
| RF-TAR-002 | Crear tarea | Must | MVP | Miembro con acceso a la habitación |
| RF-TAR-003 | Editar tarea | Must | MVP | Miembro con acceso a la habitación |
| RF-TAR-004 | Mover tarea entre columnas | Must | MVP | Miembro con acceso a la habitación |
| RF-TAR-005 | Eliminar tarea | Must | MVP | Miembro con acceso a la habitación |
| RF-TAR-006 | Columnas por defecto | Must | MVP | Sistema |
| RF-TAR-007 | Configurar columnas del tablero | Should | MVP | Líder, Administrador, Dueño |
| RF-TAR-008 | Asignar responsable | Must | MVP | Miembro con acceso a la habitación |
| RF-TAR-009 | Tareas huérfanas | Should | MVP | Sistema |
| RF-TAR-010 | Vista de lista y filtros | Should | MVP | Miembro con acceso a la habitación |
| RF-TAR-011 | Actualización del tablero en vivo | Should | MVP | Miembro con acceso a la habitación |
| RF-TAR-012 | Fecha límite y vencidas | Should | MVP | Miembro con acceso a la habitación |
| RF-TAR-013 | Mis tareas | Could | MVP | Usuario |
| RF-TAR-014 | Comentarios, etiquetas y adjuntos en tareas | Could | Evolución | Miembro con acceso a la habitación |
| RF-CAR-001 | Ver la cartelera | Must | MVP | Miembro con acceso a la habitación |
| RF-CAR-002 | Publicar un anuncio | Must | MVP | Líder, Administrador, Dueño |
| RF-CAR-003 | Editar y eliminar anuncios propios | Must | MVP | Líder, Administrador, Dueño |
| RF-CAR-004 | Gestionar anuncios ajenos | Must | MVP | Administrador, Dueño |
| RF-CAR-005 | Crear una reunión | Must | MVP | Líder, Administrador, Dueño |
| RF-CAR-006 | Editar y cancelar reuniones | Must | MVP | Líder, Administrador, Dueño |
| RF-CAR-007 | Confirmar asistencia | Must | MVP | Miembro con acceso a la habitación |
| RF-CAR-008 | Ver asistentes | Should | MVP | Miembro con acceso a la habitación |
| RF-CAR-009 | Lista de reuniones | Must | MVP | Miembro con acceso a la habitación |
| RF-CAR-010 | Vista de calendario | Should | MVP | Miembro con acceso a la habitación |
| RF-CAR-011 | Anuncio para toda la oficina | Could | Evolución | Administrador, Dueño |
| RF-CAR-012 | Recordatorios y reuniones recurrentes | Could | Evolución | Líder, Administrador, Dueño |
| RF-CHA-001 | Canal de la oficina | Must | MVP | Miembro |
| RF-CHA-002 | Canal de la habitación | Must | MVP | Miembro con acceso a la habitación |
| RF-CHA-003 | Elegir el canal de envío | Must | MVP | Miembro |
| RF-CHA-004 | Enviar mensaje | Must | MVP | Miembro |
| RF-CHA-005 | Recepción en tiempo real | Must | MVP | Miembro |
| RF-CHA-006 | Historial persistente | Must | MVP | Miembro |
| RF-CHA-007 | Control de acceso del historial | Must | MVP | Sistema |
| RF-CHA-008 | Indicador de mensajes no leídos | Should | MVP | Miembro |
| RF-CHA-009 | Mensajería privada | Could | Evolución | Miembro |
| RF-CHA-010 | Editar y eliminar mensajes | Could | Evolución | Miembro, Administrador, Dueño |
| RF-NOT-001 | Centro de notificaciones | Should | MVP | Usuario |
| RF-NOT-002 | Eventos que generan notificación | Should | MVP | Sistema |
| RF-NOT-003 | Marcar notificaciones como leídas | Should | MVP | Usuario |
| RF-NOT-004 | Notificaciones respetan permisos | Must | MVP | Sistema |
| RF-NOT-005 | Notificaciones en tiempo real | Could | MVP | Usuario |
| RF-NOT-006 | Notificaciones por email | Could | Evolución | Usuario |
| RF-NOT-007 | Preferencias de notificación | Could | Evolución | Usuario |
| RF-BOT-001 | Conversar con el bot | Should | MVP | Usuario |
| RF-BOT-002 | Consultar tareas, reuniones y anuncios | Should | MVP | Usuario |
| RF-BOT-003 | Respeto de permisos | Must | MVP | Sistema |
| RF-BOT-004 | Solo lectura | Must | MVP | Sistema |
| RF-BOT-005 | Resumen de actividad | Could | MVP | Usuario |
| RF-BOT-006 | Repaso diario en la primera conexión | Should | MVP | Sistema |
| RF-BOT-007 | Una sola vez por día | Should | MVP | Sistema |
| RF-BOT-008 | Repaso sin IA | Should | MVP | Sistema |
| RF-BOT-009 | Redacción del repaso con IA | Could | MVP | Sistema |
| RF-BOT-010 | Ejecución de acciones por el bot | Could | Evolución | Usuario |
| RF-BOT-011 | Reacción del bot a eventos | Could | Evolución | Sistema |
| RF-OBJ-001 | Interacción con un objeto | Must | MVP | Miembro |
| RF-OBJ-002 | Objetos del MVP | Must | MVP | Miembro |
| RF-OBJ-003 | Registro extensible de tipos de objeto | Must | MVP | Sistema |
| RF-OBJ-004 | Permisos del objeto | Must | MVP | Sistema |
| RF-OBJ-005 | Posición de los objetos | Should | MVP | Sistema |
| RF-OBJ-006 | Objetos adicionales | Could | Evolución | Miembro |
| RF-OBJ-007 | Personalización de la habitación | Could | Evolución | Dueño, Administrador |

---

## 7. Entidades conceptuales

Entidades del dominio que se desprenden de los requisitos. Es una vista **conceptual**, no el modelo de datos definitivo (ese se define en el diseño de datos).

| Entidad | Descripción | Relaciones principales |
|---|---|---|
| Usuario | Persona con cuenta: email, nombre visible, contraseña protegida | Tiene una oficina propia, muchas membresías, un avatar y notificaciones |
| ConfiguraciónAvatar | Apariencia persistente del avatar | Uno por usuario |
| Oficina | Espacio de trabajo con estado (activa o dada de baja y fecha de baja) | Tiene un Dueño, muchas membresías y habitaciones |
| Membresía | Pertenencia de un usuario a una oficina: rol (Dueño, Administrador, Miembro) y estado (activa o dada de baja) | Une Usuario y Oficina |
| Invitación | Enlace con vencimiento, límite de usos y estado | Pertenece a una oficina, la crea un Dueño o Administrador |
| Habitación | Espacio de la oficina; puede ser la principal | Tiene accesos, líderes, objetos, tareas, anuncios, reuniones y mensajes |
| AccesoHabitación | Permiso de un miembro para entrar a una habitación | Une Membresía y Habitación |
| LiderazgoHabitación | Marca de Líder de un miembro en una habitación | Une Membresía y Habitación |
| ObjetoHabitación | Instancia de un tipo de objeto ubicada en una habitación | Pertenece a una habitación |
| Columna | Columna del tablero con nombre y orden | Pertenece a una habitación |
| Tarea | Título, descripción, responsable, fecha límite, prioridad | Pertenece a una columna y habitación; tiene un responsable opcional |
| Anuncio | Aviso de la cartelera | Pertenece a una habitación; tiene un autor |
| Reunión | Evento con fecha, hora y estado (activa o cancelada) | Pertenece a una habitación; tiene un creador |
| Asistencia | Respuesta de un usuario a una reunión | Une Usuario y Reunión |
| Mensaje | Texto enviado a un canal | Pertenece a una oficina (canal de oficina) o a una habitación (canal de habitación); tiene un autor |
| Notificación | Aviso dirigido a un usuario, con estado de lectura | Pertenece a un usuario |
| EntregaRepasoDiario | Registro de que el repaso del día ya se presentó | Une Usuario y fecha |

---

## 8. Trazabilidad con los requisitos del curso

Los requisitos obligatorios del enunciado (R1–R8) incluyen aspectos no funcionales y de entrega que esta ERS no cubre. Se mapean los que dependen del comportamiento funcional:

| Requisito del curso | Cubierto por |
|---|---|
| R1 · Tres entidades relacionadas, una `User` | Sección 7: Usuario, Oficina, Membresía, Habitación, Tarea, entre otras |
| R2 · Registro, login, logout, sesión expirable, rutas protegidas, dos roles, 401/403, aislamiento | RF-AUT-001 a RF-AUT-005, RF-OFI-003, RF-OFI-011, RF-OFI-012, RF-HAB-006, RF-HAB-011, RN-03, RN-16 |
| R5 · Flujo principal, CRUD completo de una entidad del usuario, validación y estados de interfaz | RF-TAR-001 a RF-TAR-005, RN-17 |
| IA en el producto (recomendado) | RF-BOT-001 a RF-BOT-009 |
| Autenticación avanzada (recomendado) | RF-AUT-006, RF-AUT-008, RF-AUT-009, RF-AUT-010 |

R3, R4, R6, R7 y R8 (repositorio, despliegue, justificación técnica, seguridad de la API y defensa) quedan fuera de esta ERS.

---

## 9. Supuestos y puntos a validar

| ID | Tema | Propuesta actual | Requisitos afectados |
|---|---|---|---|
| P-01 | Identificador de login | Email; el nombre visible es aparte y puede repetirse | RF-AUT-001, RF-AUT-002 |
| P-02 | Política de contraseña | Mínimo 8 caracteres, sin reglas de composición | RF-AUT-001 |
| P-03 | Duración de sesión e invitaciones | Parámetros configurables, sin valor fijo en la ERS | RF-AUT-003, RF-OFI-005 |
| P-04 | Email en el MVP | Entra solo para recuperar contraseña (RF-AUT-006) | RF-AUT-006 |
| P-05 | Qué pasa si se elimina definitivamente la oficina propia | El usuario queda sin oficina propia; hay que decidir si puede crear una nueva | RF-OFI-016 |
| P-06 | Eliminar una habitación | Borra su contenido, sin recuperación | RF-HAB-005 |
| P-07 | Administrador sobre otros Administradores | No puede expulsarlos ni modificarlos; solo el Dueño | RF-OFI-012 |
| P-08 | Dueño y Administrador en las habitaciones | Acceso total y permisos de Líder en todas | RN-07 |
| P-09 | Anuncios para toda la oficina | Evolución; falta confirmar si se necesita | RF-CAR-011 |
| P-10 | Notificar la baja de oficina a los miembros | Sí, mediante notificación | RF-NOT-002 |
| P-11 | Historial al recuperar acceso a una habitación | Se vuelve a poder leer el historial completo | RF-CHA-007 |
| P-12 | Objetos concretos del MVP | Tablero, cartelera, puerta y bot; chat y notificaciones desde la interfaz fija | RF-OBJ-002 |
| P-13 | Prioridad de Administrador delegado y Líder | Should en el MVP; si el tiempo es ajustado pueden pasar a evolución, ya que el curso exige dos roles y alcanzan Dueño y Miembro | RF-OFI-011, RF-HAB-008 |
| P-14 | Columnas por defecto del tablero | "Pendiente", "En curso" y "Hecho" | RF-TAR-006 |
| P-15 | Documento maestro | Actualizarlo según la tabla de la sección 1.3, o declarar que esta ERS lo reemplaza en esos puntos | Toda la ERS |

---

## 10. Cómo pasar de la ERS a las historias de usuario

Cada requisito se convierte en una o más historias para el tablero Kanban. Regla práctica:

- Un requisito con **pocos criterios** (hasta 3) suele ser una historia.
- Un requisito con **muchos criterios** o varios actores se divide en historias, cada una con los criterios que le corresponden.
- Los requisitos con fase **Evolución** van al backlog, sin planificarse en el MVP.

**Plantilla de historia:**

> **Título:** [verbo + resultado]
> **Referencia:** RF-MÓDULO-NNN
> **Historia:** Como [actor], quiero [acción], para [beneficio].
> **Criterios de aceptación:** (copiados del requisito)
> **Etiquetas:** módulo · prioridad (Must / Should / Could) · fase

**Ejemplo a partir de RF-TAR-004:**

> **Título:** Mover una tarea entre columnas
> **Referencia:** RF-TAR-004
> **Historia:** Como miembro con acceso a la habitación, quiero mover una tarea a otra columna, para reflejar el avance del trabajo.
> **Criterios:** los tres primeros del requisito (persistencia, 403 sin acceso, ver el cambio en vivo) y la alternativa táctil.
> **Etiquetas:** TAR · Must · MVP

**Orden sugerido por dependencias** (para armar el backlog):

1. Cuenta y autenticación (AUT) y creación de la oficina propia (RF-OFI-001 a RF-OFI-003).
2. Habitaciones y accesos (HAB) e invitaciones (RF-OFI-005 a RF-OFI-012).
3. Escena, avatar y presencia (MUN).
4. Tareas (TAR), que es la base de R5.
5. Cartelera, reuniones (CAR) y chat (CHA).
6. Objetos interactuables (OBJ) conectados a las herramientas anteriores.
7. Notificaciones (NOT) y bot con repaso diario (BOT).
