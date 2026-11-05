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
| Public entry | Caddy reverse proxy on the EC2 host | Terminates TLS with automatic Let's Encrypt certificates; redirects HTTP to HTTPS; routes API paths to NestJS and the reserved path or host to Colyseus with WebSocket upgrade; the only public listener (decision D13, see [Technical justification](../docs/technical-justification.md#d13-production-compute-on-a-single-ec2-host)) |
| Compute | One EC2 host (`t3.small`, Amazon Linux 2023) running Docker Compose | Containers `caddy`, `api` (NestJS), and `realtime` (Colyseus); Lambda **MUST NOT** host Colyseus rooms |
| Images | ECR | Versioned images per service, published by CI and pulled by the host |
| Database | RDS for PostgreSQL | Private subnets; reachable only from authorized services |
| AI | Amazon Bedrock | Invoked from NestJS only |
| Objects | S3 | Access controlled from the backend; bucket not public by default |
| Secrets | Secrets Manager | Read by the host at deploy or start and injected into containers as environment variables |
| Observability | CloudWatch | Logs, metrics, and alarms |
| Cost control | AWS Budgets | Budget and alert thresholds |

## Region

- The environment is hosted in `us-east-2` (US East, Ohio). AWS assigns this Region to the account by contact country and denies other Regions through managed service control policies, so it cannot be changed; higher latency from Argentina is an accepted trade-off (decision D5, updated and approved by Agustin on 2026-11-04; see [Technical justification](../docs/technical-justification.md#d5-aws-region)).

## Network and access

- The VPC has one public subnet for the EC2 host and private subnets in at least two Availability Zones for the RDS DB subnet group. There is no NAT gateway, no load balancer, and no ACM certificate.
- RDS **MUST** be in private subnets with no public access. Its security group **MUST** allow inbound connections only from the EC2 host security group on port 5432. Only the NestJS container (and any migration task) uses the database credentials.
- Colyseus **MUST NOT** have network access or credentials to the database; it reaches persisted data through NestJS ([Architecture](./architecture.md)). Its calls to the internal NestJS endpoint use a service secret from Secrets Manager.
- The host security group **MUST** allow inbound traffic only on ports 443 and 80, and **MUST NOT** open SSH. Administration uses SSM Session Manager. Only Caddy publishes host ports; `api` and `realtime` listen on the private Docker network. The internal NestJS and Colyseus channel stays on that network and **MUST NOT** be routed by Caddy.
- The host uses an Elastic IP (a public IPv4 address has an hourly charge). Let's Encrypt needs a DNS name that points to it; see the open decisions.
- Production traffic **MUST** use HTTPS and WSS. CORS and allowed origins follow [Security](./security.md).
- Container health checks **MUST** target a lightweight endpoint per service and **MUST NOT** be presented as proof of a working user flow.
- Colyseus runs as one container for the MVP; horizontal scaling is a decision, not a default ([Realtime and presence](./realtime-and-presence.md)). WebSocket idle timeouts in Caddy **MUST** be set deliberately and documented.
- The single host is a single point of failure for the API and realtime. Recovery is to re-provision the host from Terraform and redeploy; data is protected by RDS automated backups (decision D13).

## Identity and secrets

- The EC2 instance profile **MUST** grant least privilege: pulling from ECR, reading the specific Secrets Manager secrets, writing CloudWatch Logs, SSM, and later invoking the selected Bedrock models. Wildcard actions and resources **MUST NOT** be used where the actions and resources are known.
- Containers share the instance role, so the separation between NestJS and Colyseus is by credentials, not by IAM: the database credentials and Bedrock calls belong to NestJS only, and Colyseus receives only its own service secret. Per-service IAM roles would need separate hosts or a return to a container orchestrator.
- Secrets and connection strings **MUST** come from Secrets Manager or equivalent secure injection, never from images, Git, or logs. Long-lived access keys **MUST NOT** be used by services.
- Terraform and pipeline roles **MUST** stay separate from the instance profile.
- Humans **SHOULD** use individual identities with limited permissions; shared root credentials **MUST NOT** be used.

## Delivery

- Each repository **MUST** own its pipeline. Backend CI builds and publishes images to ECR, and the deploy stage runs `docker compose up -d` on the host through SSM Run Command followed by a health check; release evidence follows [Deployment and operations](./deployment-and-operations.md).
- Images **MUST** be reproducible from a commit and tagged with an immutable identifier, not only `latest`.
- Pipeline credentials **MUST** use GitHub Actions OIDC federation to an IAM role; long-lived IAM user access keys **MUST NOT** be stored in GitHub Secrets (decision D6, approved by Agustin on 2026-11-02; see [Technical justification](../docs/technical-justification.md#d6-pipeline-authentication-to-aws)).
- Database migrations in deployment **MUST** follow the plan required by [Data](./data.md).

## Observability and cost

- Services **MUST** emit structured logs to CloudWatch through the Docker `awslogs` driver, without secrets or message content ([Observability and privacy](./observability-and-privacy.md)). Log retention **MUST** be set explicitly.
- Alarms **SHOULD** cover EC2 status checks and CPU, container health, restart loops, error rates, and RDS availability.
- The EC2 host, its Elastic IP, and RDS incur fixed cost, far lower than the previous Fargate, ALB, and NAT design (decision D13). A budget with alerts **MUST** exist, and resources created for experiments **MUST** have a cleanup owner.
- Backup and point-in-time recovery for RDS **SHOULD** be enabled and the restore path documented.

## Verification

Evidence **MUST** identify the environment and deployed revision and confirm: external HTTPS and WSS access from another network, only ports 443 and 80 reachable on the host, database not publicly reachable, role permissions scoped, and secrets absent from images and repository. Unprovisioned items **MUST** be reported as not configured.

## Open decisions

- Exact routing (path versus host) for Colyseus in Caddy, and RDS instance sizing.
- Domain and DNS name for the Elastic IP, which Let's Encrypt requires; a free wildcard DNS name (for example sslip.io) is a candidate interim option, not decided. S3 usage is also open (uploads are not defined yet).
- Amazon Bedrock model: the Free plan does not support global or geographic cross-Region inference, so the bot **MUST** use a model with in-Region on-demand inference in `us-east-2` (to be checked in the console; see [D5](../docs/technical-justification.md#d5-aws-region)).
- Scaling strategy for Colyseus beyond one instance.
