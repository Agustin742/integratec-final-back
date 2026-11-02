# Vista Dinámica y de Comportamiento (Secuencias)

> Parte de la [documentación de diagramas](../README.md).

Esta carpeta contiene los **diagramas de secuencia** que modelan cómo interactúan los componentes en el tiempo a través de llamadas HTTPS REST y mensajes WSS de Colyseus en la plataforma de aulas virtuales 3D para escuelas. Son diseño propuesto, no implementado, y asumen las decisiones D1 (sesión JWT con refresh rotado) y D2 (`onAuth` de Colyseus contra un endpoint interno de NestJS), pendientes de aprobación del equipo.

## Documentos

| Archivo | Escenarios | Contenido clave |
|---|---|---|
| [core-flows.md](./core-flows.md) | S1 a S7 (Núcleo) | Registro y login, ingreso al aula y verificación de `onAuth`, movimiento y validación autoritativa, entrega y calificación con puntos, chat con persistencia y difusión, repaso diario del bot, renovación de sesión, reconexión y logout. |
| [admin-flows.md](./admin-flows.md) | S8 a S13 (Administración y servicios) | Creación de aula, invitación y alta, baja lógica de miembros, aviso con notificación, compra en la tienda y consulta al Bot con RAG. |

## Navegación

[← Anterior: Vista Estructural](../03-structural/README.md) · [Índice Maestro](../README.md) · [Siguiente: Referencia y Huecos →](../05-reference/README.md)
