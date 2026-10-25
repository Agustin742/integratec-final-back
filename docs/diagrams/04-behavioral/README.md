# Vista Dinámica y de Comportamiento (Secuencias)

> Parte de la [documentación de diagramas](../README.md).

Esta carpeta contiene los **diagramas de secuencia** que modelan cómo interactúan los componentes en el tiempo a través de llamadas HTTPS REST y mensajes WSS de Colyseus.

## Documentos

| Archivo | Escenarios | Contenido clave |
|---|---|---|
| [core-flows.md](./core-flows.md) | S1 a S7 (Núcleo) | Registro y sesión, ingreso a sala y handshake WSS, movimiento y predicción local, creación de tareas, chat con persistencia y difusión, repaso diario del bot, reconexión y logout. |
| [admin-flows.md](./admin-flows.md) | S8 a S12 (Administración) | Creación y canje de invitaciones, solicitud y aprobación de acceso, expulsión forzada, publicación de eventos/asistencia, y rechazo 403 ante acciones no autorizadas. |

## Navegación

[← Anterior: Vista Estructural](../03-structural/README.md) · [Índice Maestro](../README.md) · [Siguiente: Referencia y Huecos →](../05-reference/README.md)
