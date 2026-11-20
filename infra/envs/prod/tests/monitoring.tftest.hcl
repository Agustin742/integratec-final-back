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

run "host_status_check_alarms" {
  command = apply

  assert {
    condition     = alltrue([for k in ["status_instance", "status_system"] : module.monitoring.host_alarms[k].namespace == "AWS/EC2" && module.monitoring.host_alarms[k].dimensions["InstanceId"] == module.host.instance_id])
    error_message = "Host status alarms must use AWS/EC2 and the InstanceId dimension of the host."
  }

  assert {
    condition     = module.monitoring.host_alarms["status_instance"].alarm_name == "aula-virtual-prod-host-status-instance" && module.monitoring.host_alarms["status_instance"].metric_name == "StatusCheckFailed_Instance"
    error_message = "The instance status alarm must watch StatusCheckFailed_Instance."
  }

  assert {
    condition     = module.monitoring.host_alarms["status_system"].alarm_name == "aula-virtual-prod-host-status-system" && module.monitoring.host_alarms["status_system"].metric_name == "StatusCheckFailed_System"
    error_message = "The system status alarm must watch StatusCheckFailed_System."
  }

  assert {
    condition = alltrue([for k in ["status_instance", "status_system"] :
      module.monitoring.host_alarms[k].comparison_operator == "GreaterThanOrEqualToThreshold" &&
      module.monitoring.host_alarms[k].threshold == 1 &&
      module.monitoring.host_alarms[k].statistic == "Maximum" &&
      module.monitoring.host_alarms[k].period == 60 &&
      module.monitoring.host_alarms[k].evaluation_periods == 2
    ])
    error_message = "Status alarms must fire at Maximum >= 1 over 2 periods of 60 seconds."
  }

  assert {
    condition     = alltrue([for k in ["status_instance", "status_system"] : module.monitoring.host_alarms[k].treat_missing_data == "missing"])
    error_message = "Status alarms must treat missing data as missing: a stopped instance publishes nothing and is not a failed status check."
  }
}

run "host_cpu_alarm" {
  command = apply

  assert {
    condition     = module.monitoring.host_alarms["cpu"].alarm_name == "aula-virtual-prod-host-cpu-high" && module.monitoring.host_alarms["cpu"].metric_name == "CPUUtilization" && module.monitoring.host_alarms["cpu"].namespace == "AWS/EC2"
    error_message = "The CPU alarm must watch AWS/EC2 CPUUtilization."
  }

  assert {
    condition     = module.monitoring.host_alarms["cpu"].dimensions["InstanceId"] == module.host.instance_id
    error_message = "The CPU alarm must use the InstanceId dimension of the host."
  }

  assert {
    condition = (
      module.monitoring.host_alarms["cpu"].comparison_operator == "GreaterThanThreshold" &&
      module.monitoring.host_alarms["cpu"].threshold == 80 &&
      module.monitoring.host_alarms["cpu"].statistic == "Average" &&
      module.monitoring.host_alarms["cpu"].period == 300 &&
      module.monitoring.host_alarms["cpu"].evaluation_periods == 3
    )
    error_message = "The CPU alarm must fire above 80 percent on the average over 3 periods of 300 seconds (15 minutes)."
  }

  assert {
    condition     = module.monitoring.host_alarms["cpu"].treat_missing_data == "missing"
    error_message = "The CPU alarm must treat missing data as missing; the status alarms cover a dead host."
  }
}

run "database_storage_alarm" {
  command = apply

  assert {
    condition     = module.monitoring.database_alarms["free_storage"].alarm_name == "aula-virtual-prod-database-free-storage-low" && module.monitoring.database_alarms["free_storage"].metric_name == "FreeStorageSpace" && module.monitoring.database_alarms["free_storage"].namespace == "AWS/RDS"
    error_message = "The storage alarm must watch AWS/RDS FreeStorageSpace."
  }

  assert {
    condition     = module.monitoring.database_alarms["free_storage"].dimensions["DBInstanceIdentifier"] == module.database.identifier
    error_message = "The storage alarm must use the DBInstanceIdentifier dimension of the database."
  }

  assert {
    condition = (
      module.monitoring.database_alarms["free_storage"].comparison_operator == "LessThanThreshold" &&
      module.monitoring.database_alarms["free_storage"].threshold == 2147483648 &&
      module.monitoring.database_alarms["free_storage"].statistic == "Minimum" &&
      module.monitoring.database_alarms["free_storage"].period == 300 &&
      module.monitoring.database_alarms["free_storage"].evaluation_periods == 2
    )
    error_message = "The storage alarm must fire below 2 GiB (2147483648 bytes) on the minimum over 2 periods of 300 seconds."
  }

  assert {
    condition     = module.monitoring.database_alarms["free_storage"].treat_missing_data == "missing"
    error_message = "The storage alarm must treat missing data as missing; the RDS event subscription covers an unavailable database."
  }
}

run "container_health_alarms" {
  command = apply

  assert {
    condition     = toset(keys(module.monitoring.container_alarms)) == toset(["api", "realtime"])
    error_message = "There must be one container alarm per service: api and realtime."
  }

  assert {
    condition = alltrue([for k in ["api", "realtime"] :
      module.monitoring.container_alarms[k].alarm_name == "aula-virtual-prod-${k}-unhealthy" &&
      module.monitoring.container_alarms[k].namespace == "AulaVirtual/Containers" &&
      module.monitoring.container_alarms[k].metric_name == "Healthy" &&
      length(module.monitoring.container_alarms[k].dimensions) == 1 &&
      module.monitoring.container_alarms[k].dimensions["Service"] == k
    ])
    error_message = "Each container alarm must watch the Healthy metric of its Service dimension in the AulaVirtual/Containers namespace."
  }

  assert {
    condition = alltrue([for k in ["api", "realtime"] :
      module.monitoring.container_alarms[k].comparison_operator == "LessThanThreshold" &&
      module.monitoring.container_alarms[k].threshold == 1 &&
      module.monitoring.container_alarms[k].statistic == "Minimum" &&
      module.monitoring.container_alarms[k].period == 60 &&
      module.monitoring.container_alarms[k].evaluation_periods == 3
    ])
    error_message = "Container alarms must fire when the Minimum is below 1 for 3 periods of 60 seconds."
  }

  assert {
    condition     = alltrue([for k in ["api", "realtime"] : module.monitoring.container_alarms[k].treat_missing_data == "breaching"])
    error_message = "Container alarms must treat missing data as breaching: no data means the host, the timer or the publisher is dead."
  }

  assert {
    condition     = alltrue([for k in ["api", "realtime"] : strcontains(module.monitoring.container_alarms[k].alarm_description, "docker compose ps") && strcontains(module.monitoring.container_alarms[k].alarm_description, "/aula-virtual-prod/${k}")])
    error_message = "Container alarm descriptions must tell what to check: docker compose ps and the CloudWatch log group of the service."
  }
}

run "container_namespace_comes_from_one_value_shared_with_the_host_policy_and_the_script" {
  command = apply

  assert {
    condition     = module.monitoring.container_alarms["api"].namespace == module.runtime_access.policy_statements["PublishContainerHealth"].Condition.StringEquals["cloudwatch:namespace"]
    error_message = "The alarms and the IAM condition must use the same namespace."
  }

  assert {
    condition     = var.project != "" && strcontains(file("../../deploy/publish-container-health.sh"), "HEALTH_NAMESPACE:-${module.monitoring.container_alarms["api"].namespace}}")
    error_message = "The publisher script default namespace must equal the Terraform namespace."
  }
}

run "every_alarm_notifies_the_topic_on_alarm_and_recovery" {
  command = apply

  assert {
    condition = alltrue([for a in merge(module.monitoring.host_alarms, module.monitoring.database_alarms, module.monitoring.container_alarms) :
      toset(a.alarm_actions) == toset([module.monitoring.alarm_topic_arn]) && toset(a.ok_actions) == toset([module.monitoring.alarm_topic_arn])
    ])
    error_message = "Every alarm must publish to the alarm topic both when it fires and when it recovers."
  }

  assert {
    condition     = alltrue([for a in merge(module.monitoring.host_alarms, module.monitoring.database_alarms, module.monitoring.container_alarms) : trimspace(a.alarm_description) != ""])
    error_message = "Every alarm must carry a description saying what to check."
  }
}

run "database_events_notify_the_topic" {
  command = apply

  assert {
    condition     = module.monitoring.database_event_subscription.name == "aula-virtual-prod-db-events" && module.monitoring.database_event_subscription.sns_topic == module.monitoring.alarm_topic_arn
    error_message = "The RDS event subscription must publish to the alarm topic."
  }

  assert {
    condition     = module.monitoring.database_event_subscription.source_type == "db-instance" && toset(module.monitoring.database_event_subscription.source_ids) == toset([module.database.identifier])
    error_message = "The RDS event subscription must watch only the database instance."
  }

  assert {
    condition     = toset(module.monitoring.database_event_subscription.event_categories) == toset(["availability", "failure", "low storage", "recovery"]) && module.monitoring.database_event_subscription.enabled == true
    error_message = "The RDS event subscription must be enabled for availability, failure, low storage and recovery events."
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
    host_instance_id      = "i-0123456789abcdef0"

    database_instance_identifier = "aula-virtual-prod-db"
    container_health_namespace   = "AulaVirtual/Containers"
  }

  expect_failures = [var.name_prefix]
}

run "rejects_an_aws_reserved_container_health_namespace" {
  command = plan

  module {
    source = "../../modules/monitoring"
  }

  variables {
    name_prefix                  = "aula-virtual-prod"
    alert_email_addresses        = ["alerts@example.com"]
    monthly_budget_usd           = 40
    host_instance_id             = "i-0123456789abcdef0"
    database_instance_identifier = "aula-virtual-prod-db"
    container_health_namespace   = "AWS/EC2"
  }

  expect_failures = [var.container_health_namespace]
}
