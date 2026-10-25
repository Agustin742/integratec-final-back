# Vista de Arquitectura de Sistemas y Comunicación

> Parte de la [documentación de diagramas](../README.md).

Esta carpeta define la **infraestructura en la nube, límites de proceso y protocolos de comunicación** entre el frontend y los servicios backend.

## Documentos

| Archivo | Descripción | Contenido clave |
|---|---|---|
| [deployment-and-network.md](./deployment-and-network.md) | Topología física y red | Diagrama de infraestructura AWS (Amplify, ALB, ECS Fargate, RDS PostgreSQL, S3, Bedrock), matriz de canales REST vs WSS, y flujo de acceso a salas. |
| [realtime-colyseus.md](./realtime-colyseus.md) | Comunicación WebSocket / Colyseus | Ciclo de vida de conexión y reconexión, catálogo de eventos efímeros, y regla de consistencia y autoridad de datos. |

## Navegación

[← Anterior: Vista Funcional](../01-functional/README.md) · [Índice Maestro](../README.md) · [Siguiente: Vista Estructural →](../03-structural/README.md)
