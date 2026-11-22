# Topic every alarm publishes to. Alarms from other modules take its ARN from the
# alarm_topic_arn output.
resource "aws_sns_topic" "alarms" {
  name = "${var.name_prefix}-alarms"

  tags = {
    Name = "${var.name_prefix}-alarms"
  }
}

# One email subscription per address. Each stays "Pending confirmation" and receives
# nothing until its owner clicks the link in the confirmation email AWS sends: Terraform
# cannot confirm it.
resource "aws_sns_topic_subscription" "email" {
  for_each = toset(var.alert_email_addresses)

  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = each.key
}
