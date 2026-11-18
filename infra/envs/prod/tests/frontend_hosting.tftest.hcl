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
  # policy document is pinned to a well-formed value.
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

# The Elastic IP address is pinned (the mock would otherwise return a random string),
# so the sslip.io origin the frontend is built against can be asserted. It is the real
# address of the production host.
override_resource {
  target          = module.host.aws_eip.host
  override_during = apply
  values = {
    public_ip = "16.59.248.180"
  }
}

# The mock returns random strings for data sources, so the AMI lookup is pinned.
override_data {
  target = module.host.data.aws_ssm_parameter.al2023_ami
  values = {
    value = "ami-0123456789abcdef0"
  }
}

variables {
  import_existing_frontend = false
  project                  = "aula-virtual"
  allowed_origins          = ["https://app.example.com"]
  password_reset_url_base  = "https://app.example.com/reset-password"
}

run "app_matches_the_console_created_app" {
  command = apply

  assert {
    condition     = module.frontend_hosting.app_settings.name == "aula-virtual-prod-front"
    error_message = "The app must keep the name it was created with in the console (an import must not rename it)."
  }

  assert {
    condition     = module.frontend_hosting.app_settings.repository == "https://github.com/Agustin742/integratec-final-front"
    error_message = "The app must point at the frontend repository."
  }

  assert {
    condition     = module.frontend_hosting.app_settings.platform == "WEB"
    error_message = "The app must be a WEB (static SPA) app."
  }
}

run "spa_rewrite_rule_is_exact" {
  command = apply

  assert {
    condition     = length(module.frontend_hosting.app_settings.custom_rules) == 1
    error_message = "The app must have exactly one custom rule: the SPA rewrite."
  }

  # Must stay identical to the rewrite rule in the front docs/routing.md.
  assert {
    condition     = module.frontend_hosting.app_settings.custom_rules[0].source == "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|wasm)$)([^.]+$)/>"
    error_message = "The rewrite source must match the front docs/routing.md rule exactly."
  }

  assert {
    condition     = module.frontend_hosting.app_settings.custom_rules[0].target == "/index.html" && module.frontend_hosting.app_settings.custom_rules[0].status == "200"
    error_message = "The rewrite must serve /index.html with status 200 (rewrite, not redirect)."
  }
}

run "build_env_vars_point_at_the_api_host" {
  command = apply

  assert {
    condition = module.frontend_hosting.app_settings.environment_variables == tomap({
      VITE_APP_ENV      = "production"
      VITE_API_BASE_URL = "https://16-59-248-180.sslip.io"
      VITE_REALTIME_URL = "wss://16-59-248-180.sslip.io"
    })
    error_message = "The app variables must be exactly VITE_APP_ENV=production plus the https API origin and the wss realtime origin derived from the host sslip.io name."
  }

  assert {
    condition     = module.frontend_hosting.branch_settings.environment_variables == null || length(module.frontend_hosting.branch_settings.environment_variables) == 0
    error_message = "Variables live at the app level only; the branch must not override them."
  }
}

run "develop_branch_is_production_with_auto_build" {
  command = apply

  assert {
    condition     = module.frontend_hosting.branch_settings.branch_name == "develop" && module.frontend_hosting.branch_settings.stage == "PRODUCTION"
    error_message = "The deployed branch must be develop with stage PRODUCTION."
  }

  assert {
    condition     = module.frontend_hosting.branch_settings.enable_auto_build == true && module.frontend_hosting.branch_settings.framework == "Web"
    error_message = "The branch must build on every push and use the Web framework."
  }
}

run "no_secrets_headers_or_basic_auth_are_managed" {
  command = apply

  assert {
    condition     = module.frontend_hosting.app_settings.token_configured == false
    error_message = "No GitHub token may be set: it would be stored in the Terraform state. The app uses the console GitHub App connection."
  }

  assert {
    condition     = module.frontend_hosting.app_settings.enable_basic_auth == false && module.frontend_hosting.branch_settings.enable_basic_auth == false
    error_message = "Basic auth must stay disabled."
  }
}

run "outputs_expose_app_id_domain_and_branch_url" {
  command = apply

  assert {
    condition     = output.frontend_amplify_app_id == module.frontend_hosting.app_id
    error_message = "The root must expose the Amplify app id."
  }

  assert {
    condition     = output.frontend_default_domain == module.frontend_hosting.default_domain
    error_message = "The root must expose the Amplify default domain."
  }

  assert {
    condition     = output.frontend_branch_url == "https://develop.${module.frontend_hosting.default_domain}"
    error_message = "The root must expose the deployed branch URL https://develop.<default_domain>."
  }
}

run "api_and_realtime_urls_must_be_secure" {
  command = plan

  variables {
    frontend_api_base_url = "http://16-59-248-180.sslip.io"
  }

  expect_failures = [var.frontend_api_base_url]
}

run "realtime_url_must_be_secure_websocket" {
  command = plan

  variables {
    frontend_realtime_url = "ws://16-59-248-180.sslip.io"
  }

  expect_failures = [var.frontend_realtime_url]
}

run "static_scan_keeps_tokens_headers_and_build_spec_out_of_terraform" {
  command = plan

  # custom_headers and build_spec are computed, so a mock plan cannot tell "unset" from
  # "set": scan the module source instead. The var.project != "" term gives each
  # assertion a reference to the configuration (Terraform rejects constant-only conditions).
  assert {
    condition     = var.project != "" && length(fileset("../../modules/frontend_hosting", "*.tf")) > 0
    error_message = "The static scan found no .tf files; check the relative paths."
  }

  assert {
    condition = var.project != "" && length([
      for f in fileset("../../modules/frontend_hosting", "*.tf") : f
      if can(regex("(?m)^[[:space:]]*(access_token|oauth_token|basic_auth_credentials|custom_headers|build_spec)[[:space:]]*=", file("../../modules/frontend_hosting/${f}")))
    ]) == 0
    error_message = "The Amplify module must not set access_token, oauth_token, basic_auth_credentials, custom_headers or build_spec: tokens and credentials would be stored in the state, and the build spec and headers come from the frontend repository."
  }
}

run "root_imports_the_console_created_app_and_branch" {
  command = plan

  # Mock providers cannot import, so the tests run with import_existing_frontend = false;
  # the import blocks are checked statically and by the real plan (see infra/README.md).
  assert {
    condition     = var.frontend_amplify_app_id == "d61i488hxxotx" && var.frontend_branch == "develop"
    error_message = "The defaults must identify the console-created app and the develop branch."
  }

  assert {
    condition = (
      var.project != "" &&
      can(regex("(?s)import [{][^}]*to *= *module[.]frontend_hosting[.]aws_amplify_app[.]this[^}]*id *= *var[.]frontend_amplify_app_id", file("main.tf"))) &&
      can(regex("(?s)import [{][^}]*to *= *module[.]frontend_hosting[.]aws_amplify_branch[.]this[^}]*id *= *\"[$][{]var[.]frontend_amplify_app_id[}]/[$][{]var[.]frontend_branch[}]\"", file("main.tf")))
    )
    error_message = "main.tf must import the app by its id and the branch by <app id>/<branch name>."
  }
}
