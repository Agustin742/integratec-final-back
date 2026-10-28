# Architecture and Module Boundaries

NestJS and Colyseus are separate responsibilities and, from the start, separate deployable services. This rule defines their boundaries and the integration that [master §6.1](../master-document.md#61-componentes) delegates here.

## Authority and scope

- [Master §5](../master-document.md#5-stack-y-responsabilidades-técnicas) and [§6](../master-document.md#6-arquitectura-general-actualizada) define the stack, components, and data ownership; [master §7](../master-document.md#7-integración-y-despliegue-en-aws) defines the deployment topology.
- Cross-repository contracts follow [API contracts](./api-contracts.md); their distribution mechanism is **open**.
- Unresolved choices follow [Documentation and decisions](./documentation-and-decisions.md). Contributors **MUST NOT** introduce a framework, queue, cache, or shared package as an incidental implementation choice.

## Services and ownership

| Service | Owns | Does not own |
|---|---|---|
| NestJS API | REST, authentication, sessions, authorization, business rules, persistence through Prisma, AI integration | Live room state, avatar positions |
| Colyseus server | Live room sessions, presence, avatar movement, ephemeral synchronized state | Persistent records, credentials, business rules |
| PostgreSQL (RDS) | Durable domain data | Presence, movement, connections |

- Every durable domain change **MUST** pass through NestJS and be committed to PostgreSQL before any realtime notification is emitted (persistence before broadcast).
- Colyseus **MUST NOT** read or write PostgreSQL directly. It obtains authorization and persistent data through NestJS application services.
- Colyseus **MUST NOT** promote ephemeral state to persistent state on its own, and **MUST NOT** act as a competing source of truth for tasks, messages, memberships, or any other durable record.
- Socket.IO **MUST NOT** be added by default and **MUST NOT** duplicate Colyseus synchronization; see [Realtime and presence](./realtime-and-presence.md).
- The browser **MUST** reach AI and storage services only through NestJS.

## Integration between NestJS and Colyseus

Both directions are internal, server-to-server contracts. The concrete transport is **open** and **MUST** be recorded as a decision before implementation.

| Direction | Purpose | Requirements |
|---|---|---|
| Colyseus to NestJS | Verify the caller's identity and access to an office and room before admission, and re-verify when access may have changed | The answer **MUST** come from current persisted state, never from client-supplied claims |
| NestJS to Colyseus | Announce a change already committed (for example a task or message) so connected clients can update | **MUST** be sent only after the database commit; failure **MUST NOT** roll back the committed change |

- Internal endpoints or channels **MUST NOT** be reachable from the public internet or routed by the public load balancer. They **MUST** authenticate the calling service with a credential injected through secure configuration; see [Configuration](./configuration-and-environments.md) and [AWS infrastructure](./aws-infrastructure.md).
- A lost notification **MUST** be recoverable: REST remains the source of truth and clients reconcile through it.
- Events and payloads are illustrative until agreed ([master §6.2](../master-document.md#62-canales-y-propiedad-de-los-datos)); names, payloads, and acknowledgements **MUST** be specified under [API contracts](./api-contracts.md) before consumers rely on them.

## Module boundaries inside NestJS

- Code **SHOULD** be organized by domain capability (for example authentication, offices, rooms, tasks, communication, meetings, bot), each exposing a narrow service interface to the others.
- A module **MUST NOT** query another module's tables directly; it **MUST** call that module's service.
- Controllers **MUST** adapt transport and validation only; authorization and business rules **MUST** live in services so REST, Colyseus-driven checks, and bot tools share one implementation.
- Request and response shapes **MUST** use explicit DTOs; persistence entities **MUST NOT** be returned directly. See [Security](./security.md) and [Data](./data.md).
- Bot tools **MUST** call the same services as REST endpoints and inherit the calling user's authorization; see [AI bot and daily briefing](./ai-bot-and-daily-briefing.md).
- Whether both services live in one workspace, share a contracts package, or are separate packages inside this repository is **open**.

## Failure and verification

- NestJS **MUST** remain correct when Colyseus is down; Colyseus **MUST** reject joins when NestJS cannot verify authorization rather than admit unverified users.
- A change **MUST** identify the owning service, its external boundaries, and how resources (connections, timers, subscriptions) are released.
- Verification follows [Quality and testing](./quality-and-testing.md) and includes at least one test that a Colyseus-side action cannot bypass NestJS authorization.

## Open decisions

- Internal transport and service-to-service authentication mechanism between NestJS and Colyseus.
- Repository and package layout for the two services and any shared contracts.
- Contract distribution between frontend and backend ([API contracts](./api-contracts.md)).
