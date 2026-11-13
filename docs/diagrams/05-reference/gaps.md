# Huecos declarados

> Registro de decisiones aprobadas y de puntos abiertos que afectan los diagramas del aula virtual escolar. El estado del trabajo vive en Projects, no en esta tabla.

← [Convenciones](./conventions.md) · [Índice](../README.md)

## 1. Decisiones aprobadas

Las decisiones D1 a D10 de la [justificación técnica, sección 7](../../technical-justification.md#7-architecture-decisions-recorded-on-2026-11-02) fueron tomadas y aprobadas por Agustín (responsable de las decisiones) el 2026-11-02, y D13 el 2026-11-05; no se afirma aprobación de todo el equipo. Los diagramas las reflejan como diseño propuesto, no implementado. El conflicto previo entre RN-02 / RF-AUL-002 / HU-AUL-002 (correo o código/enlace) y las reglas (solo correo de un solo uso) queda resuelto por D7.

| ID | Decisión | Vistas afectadas |
|---|---|---|
| D1 | JWT de acceso de vida corta más refresh token opaco hasheado y rotado; el identificador de sesión se verifica en cada petición protegida. Almacenamiento de tokens en el cliente: `sessionStorage` con header `Authorization: Bearer` (acordado con el frontend, FD1) | Arquitectura, realtime, convenciones |
| D2 | `onAuth` de Colyseus consulta un endpoint interno de NestJS autenticado con un secreto de servicio en Secrets Manager; el ingreso se rechaza si NestJS no puede verificar | Arquitectura, realtime |
| D3 | Monorepo pnpm: `apps/api` (NestJS), `apps/realtime` (Colyseus) y `packages/contracts` | Arquitectura |
| D4 | OpenAPI generado por NestJS y servido con Scalar; el frontend genera sus tipos. Detalle de distribución en D8 | Arquitectura, realtime, clases |
| D5 | Región AWS `us-east-2` (actualizada el 2026-11-04: la región la asigna AWS por país de la cuenta y no puede cambiarse; reemplaza a `sa-east-1`); Bedrock disponible en el plan Free sin inferencia entre regiones (verificado el 2026-11-05): el modelo debe tener inferencia on-demand dentro de la región, por confirmar en la consola | Arquitectura |
| D6 | GitHub Actions con OIDC hacia un rol IAM, sin claves de larga duración (el proveedor OIDC está bloqueado por una política de la cuenta; ver fila 25) | Arquitectura |
| D7 | Dos mecanismos de ingreso: invitación por correo (un solo uso; obligatoria para profesores invitados y para padres) y código de unión por aula (solo rol `Student`, hash, vencimiento, revocable, máximo de usos opcional, límite de intentos, auditoría). La forma de la entidad queda para el esquema Prisma base | Datos, aulas, casos de uso |
| D8 | Artefactos de contrato versionados: el backend genera y **commitea** `openapi.json` (ruta prevista, p. ej. `apps/api/openapi.json`; la fija el bootstrap del monorepo) y su CI falla si está desactualizado; los tipos de estado de sala (`@colyseus/schema` codegen) y de mensajes (`packages/contracts`) se generan o exportan y se commitean; el frontend los trae con `pnpm api:sync` y commitea los tipos generados | Arquitectura, realtime, clases |
| D9 | Contrato primero: el backend publica los DTO y la entrada OpenAPI de cada endpoint (puede ser un stub que responde `501`) en un PR antes de la implementación o junto con ella; el frontend construye sus mocks (MSW, solo desarrollo y pruebas) desde `openapi.json` (FD9) | Arquitectura, convenciones |
| D10 | Plazos: los instantes se guardan en UTC y la API devuelve ISO 8601 UTC; cada escuela tiene una zona IANA persistida (por defecto `America/Argentina/Buenos_Aires`); el frontend muestra los plazos en esa zona y la indica; el servidor decide la tardanza en UTC (FD11). Cierra el antiguo hueco 16 | Modelo de datos, convenciones |
| D13 | Cómputo de producción en un único host EC2 (`t3.small`, Docker Compose con Caddy, NestJS y Colyseus) en lugar de ECS Fargate, ALB y NAT; RDS sigue como base administrada separada; sin SSH (SSM Session Manager). Aprobada el 2026-11-05 | Arquitectura |

## 2. Huecos abiertos vigentes

Cada fila remite a la regla que la mantiene abierta. **Abierto** significa que no se decidió: no se elige aquí ni se resuelve por dibujarlo. Los requisitos funcionales y las reglas de negocio están en la [ERS](../../functional-requirements.md); las historias, en [user-stories.md](../../user-stories.md).

| # | Tema | Estado y fuente | Vista afectada |
|---|---|---|---|
| 1 | Nombres, payloads, direcciones y acknowledgements de eventos realtime | Ilustrativos hasta especificarse en [API contracts](../../../rules/api-contracts.md); requieren contrato productor/consumidor | Realtime, clases |
| 2 | Catálogo de endpoints, verbos y DTOs | Propuestos; el contrato REST saldrá del `openapi.json` commiteado (D4, D8) | Casos de uso, secuencias |
| 3 | Tick rate, reconciliación de movimiento y límites por conexión | Decididos el 2026-11-10 (D14; [Realtime and presence](../../../rules/realtime-and-presence.md#movement)) | Realtime |
| 4 | Política de conexiones duplicadas y propagación de cambios de acceso a las `Room` vivas | Decididas el 2026-11-10 (D14; [Realtime and presence](../../../rules/realtime-and-presence.md#presence-and-duplicate-connections)) | Realtime |
| 5 | Ventana de reconexión y backoff | Decididos el 2026-11-10 (D14; [Realtime and presence](../../../rules/realtime-and-presence.md#reconnection-and-disconnection)) | Realtime |
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
| 17 | Historial de reentregas y de calificaciones; intentos, entrega tardía y crédito parcial; edición o baja de actividades con entregas; fórmula y agregación de `ActivityMetric`; límites y análisis de archivos | Abiertos ([Activities and grading](../../../rules/activities-and-grading.md#open-decisions)) | Modelo de datos, secuencias |
| 18 | Catálogo de medallas, otras fuentes de puntos, reembolsos y períodos de gracia de la racha; estado inicial de minijuegos; visibilidad de saldos ajenos | Abiertos ([Points and shop](../../../rules/points-and-shop.md#open-decisions)) | Modelo de datos, casos de uso |
| 19 | Modelo de IA, tecnología de recuperación y límites numéricos de uso; persistencia del texto del repaso; recuperación tras fallo de entrega y repaso en día de examen; alcance de los controles de salida | Abiertos ([Bot](../../../rules/ai-bot-and-daily-briefing.md#open-decisions)) | Secuencias, convenciones |
| 20 | Ruteo de Caddy hacia Colyseus (ruta o host), dominio y nombre DNS para la IP elástica (el certificado lo emite Let's Encrypt y requiere un nombre DNS; un nombre comodín gratuito como sslip.io es un candidato provisional, no decidido), dimensionamiento de RDS y uso de S3 | Abiertos ([AWS infrastructure](../../../rules/aws-infrastructure.md#open-decisions)) | Arquitectura |
| 21 | Modelo de Bedrock con inferencia on-demand dentro de `us-east-2`: el plan Free no admite inferencia entre regiones global ni geográfica (verificado el 2026-11-05); falta confirmar en la consola qué modelo la ofrece | Abierto, por verificar (D5; [AWS infrastructure](../../../rules/aws-infrastructure.md#open-decisions)) | Arquitectura |
| 22 | Escalado de Colyseus más allá de una instancia (D13 limita el cómputo a un único host con escalado vertical) | Abierto ([AWS infrastructure](../../../rules/aws-infrastructure.md#open-decisions), [Realtime and presence](../../../rules/realtime-and-presence.md#scaling-and-deployment)) | Arquitectura |
| 23 | Propiedad compartida del archivo Compose y de las etiquetas de imagen del host entre Terraform y el pipeline; si Terraform gestiona Amplify; entornos además de producción | Abiertos ([Infrastructure as code](../../../rules/infrastructure-as-code.md#open-decisions)) | Arquitectura |
| 24 | Socket.IO | Excluido del MVP; cualquier uso requiere justificación independiente ([Realtime and presence](../../../rules/realtime-and-presence.md#scaling-and-deployment)) | Arquitectura, realtime |
| 25 | Una política administrada de AWS deniega `iam:CreateOpenIDConnectProvider` en la cuenta actual, por lo que el proveedor OIDC y el rol de GitHub Actions quedan desactivados (`enable_github_oidc = false`); Terraform se aplica de forma local con credenciales temporales y el despliegue desde el pipeline queda diferido hasta activar las funciones avanzadas de la cuenta | Abierto, bloqueado por la cuenta (D6; [justificación técnica](../../technical-justification.md#d6-pipeline-authentication-to-aws)) | Arquitectura |

### Notas

- **Resueltos por regla:** los recursos de otra escuela o aula responden `404` sin revelar su existencia (RN-04); el Padre no ingresa al aula 3D; la unicidad, la aceptación atómica de invitaciones y la entrega única del repaso diario son restricciones obligatorias de [Data](../../../rules/data.md#constraints-and-uniqueness), no propuestas.
- **Normas y motivos:** [reglas de dominio](../../../rules/README.md) y [justificación técnica](../../technical-justification.md), sin duplicar sus explicaciones ni reabrir lo ya obligatorio.
- **Supuestos de la ERS:** los supuestos marcados en la ERS siguen identificados allí; reproducirlos en un diagrama no los da por cerrados.

← [Convenciones](./conventions.md) · [Índice](../README.md)
