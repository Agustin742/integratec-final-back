variable "region" {
  description = "AWS region for the prod environment (decision D5)."
  type        = string
  default     = "us-east-2"

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]$", var.region))
    error_message = "region must be an AWS region code such as us-east-2."
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

variable "github_repository" {
  description = "GitHub repository (owner/name) whose workflows may assume the CI role (decision D6)."
  type        = string
  default     = "Agustin742/integratec-final-back"

  validation {
    condition     = can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "github_repository must have the form owner/name."
  }
}

variable "github_branch" {
  description = "Only workflows running on this branch may assume the CI role."
  type        = string
  default     = "main"

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$", var.github_branch)) && !strcontains(var.github_branch, "..")
    error_message = "github_branch must be a single branch name: no wildcards, no leading or trailing slash, no '..'."
  }
}

variable "enable_github_oidc" {
  description = "Create the GitHub Actions OIDC provider and CI role (decision D6). Disabled by default because an AWS-managed service control policy in the current account denies iam:CreateOpenIDConnectProvider; set it to true once that restriction is lifted."
  type        = bool
  default     = false
  nullable    = false
}
