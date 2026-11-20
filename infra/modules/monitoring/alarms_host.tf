locals {
  host_status_period             = 60
  host_status_evaluation_periods = 2
  host_cpu_threshold_percent     = 80
  host_cpu_period                = 300
  host_cpu_evaluation_periods    = 3 # 3 x 5 minutes: sustained load, not a deploy spike.
}

# A failed instance check means the guest OS or its network is not responding (the
# containers on it are down with it). AWS publishes 0 or 1 once a minute, so Maximum over
# two minutes needs two consecutive failing minutes and ignores a one-off blip.
#
# treat_missing_data = "missing": while the instance is stopped, EC2 publishes no status
# data at all. "missing" keeps the alarm in its current state, so a stop made on purpose
# does not raise a false alarm (and "breaching" would). A crashed instance still reports
# failed checks, which do alarm.
resource "aws_cloudwatch_metric_alarm" "host_status_instance" {
  alarm_name          = "${var.name_prefix}-host-status-instance"
  alarm_description   = "The host instance status check is failing (guest OS or network unresponsive). Check the console status checks and SSM, then reboot the instance."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_Instance"
  dimensions          = { InstanceId = var.host_instance_id }
  statistic           = "Maximum"
  period              = local.host_status_period
  evaluation_periods  = local.host_status_evaluation_periods
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  tags = {
    Name = "${var.name_prefix}-host-status-instance"
  }
}

# A failed system check means the AWS hardware under the host has a problem. Stopping and
# starting the instance moves it to other hardware (a reboot does not). Missing data is
# treated as "missing" for the same reason as the instance check.
resource "aws_cloudwatch_metric_alarm" "host_status_system" {
  alarm_name          = "${var.name_prefix}-host-status-system"
  alarm_description   = "The host system status check is failing (AWS hardware or network problem). Stop and start the instance to move it to healthy hardware, and check the AWS Health Dashboard."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = { InstanceId = var.host_instance_id }
  statistic           = "Maximum"
  period              = local.host_status_period
  evaluation_periods  = local.host_status_evaluation_periods
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  tags = {
    Name = "${var.name_prefix}-host-status-system"
  }
}

# Average CPU above 80 % for 15 minutes: the containers are starved and the t3 burst
# credits may be running out.
#
# treat_missing_data = "missing": a stopped or dead host is reported by the status
# alarms, so a gap in the CPU data must not flip this alarm either way.
resource "aws_cloudwatch_metric_alarm" "host_cpu" {
  alarm_name          = "${var.name_prefix}-host-cpu-high"
  alarm_description   = "Host CPU has averaged above ${local.host_cpu_threshold_percent} percent for 15 minutes. Check which container uses the CPU (docker stats) and the CPU credit balance of the instance."
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  dimensions          = { InstanceId = var.host_instance_id }
  statistic           = "Average"
  period              = local.host_cpu_period
  evaluation_periods  = local.host_cpu_evaluation_periods
  threshold           = local.host_cpu_threshold_percent
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  tags = {
    Name = "${var.name_prefix}-host-cpu-high"
  }
}
