locals {
  # Internal URLs use the Compose service names and container ports of the production
  # stack: realtime listens on 2567 and api on 3000 (Dockerfiles and the Compose file
  # added in T5). Change them together with those files.
  realtime_internal_url = "http://realtime:2567"
  api_internal_url      = "http://api:3000"

  # Non-secret runtime config, one SSM parameter per service and env var.
  # DATABASE_URL is built on the host from the RDS master secret, so it does not
  # belong here; the host builds it from the DB_* parameters below plus that secret.
  # DB_* are read by infra/deploy/start-app.sh only: compose.prod.yaml lists the api
  # environment explicitly, so these names never reach the containers.
  config = {
    api = {
      ALLOWED_ORIGINS         = join(",", var.allowed_origins)
      PASSWORD_RESET_URL_BASE = var.password_reset_url_base
      NODE_ENV                = "production"
      # The bucket is created in the environment region, so reuse it instead of a second knob.
      S3_REGION             = var.region
      S3_BUCKET             = var.s3_bucket_name
      REALTIME_INTERNAL_URL = local.realtime_internal_url
      DB_HOST               = var.db_host
      DB_PORT               = tostring(var.db_port)
      DB_NAME               = var.db_name
      DB_SECRET_ARN         = var.db_secret_arn
    }
    realtime = {
      API_INTERNAL_URL = local.api_internal_url
      NODE_ENV         = "production"
    }
  }

  path_prefixes = { for service, _ in local.config : service => "/${var.name_prefix}/config/${service}" }

  parameters = merge([
    for service, values in local.config : {
      for name, value in values : "${service}/${name}" => {
        service = service
        name    = "${local.path_prefixes[service]}/${name}"
        value   = value
      }
    }
  ]...)
}

resource "aws_ssm_parameter" "this" {
  for_each = local.parameters

  name  = each.value.name
  type  = "String"
  value = each.value.value

  tags = {
    Name = each.value.name
  }
}
