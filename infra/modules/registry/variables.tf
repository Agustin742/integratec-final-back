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

variable "release_tag_prefix" {
  description = "Tag prefix that marks deployable images; the deploy pipeline must tag every image meant to run with it."
  type        = string
  default     = "release-"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]{1,128}$", var.release_tag_prefix))
    error_message = "release_tag_prefix must be 1 to 128 characters of letters, digits, underscores, periods and hyphens (the characters ECR allows in tags)."
  }
}

variable "max_release_images" {
  description = "Number of most recent release-tagged images kept per repository; older ones expire."
  type        = number
  default     = 20

  validation {
    condition     = var.max_release_images >= 1 && floor(var.max_release_images) == var.max_release_images
    error_message = "max_release_images must be an integer greater than or equal to 1."
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

variable "non_release_expiry_days" {
  description = "Days after push when tagged images without the release prefix (for example CI builds) expire."
  type        = number
  default     = 30

  validation {
    condition     = var.non_release_expiry_days >= 1 && floor(var.non_release_expiry_days) == var.non_release_expiry_days
    error_message = "non_release_expiry_days must be an integer greater than or equal to 1."
  }
}
