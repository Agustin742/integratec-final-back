# Diagramas de Arquitectura y Diseño — IntegrarTEC 2026

> **Directorio de arquitectura de diseño** · Plataforma de salas de convivencia y organización  
> **Estado:** baseline de diseño v0.5 (organización modular en vistas arquitectónicas, 100% compatible con GitHub Mermaid)  
> **Última actualización:** 25 de octubre de 2026

---

## 1. Organización de las Vistas de Arquitectura

El diseño se organiza en carpetas temáticas para facilitar su lectura progresiva, desde la visión funcional de negocio hasta los detalles de implementación y secuencias temporales:

```mermaid
flowchart TD
  subgraph F["01-functional (Vista Funcional)"]
    direction LR
    UC["use-cases.md<br/>Casos de uso y permisos"]
  end
  subgraph S["02-system-architecture (Vista de Sistemas)"]
    direction LR
    DEP["deployment-and-network.md<br/>Topología AWS y Canales"]
    RT["realtime-colyseus.md<br/>WebSocket y Consistencia"]
  end
  subgraph E["03-structural (Vista Estructural)"]
    direction LR
    DM["data-model.md<br/>Modelo Relacional ER"]
    CL["class-design.md<br/>Clases y Guards"]
  end
  subgraph B["04-behavioral (Vista Dinámica)"]
    direction LR
    SC["core-flows.md<br/>Secuencias S1 a S7"]
    SA["admin-flows.md<br/>Secuencias S8 a S12"]
  end
  subgraph R["05-reference (Referencia)"]
    direction LR
    CV["conventions.md<br/>Códigos y Reglas"]
    GP["gaps.md<br/>27 Huecos Declarados"]
  end

  F --> S
  S --> E
  E --> B
  B -.-> R
```

### Índice General

| Módulo / Vista | Contenido | Archivos |
|---|---|---|
| [**01. Funcional**](./01-functional/README.md) | Actores (Miembro, Moderador, Admin), diagrama general de casos de uso y matriz de permisos por rol | [use-cases.md](./01-functional/use-cases.md) |
| [**02. Sistemas y Red**](./02-system-architecture/README.md) | Topología AWS (Amplify, ALB, ECS, RDS, S3, Bedrock), canales REST/WSS y ciclo Colyseus | [deployment-and-network.md](./02-system-architecture/deployment-and-network.md) · [realtime-colyseus.md](./02-system-architecture/realtime-colyseus.md) |
| [**03. Estructural**](./03-structural/README.md) | Diagrama entidad-relación de PostgreSQL (Prisma) y arquitectura de clases/guards en NestJS y React | [data-model.md](./03-structural/data-model.md) · [class-design.md](./03-structural/class-design.md) |
| [**04. Dinámica**](./04-behavioral/README.md) | Interacciones temporales: flujos principales (S1-S7) y flujos de administración/moderación (S8-S12) | [core-flows.md](./04-behavioral/core-flows.md) · [admin-flows.md](./04-behavioral/admin-flows.md) |
| [**05. Referencia**](./05-reference/README.md) | Convenciones de errores, orden obligatorio de validación y matriz de seguimiento de huecos | [conventions.md](./05-reference/conventions.md) · [gaps.md](./05-reference/gaps.md) |

---

## 2. Lectura según el Objetivo

| Si tu objetivo es... | Rutas y diagramas recomendados | Qué obtendrás |
|---|---|---|
| **Definir alcance y roles** | [01-functional/use-cases.md](./01-functional/use-cases.md) | Cuáles son las capacidades exactas de Miembro, Moderador y Admin. |
| **Diseñar base de datos** | [03-structural/data-model.md](./03-structural/data-model.md) | Estructura de tablas, claves foráneas, enums e invariantes para Prisma. |
| **Implementar endpoints / WebSocket** | [02-system-architecture](./02-system-architecture/README.md) y [04-behavioral](./04-behavioral/README.md) | Qué llamadas son REST, qué eventos viajan por WSS y el orden de ejecución. |
| **Escribir pruebas de seguridad (R2)** | [01-functional/use-cases.md](./01-functional/use-cases.md) y [05-reference/conventions.md](./05-reference/conventions.md) | Escenarios que deben devolver 401 (sin sesión) y 403 (rol insuficiente). |
| **Preparar la defensa técnica (R8)** | [02-system-architecture/deployment-and-network.md](./02-system-architecture/deployment-and-network.md) y [04-behavioral/core-flows.md](./04-behavioral/core-flows.md) | Explicación clara de la separación de responsabilidades y flujo integral. |

---

## 3. Principios de Consistencia de los Diagramas

1. **Mermaid como Fuente Única:** Todos los diagramas son código Mermaid en archivos Markdown, renderizados automáticamente por GitHub sin depender de herramientas externas.
2. **Autoridad Única:** NestJS y PostgreSQL son la autoridad exclusiva de los datos persistentes (usuarios, salas, tareas, chat). Colyseus gestiona únicamente estado efímero en memoria (presencia y movimiento).
3. **Regla de Escritura y Difusión:** El cliente envía las acciones persistentes por HTTPS REST a NestJS; una vez confirmada la escritura en RDS, NestJS notifica a Colyseus para que difunda el evento a la sala.

---

## 4. Fuentes y Mantenimiento

- **Documento Maestro:** [master-document.md](../../master-document.md) es la fuente de verdad del producto. Los diagramas ilustran su arquitectura objetivo.
- **Reglas del Proyecto:** Las especificaciones de [rules/security.md](../../rules/security.md) y [rules/project-requirements.md](../../rules/project-requirements.md) son de cumplimiento mandatorio.
- **Actualización:** Cuando una decisión de código altere un contrato o resuelva un ítem de [05-reference/gaps.md](./05-reference/gaps.md), el PR correspondiente debe actualizar el diagrama asociado.
