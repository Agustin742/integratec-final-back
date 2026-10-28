# AWS Infrastructure

AWS hosts the chosen technologies; it does not replace them. This rule fixes the intended infrastructure constraints per [master §7](../master-document.md#7-integración-y-despliegue-en-aws). Nothing here claims the infrastructure already exists; see [Deployment and operations](./deployment-and-operations.md).

## Authority and scope

- Topology and service roles come from [master §7](../master-document.md#7-integración-y-despliegue-en-aws). Configuration and secrets follow [Configuration and environments](./configuration-and-environments.md); release, verification, and recovery follow [Deployment and operations](./deployment-and-operations.md). They are not repeated here.
- These resources **MUST** be defined and changed through Terraform as described in [Infrastructure as code](./infrastructure-as-code.md).
- Course requirement R4 requires public HTTPS, a cloud database, environment-based configuration, and availability until the defenses end ([project requirements](./project-requirements.md)).

## Services

| Concern | Service | Constraint |
|---|---|---|
| Frontend hosting | Amplify Hosting | Serves the static build over HTTPS; owned by the frontend repository |
| Public entry | Application Load Balancer with ACM certificate | Terminates TLS; routes API paths to NestJS and the reserved path or host to Colyseus; supports WebSocket upgrade |
| Compute | ECS on Fargate | Two persistent services (NestJS, Colyseus); Lambda **MUST NOT** host Colyseus rooms |
| Images | ECR | Versioned images per service, published by CI |
| Database | RDS for PostgreSQL | Private subnets; reachable only from authorized services |
| AI | Amazon Bedrock | Invoked from NestJS only |
| Objects | S3 | Access controlled from the backend; bucket not public by default |
| Secrets | Secrets Manager | Injected into tasks at runtime |
| Observability | CloudWatch | Logs, metrics, and alarms |
| Cost control | AWS Budgets | Budget and alert thresholds |

## Network and access

- RDS **MUST** be in private subnets with no public access. Its security group **MUST** allow inbound connections only from the NestJS service (and any migration task).
- Colyseus **MUST NOT** have network access or credentials to the database; it reaches persisted data through NestJS ([Architecture](./architecture.md)).
- Each ECS service **MUST** have its own security group. Services receive inbound traffic only from the load balancer, except the internal NestJS and Colyseus channel, which **MUST NOT** be exposed through the public listener.
- Production traffic **MUST** use HTTPS and WSS. CORS and allowed origins follow [Security](./security.md).
- ALB health checks **MUST** target a lightweight endpoint per service and **MUST NOT** be presented as proof of a working user flow.
- Colyseus runs as one task for the MVP; horizontal scaling is a decision, not a default ([Realtime and presence](./realtime-and-presence.md)). WebSocket idle timeouts and sticky behavior at the load balancer **MUST** be set deliberately and documented.

## Identity and secrets

- Each service **MUST** have a separate IAM task role granting least privilege. Wildcard actions and resources **MUST NOT** be used where the actions and resources are known.
- NestJS permissions are limited to: invoking the selected Bedrock models, reading its secrets, and accessing its S3 prefixes. Colyseus receives only what it needs, which excludes Bedrock and the database.
- Secrets and connection strings **MUST** come from Secrets Manager or equivalent secure injection, never from images, Git, or logs. Long-lived access keys **MUST NOT** be used by services.
- The execution role (pull image, write logs) **MUST** be separate from the task role.
- Humans **SHOULD** use individual identities with limited permissions; shared root credentials **MUST NOT** be used.

## Delivery

- Each repository **MUST** own its pipeline. Backend CI builds and publishes images to ECR and updates ECS; release evidence follows [Deployment and operations](./deployment-and-operations.md).
- Images **MUST** be reproducible from a commit and tagged with an immutable identifier, not only `latest`.
- Pipeline credentials **SHOULD** use short-lived federation rather than stored keys. This choice is **open**.
- Database migrations in deployment **MUST** follow the plan required by [Data](./data.md).

## Observability and cost

- Services **MUST** emit structured logs to CloudWatch without secrets or message content ([Observability and privacy](./observability-and-privacy.md)). Log retention **MUST** be set explicitly.
- Alarms **SHOULD** cover task health, restart loops, error rates, and database availability.
- Fargate, ALB, and RDS incur fixed cost. A budget with alerts **MUST** exist, and resources created for experiments **MUST** have a cleanup owner.
- Backup and point-in-time recovery for RDS **SHOULD** be enabled and the restore path documented.

## Verification

Evidence **MUST** identify the environment and deployed revision and confirm: external HTTPS and WSS access from another network, database not publicly reachable, role permissions scoped, and secrets absent from images and repository. Unprovisioned items **MUST** be reported as not configured.

## Open decisions

- Region, instance sizing, and the exact routing (path versus host) for Colyseus.
- Pipeline authentication to AWS.
- Domain, certificate ownership, and S3 usage (uploads are not defined yet).
- Scaling strategy for Colyseus beyond one instance.
