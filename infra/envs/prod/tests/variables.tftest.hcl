mock_provider "aws" {}

run "defaults_target_prod_in_us_east_2" {
  command = plan

  assert {
    condition     = var.region == "us-east-2"
    error_message = "The default region must be us-east-2 (decision D5)."
  }

  assert {
    condition     = var.enable_github_oidc == false
    error_message = "GitHub OIDC resources must be opt-in (the account's managed SCP denies the provider)."
  }

  assert {
    condition     = output.environment == "prod"
    error_message = "This root must describe the prod environment."
  }
}

run "rejects_invalid_project_prefix" {
  command = plan

  variables {
    project = "Aula Virtual"
  }

  expect_failures = [var.project]
}

run "rejects_invalid_region" {
  command = plan

  variables {
    region = "not-a-region"
  }

  expect_failures = [var.region]
}
