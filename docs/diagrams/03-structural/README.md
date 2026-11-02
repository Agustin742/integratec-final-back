# Vista Estructural y de Datos

> Parte de la [documentación de diagramas](../README.md).

Esta carpeta contiene la **estructura estática del sistema** escolar: un modelo lógico propuesto para PostgreSQL (escuelas, aulas, actividades, puntos, comunicación y bot) y responsabilidades de capas. No es un esquema Prisma aprobado ni relevamiento de código existente.

## Documentos

| Archivo | Descripción | Contenido clave |
|---|---|---|
| [data-model.md](./data-model.md) | Modelo relacional ER | Diagramas ER de escuela, aula, actividades, entregas, puntos, comunicación, bot y métricas; cardinalidades, invariantes y decisiones abiertas. |
| [class-design.md](./class-design.md) | Diseño de clases por capa | Frontend (React/Three), Backend (NestJS controllers/services/guards/autorización compartida) y Realtime (Colyseus). |

## Navegación

[← Anterior: Arquitectura de Sistemas](../02-system-architecture/README.md) · [Índice Maestro](../README.md) · [Siguiente: Vista Dinámica →](../04-behavioral/README.md)
