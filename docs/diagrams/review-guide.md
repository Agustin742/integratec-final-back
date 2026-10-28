# Cómo revisar la alineación de diagramas

La actualización conserva los commits originales del PR #4 y los alinea con la ERS de Luis. Se entrega mediante **un único PR desde `docs/diagram-alignment-04-handoff` hacia `develop`**, con commits por tema para facilitar la revisión. Alejo aceptó el diff amplio para evitar administrar PRs intermedios. No se modifica la rama del compañero ni se integra nada sin aprobación humana; Alejo se encarga del cierre del PR #4.

## Orden de revisión

El PR completo se compara con `develop`. Para revisar por partes se pueden recorrer los commits o comparar las ramas locales de la tabla con su padre inmediato; estas ramas son ayudas de revisión, **no PRs hijos que deban publicarse o mergearse**. `docs/diagram-alignment` parte de `develop` e incorpora la historia original de `docs/proyect-diagrams` mediante el merge `2a9c4e6`, preservando la atribución original. No significa que el PR #4 haya sido aprobado o mergeado en GitHub.

| Paso | Rama local | Base de comparación | Commit / alcance | Líneas añadidas + eliminadas |
|---|---|---|---|---|
| 1 | `docs/diagram-alignment-01-sources` | `docs/diagram-alignment` | `d0e1380`: fuentes y decisiones | 113 |
| 2 | `docs/diagram-alignment-02-domain` | `docs/diagram-alignment-01-sources` | `540734b`: casos de uso y permisos | 278 |
| 3 | `docs/diagram-alignment-02-model` | `docs/diagram-alignment-02-domain` | `4a8741e`: entidades y responsabilidades | 279 |
| 4 | `docs/diagram-alignment-03-flows` | `docs/diagram-alignment-02-model` | `aa9ffc5`: arquitectura y canales | 109 |
| 5 | `docs/diagram-alignment-03-core` | `docs/diagram-alignment-03-flows` | `ab1c902`: secuencias núcleo | 103 |
| 6 | `docs/diagram-alignment-03-admin` | `docs/diagram-alignment-03-core` | `d2df521`: administración y ciclo de oficina | 254 |
| 7 | `docs/diagram-alignment-03-reference` | `docs/diagram-alignment-03-admin` | `2e88b82`: referencias y decisiones resueltas | 218 |
| 8 | `docs/diagram-alignment-04-handoff` | `docs/diagram-alignment-03-reference` | Guía y registro de verificación local | Consultar diff del corte |

```text
 develop
  └─ docs/diagram-alignment (historia original preservada)
      └─ 01-sources
          └─ 02-domain
              └─ 02-model
                  └─ 03-flows
                      └─ 03-core
                          └─ 03-admin
                              └─ 03-reference
                                  └─ 04-handoff (estado local completo)
```

Los nombres abreviados del dibujo corresponden al historial local de preparación. La rama final contiene todos los cortes y es la única rama que se publica para esta entrega. No se necesitan merges de ramas intermedias. El rollback de un corte corresponde a sus documentos modificados; no exige reescribir la historia del compañero.

## Qué confirmar

- La [ERS](../functional-requirements.md) y sus RF/RN gobiernan el comportamiento; los supuestos P# permanecen visibles.
- La [conciliación posterior](../requirements-decision.md#confirmaciones-para-la-alineación-documental) sigue las [reglas integradas del PR #5](../../rules/README.md) y enlaza la [justificación técnica](../technical-justification.md). Se mantienen no transferencia y Three.js + R3F; zona horaria y respuestas se rigen por sus reglas específicas, incluidas las decisiones abiertas.
- Oficina, membresía, acceso y liderazgo no se confunden; la principal no es una sala general global.
- Tareas colaborativas y columnas configurables, canales de oficina/habitación, asistencia MVP y bot solo lectura coinciden entre vistas.
- Invitaciones pueden tener límite opcional de usos; expulsión conserva contenido; baja de oficina se recupera durante 15 días.
- No hay esquemas Prisma, endpoints, guards ni mecanismos de entrega aprobados simplemente por estar dibujados.

## Conciliación con el PR #5

El PR #5 ya fue integrado por el equipo. Su `develop` se incorpora solo a la rama del PR #6, preservando la historia de Agustín. Los cortes anteriores de la tabla son históricos: el estado vigente es el head del PR #6. Registro atómico, unicidad de entrega y hash de invitación son restricciones obligatorias, no propuestas. Métodos, campos y contratos concretos siguen propuestos donde las reglas los dejan abiertos. No se mergea el PR #6 a `develop`.

## Verificación observada y límites

En el estado de documentación alineada se observaron:

- **5 tests de tooling CI:** pasan. No son pruebas de una aplicación backend.
- **Enlaces internos Markdown:** pasan para 55 archivos tras incorporar la documentación del PR #5.
- **Whitespace:** se comprueba el diff completo contra `develop`, incluidos los documentos originales, para coincidir con el alcance real del PR y su CI.
- **Lectura estructural:** 24 bloques Mermaid en `docs/diagrams/` y conservación de las historias originales. La conciliación comprueba referencias a las reglas y decisiones abiertas sin confundirlas con propuestas; no es un parser de gramática Mermaid.

**No verificado:** render visual/gramática con Mermaid y validación local actionlint, porque esos ejecutables no están instalados. No se instalaron dependencias. No hay código de aplicación ni despliegue que probar como parte de esta actualización. Se corrigieron antes del cierre un enlace de ancla, whitespace nuevo y errores del script local de inspección; no quedan esos controles fallando. La primera inspección de llaves confundía cardinalidades ER con bloques y se corrigió para contar solo declaraciones.

Los comandos locales están en el [README](../../README.md#ci). El único PR apunta a `develop`, por lo que utiliza los triggers existentes de CI sin modificar el workflow. No se publican PRs con bases intermedias ni se asumen checks remotos aprobados antes de observar sus resultados.

## Próximo paso del equipo

Revisar el único PR hacia `develop`, comprobar CI y la representación Mermaid de su revisión final, y obtener aprobación de otro integrante antes de cualquier merge. La [tarjeta del Project backend](https://github.com/users/Agustin742/projects/3) contiene el avance y el vínculo del PR. Alejo cerrará el PR #4 como reemplazado; esta publicación no autoriza al agente a cerrarlo ni a mergear.
