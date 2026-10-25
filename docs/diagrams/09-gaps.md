# Huecos declarados

> Decisiones que la documentación actual no resuelve y los diagramas que dependen de ellas. Parte del [índice de diagramas](./README.md).

**En este archivo**

- [1. Huecos declarados](#1-huecos-declarados)

← [Convenciones transversales](./08-conventions.md) · [Índice](./README.md)

---

## 1. Huecos declarados

Ninguno de estos puntos está resuelto en la documentación actual. Los diagramas que dependen de ellos usan **(propuesto)** y deben revisarse cuando se cierren.

| # | Hueco | Estado | Impacta en |
|---|---|---|---|
| 1 | Nombres definitivos de eventos realtime | Abierto | 04 §1.1, 04 §1.2, S2–S7 |
| 2 | Payloads, direccionalidad, namespaces y acknowledgements | Abierto | 04 §1.2, S3–S7 |
| 3 | Tick rate y autoridad exacta del movimiento | Abierto | 04 §1.2, S3 |
| 4 | Endpoints, verbos y DTOs | Abierto | 02 §1.2, S1–S7 |
| 5 | Catálogo de errores más allá de 401 y 403 | Abierto | 08 §1.1 |
| 6 | Campos exactos de toda entidad | Abierto | 03 §1.1 |
| 7 | Cardinalidades de `User`–`AvatarConfiguration`, `User`–`Session`, `Room`–`Meeting`, `User`–`BotConversation` | Abierto | 03 §1.1 |
| 8 | Matriz de permisos por rol (`rules/rooms-and-permissions.md` no existe) | Abierto | 02 §1.3, 03 §1.1, S4 |
| 9 | Valores de visibilidad de una sala | Abierto | 02 §1.3, 03 §1.1 |
| 10 | Formato, expiración y revocación de invitaciones | Con propuesta | 02 §1.3 |
| 11 | Flujo de solicitud y aprobación de ingreso | Con propuesta | 02 §1.3 |
| 12 | Expulsión, ban y revocación de membresía | Con propuesta | 04 §1.1 |
| 13 | Estados y transiciones de `Task` | Abierto | 03 §1.1 |
| 14 | Modelo de mensajería privada | Abierto | 03 §1.1 |
| 15 | Modelo de asistencia a reuniones (entidad `Attendance`) | Con propuesta | 03 §1.1 |
| 16 | Modelo de `BotConversation` y catálogo de herramientas del bot | Abierto | 03 §1.1, S6 |
| 17 | Límites numéricos de consumo de IA | Abierto | 08 §1.4, S6 |
| 18 | Mecanismo de sesión: JWT o cookie, duración, refresh, revocación | Abierto | 02 §1.1, S1, S7 |
| 19 | Cantidad y administración de salas generales | Abierto | 02 §1.3 |
| 20 | Retención y reglas de acceso al historial de mensajes | Abierto | S5 |
| 21 | Uploads a S3: endpoints, tipos permitidos, URLs prefirmadas | Abierto | 02 §1.1 |
| 22 | Casos de uso de Socket.IO | Con propuesta | 02 §1.1 |
| 23 | Unicidad de `DailyReviewDelivery` | Abierto | 03 §1.1, S6 |
| 24 | Decisión de camino de chat (REST + difusión) frente a mensaje por WSS; adoptada como propuesta en S5 | Con propuesta | 04 §1.2, S5 |
| 25 | Matriz de permisos fina del Admin (UC-20 a UC-28) y del Miembro sobre tareas ajenas | Abierto | 01 §1.3 |
| 26 | Si un recurso no visible responde `403` o `404` | Abierto | 01 §1.3 |
| 27 | Rol Moderador: existencia, permisos exactos y edición de tareas ajenas (propuesto) | Con propuesta | 01 §1.4, 03 §1.2, S10, S12 |

Los huecos 10, 11, 12, 15 y 22 tienen ahora una **propuesta** en [Modelo de datos](./03-data-model.md#12-entidades-adicionales), [Eventos](./04-realtime.md#14-eventos-adicionales-de-administración) y [Casos de uso](./01-use-cases.md#1-casos-de-uso), pero siguen sin respaldo en la fuente.

---

← [Convenciones transversales](./08-conventions.md) · [Índice](./README.md)
