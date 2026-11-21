variable "name_prefix" {
  description = "Prefix for resource names, including project and environment (for example aula-virtual-prod)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,60}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3 to 62 characters: lowercase letters, digits and hyphens only, starting with a letter and ending with a letter or digit."
  }
}

variable "alert_email_addresses" {
  description = "Addresses that receive the alarm notifications (SNS email subscriptions) and the budget notifications. The caller validates them."
  type        = list(string)
}

variable "monthly_budget_usd" {
  description = "Monthly cost limit of the account in USD; the budget notifications are percentages of it."
  type        = number
}

variable "host_instance_id" {
  description = "ID of the EC2 host the status and CPU alarms watch."
  type        = string
}

variable "database_instance_identifier" {
  description = "Identifier of the RDS instance the storage alarm and the event subscription watch."
  type        = string
}

variable "container_health_namespace" {
  description = "CloudWatch namespace where the host publishes the Healthy metric of each container (script infra/deploy/publish-container-health.sh); the container alarms watch it."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.#:/-]{1,255}$", var.container_health_namespace)) && !startswith(var.container_health_namespace, "AWS/")
    error_message = "container_health_namespace must be 1 to 255 characters of letters, digits and _ . # : / -, and must not start with AWS/ (reserved by AWS)."
  }
}
