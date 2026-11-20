mock_provider "aws" {
  # The mock returns random strings for ARNs; the email subscriptions validate the topic
  # ARN format, so the alarm topic ARN is pinned to a well-formed value.
  override_resource {
    target = module.monitoring.aws_sns_topic.alarms
    values = {
      arn = "arn:aws:sns:us-east-2:123456789012:aula-virtual-prod-alarms"
    }
  }

  # The delivery pipeline module builds role and project ARNs from the account ID, and
  # CodeBuild validates them; the mock would return a random string, so it is pinned.
  override_data {
    target = module.delivery_pipeline.data.aws_caller_identity.current
    values = {
      account_id = "123456789012"
    }
  }

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
  import_existing_frontend = false
  project                  = "aula-virtual"
  allowed_origins          = ["https://app.example.com"]
  password_reset_url_base  = "https://app.example.com/reset-password"
  alert_email_addresses    = ["alerts@example.com", "oncall@example.com"]
}

run "alarm_topic_is_named_by_prefix" {
  command = apply

  assert {
    condition     = module.monitoring.alarm_topic_name == "aula-virtual-prod-alarms"
    error_message = "The alarm topic must be named <name_prefix>-alarms."
  }

  assert {
    condition     = output.alarm_topic_arn == module.monitoring.alarm_topic_arn
    error_message = "The root must expose the alarm topic ARN."
  }
}

run "each_address_gets_one_email_subscription" {
  command = apply

  assert {
    condition     = length(module.monitoring.subscriptions) == 2
    error_message = "There must be exactly one subscription per alert address."
  }

  assert {
    condition     = toset(keys(module.monitoring.subscriptions)) == toset(["alerts@example.com", "oncall@example.com"])
    error_message = "Subscriptions must be keyed by the alert addresses."
  }

  assert {
    condition     = alltrue([for s in values(module.monitoring.subscriptions) : s.protocol == "email" && s.topic_arn == module.monitoring.alarm_topic_arn])
    error_message = "Every subscription must use the email protocol on the alarm topic."
  }
}

run "budget_is_a_monthly_cost_budget_of_20_usd" {
  command = apply

  assert {
    condition     = module.monitoring.budget_name == "aula-virtual-prod-monthly-cost" && output.monthly_budget_name == module.monitoring.budget_name
    error_message = "The budget must be named <name_prefix>-monthly-cost and the root must expose its name."
  }

  assert {
    condition     = module.monitoring.budget_settings == { budget_type = "COST", time_unit = "MONTHLY", limit_unit = "USD", limit_amount = "40" }
    error_message = "The budget must be a monthly COST budget with a 40 USD limit."
  }
}

run "budget_notifies_at_50_and_80_actual_and_100_forecasted" {
  command = apply

  assert {
    condition     = length(module.monitoring.budget_notifications) == 3
    error_message = "The budget must have exactly three notifications."
  }

  assert {
    condition     = length([for n in module.monitoring.budget_notifications : n if n.notification_type == "ACTUAL" && n.threshold == 50]) == 1
    error_message = "There must be one ACTUAL notification at 50 percent."
  }

  assert {
    condition     = length([for n in module.monitoring.budget_notifications : n if n.notification_type == "ACTUAL" && n.threshold == 80]) == 1
    error_message = "There must be one ACTUAL notification at 80 percent."
  }

  assert {
    condition     = length([for n in module.monitoring.budget_notifications : n if n.notification_type == "FORECASTED" && n.threshold == 100]) == 1
    error_message = "There must be one FORECASTED notification at 100 percent."
  }

  assert {
    condition     = alltrue([for n in module.monitoring.budget_notifications : n.comparison_operator == "GREATER_THAN" && n.threshold_type == "PERCENTAGE" && toset(n.subscriber_email_addresses) == toset(var.alert_email_addresses)])
    error_message = "Every notification must compare GREATER_THAN on a PERCENTAGE and email every alert address directly."
  }
}

run "budget_limit_is_configurable" {
  command = apply

  variables {
    monthly_budget_usd = 35
  }

  assert {
    condition     = module.monitoring.budget_settings.limit_amount == "35"
    error_message = "monthly_budget_usd must feed the budget limit."
  }
}

run "rejects_empty_alert_list" {
  command = plan

  variables {
    alert_email_addresses = []
  }

  expect_failures = [var.alert_email_addresses]
}

run "rejects_invalid_alert_email" {
  command = plan

  variables {
    alert_email_addresses = ["not-an-email"]
  }

  expect_failures = [var.alert_email_addresses]
}

run "rejects_duplicate_alert_emails" {
  command = plan

  variables {
    alert_email_addresses = ["alerts@example.com", "Alerts@example.com"]
  }

  expect_failures = [var.alert_email_addresses]
}

run "rejects_more_than_ten_alert_emails" {
  command = plan

  variables {
    alert_email_addresses = [for i in range(11) : "user${i}@example.com"]
  }

  expect_failures = [var.alert_email_addresses]
}

run "rejects_zero_budget" {
  command = plan

  variables {
    monthly_budget_usd = 0
  }

  expect_failures = [var.monthly_budget_usd]
}

run "rejects_negative_budget" {
  command = plan

  variables {
    monthly_budget_usd = -5
  }

  expect_failures = [var.monthly_budget_usd]
}

run "rejects_invalid_module_name_prefix" {
  command = plan

  module {
    source = "../../modules/monitoring"
  }

  variables {
    name_prefix           = "Bad_Prefix"
    alert_email_addresses = ["alerts@example.com"]
    monthly_budget_usd    = 40
  }

  expect_failures = [var.name_prefix]
}
