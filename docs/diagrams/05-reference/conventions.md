# Convenciones transversales

> Códigos de error, orden de verificación, idempotencia y límites de IA. Parte del [índice de diagramas](../README.md).

**En este archivo**

- [1. Convenciones transversales](#1-convenciones-transversales)
  - [1.1 Códigos de error](#11-códigos-de-error)
  - [1.2 Orden obligatorio de verificación](#12-orden-obligatorio-de-verificación)
  - [1.3 Idempotencia y duplicados](#13-idempotencia-y-duplicados)
  - [1.4 Límites de IA](#14-límites-de-ia)
  - [1.5 Qué nunca se persiste](#15-qué-nunca-se-persiste)

← [Secuencias de administración](../04-behavioral/admin-flows.md) · [Índice](../README.md) · [Huecos declarados](./gaps.md) →

---

## 1. Convenciones transversales

Estas convenciones derivan de la [ERS](../../functional-requirements.md), las decisiones D1 a D7 aprobadas por Agustín el 2026-11-02 ([justificación técnica](../../technical-justification.md#7-architecture-decisions-recorded-on-2026-11-02)) y las [reglas](../../../rules/README.md). No establecen requisitos nuevos ni reemplazan sus fuentes; mecanismos no acordados se rotulan como propuestas.

### 1.1 Códigos de error

| Código | Cuándo | Dónde |
|---|---|---|
| `401` | Falta la autenticación o la sesión está vencida o revocada (identificador de sesión verificado en cada petición protegida, D1) | Todo endpoint HTTP protegido; realtime expresa el mismo principio sin exigir código HTTP tras el handshake |
| `403` | Hay identidad válida pero falta el permiso sobre un recurso del propio contexto | Operaciones HTTP sin permiso sobre el aula o el recurso |
| `404` | Recurso de otra escuela o aula: no se revela su existencia (RN-04) | Todo endpoint HTTP; uniforme en la API |
| `409` | (propuesto) Conflicto de unicidad, por ejemplo email ya registrado o marcador diario existente | Alta de usuario; repaso diario |
| `422` | (propuesto) DTO válido en forma pero inválido en regla de negocio | Validación del DTO después de los guards |
| `429` | (propuesto) Límite de consumo de IA excedido | Endpoints del bot |

Las respuestas siguen [Authentication and session](../../../rules/authentication-and-session.md#authorization-responses). Según esa regla, los recursos de otra escuela o aula responden `404` de forma uniforme en toda la API, sin revelar su existencia, y `403` queda para rol insuficiente sobre un recurso visible. Los demás códigos de la tabla son propuestas.

### 1.2 Orden obligatorio de verificación

Todo endpoint protegido ejecuta, en este orden: **autenticación → autorización sobre escuela, aula y recurso → validación del DTO → escritura**. Ningún guard ni validación es opcional, y ninguno se reemplaza por un control en el cliente. El cliente puede ocultar un botón; el servidor debe rechazar la operación igual.

### 1.3 Idempotencia y duplicados

| Operación | Riesgo | Mecanismo |
|---|---|---|
| Repaso diario del bot | Dos repasos el mismo día | Unicidad usuario/fecha y decisión atómica obligatorias según [Data](../../../rules/data.md#constraints-and-uniqueness); reserva, recuperación y confirmación concretas siguen abiertas, ver S6 |
| Alta de usuario | Dos cuentas con el mismo email | Unicidad de email normalizado obligatoria según [Data](../../../rules/data.md#constraints-and-uniqueness); email como login conserva el supuesto P-01 |
| Mensaje de chat | Duplicado por reintento | (propuesto) Idempotency key por mensaje del cliente |
| Escritura persistente + difusión | Difusión repetida | (propuesto) `revision` monotónica por aula; el cliente descarta revisiones viejas |

### 1.4 Límites de IA

Bedrock se invoca únicamente desde NestJS; el navegador nunca lo alcanza ni recibe credenciales del proveedor. En el MVP el bot es de **solo lectura**, incluso ante un pedido explícito de escritura (RN-14); acciones de negocio son Evolución. Toda consulta y respuesta del modelo pasa por las mismas reglas de autorización que una petición humana y no puede ampliar el alcance de datos del usuario. Si el proveedor falla o excede el tiempo de espera, el repaso diario degrada a un resumen estructurado sin generación de texto. Los límites numéricos de consumo siguen sin definirse. Los resúmenes personales se entregan al usuario destinatario, no se difunden a toda el aula.

### 1.5 Qué nunca se persiste

Posición por fotograma, posiciones transitorias, estados interpolados de avatares, conexiones activas y presencia. Estos datos viven en la memoria de Colyseus y se reconstruyen al reconectar. Si el diseño propone una tabla para ellos, el diseño está mal.

---

← [Secuencias de administración](../04-behavioral/admin-flows.md) · [Índice](../README.md) · [Huecos declarados](./gaps.md) →

## 2. Tiempo y alcance de datos

La zona del repaso sigue [AI bot and daily briefing](../../../rules/ai-bot-and-daily-briefing.md#daily-review), sin herencia implícita a otras funciones. Fechas e instantes siguen [Data and time](../../../rules/data-and-time.md); los instantes se guardan en UTC y los plazos se muestran en la zona IANA de la escuela (D10, [justificación técnica](../../technical-justification.md#d10-deadline-time-zone)).
