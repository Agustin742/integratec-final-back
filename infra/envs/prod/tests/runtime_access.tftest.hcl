mock_provider "aws" {
  # The mock returns random strings for data sources and ARNs, so the values the SSM
  # path ARNs are built from are pinned to well-formed ones.
  override_data {
    target = module.app_config.data.aws_partition.current
    values = {
      partition = "aws"
    }
  }

  override_data {
    target = module.app_config.data.aws_region.current
    values = {
      region = "us-east-2"
    }
  }

  override_data {
    target = module.app_config.data.aws_caller_identity.current
    values = {
      account_id = "123456789012"
    }
  }

  override_resource {
    target = module.app_config.aws_ssm_parameter.this["api/ALLOWED_ORIGINS"]
    values = {
      arn = "arn:aws:ssm:us-east-2:123456789012:parameter/aula-virtual-prod/config/api/ALLOWED_ORIGINS"
    }
  }

  override_resource {
    target = module.app_config.aws_ssm_parameter.this["api/PASSWORD_RESET_URL_BASE"]
    values = {
      arn = "arn:aws:ssm:us-east-2:123456789012:parameter/aula-virtual-prod/config/api/PASSWORD_RESET_URL_BASE"
    }
  }

  override_resource {
    target = module.app_config.aws_ssm_parameter.this["api/NODE_ENV"]
    values = {
      arn = "arn:aws:ssm:us-east-2:123456789012:parameter/aula-virtual-prod/config/api/NODE_ENV"
    }
  }

  override_resource {
    target = module.app_config.aws_ssm_parameter.this["api/S3_REGION"]
    values = {
      arn = "arn:aws:ssm:us-east-2:123456789012:parameter/aula-virtual-prod/config/api/S3_REGION"
    }
  }

  override_resource {
    target = module.app_config.aws_ssm_parameter.this["api/S3_BUCKET"]
    values = {
      arn = "arn:aws:ssm:us-east-2:123456789012:parameter/aula-virtual-prod/config/api/S3_BUCKET"
    }
  }

  override_resource {
    target = module.app_config.aws_ssm_parameter.this["api/REALTIME_INTERNAL_URL"]
    values = {
      arn = "arn:aws:ssm:us-east-2:123456789012:parameter/aula-virtual-prod/config/api/REALTIME_INTERNAL_URL"
    }
  }

  override_resource {
    target = module.app_config.aws_ssm_parameter.this["realtime/API_INTERNAL_URL"]
    values = {
      arn = "arn:aws:ssm:us-east-2:123456789012:parameter/aula-virtual-prod/config/realtime/API_INTERNAL_URL"
    }
  }

  override_resource {
    target = module.app_config.aws_ssm_parameter.this["realtime/NODE_ENV"]
    values = {
      arn = "arn:aws:ssm:us-east-2:123456789012:parameter/aula-virtual-prod/config/realtime/NODE_ENV"
    }
  }

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

  # The mock generates random values for computed nested blocks, so the managed
  # master user secret is pinned to a well-formed value.
  override_resource {
    target = module.database.aws_db_instance.this
    values = {
      address  = "aula-virtual-prod-db.abcdefghij.us-east-2.rds.amazonaws.com"
      endpoint = "aula-virtual-prod-db.abcdefghij.us-east-2.rds.amazonaws.com:5432"
      port     = 5432
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

run "role_policy_is_attached_to_the_host_role" {
  command = apply

  assert {
    condition     = module.runtime_access.role_policy_role == module.host.instance_role_name
    error_message = "The runtime policy must be attached to the host instance role."
  }

  assert {
    condition     = module.runtime_access.role_policy_name == "aula-virtual-prod-host-runtime"
    error_message = "The policy must be named <prefix>-host-runtime."
  }

  assert {
    condition     = toset(keys(module.runtime_access.policy_statements)) == toset(["EcrAuthToken", "EcrPull", "ReadAppSecrets", "ReadAppConfig", "ReadAppConfigByPath", "FilesBucketObjects", "WriteServiceLogs"])
    error_message = "The policy must have exactly the statements EcrAuthToken, EcrPull, ReadAppSecrets, ReadAppConfig, ReadAppConfigByPath, FilesBucketObjects and WriteServiceLogs."
  }

  assert {
    condition     = alltrue([for s in values(module.runtime_access.policy_statements) : s.Effect == "Allow"])
    error_message = "Every statement must be an Allow."
  }
}

run "ecr_pull_is_limited_to_the_two_repositories" {
  command = apply

  assert {
    condition     = toset(module.runtime_access.policy_statements["EcrPull"].Action) == toset(["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"])
    error_message = "ECR pull must be exactly BatchGetImage, GetDownloadUrlForLayer and BatchCheckLayerAvailability (no push)."
  }

  assert {
    condition     = toset(module.runtime_access.policy_statements["EcrPull"].Resource) == toset(values(module.registry.repository_arns)) && length(module.runtime_access.policy_statements["EcrPull"].Resource) == 2
    error_message = "ECR pull must be scoped to the ARNs of the api and realtime repositories."
  }

  assert {
    condition     = module.runtime_access.policy_statements["EcrAuthToken"].Action == "ecr:GetAuthorizationToken" && module.runtime_access.policy_statements["EcrAuthToken"].Resource == "*"
    error_message = "GetAuthorizationToken has no resource-level permissions: it is the only action allowed on \"*\", in its own statement."
  }
}

run "secrets_are_read_by_exact_arn" {
  command = apply

  assert {
    condition     = module.runtime_access.policy_statements["ReadAppSecrets"].Action == "secretsmanager:GetSecretValue"
    error_message = "Secrets access must be GetSecretValue only."
  }

  assert {
    condition     = toset(module.runtime_access.policy_statements["ReadAppSecrets"].Resource) == toset(concat(values(module.app_config.secret_arns), [module.database.master_user_secret_arn])) && length(module.runtime_access.policy_statements["ReadAppSecrets"].Resource) == 4
    error_message = "Secrets access must cover the three app secrets and the RDS master secret, by exact ARN."
  }

  assert {
    condition     = contains(module.runtime_access.policy_statements["ReadAppSecrets"].Resource, "arn:aws:secretsmanager:us-east-2:123456789012:secret:rds!db-00000000-0000-0000-0000-000000000000-AbCdEf")
    error_message = "The RDS master secret ARN must be included."
  }
}

run "config_parameters_are_scoped_to_the_config_path" {
  command = apply

  assert {
    condition     = module.runtime_access.policy_statements["ReadAppConfig"].Action == "ssm:GetParameters"
    error_message = "ReadAppConfig must be ssm:GetParameters only."
  }

  assert {
    condition     = toset(module.runtime_access.policy_statements["ReadAppConfig"].Resource) == toset(flatten(values(module.app_config.parameter_arns)))
    error_message = "GetParameters must be scoped to the ARNs of the config parameters."
  }

  assert {
    condition     = module.runtime_access.policy_statements["ReadAppConfigByPath"].Action == "ssm:GetParametersByPath"
    error_message = "ReadAppConfigByPath must be ssm:GetParametersByPath only."
  }

  assert {
    condition     = toset(module.runtime_access.policy_statements["ReadAppConfigByPath"].Resource) == toset(concat(values(module.app_config.parameter_path_arns), [for p in values(module.app_config.parameter_path_arns) : "${p}/*"]))
    error_message = "GetParametersByPath must be scoped to each service config path and its children, nothing broader."
  }

  assert {
    condition     = module.app_config.parameter_path_arns == { api = "arn:aws:ssm:us-east-2:123456789012:parameter/aula-virtual-prod/config/api", realtime = "arn:aws:ssm:us-east-2:123456789012:parameter/aula-virtual-prod/config/realtime" }
    error_message = "Path ARNs must be arn:<partition>:ssm:<region>:<account>:parameter/<prefix>/config/<service> (single slash after parameter)."
  }

  assert {
    condition = alltrue([
      for service, path_arn in module.app_config.parameter_path_arns :
      !contains(flatten(values(module.app_config.parameter_arns)), path_arn) && alltrue([for p in module.app_config.parameter_arns[service] : startswith(p, "${path_arn}/")])
    ])
    error_message = "A path ARN must differ from every parameter ARN, and each parameter ARN of the service must sit under its path ARN."
  }
}

run "bucket_access_is_object_level_only" {
  command = apply

  assert {
    condition     = toset(module.runtime_access.policy_statements["FilesBucketObjects"].Action) == toset(["s3:GetObject", "s3:PutObject", "s3:DeleteObject"])
    error_message = "Bucket access must be GetObject, PutObject and DeleteObject (no ListBucket, no s3:*)."
  }

  assert {
    condition     = module.runtime_access.policy_statements["FilesBucketObjects"].Resource == "${module.storage.bucket_arn}/*"
    error_message = "Bucket access must be scoped to the objects of the files bucket."
  }
}

run "log_groups_are_named_by_prefix_and_kept_14_days" {
  command = apply

  assert {
    condition     = module.runtime_access.log_group_names == { api = "/aula-virtual-prod/api", realtime = "/aula-virtual-prod/realtime", caddy = "/aula-virtual-prod/caddy" }
    error_message = "Log groups must be /<prefix>/api, /<prefix>/realtime and /<prefix>/caddy."
  }

  assert {
    condition     = alltrue([for g in values(module.runtime_access.log_group_settings) : g.retention_in_days == 14]) && length(module.runtime_access.log_group_settings) == 3
    error_message = "Every log group must retain logs for 14 days."
  }

  assert {
    condition     = output.log_group_names == module.runtime_access.log_group_names
    error_message = "The prod root must expose the log group names for the Compose awslogs configuration."
  }
}

run "log_writes_are_scoped_to_the_log_groups" {
  command = apply

  assert {
    condition     = toset(module.runtime_access.policy_statements["WriteServiceLogs"].Action) == toset(["logs:CreateLogStream", "logs:PutLogEvents"])
    error_message = "Log access must be CreateLogStream and PutLogEvents only (the groups are created by Terraform)."
  }

  assert {
    condition     = toset(module.runtime_access.policy_statements["WriteServiceLogs"].Resource) == toset([for arn in values(module.runtime_access.log_group_arns) : "${arn}:*"]) && length(module.runtime_access.policy_statements["WriteServiceLogs"].Resource) == 3
    error_message = "Log writes must target each log group ARN with the :* suffix (the provider ARN no longer carries it)."
  }
}

run "no_wildcard_except_the_ecr_token_and_no_service_wide_actions" {
  command = apply

  assert {
    condition = alltrue([
      for sid, s in module.runtime_access.policy_statements :
      sid == "EcrAuthToken" || alltrue([for r in flatten([s.Resource]) : r != "*" && (!strcontains(r, "*") || endswith(r, "/*") || endswith(r, ":*"))])
    ])
    error_message = "Only the ECR token statement may use Resource \"*\"; elsewhere a wildcard may only be a trailing /* or :* on a known ARN."
  }

  assert {
    condition     = alltrue([for s in values(module.runtime_access.policy_statements) : alltrue([for a in flatten([s.Action]) : !endswith(a, ":*")])])
    error_message = "No statement may grant a service-wide action such as s3:*."
  }
}

run "static_scan_of_runtime_access_module" {
  command = plan

  assert {
    condition     = var.project != "" && length(regexall("(?m)^[[:space:]]*resource[[:space:]]+\"aws_cloudwatch_log_group\"", file("../../modules/runtime_access/logs.tf"))) == 1
    error_message = "logs.tf must declare the log groups once, with for_each."
  }

  assert {
    condition     = var.project != "" && !can(regex("\"kms:", file("../../modules/runtime_access/policy.tf")))
    error_message = "No kms permissions: the secrets use the AWS managed key aws/secretsmanager, whose key policy already allows principals that may use Secrets Manager."
  }

  assert {
    condition     = var.project != "" && length(regexall("(?m)^[[:space:]]*kms_key_id", file("../../modules/app_config/secrets.tf"))) == 0
    error_message = "The app secrets must keep the default AWS managed key; if a customer key is added, the policy needs kms:Decrypt on it."
  }
}

run "rejects_invalid_name_prefix" {
  command = plan

  module {
    source = "../../modules/runtime_access"
  }

  variables {
    name_prefix             = "Bad_Prefix"
    role_name               = "r"
    ecr_repository_arns     = { api = "arn:aws:ecr:us-east-2:123456789012:repository/a" }
    secret_arns             = ["arn:aws:secretsmanager:us-east-2:123456789012:secret:a"]
    ssm_parameter_arns      = ["arn:aws:ssm:us-east-2:123456789012:parameter/p/a"]
    ssm_parameter_path_arns = ["arn:aws:ssm:us-east-2:123456789012:parameter/p"]
    s3_bucket_arn           = "arn:aws:s3:::bucket"
  }

  expect_failures = [var.name_prefix]
}

run "rejects_empty_secret_list" {
  command = plan

  module {
    source = "../../modules/runtime_access"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    role_name               = "r"
    ecr_repository_arns     = { api = "arn:aws:ecr:us-east-2:123456789012:repository/a" }
    secret_arns             = []
    ssm_parameter_arns      = ["arn:aws:ssm:us-east-2:123456789012:parameter/p/a"]
    ssm_parameter_path_arns = ["arn:aws:ssm:us-east-2:123456789012:parameter/p"]
    s3_bucket_arn           = "arn:aws:s3:::bucket"
  }

  expect_failures = [var.secret_arns]
}

run "rejects_invalid_retention" {
  command = plan

  module {
    source = "../../modules/runtime_access"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    role_name               = "r"
    ecr_repository_arns     = { api = "arn:aws:ecr:us-east-2:123456789012:repository/a" }
    secret_arns             = ["arn:aws:secretsmanager:us-east-2:123456789012:secret:a"]
    ssm_parameter_arns      = ["arn:aws:ssm:us-east-2:123456789012:parameter/p/a"]
    ssm_parameter_path_arns = ["arn:aws:ssm:us-east-2:123456789012:parameter/p"]
    s3_bucket_arn           = "arn:aws:s3:::bucket"
    retention_in_days       = 10
  }

  expect_failures = [var.retention_in_days]
}

run "rejects_bucket_arn_that_is_not_an_s3_arn" {
  command = plan

  module {
    source = "../../modules/runtime_access"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    role_name               = "r"
    ecr_repository_arns     = { api = "arn:aws:ecr:us-east-2:123456789012:repository/a" }
    secret_arns             = ["arn:aws:secretsmanager:us-east-2:123456789012:secret:a"]
    ssm_parameter_arns      = ["arn:aws:ssm:us-east-2:123456789012:parameter/p/a"]
    ssm_parameter_path_arns = ["arn:aws:ssm:us-east-2:123456789012:parameter/p"]
    s3_bucket_arn           = "aula-virtual-prod-files-bucket"
  }

  expect_failures = [var.s3_bucket_arn]
}

run "rejects_wildcard_secret_arn" {
  command = plan

  module {
    source = "../../modules/runtime_access"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    role_name               = "r"
    ecr_repository_arns     = { api = "arn:aws:ecr:us-east-2:123456789012:repository/a" }
    secret_arns             = ["arn:aws:secretsmanager:us-east-2:123456789012:secret:*"]
    ssm_parameter_arns      = ["arn:aws:ssm:us-east-2:123456789012:parameter/p/a"]
    ssm_parameter_path_arns = ["arn:aws:ssm:us-east-2:123456789012:parameter/p"]
    s3_bucket_arn           = "arn:aws:s3:::bucket"
  }

  expect_failures = [var.secret_arns]
}

run "rejects_wildcard_bucket_arn" {
  command = plan

  module {
    source = "../../modules/runtime_access"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    role_name               = "r"
    ecr_repository_arns     = { api = "arn:aws:ecr:us-east-2:123456789012:repository/a" }
    secret_arns             = ["arn:aws:secretsmanager:us-east-2:123456789012:secret:a"]
    ssm_parameter_arns      = ["arn:aws:ssm:us-east-2:123456789012:parameter/p/a"]
    ssm_parameter_path_arns = ["arn:aws:ssm:us-east-2:123456789012:parameter/p"]
    s3_bucket_arn           = "arn:aws:s3:::*"
  }

  expect_failures = [var.s3_bucket_arn]
}

run "rejects_object_path_bucket_arn" {
  command = plan

  module {
    source = "../../modules/runtime_access"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    role_name               = "r"
    ecr_repository_arns     = { api = "arn:aws:ecr:us-east-2:123456789012:repository/a" }
    secret_arns             = ["arn:aws:secretsmanager:us-east-2:123456789012:secret:a"]
    ssm_parameter_arns      = ["arn:aws:ssm:us-east-2:123456789012:parameter/p/a"]
    ssm_parameter_path_arns = ["arn:aws:ssm:us-east-2:123456789012:parameter/p"]
    s3_bucket_arn           = "arn:aws:s3:::bucket/prefix"
  }

  expect_failures = [var.s3_bucket_arn]
}
