variable "name_prefix" {
  description = "Prefix for resource names, including project and environment (for example aula-virtual-prod)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,60}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3 to 62 characters: lowercase letters, digits and hyphens only, starting with a letter and ending with a letter or digit."
  }
}

variable "services" {
  description = "Services that get an ECR repository, named <name_prefix>-<service>."
  type        = set(string)
  default     = ["api", "realtime"]

  validation {
    condition     = length(var.services) > 0 && alltrue([for s in var.services : can(regex("^[a-z][a-z0-9-]*[a-z0-9]$", s))])
    error_message = "services must be a non-empty set of lowercase names (letters, digits and hyphens)."
  }
}

variable "max_image_count" {
  description = "Number of most recent images kept per repository; older ones expire."
  type        = number
  default     = 10

  validation {
    condition     = var.max_image_count >= 1 && floor(var.max_image_count) == var.max_image_count
    error_message = "max_image_count must be an integer greater than or equal to 1."
  }
}

variable "untagged_expiry_days" {
  description = "Days after push when untagged images expire."
  type        = number
  default     = 7

  validation {
    condition     = var.untagged_expiry_days >= 1 && floor(var.untagged_expiry_days) == var.untagged_expiry_days
    error_message = "untagged_expiry_days must be an integer greater than or equal to 1."
  }
}
