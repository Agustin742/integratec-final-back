locals {
  # Decided by Agustin on 2026-11-20: a USD 40 monthly limit, because the expected spend
  # is about USD 35 a month, warning at 50 % and
  # 80 % of the limit as spent and at 100 % as forecast for the month, so a trend is seen
  # before the money is spent.
  budget_notifications = [
    { notification_type = "ACTUAL", threshold = 50 },
    { notification_type = "ACTUAL", threshold = 80 },
    { notification_type = "FORECASTED", threshold = 100 },
  ]
}

resource "aws_budgets_budget" "monthly_cost" {
  name         = "${var.name_prefix}-monthly-cost"
  budget_type  = "COST"
  time_unit    = "MONTHLY"
  limit_unit   = "USD"
  limit_amount = tostring(var.monthly_budget_usd)

  # AWS Budgets emails the addresses directly, so no SNS topic policy is needed for it.
  dynamic "notification" {
    for_each = local.budget_notifications

    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value.threshold
      threshold_type             = "PERCENTAGE"
      notification_type          = notification.value.notification_type
      subscriber_email_addresses = var.alert_email_addresses
    }
  }

  tags = {
    Name = "${var.name_prefix}-monthly-cost"
  }
}
