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
  description = "Minutes after which the terraform apply build is stopped; longer than plan, and above the 80 minute update timeout of an RDS instance in the AWS provider, so a slow database change is not cut off halfway."
  type        = number
  default     = 120

  validation {
    condition     = var.apply_build_timeout_minutes >= 5 && var.apply_build_timeout_minutes <= 480 && floor(var.apply_build_timeout_minutes) == var.apply_build_timeout_minutes
    error_message = "apply_build_timeout_minutes must be a whole number between 5 and 480."
  }
}

variable "ecr_repository_names" {
  description = "Repository name of each service image, keyed by service name (api, realtime and migrate); the images project pushes to them."
  type        = map(string)

  validation {
    condition     = alltrue([for service in ["api", "realtime", "migrate"] : contains(keys(var.ecr_repository_names), service)])
    error_message = "ecr_repository_names must have the keys api, realtime and migrate."
  }
}

variable "ecr_repository_arns" {
  description = "Repository ARN of each service image, keyed by service name (api, realtime and migrate); the images role may push to exactly these."
  type        = map(string)

  validation {
    condition     = alltrue([for service in ["api", "realtime", "migrate"] : contains(keys(var.ecr_repository_arns), service)])
    error_message = "ecr_repository_arns must have the keys api, realtime and migrate."
  }
}

variable "images_build_timeout_minutes" {
  description = "Minutes after which the images build is stopped; it builds and pushes three Docker images on a small instance."
  type        = number
  default     = 60

  validation {
    condition     = var.images_build_timeout_minutes >= 5 && var.images_build_timeout_minutes <= 480 && floor(var.images_build_timeout_minutes) == var.images_build_timeout_minutes
    error_message = "images_build_timeout_minutes must be a whole number between 5 and 480."
  }
}

variable "host_instance_id" {
  description = "ID of the EC2 host the deploy project sends its command to; the deploy role may run commands on exactly this instance."
  type        = string

  validation {
    condition     = length(var.host_instance_id) > 0 && !strcontains(var.host_instance_id, "*") && !strcontains(var.host_instance_id, "/")
    error_message = "host_instance_id must be the exact ID of one instance (no wildcards)."
  }
}

variable "site_address" {
  description = "Public host name of the stack (output host_sslip_domain); the deploy project health-checks https://<site_address>/api/health and /realtime/health."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9.-]+$", var.site_address))
    error_message = "site_address must be a host name: letters, digits, dots and hyphens only."
  }
}

variable "deploy_build_timeout_minutes" {
  description = "Minutes after which the deploy build is stopped; it waits for the host deployment (up to 20 minutes) and the health check."
  type        = number
  default     = 30

  validation {
    condition     = var.deploy_build_timeout_minutes >= 5 && var.deploy_build_timeout_minutes <= 480 && floor(var.deploy_build_timeout_minutes) == var.deploy_build_timeout_minutes
    error_message = "deploy_build_timeout_minutes must be a whole number between 5 and 480."
  }
}

variable "github_repository" {
  description = "GitHub repository (owner/name) the pipeline watches through the connection."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "github_repository must have the form owner/name."
  }
}

variable "source_branch" {
  description = "Branch whose pushes start the pipeline."
  type        = string
  default     = "develop"

  validation {
    condition     = length(var.source_branch) > 0 && !strcontains(var.source_branch, "*")
    error_message = "source_branch must be the exact name of one branch (no wildcards)."
  }
}

variable "approval_timeout_minutes" {
  description = "Minutes the manual approval waits for a decision. When it expires the run fails at the Approval stage and nothing is applied, built or deployed; the next push starts a fresh run. CodePipeline accepts 5 minutes to 7 days."
  type        = number
  default     = 1440

  validation {
    condition     = var.approval_timeout_minutes >= 5 && var.approval_timeout_minutes <= 10080 && floor(var.approval_timeout_minutes) == var.approval_timeout_minutes
    error_message = "approval_timeout_minutes must be a whole number between 5 and 10080 (7 days)."
  }
}
