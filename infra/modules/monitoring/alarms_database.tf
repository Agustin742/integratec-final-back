locals {
  database_free_storage_threshold_bytes = 2 * 1024 * 1024 * 1024 # 2 GiB of the 20 GiB volume.
}

# Less than 2 GiB free, on the lowest value of two 5-minute periods, leaves time to
# grow the volume or clean up before the database stops accepting writes.
#
# treat_missing_data = "missing": RDS publishes this metric continuously while the
# instance runs. A gap (instance stopped or rebooting) must not flip the state; the
# event subscription below reports availability problems.
resource "aws_cloudwatch_metric_alarm" "database_free_storage" {
  alarm_name          = "${var.name_prefix}-database-free-storage-low"
  alarm_description   = "Database free storage is below 2 GiB. Check what is growing (tables, WAL, logs) and increase the allocated storage before the instance runs out of space."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = var.database_instance_identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = local.database_free_storage_threshold_bytes
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  tags = {
    Name = "${var.name_prefix}-database-free-storage-low"
  }
}

# RDS availability signal: the service itself reports shutdowns, restarts, failovers,
# failures and recovery. It costs nothing, unlike an alarm.
#
# Topic policy: RDS publishes to the topic through the service. AWS documents that this
# works with the default topic policy when the topic is in the same account and is not
# encrypted with KMS. The alarm topic is a standard, unencrypted topic in this account,
# so no extra policy is added. If the topic is ever encrypted with a customer managed
# key, the key policy must allow events.rds.amazonaws.com.
resource "aws_db_event_subscription" "database" {
  name             = "${var.name_prefix}-db-events"
  sns_topic        = aws_sns_topic.alarms.arn
  source_type      = "db-instance"
  source_ids       = [var.database_instance_identifier]
  event_categories = ["availability", "failure", "low storage", "recovery"]
  enabled          = true

  tags = {
    Name = "${var.name_prefix}-db-events"
  }
}
