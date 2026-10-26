# ERS · Decisiones, formato de requisitos y módulos

Oct 25, 2026 · @Luis

## Decisiones cerradas

Quedaron resueltas las cinco dudas que seguían abiertas sobre permisos, y con ellas la matriz de roles está lista para redactar requisitos.

| Tema | Decisión |
| --- | --- |
| Nombrar Administradores | Solo el Dueño nombra Administradores, para evitar que el poder se escale en cadena. El Administrador puede asignar Líderes. |
| Generar invitaciones | Dueño y Administrador. El Líder no invita gente nueva: solo da acceso a su habitación a quienes ya son miembros de la oficina. |
| Borrar tareas | Cualquier persona con acceso a la habitación. |
| Editar o borrar anuncios y reuniones ajenos | Solo Administrador y Dueño. Se interpretó que "administradores" incluye al Dueño, que tiene todos los permisos. |
| Líderes por habitación | Puede haber varios. |

## Cambios en la matriz de permisos

Anuncios, reuniones y el alcance del Líder cambian respecto de la versión anterior de la matriz; el resto queda igual.

**Anuncios y reuniones**

- Cualquier Líder, Administrador o Dueño puede crear anuncios y reuniones en su habitación.
- El Líder solo edita o borra los suyos.
- Los anuncios y reuniones ajenos los gestionan únicamente el Administrador y el Dueño.

**Líder**

- Puede haber varios por habitación.
- Su alcance: dar acceso a miembros ya existentes de la oficina, publicar anuncios y reuniones, y configurar las columnas del tablero.
- No invita gente nueva a la oficina.

**Sin cambios**

- Solo el Dueño nombra Administradores.
- El Administrador puede asignar Líderes.
- Cualquiera con acceso a la habitación borra tareas.

## Formato de los requisitos

Cada requisito funcional lleva un ID trazable, para que cada historia de usuario del Kanban referencie el requisito del que sale.

Campos de cada requisito:

1. ID con formato RF-MÓDULO-NNN.
2. Nombre.
3. Prioridad en escala MoSCoW (Must, Should, Could, Won't).
4. Fase: MVP o evolución.
5. Actor.
6. Descripción.
7. Criterios de aceptación en formato Dado / Cuando / Entonces.

Ejemplo:

| Campo | Contenido |
| --- | --- |
| ID y nombre | RF-TAR-004 · Mover tarea entre columnas |
| Prioridad / fase | Must · MVP |
| Actor | Miembro con acceso a la habitación |
| Descripción | El sistema debe permitir mover una tarea a otra columna del tablero de su habitación. |
| Criterio 1 | Dado un usuario con acceso, cuando arrastra la tarea a otra columna, entonces la tarea queda en la nueva columna y el cambio persiste al recargar. |
| Criterio 2 | Dado un usuario sin acceso a la habitación, cuando intenta mover la tarea, entonces el sistema responde 403. |
| Criterio 3 | Dados otros usuarios conectados a esa habitación, cuando se mueve la tarea, entonces ven el cambio. |

## Módulos propuestos

Los requisitos se agrupan en diez módulos; los prefijos de ID son una propuesta para validar.

| N.º | Módulo | Prefijo |
| --- | --- | --- |
| 1 | Cuenta y autenticación | AUT |
| 2 | Oficinas e invitaciones | OFI |
| 3 | Habitaciones y accesos | HAB |
| 4 | Mundo 3D, avatar y presencia | MUN |
| 5 | Tareas (Kanban) | TAR |
| 6 | Cartelera y reuniones | CAR |
| 7 | Chat | CHA |
| 8 | Notificaciones | NOT |
| 9 | Bot y repaso diario | BOT |
| 10 | Objetos interactuables (extensibilidad) | OBJ |

## Pendientes y próximo paso

Quedan dos puntos menores por confirmar antes de redactar el primer módulo.

- La recuperación de contraseña necesita enviar emails, así que el email entraría en el MVP al menos para eso. Falta confirmar si se acepta o si se deja para la evolución.
- Por ahora se asume que las notificaciones por email son evolución y que las notificaciones dentro de la app alcanzan para el MVP.

Próximo paso: redactar los requisitos módulo por módulo, mostrándolos en el chat para su revisión antes de armar el documento formal. Se empieza por Cuenta y autenticación, que es la base de R2.
