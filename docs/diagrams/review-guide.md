# Cómo revisar la alineación de diagramas

La actualización conserva los commits originales del PR #4 y los alinea con la ERS de Luis. Los cambios están en **ramas locales encadenadas**: no se publicaron ramas ni nuevos PRs, no se modificó la rama del compañero y no se integró nada a `develop`, `test` o `main`.

## Orden de revisión

Cada rama se compara con su padre inmediato, no con `main`. La rama de integración `docs/diagram-alignment` parte de `develop` e incorpora la historia original de `docs/proyect-diagrams` mediante el merge local `2a9c4e6`; eso preserva la atribución original. No significa que el PR #4 haya sido aprobado o mergeado en GitHub.

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

Los nombres abreviados del dibujo corresponden a las ramas completas de la tabla. No se deben mergear los hijos fuera de orden ni tratar cada rama como una implementación independiente. El rollback de un corte corresponde a sus documentos modificados; no exige reescribir la historia del compañero.

## Qué confirmar

- La [ERS](../functional-requirements.md) y sus RF/RN gobiernan el comportamiento; los supuestos P# permanecen visibles.
- [Propiedad, renderizado y zona horaria](../requirements-decision.md#confirmaciones-para-la-alineación-documental) reflejan las confirmaciones de Alejo: no transferencia, Three.js + R3F y Buenos Aires para todo el producto.
- Oficina, membresía, acceso y liderazgo no se confunden; la principal no es una sala general global.
- Tareas colaborativas y columnas configurables, canales de oficina/habitación, asistencia MVP y bot solo lectura coinciden entre vistas.
- Invitaciones pueden tener límite opcional de usos; expulsión conserva contenido; baja de oficina se recupera durante 15 días.
- No hay esquemas Prisma, endpoints, guards ni mecanismos de entrega aprobados simplemente por estar dibujados.

## Verificación observada y límites

En el estado de documentación alineada se observaron:

- **5 tests de tooling CI:** pasan. No son pruebas de una aplicación backend.
- **Enlaces internos Markdown:** pasan; el cierre añade esta guía a los documentos revisados.
- **Whitespace del diff de correcciones:** pasa; no se aplica retroactivamente a los documentos originales del PR.
- **Lectura estructural:** 24 bloques Mermaid, nueve comprobaciones de alineación y conservación de la ascendencia Git original. No es un parser de gramática Mermaid.

**No verificado:** render visual/gramática con Mermaid y validación local actionlint, porque esos ejecutables no están instalados. No se instalaron dependencias. No hay código de aplicación ni despliegue que probar como parte de esta actualización. Se corrigieron antes del cierre un enlace de ancla, whitespace nuevo y errores del script local de inspección; no quedan esos controles fallando. La primera inspección de llaves confundía cardinalidades ER con bloques y se corrigió para contar solo declaraciones.

Los comandos locales están en el [README](../../README.md#ci). La automatización actual solo se dispara para PRs a `develop`, `test` y `main`: **no se debe asumir CI automático para PRs hijos con otra base**. Su publicación requiere acordar cómo ejecutar y adjuntar esos controles, sin cambiar silenciosamente el workflow.

## Próximo paso del equipo

Revisar localmente o autorizar la publicación de la cadena, con sus bases y dependencias explícitas. Después verificar la representación Mermaid y obtener revisión humana antes de cualquier integración. La [tarjeta del Project backend](https://github.com/users/Agustin742/projects/3) contiene el avance y los vínculos; tener commits locales no equivale a entrega remota ni a aprobación del PR #4.
