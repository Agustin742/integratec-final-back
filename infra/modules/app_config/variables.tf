variable "name_prefix" {
  description = "Prefix for resource names, including project and environment (for example aula-virtual-prod)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,60}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3 to 62 characters: lowercase letters, digits and hyphens only, starting with a letter and ending with a letter or digit."
  }
}

variable "region" {
  description = "AWS region of the environment; published to the API as S3_REGION (the bucket lives in the same region)."
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]$", var.region))
    error_message = "region must be an AWS region code such as us-east-2."
  }
}

variable "allowed_origins" {
  description = "Browser origins the API accepts (CORS), published as ALLOWED_ORIGINS joined with commas."
  type        = list(string)

  validation {
    condition     = length(var.allowed_origins) > 0 && alltrue([for o in var.allowed_origins : can(regex("^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$", o))])
    error_message = "allowed_origins must list at least one https origin without path, query or trailing slash, such as https://app.example.com."
  }
}

variable "password_reset_url_base" {
  description = "Frontend page that receives the password reset token, published as PASSWORD_RESET_URL_BASE."
  type        = string

  validation {
    condition     = can(regex("^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^?#[:space:]]*)?$", var.password_reset_url_base))
    error_message = "password_reset_url_base must be an absolute https URL without query string or fragment, such as https://app.example.com/reset-password."
  }
}

variable "secret_recovery_window_in_days" {
  description = "Days a deleted secret stays recoverable (7 to 30)."
  type        = number
  default     = 7

  validation {
    condition     = var.secret_recovery_window_in_days >= 7 && var.secret_recovery_window_in_days <= 30 && floor(var.secret_recovery_window_in_days) == var.secret_recovery_window_in_days
    error_message = "secret_recovery_window_in_days must be a whole number between 7 and 30."
  }
}
