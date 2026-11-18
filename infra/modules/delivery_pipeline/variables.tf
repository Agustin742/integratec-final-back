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
