output "alarm_topic_arn" {
  description = "ARN of the SNS topic that alarms publish to."
  value       = aws_sns_topic.alarms.arn
}

output "alarm_topic_name" {
  description = "Name of the SNS topic that alarms publish to."
  value       = aws_sns_topic.alarms.name
}

output "subscriptions" {
  description = "Email subscriptions of the alarm topic (protocol and topic), keyed by address, for tests and review."
  value = { for k, s in aws_sns_topic_subscription.email : k => {
    protocol  = s.protocol
    topic_arn = s.topic_arn
  } }
}

output "host_alarms" {
  description = "Host alarms (metric, dimensions, threshold, actions), keyed by status_instance, status_system and cpu, for tests and review."
  value = { for k, a in {
    status_instance = aws_cloudwatch_metric_alarm.host_status_instance
    status_system   = aws_cloudwatch_metric_alarm.host_status_system
    cpu             = aws_cloudwatch_metric_alarm.host_cpu
    } : k => {
    alarm_name          = a.alarm_name
    alarm_description   = a.alarm_description
    namespace           = a.namespace
    metric_name         = a.metric_name
    dimensions          = a.dimensions
    statistic           = a.statistic
    period              = a.period
    evaluation_periods  = a.evaluation_periods
    threshold           = a.threshold
    comparison_operator = a.comparison_operator
    treat_missing_data  = a.treat_missing_data
    alarm_actions       = tolist(a.alarm_actions)
    ok_actions          = tolist(a.ok_actions)
  } }
}

output "database_alarms" {
  description = "Database alarms (metric, dimensions, threshold, actions), keyed by free_storage, for tests and review."
  value = { for k, a in {
    free_storage = aws_cloudwatch_metric_alarm.database_free_storage
    } : k => {
    alarm_name          = a.alarm_name
    alarm_description   = a.alarm_description
    namespace           = a.namespace
    metric_name         = a.metric_name
    dimensions          = a.dimensions
    statistic           = a.statistic
    period              = a.period
    evaluation_periods  = a.evaluation_periods
    threshold           = a.threshold
    comparison_operator = a.comparison_operator
    treat_missing_data  = a.treat_missing_data
    alarm_actions       = tolist(a.alarm_actions)
    ok_actions          = tolist(a.ok_actions)
  } }
}

output "database_event_subscription" {
  description = "RDS event subscription (name, topic, source and categories), for tests and review."
  value = {
    name             = aws_db_event_subscription.database.name
    sns_topic        = aws_db_event_subscription.database.sns_topic
    source_type      = aws_db_event_subscription.database.source_type
    source_ids       = tolist(aws_db_event_subscription.database.source_ids)
    event_categories = tolist(aws_db_event_subscription.database.event_categories)
    enabled          = aws_db_event_subscription.database.enabled
  }
}

output "budget_name" {
  description = "Name of the monthly cost budget."
  value       = aws_budgets_budget.monthly_cost.name
}

output "budget_settings" {
  description = "Type, period and limit of the monthly cost budget, for tests and review."
  value = {
    budget_type  = aws_budgets_budget.monthly_cost.budget_type
    time_unit    = aws_budgets_budget.monthly_cost.time_unit
    limit_unit   = aws_budgets_budget.monthly_cost.limit_unit
    limit_amount = aws_budgets_budget.monthly_cost.limit_amount
  }
}

output "budget_notifications" {
  description = "Notifications of the monthly cost budget (type, threshold and recipients), for tests and review."
  value = [for n in aws_budgets_budget.monthly_cost.notification : {
    comparison_operator        = n.comparison_operator
    threshold                  = n.threshold
    threshold_type             = n.threshold_type
    notification_type          = n.notification_type
    subscriber_email_addresses = n.subscriber_email_addresses
  }]
}
