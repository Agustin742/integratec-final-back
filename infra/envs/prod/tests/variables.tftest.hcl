mock_provider "aws" {}

run "defaults_target_prod_in_sa_east_1" {
  command = plan

  assert {
    condition     = var.region == "sa-east-1"
    error_message = "The default region must be sa-east-1 (decision D5)."
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
