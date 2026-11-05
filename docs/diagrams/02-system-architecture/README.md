# Vista de Arquitectura de Sistemas y Comunicación

> Parte de la [documentación de diagramas](../README.md).

Esta carpeta propone la **infraestructura en la nube, límites de proceso y protocolos de comunicación** entre el frontend y los servicios backend.

## Documentos

| Archivo | Descripción | Contenido clave |
|---|---|---|
| [deployment-and-network.md](./deployment-and-network.md) | Topología física y red | Diagrama de infraestructura AWS en `us-east-2` (Amplify, ALB, ECR, ECS Fargate, RDS PostgreSQL, S3, Secrets Manager, Bedrock, GitHub OIDC), matriz de canales REST vs WSS, flujo de acceso a escuelas y aulas y puntos abiertos de infraestructura. |
| [realtime-colyseus.md](./realtime-colyseus.md) | Comunicación WebSocket / Colyseus | Ciclo de conexión con `onAuth` contra NestJS (D2), catálogo de eventos por aula, controles de aula, regla de consistencia y autoridad de datos, y decisiones abiertas de realtime. |

## Navegación

[← Anterior: Vista Funcional](../01-functional/README.md) · [Índice Maestro](../README.md) · [Siguiente: Vista Estructural →](../03-structural/README.md)
