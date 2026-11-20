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

variable "vpc_cidr" {
  description = "IPv4 CIDR block of the prod VPC (a /16)."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = try(can(cidrnetmask(var.vpc_cidr)) && cidrsubnet(var.vpc_cidr, 0, 0) == var.vpc_cidr && split("/", var.vpc_cidr)[1] == "16", false)
    error_message = "vpc_cidr must be an IPv4 network address with a /16 prefix, such as 10.0.0.0/16 (no host bits set)."
  }
}

variable "host_instance_type" {
  description = "EC2 instance type of the prod host (x86_64 burstable only)."
  type        = string
  default     = "t3.small"

  validation {
    condition     = contains(["t3.small", "t3.medium", "t3.large", "t3a.small", "t3a.medium", "t3a.large"], var.host_instance_type)
    error_message = "host_instance_type must be an x86_64 burstable type: t3.small, t3.medium, t3.large, t3a.small, t3a.medium or t3a.large."
  }
}

variable "host_root_volume_size_gb" {
  description = "Size in GiB of the encrypted gp3 root volume of the prod host."
  type        = number
  default     = 20

  validation {
    condition     = var.host_root_volume_size_gb == floor(var.host_root_volume_size_gb) && var.host_root_volume_size_gb >= 20 && var.host_root_volume_size_gb <= 100
    error_message = "host_root_volume_size_gb must be a whole number between 20 and 100."
  }
}

variable "availability_zones" {
  description = "Availability zones for the prod network: the public subnet goes in the first one and one private subnet is created per zone (at least two, for RDS)."
  type        = list(string)
  default     = ["us-east-2a", "us-east-2b"]

  validation {
    condition     = length(var.availability_zones) >= 2 && length(distinct(var.availability_zones)) == length(var.availability_zones)
    error_message = "availability_zones must list at least two distinct availability zones."
  }
}

variable "allowed_origins" {
  description = "Browser origins the API accepts (CORS); published to SSM as ALLOWED_ORIGINS. Required: there is no real frontend URL yet."
  type        = list(string)

  validation {
    # Must match the API check new URL(value).origin === value: lowercase host, no
    # default :443 port and no zero-padded port, since URL parsing rewrites all three.
    condition     = length(var.allowed_origins) > 0 && alltrue([for o in var.allowed_origins : can(regex("^https://[a-z0-9.-]+(:[1-9][0-9]{0,4})?$", o)) && !endswith(o, ":443")])
    error_message = "allowed_origins must list at least one canonical https origin: lowercase host, no path, query or trailing slash, and no default :443 port, such as https://app.example.com."
  }
}

variable "password_reset_url_base" {
  description = "Frontend page that receives the password reset token; published to SSM as PASSWORD_RESET_URL_BASE. Required: there is no real frontend URL yet."
  type        = string

  validation {
    condition     = can(regex("^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^?#[:space:]]*)?$", var.password_reset_url_base))
    error_message = "password_reset_url_base must be an absolute https URL without query string or fragment, such as https://app.example.com/reset-password."
  }
}

variable "database_backup_retention_period" {
  description = "Days of automated RDS backups (point-in-time restore window). Defaults to 1 because the AWS Free plan account rejects longer retention (FreeTierRestrictionError); raise it after upgrading the account plan."
  type        = number
  default     = 1
}

variable "frontend_amplify_app_id" {
  description = "ID of the Amplify app created in the console, used by the import blocks. It is not a secret; it also appears in the app ARN and in the default domain."
  type        = string
  default     = "d61i488hxxotx"

  validation {
    condition     = can(regex("^d[a-z0-9]{8,20}$", var.frontend_amplify_app_id))
    error_message = "frontend_amplify_app_id must be an Amplify app ID such as d61i488hxxotx."
  }
}

variable "frontend_repository_url" {
  description = "HTTPS URL of the frontend GitHub repository connected to Amplify."
  type        = string
  default     = "https://github.com/Agustin742/integratec-final-front"
}

variable "frontend_branch" {
  description = "Frontend branch deployed as the PRODUCTION stage of the Amplify app."
  type        = string
  default     = "develop"
}

variable "frontend_api_base_url" {
  description = "HTTPS base URL of the API compiled into the frontend as VITE_API_BASE_URL, with an optional path and no trailing slash. Null derives https://<host sslip.io name>/api, the route Caddy serves the API on."
  type        = string
  default     = null

  validation {
    condition     = var.frontend_api_base_url == null || can(regex("^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~-]+)*$", var.frontend_api_base_url)) && !can(regex("/[.]+(/|$)", var.frontend_api_base_url))
    error_message = "frontend_api_base_url must be an https base URL with an optional path, without trailing slash, query or fragment, such as https://api.example.com/api."
  }
}

variable "frontend_realtime_url" {
  description = "Secure WebSocket base URL of the realtime service compiled into the frontend as VITE_REALTIME_URL, with an optional path and no trailing slash. Null derives wss://<host sslip.io name>/realtime, the route Caddy serves realtime on."
  type        = string
  default     = null

  validation {
    condition     = var.frontend_realtime_url == null || can(regex("^wss://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~-]+)*$", var.frontend_realtime_url)) && !can(regex("/[.]+(/|$)", var.frontend_realtime_url))
    error_message = "frontend_realtime_url must be a wss base URL with an optional path, without trailing slash, query or fragment, such as wss://api.example.com/realtime."
  }
}

variable "import_existing_frontend" {
  description = "Import the console-created Amplify app and branch into the state. It only has an effect until the first apply that records them; tests set it to false because mock providers cannot import."
  type        = bool
  default     = true
  nullable    = false
}

variable "alert_email_addresses" {
  description = "Addresses that receive alarm and budget notifications. Required and kept out of git: set it in the git-ignored terraform.tfvars. Each address must confirm its SNS subscription from the inbox."
  type        = list(string)

  validation {
    condition     = length(var.alert_email_addresses) > 0
    error_message = "alert_email_addresses must list at least one address."
  }

  validation {
    condition     = alltrue([for e in var.alert_email_addresses : can(regex("^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$", e))])
    error_message = "alert_email_addresses must contain only email addresses such as alerts@example.com."
  }

  validation {
    condition     = length(distinct([for e in var.alert_email_addresses : lower(e)])) == length(var.alert_email_addresses)
    error_message = "alert_email_addresses must not repeat an address (comparison ignores case)."
  }

  validation {
    condition     = length(var.alert_email_addresses) <= 10
    error_message = "alert_email_addresses may list at most 10 addresses (AWS Budgets allows 10 email subscribers per notification)."
  }
}

variable "monthly_budget_usd" {
  description = "Monthly cost limit in USD of the AWS Budget; notifications fire at 50 % and 80 % actual and 100 % forecasted."
  type        = number
  default     = 20

  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be greater than 0."
  }
}
