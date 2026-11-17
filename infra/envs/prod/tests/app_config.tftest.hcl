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

  # The mock leaves the managed master secret empty and returns random values for the
  # endpoint; app_config validates the database connection settings it publishes, so
  # the instance is pinned to well-formed values.
  override_resource {
    target = module.database.aws_db_instance.this
    values = {
      address = "aula-virtual-prod-db.abcdefghij.us-east-2.rds.amazonaws.com"
      port    = 5432
      master_user_secret = [{
        secret_arn    = "arn:aws:secretsmanager:us-east-2:123456789012:secret:rds!db-00000000-0000-0000-0000-000000000000-AbCdEf"
        kms_key_id    = "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000000"
        secret_status = "active"
      }]
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
    condition     = toset(keys(module.app_config.parameters)) == toset(["api/ALLOWED_ORIGINS", "api/PASSWORD_RESET_URL_BASE", "api/NODE_ENV", "api/S3_REGION", "api/S3_BUCKET", "api/REALTIME_INTERNAL_URL", "api/DB_HOST", "api/DB_PORT", "api/DB_NAME", "api/DB_SECRET_ARN", "realtime/API_INTERNAL_URL", "realtime/NODE_ENV"])
    error_message = "The config parameters must be exactly the non-secret api and realtime settings, including the database connection info (DATABASE_URL is built on the host)."
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

run "database_connection_info_is_published_for_the_host" {
  command = apply

  assert {
    condition     = module.app_config.parameters["api/DB_HOST"].value == module.database.address && module.app_config.parameters["api/DB_HOST"].value == "aula-virtual-prod-db.abcdefghij.us-east-2.rds.amazonaws.com"
    error_message = "DB_HOST must be the RDS address from module.database."
  }

  assert {
    condition     = module.app_config.parameters["api/DB_PORT"].value == "5432" && module.app_config.parameters["api/DB_PORT"].value == tostring(module.database.port)
    error_message = "DB_PORT must be the RDS port from module.database, as a string."
  }

  assert {
    condition     = module.app_config.parameters["api/DB_NAME"].value == module.database.db_name
    error_message = "DB_NAME must be the initial database name from module.database."
  }

  assert {
    condition     = module.app_config.parameters["api/DB_SECRET_ARN"].value == module.database.master_user_secret_arn && module.app_config.parameters["api/DB_SECRET_ARN"].value == "arn:aws:secretsmanager:us-east-2:123456789012:secret:rds!db-00000000-0000-0000-0000-000000000000-AbCdEf"
    error_message = "DB_SECRET_ARN must be the ARN of the RDS-managed master secret (the pointer, never its value)."
  }

  assert {
    condition     = alltrue([for n in ["DB_HOST", "DB_PORT", "DB_NAME", "DB_SECRET_ARN"] : module.app_config.parameters["api/${n}"].type == "String" && module.app_config.parameters["api/${n}"].name == "/aula-virtual-prod/config/api/${n}"])
    error_message = "The database parameters must be String parameters under /<name_prefix>/config/api/."
  }

  assert {
    condition     = !contains(keys(module.app_config.parameters), "realtime/DB_HOST") && !contains(keys(module.app_config.parameters), "realtime/DB_SECRET_ARN")
    error_message = "Only the api reads database settings; realtime must not get them."
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
    db_host                 = "db.abc.us-east-2.rds.amazonaws.com"
    db_port                 = 5432
    db_name                 = "aula"
    db_secret_arn           = "arn:aws:secretsmanager:us-east-2:123456789012:secret:rds!db-1-AbCdEf"
  }

  expect_failures = [var.name_prefix]
}

# A null value (what a mock leaves for the managed secret) is rejected too, so a real plan
# can never publish an empty DB_SECRET_ARN; prod tests pin the database instance instead.

run "rejects_db_host_with_a_scheme_or_port" {
  command = plan

  module {
    source = "../../modules/app_config"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    region                  = "us-east-2"
    s3_bucket_name          = "aula-virtual-prod-files-abc123"
    allowed_origins         = ["https://app.example.com"]
    password_reset_url_base = "https://app.example.com/reset-password"
    db_host                 = "postgres://db.example.com:5432"
    db_port                 = 5432
    db_name                 = "aula"
    db_secret_arn           = "arn:aws:secretsmanager:us-east-2:123456789012:secret:rds!db-1-AbCdEf"
  }

  expect_failures = [var.db_host]
}

run "rejects_empty_db_host" {
  command = plan

  module {
    source = "../../modules/app_config"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    region                  = "us-east-2"
    s3_bucket_name          = "aula-virtual-prod-files-abc123"
    allowed_origins         = ["https://app.example.com"]
    password_reset_url_base = "https://app.example.com/reset-password"
    db_host                 = ""
    db_port                 = 5432
    db_name                 = "aula"
    db_secret_arn           = "arn:aws:secretsmanager:us-east-2:123456789012:secret:rds!db-1-AbCdEf"
  }

  expect_failures = [var.db_host]
}

run "rejects_out_of_range_db_port" {
  command = plan

  module {
    source = "../../modules/app_config"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    region                  = "us-east-2"
    s3_bucket_name          = "aula-virtual-prod-files-abc123"
    allowed_origins         = ["https://app.example.com"]
    password_reset_url_base = "https://app.example.com/reset-password"
    db_host                 = "db.abc.us-east-2.rds.amazonaws.com"
    db_port                 = 70000
    db_name                 = "aula"
    db_secret_arn           = "arn:aws:secretsmanager:us-east-2:123456789012:secret:rds!db-1-AbCdEf"
  }

  expect_failures = [var.db_port]
}

run "rejects_invalid_db_name" {
  command = plan

  module {
    source = "../../modules/app_config"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    region                  = "us-east-2"
    s3_bucket_name          = "aula-virtual-prod-files-abc123"
    allowed_origins         = ["https://app.example.com"]
    password_reset_url_base = "https://app.example.com/reset-password"
    db_host                 = "db.abc.us-east-2.rds.amazonaws.com"
    db_port                 = 5432
    db_name                 = "Bad-Name"
    db_secret_arn           = "arn:aws:secretsmanager:us-east-2:123456789012:secret:rds!db-1-AbCdEf"
  }

  expect_failures = [var.db_name]
}

run "rejects_non_secret_manager_db_secret_arn" {
  command = plan

  module {
    source = "../../modules/app_config"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    region                  = "us-east-2"
    s3_bucket_name          = "aula-virtual-prod-files-abc123"
    allowed_origins         = ["https://app.example.com"]
    password_reset_url_base = "https://app.example.com/reset-password"
    db_host                 = "db.abc.us-east-2.rds.amazonaws.com"
    db_port                 = 5432
    db_name                 = "aula"
    db_secret_arn           = "arn:aws:s3:::bucket"
  }

  expect_failures = [var.db_secret_arn]
}

run "rejects_empty_db_secret_arn" {
  command = plan

  module {
    source = "../../modules/app_config"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    region                  = "us-east-2"
    s3_bucket_name          = "aula-virtual-prod-files-abc123"
    allowed_origins         = ["https://app.example.com"]
    password_reset_url_base = "https://app.example.com/reset-password"
    db_host                 = "db.abc.us-east-2.rds.amazonaws.com"
    db_port                 = 5432
    db_name                 = "aula"
    db_secret_arn           = ""
  }

  expect_failures = [var.db_secret_arn]
}

run "rejects_null_db_secret_arn" {
  command = plan

  module {
    source = "../../modules/app_config"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    region                  = "us-east-2"
    s3_bucket_name          = "aula-virtual-prod-files-abc123"
    allowed_origins         = ["https://app.example.com"]
    password_reset_url_base = "https://app.example.com/reset-password"
    db_host                 = "db.abc.us-east-2.rds.amazonaws.com"
    db_port                 = 5432
    db_name                 = "aula"
    db_secret_arn           = null
  }

  expect_failures = [var.db_secret_arn]
}
