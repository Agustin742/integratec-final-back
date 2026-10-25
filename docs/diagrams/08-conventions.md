# Convenciones transversales

> Códigos de error, orden de verificación, idempotencia y límites de IA. Parte del [índice de diagramas](./README.md).

**En este archivo**

- [1. Convenciones transversales](#1-convenciones-transversales)
  - [1.1 Códigos de error](#11-códigos-de-error)
  - [1.2 Orden obligatorio de verificación](#12-orden-obligatorio-de-verificación)
  - [1.3 Idempotencia y duplicados](#13-idempotencia-y-duplicados)
  - [1.4 Límites de IA](#14-límites-de-ia)
  - [1.5 Qué nunca se persiste](#15-qué-nunca-se-persiste)

← [Secuencias de administración (S8 a S12)](./07-sequences-admin.md) · [Índice](./README.md) · [Huecos declarados](./09-gaps.md) →

---

## 1. Convenciones transversales

Estas reglas aplican a todos los diagramas anteriores. Si un diagrama las contradice, el diagrama está mal, no la regla.

### 1.1 Códigos de error

| Código | Cuándo | Dónde |
|---|---|---|
| `401` | Falta la autenticación o la sesión está vencida o revocada | Todo endpoint HTTP protegido y el handshake de Colyseus |
| `403` | Hay identidad válida pero falta el permiso sobre el recurso o la sala | Endpoints con `RoomMembershipGuard`; rechazo de handshake |
| `409` | (propuesto) Conflicto de unicidad, por ejemplo email ya registrado o marcador diario existente | Alta de usuario; repaso diario |
| `422` | (propuesto) DTO válido en forma pero inválido en regla de negocio | Validación con Zod después de los guards |
| `429` | (propuesto) Límite de consumo de IA excedido | Endpoints del bot |

Solo `401` y `403` están definidos en la fuente. El resto es propuesta y debe confirmarse antes de implementar el manejador global de errores.

### 1.2 Orden obligatorio de verificación

Todo endpoint protegido ejecuta, en este orden: **autenticación → autorización sobre la sala → validación del DTO → escritura**. Ningún guard ni validación es opcional, y ninguno se reemplaza por un control en el cliente. El cliente puede ocultar un botón; el servidor debe rechazar la operación igual.

### 1.3 Idempotencia y duplicados

| Operación | Riesgo | Mecanismo |
|---|---|---|
| Repaso diario del bot | Dos repasos el mismo día | Constraint único (`userId`, `deliveryDate`) con inserción atómica; solo el proceso que gana continúa |
| Alta de usuario | Dos cuentas con el mismo email | Índice único normalizado en minúsculas |
| Mensaje de chat | Duplicado por reintento | (propuesto) Idempotency key por mensaje del cliente |
| Escritura persistente + difusión | Difusión repetida | (propuesto) `revision` monotónica por sala; el cliente descarta revisiones viejas |

### 1.4 Límites de IA

Bedrock se invoca únicamente desde NestJS; el navegador nunca lo alcanza ni recibe credenciales del proveedor. Toda respuesta del modelo pasa por las mismas reglas de autorización que una petición humana y no puede ampliar el alcance de datos del usuario. Si el proveedor falla o excede el tiempo de espera, el repaso diario degrada a un resumen estructurado sin generación de texto. Los límites numéricos de consumo siguen sin definirse.

### 1.5 Qué nunca se persiste

Posición por fotograma, posiciones transitorias, estados interpolados de avatares, conexiones activas y presencia. Estos datos viven en la memoria de Colyseus y se reconstruyen al reconectar. Si el diseño propone una tabla para ellos, el diseño está mal.

---

← [Secuencias de administración (S8 a S12)](./07-sequences-admin.md) · [Índice](./README.md) · [Huecos declarados](./09-gaps.md) →
