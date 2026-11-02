# Huecos declarados

> Registro de decisiones pendientes de aprobación y de puntos abiertos que afectan los diagramas del aula virtual escolar. El estado del trabajo vive en Projects, no en esta tabla.

← [Convenciones](./conventions.md) · [Índice](../README.md)

## 1. Decisiones pendientes de aprobación del equipo

Las decisiones D1 a D6 de la [justificación técnica, sección 7](../../technical-justification.md#7-architecture-decisions-recorded-on-2026-11-02) fueron tomadas por Agustín el 2026-11-02 y **no son acuerdos del equipo hasta que este las apruebe**. Los diagramas las reflejan como diseño propuesto, no implementado.

| ID | Decisión | Vistas afectadas |
|---|---|---|
| D1 | JWT de acceso de vida corta más refresh token opaco hasheado y rotado; el identificador de sesión se verifica en cada petición protegida. Almacenamiento de tokens en el cliente: abierto | Arquitectura, realtime, convenciones |
| D2 | `onAuth` de Colyseus consulta un endpoint interno de NestJS autenticado con un secreto de servicio en Secrets Manager; el ingreso se rechaza si NestJS no puede verificar | Arquitectura, realtime |
| D3 | Monorepo pnpm: `apps/api` (NestJS), `apps/realtime` (Colyseus) y `packages/contracts` | Arquitectura |
| D4 | OpenAPI generado por NestJS y servido con Scalar; el frontend genera sus tipos. Distribución de tipos realtime: abierta | Arquitectura, realtime, clases |
| D5 | Región AWS `sa-east-1`; disponibilidad de Bedrock en esa región por verificar | Arquitectura |
| D6 | GitHub Actions con OIDC hacia un rol IAM, sin claves de larga duración | Arquitectura |

## 2. Huecos abiertos vigentes

Cada fila remite a la regla que la mantiene abierta. **Abierto** significa que no se decidió: no se elige aquí ni se resuelve por dibujarlo. Los requisitos funcionales y las reglas de negocio están en la [ERS](../../functional-requirements.md); las historias, en [user-stories.md](../../user-stories.md).

| # | Tema | Estado y fuente | Vista afectada |
|---|---|---|---|
| 1 | Nombres, payloads, direcciones y acknowledgements de eventos realtime | Ilustrativos hasta especificarse en [API contracts](../../../rules/api-contracts.md); requieren contrato productor/consumidor | Realtime, clases |
| 2 | Catálogo de endpoints, verbos y DTOs | Propuestos; el contrato REST saldrá de OpenAPI (D4) | Casos de uso, secuencias |
| 3 | Tick rate, reconciliación de movimiento y límites por conexión | Abiertos ([Realtime and presence](../../../rules/realtime-and-presence.md#open-decisions)) | Realtime |
| 4 | Política de conexiones duplicadas y propagación de cambios de acceso a las `Room` vivas | Abiertas ([Realtime and presence](../../../rules/realtime-and-presence.md#open-decisions)) | Realtime |
| 5 | Ventana de reconexión y backoff | Abiertos ([Realtime and presence](../../../rules/realtime-and-presence.md#open-decisions)) | Realtime |
| 6 | Camino de envío del chat: REST más difusión o mensaje realtime validado | Abierto ([Communication and notifications](../../../rules/communication-and-notifications.md#open-decisions)) | Secuencias, realtime |
| 7 | Retención del historial de mensajes y conversaciones con padres; silencio por alumno, filtrado, lectura de conversaciones de padres por Dueño o Admin; visibilidad de avisos para el Padre; servicio de correo | Abiertos ([Communication and notifications](../../../rules/communication-and-notifications.md#open-decisions)) | Casos de uso, modelo de datos |
| 8 | Transporte de anuncios de NestJS a Colyseus y protocolo de recuperación de notificaciones perdidas | Abiertos ([Architecture](../../../rules/architecture.md#open-decisions)) | Arquitectura, realtime |
| 9 | Mecanismo de sincronización colaborativa (estado de Colyseus o Yjs) y persistencia de pizarrones | Abiertos ([Live classroom tools](../../../rules/live-classroom-tools.md#open-decisions)) | Realtime |
| 10 | Servicio de medios para video y voz (LiveKit o Amazon Chime SDK) y formato de credencial; acciones del alumno durante el congelamiento; mano alzada | Abiertos ([Live classroom tools](../../../rules/live-classroom-tools.md#open-decisions)) | Arquitectura, realtime |
| 11 | Nombres finales de tablas y columnas, valores de enum y límites de campo | Abiertos ([Data](../../../rules/data.md#open-decisions)) | Modelo de datos |
| 12 | Retención de mensajes, archivos y conversaciones del bot; si estas se persisten | Abiertas ([Data](../../../rules/data.md#open-decisions), [Bot](../../../rules/ai-bot-and-daily-briefing.md#open-decisions)) | Modelo de datos, secuencias |
| 13 | Efectos de eliminar cuenta, escuela o aula sobre registros retenidos | Abiertos ([Data](../../../rules/data.md#open-decisions), [Classrooms and roles](../../../rules/classrooms-and-roles.md#open-decisions)) | Modelo de datos, casos de uso |
| 14 | Alcance de la delegación del Admin frente al Dueño (transferir o eliminar la escuela) | Diferido a la implementación de roles ([Classrooms and roles](../../../rules/classrooms-and-roles.md#open-decisions)) | Casos de uso, clases |
| 15 | Si una cuenta puede tener a la vez camino de escuela y de profesor independiente | Abierto ([Data](../../../rules/data.md#open-decisions)) | Casos de uso, modelo de datos |
| 16 | Representación del almacenamiento de instantes y de la zona horaria de Buenos Aires | Abierto; el proyecto interpreta instantes con zona horaria presentados en esa zona, por confirmar ([Data](../../../rules/data.md#open-decisions)) | Modelo de datos, convenciones |
| 17 | Historial de reentregas y de calificaciones; intentos, entrega tardía y crédito parcial; edición o baja de actividades con entregas; fórmula y agregación de `ActivityMetric`; límites y análisis de archivos | Abiertos ([Activities and grading](../../../rules/activities-and-grading.md#open-decisions)) | Modelo de datos, secuencias |
| 18 | Catálogo de medallas, otras fuentes de puntos, reembolsos y períodos de gracia de la racha; estado inicial de minijuegos; visibilidad de saldos ajenos | Abiertos ([Points and shop](../../../rules/points-and-shop.md#open-decisions)) | Modelo de datos, casos de uso |
| 19 | Modelo de IA, tecnología de recuperación y límites numéricos de uso; persistencia del texto del repaso; recuperación tras fallo de entrega y repaso en día de examen; alcance de los controles de salida | Abiertos ([Bot](../../../rules/ai-bot-and-daily-briefing.md#open-decisions)) | Secuencias, convenciones |
| 20 | Ruteo del ALB hacia Colyseus (ruta o host), dominio y certificado, dimensionamiento y uso de S3 | Abiertos ([AWS infrastructure](../../../rules/aws-infrastructure.md#open-decisions)) | Arquitectura |
| 21 | Disponibilidad de modelos de Bedrock en `sa-east-1`; posible inferencia entre regiones | Abierto, por verificar (D5; [AWS infrastructure](../../../rules/aws-infrastructure.md#open-decisions)) | Arquitectura |
| 22 | Escalado de Colyseus más allá de una instancia | Abierto ([AWS infrastructure](../../../rules/aws-infrastructure.md#open-decisions), [Realtime and presence](../../../rules/realtime-and-presence.md#scaling-and-deployment)) | Arquitectura |
| 23 | Propiedad compartida de la task definition entre Terraform y el pipeline; si Terraform gestiona Amplify; entornos además de producción | Abiertos ([Infrastructure as code](../../../rules/infrastructure-as-code.md#open-decisions)) | Arquitectura |
| 24 | Socket.IO | Excluido del MVP; cualquier uso requiere justificación independiente ([Realtime and presence](../../../rules/realtime-and-presence.md#scaling-and-deployment)) | Arquitectura, realtime |

### Notas

- **Resueltos por regla:** los recursos de otra escuela o aula responden `404` sin revelar su existencia (RN-04); el Padre no ingresa al aula 3D; la unicidad, la aceptación atómica de invitaciones y la entrega única del repaso diario son restricciones obligatorias de [Data](../../../rules/data.md#constraints-and-uniqueness), no propuestas.
- **Normas y motivos:** [reglas de dominio](../../../rules/README.md) y [justificación técnica](../../technical-justification.md), sin duplicar sus explicaciones ni reabrir lo ya obligatorio.
- **Supuestos de la ERS:** los supuestos marcados en la ERS siguen identificados allí; reproducirlos en un diagrama no los da por cerrados.

← [Convenciones](./conventions.md) · [Índice](../README.md)
