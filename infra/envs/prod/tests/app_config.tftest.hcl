mock_provider "aws" {
  # The mock returns random strings for ARNs; runtime_access validates the bucket ARN
  # format, so the bucket ARN is pinned to a well-formed value.
  override_resource {
    target = module.storage.aws_s3_bucket.this
    values = {
      arn = "arn:aws:s3:::aula-virtual-prod-files-20260101000000000000000001"
    }
  }

  # The mock returns a random string for data source JSON, so the ECR lifecycle
  # policy document is pinned to a well-formed value (see infra/README.md CI checks).
  override_data {
    target = module.registry.data.aws_ecr_lifecycle_policy_document.this
    values = {
      json = "{\"rules\":[]}"
    }
  }
}

variables {
  project                 = "aula-virtual"
  allowed_origins         = ["https://app.example.com"]
  password_reset_url_base = "https://app.example.com/reset-password"
}

run "three_generated_secrets_with_expected_names" {
  command = apply

  assert {
    condition     = toset(keys(module.app_config.secret_arns)) == toset(["INTERNAL_SERVICE_SECRET", "JWT_SECRET", "INVITATION_TOKEN_KEY"])
    error_message = "There must be exactly three secrets keyed by the env var name they feed."
  }

  assert {
    condition     = module.app_config.secret_names["INTERNAL_SERVICE_SECRET"] == "aula-virtual-prod/internal-service-secret" && module.app_config.secret_names["JWT_SECRET"] == "aula-virtual-prod/jwt-secret" && module.app_config.secret_names["INVITATION_TOKEN_KEY"] == "aula-virtual-prod/invitation-token-key"
    error_message = "Secret names must be <name_prefix>/<kebab-case env var name>."
  }

  assert {
    condition     = alltrue([for s in module.app_config.secret_settings : s.recovery_window_in_days == 7])
    error_message = "Every secret must set a 7 day recovery window explicitly."
  }

  assert {
    condition     = alltrue([for s in module.app_config.secret_settings : length(s.description) > 0])
    error_message = "Every secret must have a description."
  }

  assert {
    condition     = toset(keys(output.app_secret_arns)) == toset(["INTERNAL_SERVICE_SECRET", "JWT_SECRET", "INVITATION_TOKEN_KEY"])
    error_message = "The root must expose the secret ARNs keyed by env var name."
  }
}

run "ssm_parameters_hold_non_secret_config" {
  command = apply

  assert {
    condition     = toset(keys(module.app_config.parameters)) == toset(["api/ALLOWED_ORIGINS", "api/PASSWORD_RESET_URL_BASE", "api/NODE_ENV", "api/S3_REGION", "api/S3_BUCKET", "api/REALTIME_INTERNAL_URL", "realtime/API_INTERNAL_URL", "realtime/NODE_ENV"])
    error_message = "The config parameters must be exactly the non-secret api and realtime settings (DATABASE_URL is built on the host)."
  }

  assert {
    condition     = alltrue([for p in module.app_config.parameters : p.type == "String"])
    error_message = "Config parameters must be plain String (secrets live in Secrets Manager)."
  }

  assert {
    condition     = module.app_config.parameters["api/ALLOWED_ORIGINS"].name == "/aula-virtual-prod/config/api/ALLOWED_ORIGINS" && module.app_config.parameters["realtime/API_INTERNAL_URL"].name == "/aula-virtual-prod/config/realtime/API_INTERNAL_URL"
    error_message = "Parameter names must be /<name_prefix>/config/<service>/<ENV_NAME>."
  }

  assert {
    condition     = module.app_config.parameters["api/ALLOWED_ORIGINS"].value == "https://app.example.com" && module.app_config.parameters["api/PASSWORD_RESET_URL_BASE"].value == "https://app.example.com/reset-password"
    error_message = "ALLOWED_ORIGINS and PASSWORD_RESET_URL_BASE must come from the root variables."
  }

  assert {
    condition     = module.app_config.parameters["api/NODE_ENV"].value == "production" && module.app_config.parameters["realtime/NODE_ENV"].value == "production" && module.app_config.parameters["api/S3_REGION"].value == "us-east-2" && module.app_config.parameters["api/REALTIME_INTERNAL_URL"].value == "http://realtime:2567" && module.app_config.parameters["realtime/API_INTERNAL_URL"].value == "http://api:3000"
    error_message = "Fixed parameters must match the production Compose topology and region."
  }

  assert {
    condition     = toset(keys(module.app_config.parameter_arns)) == toset(["api", "realtime"]) && alltrue([for s in ["api", "realtime"] : length(module.app_config.parameter_arns[s]) == length([for k in keys(module.app_config.parameters) : k if startswith(k, "${s}/")])])
    error_message = "Parameter ARNs must be grouped per service."
  }

  assert {
    condition     = module.app_config.parameter_path_prefixes == { api = "/aula-virtual-prod/config/api", realtime = "/aula-virtual-prod/config/realtime" } && output.app_config_parameter_path_prefixes == module.app_config.parameter_path_prefixes
    error_message = "Each service must have its own parameter path prefix, exposed by the root."
  }
}

run "allowed_origins_are_comma_joined" {
  command = plan

  variables {
    allowed_origins = ["https://app.example.com", "https://admin.example.com"]
  }

  assert {
    condition     = module.app_config.parameters["api/ALLOWED_ORIGINS"].value == "https://app.example.com,https://admin.example.com"
    error_message = "Multiple origins must be joined with commas, the format the API parses."
  }
}

run "realtime_only_gets_internal_service_secret" {
  command = apply

  assert {
    condition     = toset(keys(module.app_config.service_secret_arns)) == toset(["api", "realtime"])
    error_message = "Secret ARNs must be grouped per service."
  }

  assert {
    condition     = keys(module.app_config.service_secret_arns["realtime"]) == ["INTERNAL_SERVICE_SECRET"]
    error_message = "realtime must only receive INTERNAL_SERVICE_SECRET."
  }

  assert {
    condition     = toset(keys(module.app_config.service_secret_arns["api"])) == toset(["INTERNAL_SERVICE_SECRET", "JWT_SECRET", "INVITATION_TOKEN_KEY"])
    error_message = "api must receive all three secrets."
  }

  assert {
    condition     = output.app_service_secret_arns == module.app_config.service_secret_arns
    error_message = "The root must expose the per-service secret map."
  }
}

run "static_scan_keeps_secret_values_out_of_terraform" {
  command = plan

  # Secret values are generated and loaded by infra/scripts/seed-app-secrets.sh, so no
  # Terraform file may create a version, an ephemeral generator or a secret string.
  # The var.project != "" terms give each assertion a reference to the configuration;
  # Terraform rejects conditions that only call file functions on constants.
  assert {
    condition     = var.project != "" && length(fileset("../../modules/app_config", "*.tf")) > 0 && length(fileset("../../envs/prod", "*.tf")) > 0
    error_message = "The static scan found no .tf files; check the relative paths."
  }

  assert {
    condition = var.project != "" && length([
      for f in concat([for m in fileset("../../modules", "*/*.tf") : "../../modules/${m}"], [for e in fileset("../../envs", "*/*.tf") : "../../envs/${e}"]) : f
      if can(regex("(?m)^[[:space:]]*(resource[[:space:]]+\"aws_secretsmanager_secret_version\"|ephemeral[[:space:]]+\"|secret_string(_wo)?(_version)?[[:space:]]*=)", file(f)))
    ]) == 0
    error_message = "No Terraform file may create a secret version, an ephemeral resource or a secret string; the seed script loads values."
  }

  assert {
    condition     = var.project != "" && !can(regex("random_password|secret_string", file("../../modules/app_config/outputs.tf"))) && !can(regex("random_password|secret_string", file("outputs.tf")))
    error_message = "No output may reference a generated password or a secret string."
  }

  assert {
    condition     = var.project != "" && length(regexall("(?m)^variable \"([a-z_]*_)?(secret|password|key|token)(_value|_string)?\"", file("../../modules/app_config/variables.tf"))) == 0 && length(regexall("(?m)^variable \"([a-z_]*_)?(secret|password|key|token)(_value|_string)?\"", file("variables.tf"))) == 0
    error_message = "No secret value may be a Terraform variable."
  }

  assert {
    condition     = var.project != "" && length(regexall("seed-app-secrets[.]sh", file("../../modules/app_config/secrets.tf"))) >= 1
    error_message = "secrets.tf must point to the seed script that loads the values."
  }
}

run "rejects_empty_allowed_origins" {
  command = plan

  variables {
    allowed_origins = []
  }

  expect_failures = [var.allowed_origins]
}

run "rejects_http_allowed_origin" {
  command = plan

  variables {
    allowed_origins = ["http://app.example.com"]
  }

  expect_failures = [var.allowed_origins]
}

run "rejects_allowed_origin_with_path" {
  command = plan

  variables {
    allowed_origins = ["https://app.example.com/app"]
  }

  expect_failures = [var.allowed_origins]
}

run "rejects_http_password_reset_url_base" {
  command = plan

  variables {
    password_reset_url_base = "http://app.example.com/reset-password"
  }

  expect_failures = [var.password_reset_url_base]
}

run "rejects_password_reset_url_base_with_query" {
  command = plan

  variables {
    password_reset_url_base = "https://app.example.com/reset-password?x=1"
  }

  expect_failures = [var.password_reset_url_base]
}

run "rejects_password_reset_url_base_with_fragment" {
  command = plan

  variables {
    password_reset_url_base = "https://app.example.com/reset-password#x"
  }

  expect_failures = [var.password_reset_url_base]
}

run "rejects_invalid_module_name_prefix" {
  command = plan

  module {
    source = "../../modules/app_config"
  }

  variables {
    name_prefix             = "Bad_Prefix"
    region                  = "us-east-2"
    s3_bucket_name          = "aula-virtual-prod-files-abc123"
    allowed_origins         = ["https://app.example.com"]
    password_reset_url_base = "https://app.example.com/reset-password"
  }

  expect_failures = [var.name_prefix]
}
