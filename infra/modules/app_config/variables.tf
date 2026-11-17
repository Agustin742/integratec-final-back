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

variable "s3_bucket_name" {
  description = "Name of the files bucket, published to the API as S3_BUCKET."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.s3_bucket_name))
    error_message = "s3_bucket_name must be a valid S3 bucket name (3 to 63 characters: lowercase letters, digits, periods and hyphens)."
  }
}

variable "allowed_origins" {
  description = "Browser origins the API accepts (CORS), published as ALLOWED_ORIGINS joined with commas."
  type        = list(string)
  # Validated once, in the prod root where operators set it.
}

variable "password_reset_url_base" {
  description = "Frontend page that receives the password reset token, published as PASSWORD_RESET_URL_BASE."
  type        = string
  # Validated once, in the prod root where operators set it.
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

# Database connection info. None of it is secret: the credentials stay in the RDS-managed
# master secret, and these values only tell the host where to connect and which secret to read.
# Validation rejects null and empty values on purpose: test mocks leave the managed secret
# ARN null, and dropping it silently (compact()) would publish no DB_SECRET_ARN at all, so
# the host would fail at start instead of at plan time. Tests pin the database instance.
variable "db_host" {
  description = "DNS address of the database instance, published to the host as DB_HOST."
  type        = string

  validation {
    condition     = var.db_host != null && can(regex("^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$", var.db_host))
    error_message = "db_host must be a host name (letters, digits, periods and hyphens), without scheme or port."
  }
}

variable "db_port" {
  description = "Port the database listens on, published to the host as DB_PORT."
  type        = number

  validation {
    condition     = var.db_port != null && var.db_port >= 1 && var.db_port <= 65535 && floor(var.db_port) == var.db_port
    error_message = "db_port must be a whole number between 1 and 65535."
  }
}

variable "db_name" {
  description = "Name of the initial database, published to the host as DB_NAME."
  type        = string

  validation {
    condition     = var.db_name != null && can(regex("^[a-z][a-z0-9_]{0,62}$", var.db_name))
    error_message = "db_name must be 1 to 63 characters: lowercase letters, digits and underscores, starting with a letter."
  }
}

variable "db_secret_arn" {
  description = "ARN of the RDS-managed master user secret (the pointer, never its value), published to the host as DB_SECRET_ARN."
  type        = string

  validation {
    condition     = var.db_secret_arn != null && can(regex("^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[^*]+$", var.db_secret_arn))
    error_message = "db_secret_arn must be the ARN of a Secrets Manager secret (no wildcards); it cannot be empty."
  }
}
