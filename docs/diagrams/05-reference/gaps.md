# Huecos declarados

> Registro de decisiones funcionales y propuestas técnicas que afectan los diagramas. El estado del trabajo vive en Projects, no en esta tabla.

← [Convenciones](./conventions.md) · [Índice](../README.md)

## 1. Huecos declarados

La [ERS](../../functional-requirements.md) y las [confirmaciones](../../requirements-decision.md#confirmaciones-para-la-alineación-documental) ya resuelven parte de los 27 puntos originales. Se conserva su numeración para trazabilidad: **definido funcionalmente** no significa esquema/API aprobados ni implementación. Los supuestos P-01 a P-15 de la ERS siguen identificados allí; esta revisión no los aprueba en bloque.

| # | Tema | Estado actual y fuente | Vista afectada |
|---|---|---|---|
| 1 | Nombres de eventos realtime | Propuesta; requiere contrato de productor/consumidor | Realtime, S2–S13 |
| 2 | Payloads, direcciones, suscripciones y acknowledgements | Propuesta; distinguir comandos, confirmaciones y notificaciones según rules/api-contracts.md | Realtime, clases |
| 3 | Tick rate y movimiento | Sin frecuencia aprobada; validar límites/colisiones es funcional (RF-MUN-005/007) | Realtime, S3 |
| 4 | Endpoints, verbos y DTOs | Propuestos, no catálogo implementado | Casos de uso, secuencias |
| 5 | Errores fuera de 401/403 | Propuestos; RN-16 fija autenticación y autorización HTTP | Convenciones |
| 6 | Campos, claves, índices y tipos SQL | Diseño backend pendiente; ERS §7 sí define entidades conceptuales | Modelo ER |
| 7 | Cardinalidades | ERS define oficina/habitaciones, avatar, membresía, acceso y liderazgo; sesiones e historial del bot son diseño técnico | Modelo ER |
| 8 | Matriz de permisos | Definida en ERS §3 y RN-07 a RN-11; conservar supuestos P-07/P-08/P-13 explícitos | Casos de uso, clases |
| 9 | Visibilidad de habitación | Acceso por oficina y habitación, no enum público/global propuesto; principal accesible a miembros (RN-03/04) | Arquitectura, ER |
| 10 | Invitaciones | Funcional definido RF-OFI-005 a 009: enlace único, vencimiento, revocación, límite opcional de usos. Tokens y duración concreta pendientes (P-03) | S8, ER |
| 11 | Solicitud de ingreso | Could · Evolución, RF-OFI-018; no aprobación adicional en canje de enlace MVP | S9 |
| 12 | Expulsión y revocación | RN-12/13 y RF-OFI-012: baja lógica, conservar contenido, acceso revocado y tareas huérfanas; no se añade ban | S10, clases |
| 13 | Estados de tarea | RF-TAR-004/006/007: columnas configurables, no enum fijo. Nombres iniciales en P-14; migración pendiente | ER, S4 |
| 14 | Mensajería privada | Could · Evolución (RF-CHA-009); no se incorpora al MVP | Casos de uso, ER |
| 15 | Asistencia | Must · MVP (RF-CAR-007), por usuario/reunión; entidad conceptual definida, esquema técnico propuesto | ER, S11 |
| 16 | Conversaciones y herramientas del bot | RN-18 y RF-BOT-004 fijan solo lectura en MVP; almacenamiento del diálogo y catálogo concreto pendientes | Clases, S6 |
| 17 | Límites numéricos IA | Pendientes; timeout/rate limit sin cifras inventadas | Convenciones, S6 |
| 18 | Sesión | Expiración, renovación y revocación funcionales (AUT); JWT/cookie y parámetros pendientes (P-03) | S1, S7 |
| 19 | Sala general | Resuelto: no existe sala global; cada oficina tiene principal no eliminable, hasta 5 adicionales (RN-04/05) | Arquitectura, ER |
| 20 | Historial de chat | Persistencia y control definidos (RF-CHA-006/007); recuperación de acceso está señalada P-11; retención técnica pendiente | S5, canales |
| 21 | Uploads S3 | Endpoints, tipos, autorización y entrega de objetos pendientes; no se aprueban por topología | Arquitectura |
| 22 | Socket.IO | Solo uso puntual justificado según maestro; no hay caso adicional aprobado en estas vistas | Arquitectura, realtime |
| 23 | Entrega de repaso diario | RF-BOT-007 fija una vez por día; clave usuario/fecha, reservas, recuperación y confirmación son propuestas | ER, S6 |
| 24 | Camino de chat | REST para envío + WSS para difusión es propuesta; contrato debe servir oficina y habitación, aunque usuario cambie de habitación | S5, realtime |
| 25 | Tareas ajenas y administración | ERS §3: tareas colaborativas con acceso; solo Dueño nombra Admin; Líder solo gestiona su habitación y contenido propio | Casos de uso, S12 |
| 26 | Rechazo de recurso ajeno | RN-16/HAB-011 exigen 403 sin permiso y no revelar existencia; no se reemplaza unilateralmente por 404 | Convenciones, autorización |
| 27 | Moderador | Retirado del diseño: roles de oficina Dueño/Admin/Miembro y liderazgo de habitación separado | Casos de uso, clases |

### Decisiones confirmadas y pendientes que no deben confundirse

- **Confirmadas:** Three.js + R3F elegidos; Buenos Aires para todo el producto; propiedad única y no transferible según Luis (RN-02/RN-15).
- **Ciclo de oficina:** baja lógica, recuperación durante 15 días y eliminación definitiva están descritas en RN-14 y RF-OFI-014 a 016. P-05 (crear otra oficina después) sigue abierto.
- **Supuestos ERS:** recuperación por email, eliminación de habitación, permisos propuestos y prioridades conservan sus P#; no se decide aquí la implementación ni se dan por cerrados por reproducirlos en un diagrama.
- **Integración:** dueño y distribución de contratos entre frontend/backend, routing de canales de oficina/habitación/usuario y mecanismos de entrega requieren diseño técnico coordinado.

← [Convenciones](./conventions.md) · [Índice](../README.md)
