locals {
  container_services           = toset(["api", "realtime"])
  container_health_period      = 60
  container_health_evaluations = 3 # 3 x 1 minute: ignores a restart or a slow healthcheck, catches a real outage fast.
}

# The host publishes Healthy (1 when Docker reports the container healthy, 0 for any other
# state, including a missing container) once a minute from a systemd timer
# (infra/deploy/publish-container-health.sh). Minimum below 1 for three minutes in a row
# means the container was not healthy during that whole time.
#
# treat_missing_data = "breaching": no data at all means the host is down, the timer stopped
# or the publisher cannot reach CloudWatch, and in every case nobody is watching the
# containers. That must alarm, not stay quiet, so a gap counts as a failing minute. This is
# the opposite of the host alarms on purpose: they get their data from AWS itself, and a
# stopped instance is already reported by them.
resource "aws_cloudwatch_metric_alarm" "container_unhealthy" {
  for_each = local.container_services

  alarm_name          = "${var.name_prefix}-${each.key}-unhealthy"
  alarm_description   = "The ${each.key} container is unhealthy, missing, or the host stopped reporting its health (no data counts as unhealthy). On the host run docker compose ps and systemctl status app-container-health.timer; read the container logs in the CloudWatch log group /${var.name_prefix}/${each.key}."
  namespace           = var.container_health_namespace
  metric_name         = "Healthy"
  dimensions          = { Service = each.key }
  statistic           = "Minimum"
  period              = local.container_health_period
  evaluation_periods  = local.container_health_evaluations
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  tags = {
    Name = "${var.name_prefix}-${each.key}-unhealthy"
  }
}
