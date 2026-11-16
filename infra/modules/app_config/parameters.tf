locals {
  # Non-secret runtime config, one SSM parameter per service and env var.
  # S3_BUCKET is added with the bucket itself; DATABASE_URL is built on the host from
  # the RDS master secret, so neither belongs here.
  config = {
    api = {
      ALLOWED_ORIGINS         = join(",", var.allowed_origins)
      PASSWORD_RESET_URL_BASE = var.password_reset_url_base
      NODE_ENV                = "production"
      # The bucket is created in the environment region, so reuse it instead of a second knob.
      S3_REGION             = var.region
      REALTIME_INTERNAL_URL = "http://realtime:2567"
    }
    realtime = {
      API_INTERNAL_URL = "http://api:3000"
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
