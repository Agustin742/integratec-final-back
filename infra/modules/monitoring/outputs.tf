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
