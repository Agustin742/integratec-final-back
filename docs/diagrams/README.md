# Diagramas — IntegrarTEC 2026

> **Documento de diagramas** · Plataforma de salas de convivencia y organización  
> **Estado:** baseline de diseño v0.4 (reorganización modular con prefijos numéricos, tercer rol Moderador, Mermaid como única fuente)  
> **Última actualización:** 25 de octubre de 2026

## 1. Alcance y estado

Este directorio reúne los diagramas de arquitectura, comunicación, casos de uso, modelo de datos, clases y secuencias del proyecto. Sirve de referencia común para implementar backend y frontend, y de material de defensa para la entrega integradora.

**Los diagramas describen el sistema objetivo, no el sistema implementado.** El repositorio contiene únicamente documentación: no hay código de aplicación, ni `package.json`, ni migraciones, ni tests de producto ([README](../../README.md)). Todo lo que aparece aquí es un diseño derivado del [documento maestro](../../master-document.md) y de las [reglas del proyecto](../../rules/README.md), y debe contrastarse con el código a medida que se implemente.

Consecuencia práctica: no existen todavía endpoints, verbos HTTP, DTOs, payloads ni nombres definitivos de eventos. Cada punto que depende de una definición pendiente está marcado con **(propuesto)**. Los huecos conocidos se consolidan en [Huecos declarados](./09-gaps.md).

### 1.1 Fuentes

| Documento | Qué aporta |
|---|---|
| [Documento maestro](../../master-document.md) | Alcance del producto, stack, entidades, canales, flujos y reglas de negocio |
| [Reglas del proyecto](../../rules/README.md) | Convenciones permanentes de diseño, seguridad, calidad y flujo de trabajo |
| [Requisitos del curso](../../rules/project-requirements.md) | Requisitos académicos R1–R8 y criterios de evaluación |
| [Seguridad](../../rules/security.md) | Autenticación, autorización, validación, CORS y manejo de secretos |
| [Uso de IA](../../rules/ai-usage.md) | Límites de consumo, fallback y no-elusión de permisos |

### 1.2 Índice de documentos

El prefijo numérico fija el **orden natural de lectura y diseño**:

| Archivo | Contenido | Propósito |
|---|---|---|
| [01-use-cases.md](./01-use-cases.md) | Actores (Miembro, Moderador, Admin), diagrama general, catálogo granular y matriz de permisos | Alcance funcional y roles de usuario |
| [02-architecture.md](./02-architecture.md) | Despliegue AWS, matriz de canales, flujo de salas y comunicación por actor | Topología física y límites de autoridad |
| [03-data-model.md](./03-data-model.md) | Modelo relacional ER, entidades de dominio y administración, invariantes | Persistencia en RDS PostgreSQL |
| [04-realtime.md](./04-realtime.md) | Ciclo de conexión WSS, catálogo de eventos, consistencia y difusión | Multijugador y estado efímero en Colyseus |
| [05-classes.md](./05-classes.md) | Clases por capa (frontend, backend, realtime) y jerarquía de guards | Responsabilidades y contratos de código |
| [06-sequences-core.md](./06-sequences-core.md) | Secuencias del núcleo S1 a S7 | Flujos esenciales (login, ingreso, movimiento, tareas, chat, bot, reconexión) |
| [07-sequences-admin.md](./07-sequences-admin.md) | Secuencias de administración S8 a S12 | Flujos de gestión (invitaciones, solicitudes, expulsión, anuncios, 403) |
| [08-conventions.md](./08-conventions.md) | Códigos HTTP/WS, orden de verificación, idempotencia y límites de IA | Reglas transversales obligatorias |
| [09-gaps.md](./09-gaps.md) | Catálogo de huecos declarados con estado y referencias | Puntos abiertos pendientes de definición |

### 1.3 Cómo leer los diagramas

| Elemento | Significado |
|---|---|
| `HTTPS / REST` | Petición request-response contra NestJS a través del ALB |
| `WSS` | Canal persistente contra Colyseus |
| Línea punteada | Dependencia indirecta, credencial de runtime o acceso que **no** existe |
| **(propuesto)** | Decisión de diseño sin respaldo explícito en el documento maestro |
| Estado efímero | Vive en memoria de Colyseus o del cliente; se pierde al desconectar |
| Estado persistente | Fila en Amazon RDS for PostgreSQL, escrita solo por NestJS mediante Prisma |

La distinción central del sistema es de **autoridad**, no de tecnología: NestJS y PostgreSQL mandan sobre todo lo que debe sobrevivir a la sesión; Colyseus manda sobre presencia y movimiento, que nunca se persisten. Una sala del producto en PostgreSQL no equivale a una instancia `Room` de Colyseus ([documento maestro](../../master-document.md)).

### 1.4 Cómo usar estos diagramas

| Momento | Diagramas recomendados | Para qué |
|---|---|---|
| **Antes de codear** | [01 Casos de uso](./01-use-cases.md), [03 Modelo de datos](./03-data-model.md) | Cierran el alcance del MVP y los roles; alimentan `rules/data.md` y `rules/rooms-and-permissions.md` |
| **Al implementar** | [06-07 Secuencias](./06-sequences-core.md), [05 Clases](./05-classes.md) | Contrato de cada PR: quién escribe, qué guard va primero, cuándo se difunde |
| **Al testear (R2)** | [01 Casos de uso](./01-use-cases.md), [08 Convenciones](./08-conventions.md) | Cada caso de uso es un caso de prueba; la matriz de roles se verifica con tests de API |
| **En la defensa (R8)** | [02 Arquitectura](./02-architecture.md), [04 Realtime](./04-realtime.md), una secuencia (S5, S10 o S4) | Tres diagramas explican el sistema completo; el resto es respaldo |

### 1.5 Mermaid como única fuente

Todos los diagramas son bloques Mermaid dentro de `docs/diagrams/`, que GitHub renderiza directamente. No hay dependencias de tableros externos: un cambio de contenido se versiona junto con el código del repositorio.

---

## 2. Fuentes y mantenimiento

### 2.1 Cómo actualizar estos documentos

1. Modificar el bloque Mermaid en el archivo correspondiente (`01` al `09`), que es la fuente de verdad.
2. Si el cambio resuelve un ítem de [09 Huecos declarados](./09-gaps.md), actualizar su estado y quitar la marca **(propuesto)** en los diagramas afectados.
3. Si cambia un flujo en el código, el PR que lo introduce debe actualizar su respectivo diagrama.

### 2.2 Relación con otros documentos

- El [documento maestro](../../master-document.md) define el producto; estos documentos definen su arquitectura de diseño. Si hay conflicto, manda el documento maestro.
- Cuando se escriban `rules/data.md` y `rules/rooms-and-permissions.md`, el [03 Modelo de datos](./03-data-model.md) se alineará con el esquema real de Prisma y la matriz de permisos formalizará el [02 Flujo de salas](./02-architecture.md).
- Las reglas de [seguridad](../../rules/security.md) y [uso de IA](../../rules/ai-usage.md) son de cumplimiento estricto: si un diagrama las contradice, el diagrama debe corregirse.
