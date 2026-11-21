variable "name_prefix" {
  description = "Prefix for resource names, including project and environment (for example aula-virtual-prod)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,60}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3 to 62 characters: lowercase letters, digits and hyphens only, starting with a letter and ending with a letter or digit."
  }
}

variable "role_name" {
  description = "Name of the host instance role the runtime policy is attached to (output instance_role_name of modules/host)."
  type        = string

  validation {
    condition     = length(var.role_name) > 0
    error_message = "role_name must not be empty."
  }
}

variable "ecr_repository_arns" {
  description = "ARN of each ECR repository the host pulls from, keyed by service name."
  type        = map(string)

  validation {
    condition     = length(var.ecr_repository_arns) > 0 && alltrue([for a in values(var.ecr_repository_arns) : a != "" && !strcontains(a, "*")])
    error_message = "ecr_repository_arns must be a non-empty map of exact ARNs (no wildcards)."
  }
}

variable "secret_arns" {
  description = "Exact ARNs of the Secrets Manager secrets the host reads (app secrets and the RDS master secret)."
  type        = list(string)

  validation {
    condition     = length(var.secret_arns) > 0 && alltrue([for a in var.secret_arns : a != "" && !strcontains(a, "*")])
    error_message = "secret_arns must be a non-empty list of exact ARNs (no wildcards)."
  }
}

variable "ssm_parameter_arns" {
  description = "Exact ARNs of the SSM config parameters the host reads (ssm:GetParameters)."
  type        = list(string)

  validation {
    condition     = length(var.ssm_parameter_arns) > 0 && alltrue([for a in var.ssm_parameter_arns : a != "" && !strcontains(a, "*")])
    error_message = "ssm_parameter_arns must be a non-empty list of exact ARNs (no wildcards)."
  }
}

variable "ssm_parameter_path_arns" {
  description = "ARN of each config path (parameter/<prefix>/config/<service>) the host lists with ssm:GetParametersByPath; the module also allows the children of each path."
  type        = list(string)

  validation {
    condition     = length(var.ssm_parameter_path_arns) > 0 && alltrue([for a in var.ssm_parameter_path_arns : a != "" && !strcontains(a, "*")])
    error_message = "ssm_parameter_path_arns must be a non-empty list of exact ARNs (no wildcards)."
  }
}

variable "s3_bucket_arn" {
  description = "ARN of the files bucket; object access is granted on \"<arn>/*\"."
  type        = string

  validation {
    condition     = can(regex("^arn:aws[a-z-]*:s3:::[^*/]+$", var.s3_bucket_arn))
    error_message = "s3_bucket_arn must be the exact ARN of a bucket (arn:<partition>:s3:::<name>), with no wildcards and no object path."
  }
}

variable "host_files_bucket_arn" {
  description = "ARN of the pipeline artifact bucket; the deploy pipeline publishes the host files under host-files/ and the host may read only those objects (\"<arn>/host-files/*\")."
  type        = string

  validation {
    condition     = length(var.host_files_bucket_arn) > 0 && !strcontains(var.host_files_bucket_arn, "*") && !strcontains(var.host_files_bucket_arn, "/")
    error_message = "host_files_bucket_arn must be the exact ARN of a bucket, with no wildcards and no object path."
  }
}

variable "log_services" {
  description = "Containers that get a CloudWatch log group, named /<name_prefix>/<service>."
  type        = set(string)
  default     = ["api", "realtime", "caddy"]

  validation {
    condition     = length(var.log_services) > 0 && alltrue([for s in var.log_services : can(regex("^[a-z][a-z0-9-]*[a-z0-9]$", s))])
    error_message = "log_services must be a non-empty set of lowercase names (letters, digits and hyphens)."
  }
}

variable "retention_in_days" {
  description = "Days the log groups keep events; must be a value CloudWatch Logs accepts."
  type        = number
  default     = 14

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.retention_in_days)
    error_message = "retention_in_days must be one of the values CloudWatch Logs supports (1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653)."
  }
}

variable "container_health_namespace" {
  description = "CloudWatch namespace the host may publish metrics to with cloudwatch:PutMetricData (the container health metric); no other namespace is allowed."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.#:/-]{1,255}$", var.container_health_namespace)) && !startswith(var.container_health_namespace, "AWS/")
    error_message = "container_health_namespace must be 1 to 255 characters of letters, digits and _ . # : / -, and must not start with AWS/ (reserved by AWS)."
  }
}
