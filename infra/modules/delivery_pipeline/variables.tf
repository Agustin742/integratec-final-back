variable "name_prefix" {
  description = "Prefix for resource names, including project and environment (for example aula-virtual-prod). At most 17 characters: S3 limits bucket_prefix to 37 and the module appends -pipeline-artifacts-."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,15}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3 to 17 characters (the bucket prefix <name_prefix>-pipeline-artifacts- is limited to 37 by S3): lowercase letters, digits and hyphens only, starting with a letter and ending with a letter or digit."
  }
}

variable "artifact_expiration_days" {
  description = "Days after which pipeline artifacts (and any noncurrent versions) are permanently removed from the artifact bucket."
  type        = number
  default     = 30

  validation {
    condition     = var.artifact_expiration_days >= 1 && floor(var.artifact_expiration_days) == var.artifact_expiration_days
    error_message = "artifact_expiration_days must be an integer greater than or equal to 1."
  }
}

variable "retention_in_days" {
  description = "Days the CodeBuild log group keeps events; must be a value CloudWatch Logs accepts."
  type        = number
  default     = 14

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.retention_in_days)
    error_message = "retention_in_days must be one of the values CloudWatch Logs supports (1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653)."
  }
}

variable "project" {
  description = "Project prefix of the Terraform state bucket (<project>-tfstate-<account id>, created by infra/bootstrap); also injected into the runner as TF_VAR_project."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}[a-z0-9]$", var.project))
    error_message = "project must be lowercase letters, digits and hyphens (3 to 32 characters)."
  }
}

variable "region" {
  description = "AWS region of the prod environment; scopes the ARNs of the runner roles and is injected as TF_VAR_region."
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]$", var.region))
    error_message = "region must be an AWS region code such as us-east-2."
  }
}

variable "state_key" {
  description = "Object key of the prod Terraform state in the state bucket; the S3 native lock file is the same key plus .tflock."
  type        = string
  default     = "prod/terraform.tfstate"
}

variable "allowed_origins" {
  description = "Value of the prod root variable of the same name, injected as TF_VAR_allowed_origins so the pipeline plan equals the local one."
  type        = list(string)
}

variable "password_reset_url_base" {
  description = "Value of the prod root variable of the same name, injected as TF_VAR_password_reset_url_base."
  type        = string
}

variable "enable_github_oidc" {
  description = "Value of the prod root variable of the same name, injected as TF_VAR_enable_github_oidc."
  type        = bool
  default     = false
  nullable    = false
}

variable "plan_build_timeout_minutes" {
  description = "Minutes after which the terraform plan build is stopped."
  type        = number
  default     = 30

  validation {
    condition     = var.plan_build_timeout_minutes >= 5 && var.plan_build_timeout_minutes <= 480 && floor(var.plan_build_timeout_minutes) == var.plan_build_timeout_minutes
    error_message = "plan_build_timeout_minutes must be a whole number between 5 and 480."
  }
}

variable "apply_build_timeout_minutes" {
  description = "Minutes after which the terraform apply build is stopped; longer than plan because creating resources such as RDS instances takes minutes."
  type        = number
  default     = 60

  validation {
    condition     = var.apply_build_timeout_minutes >= 5 && var.apply_build_timeout_minutes <= 480 && floor(var.apply_build_timeout_minutes) == var.apply_build_timeout_minutes
    error_message = "apply_build_timeout_minutes must be a whole number between 5 and 480."
  }
}
