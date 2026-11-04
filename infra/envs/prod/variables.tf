variable "region" {
  description = "AWS region for the prod environment (decision D5)."
  type        = string
  default     = "sa-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]$", var.region))
    error_message = "region must be an AWS region code such as sa-east-1."
  }
}

variable "project" {
  description = "Lowercase project prefix used in resource names and the Project tag."
  type        = string
  default     = "aula-virtual"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}[a-z0-9]$", var.project))
    error_message = "project must be lowercase letters, digits and hyphens (3 to 32 characters)."
  }
}
