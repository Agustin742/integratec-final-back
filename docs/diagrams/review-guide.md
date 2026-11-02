# Cómo revisar la alineación de diagramas

Los diagramas de esta carpeta se alinearon al modelo de escuelas y aulas y a las decisiones D1 a D6 del 2026-11-02 (pendientes de aprobación del equipo). La revisión se hace sobre la rama de trabajo y se entrega con commits por tema; ningún merge ocurre sin aprobación humana.

## Orden de revisión

| Paso | Vista | Qué mirar |
|---|---|---|
| 1 | [01 Funcional](./01-functional/use-cases.md) | Actores Dueño / Admin de Escuela, Profesor, Alumno y Padre; IDs RF/RN vigentes de la [ERS](../functional-requirements.md) |
| 2 | [03 Estructural](./03-structural/data-model.md) | Entidades `School`, `SchoolMember`, `Classroom`, `ClassroomMembership`, `ParentLink`; exclusión escuela / profesor independiente |
| 3 | [02 Sistemas](./02-system-architecture/deployment-and-network.md) | Topología AWS en `sa-east-1`, `onAuth` contra NestJS (D2), puntos marcados como abiertos |
| 4 | [04 Dinámica](./04-behavioral/core-flows.md) | Secuencias S1 a S13 coherentes con arquitectura y modelo |
| 5 | [05 Referencia](./05-reference/gaps.md) | Huecos abiertos con su regla de origen |

## Qué confirmar

- La [ERS](../functional-requirements.md) y sus RF/RN gobiernan el comportamiento; las [reglas](../../rules/README.md) y la [justificación técnica](../technical-justification.md) gobiernan lo técnico.
- Escuela, aula, membresía y autoridad docente no se confunden: el Dueño y el Admin tienen autoridad docente por su membresía de escuela (RN-03).
- Recursos ajenos responden `404`; el Padre no ingresa al aula 3D; Colyseus no accede a la base.
- Los puntos que las reglas dejan abiertos están rotulados **abierto** o **propuesto**, no decididos por estar dibujados.
- No hay esquemas Prisma, endpoints, guards ni infraestructura aprobados simplemente por estar dibujados.

## Verificación y límites

- `python scripts/ci/check_docs.py` comprueba enlaces internos y estructura de los documentos.
- `git diff --check` comprueba whitespace.
- **No verificado:** render visual y gramática de Mermaid con un renderer; no hay código de aplicación ni despliegue que probar. Los comandos locales están en el [README](../../README.md#ci).

## Próximo paso del equipo

Revisar el PR, comprobar CI y la representación Mermaid, aprobar o ajustar D1 a D6 y obtener aprobación de otro integrante antes de cualquier merge.
