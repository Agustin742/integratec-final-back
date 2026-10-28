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

## Confirmaciones para la alineación documental

Estas confirmaciones de Alejo durante la revisión de alineación mantienen la ERS de Luis como base funcional; no declaran implementación ni aprueban los demás supuestos pendientes de la ERS.

| Tema | Decisión y fundamento | Referencia |
| --- | --- | --- |
| Renderizado | **Three.js + React Three Fiber están elegidos** para el mundo 3D real e integración declarativa con React. La selección ya no está pendiente; PixiJS 2.5D queda descartado, según la justificación del documento maestro. | [Documento maestro, sección 3.1](../master-document.md#31-entorno-tridimensional-isométrico) y sección 11 |
| Zona horaria | Se siguen las reglas integradas de Agustín (PR #5), por indicación posterior de Alejo: Buenos Aires para el día del repaso, sin herencia implícita; las reuniones tienen su regla propia. Esto reemplaza la confirmación anterior de alcance global, sin decidir la representación de almacenamiento pendiente de la ERS. | [Repaso](../rules/ai-bot-and-daily-briefing.md#daily-briefing), [reuniones](../rules/communication-and-meetings.md#meetings-and-attendance), [Data](../rules/data.md#open-decisions) |
| Propiedad de oficina | Se acepta la regla de Luis: **un único Dueño, sin transferencia de propiedad**. El Dueño no abandona su oficina; puede darla de baja. Se descarta la transferencia mencionada antes en el maestro. | ERS RN-02, RN-15, RF-OFI-013 a RF-OFI-016 |
| Alta de espacios | El registro crea automáticamente la **oficina propia y su habitación principal**. No hay una acción para crear una segunda oficina propia ni una sala general global. | ERS RN-01, RN-04, RF-AUT-001 y RF-OFI-001 |
| Invitaciones | **Enlace único no significa de un solo uso**. Tiene vencimiento, es revocable y puede tener un límite opcional de usos; no se impone un consumo único por defecto. | ERS RF-OFI-005 a RF-OFI-009 |

La baja de oficina es lógica y recuperable por el Dueño durante 15 días; después se elimina definitivamente (RN-14). Sigue abierto **P-05**: si el usuario podrá crear una oficina nueva después de esa eliminación. Esta alineación no resuelve ese punto ni cambia la ERS o sus historias.

Alejo pidió respetar también las respuestas de [Authentication and session](../rules/authentication-and-session.md#authorization-responses): `401` sin autenticación, `403` sin permiso y elección uniforme `403`/`404` todavía abierta para recursos de otra oficina, sin revelar su existencia. No se elige una opción mediante un diagrama. Las restricciones ya obligatorias de [Data](../rules/data.md) y [Architecture](../rules/architecture.md) no son propuestas por estar dibujadas.

Los diagramas deben reflejar estos contratos. Sus nombres de clases, eventos, endpoints o campos siguen siendo propuestas cuando no hay un contrato técnico aprobado; Mermaid no reemplaza la autoridad de los requisitos.

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

## Módulos de la ERS

La [ERS v0.1](./functional-requirements.md) ya agrupa los requisitos en estos diez módulos y utiliza los siguientes prefijos de ID:

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

## Estado de la ERS y próximos pasos

La [ERS v0.1](./functional-requirements.md) y las [historias de usuario](./user-stories.md) ya están redactadas; no son evidencia de implementación. La matriz anterior se consulta junto con los requisitos RF y reglas RN de la ERS.

- La recuperación por email figura como **Should · MVP** en RF-AUT-006; su confirmación sigue registrada como P-04 en la ERS, no como una decisión nueva de esta alineación.
- Las notificaciones dentro de la aplicación se describen en el módulo NOT; las notificaciones por email siguen en **Evolución** (RF-NOT-006).
- Los demás supuestos de la sección 9 de la ERS siguen abiertos donde no haya una confirmación explícita. En particular, no se inventa una política de reemplazo de oficina tras la eliminación definitiva (P-05).

Próximo paso: alinear los diagramas con esta base, conservar explícitas las propuestas técnicas y revisar los supuestos restantes con el equipo antes de implementar los comportamientos afectados.
