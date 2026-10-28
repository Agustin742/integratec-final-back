# Convenciones transversales

> Códigos de error, orden de verificación, idempotencia y límites de IA. Parte del [índice de diagramas](../README.md).

**En este archivo**

- [1. Convenciones transversales](#1-convenciones-transversales)
  - [1.1 Códigos de error](#11-códigos-de-error)
  - [1.2 Orden obligatorio de verificación](#12-orden-obligatorio-de-verificación)
  - [1.3 Idempotencia y duplicados](#13-idempotencia-y-duplicados)
  - [1.4 Límites de IA](#14-límites-de-ia)
  - [1.5 Qué nunca se persiste](#15-qué-nunca-se-persiste)

← [Secuencias de administración (S8 a S13)](../04-behavioral/admin-flows.md) · [Índice](../README.md) · [Huecos declarados](./gaps.md) →

---

## 1. Convenciones transversales

Estas convenciones derivan de la [ERS](../../functional-requirements.md), las [decisiones confirmadas](../../requirements-decision.md) y las [reglas](../../../rules/README.md). No establecen requisitos nuevos ni reemplazan sus fuentes; mecanismos no acordados se rotulan como propuestas.

### 1.1 Códigos de error

| Código | Cuándo | Dónde |
|---|---|---|
| `401` | Falta la autenticación o la sesión está vencida o revocada | Todo endpoint HTTP protegido; realtime expresa el mismo principio sin exigir código HTTP tras handshake |
| `403` | Hay identidad válida pero falta el permiso sobre el recurso o la sala | Operaciones HTTP sin acceso autorizado a oficina/habitación o recurso |
| `409` | (propuesto) Conflicto de unicidad, por ejemplo email ya registrado o marcador diario existente | Alta de usuario; repaso diario |
| `422` | (propuesto) DTO válido en forma pero inválido en regla de negocio | Validación con Zod después de los guards |
| `429` | (propuesto) Límite de consumo de IA excedido | Endpoints del bot |

RN-16 define `401` y `403` para HTTP; no se reemplaza 403 por 404 para los casos exigidos por la ERS. La no revelación de recursos ajenos se respeta sin publicar detalles internos. Solo estos dos códigos están fijados en esta vista. El resto es propuesta y debe confirmarse antes de implementar el manejador global de errores.

### 1.2 Orden obligatorio de verificación

Todo endpoint protegido ejecuta, en este orden: **autenticación → autorización sobre oficina, habitación y recurso → validación del DTO → escritura**. Ningún guard ni validación es opcional, y ninguno se reemplaza por un control en el cliente. El cliente puede ocultar un botón; el servidor debe rechazar la operación igual.

### 1.3 Idempotencia y duplicados

| Operación | Riesgo | Mecanismo |
|---|---|---|
| Repaso diario del bot | Dos repasos el mismo día | (propuesto) Clave usuario/fecha y reserva atómica; no confundir generación pendiente con entrega completada; ver S6 |
| Alta de usuario | Dos cuentas con el mismo email | (propuesto) Índice único normalizado; email como login es supuesto P-01 |
| Mensaje de chat | Duplicado por reintento | (propuesto) Idempotency key por mensaje del cliente |
| Escritura persistente + difusión | Difusión repetida | (propuesto) `revision` monotónica por sala; el cliente descarta revisiones viejas |

### 1.4 Límites de IA

Bedrock se invoca únicamente desde NestJS; el navegador nunca lo alcanza ni recibe credenciales del proveedor. En el MVP el bot es de **solo lectura**, incluso ante un pedido explícito de escritura (RF-BOT-004); acciones de negocio son Evolución. Toda consulta y respuesta del modelo pasa por las mismas reglas de autorización que una petición humana y no puede ampliar el alcance de datos del usuario. Si el proveedor falla o excede el tiempo de espera, el repaso diario degrada a un resumen estructurado sin generación de texto. Los límites numéricos de consumo siguen sin definirse. Los resúmenes personales se entregan al usuario destinatario, no se difunden a toda la habitación.

### 1.5 Qué nunca se persiste

Posición por fotograma, posiciones transitorias, estados interpolados de avatares, conexiones activas y presencia. Estos datos viven en la memoria de Colyseus y se reconstruyen al reconectar. Si el diseño propone una tabla para ellos, el diseño está mal.

---

← [Secuencias de administración (S8 a S13)](../04-behavioral/admin-flows.md) · [Índice](../README.md) · [Huecos declarados](./gaps.md) →

## 2. Tiempo y alcance de datos

America/Argentina/Buenos_Aires aplica al producto completo para presentación, programación local y reglas por día; no convierte una fecha sin hora en un instante. El servidor decide vencimientos y plazos. Ver [Data and time](../../../rules/data-and-time.md). Toda lectura/escritura distingue oficina activa, membresía activa y acceso de habitación. La membresía sola no habilita contenidos de todas las habitaciones.
