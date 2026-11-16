variable "name_prefix" {
  description = "Prefix for resource names, including project and environment (for example aula-virtual-prod). At most 30 characters: S3 limits bucket_prefix to 37 and the module appends -files-."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,28}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3 to 30 characters (the bucket prefix <name_prefix>-files- is limited to 37 by S3): lowercase letters, digits and hyphens only, starting with a letter and ending with a letter or digit."
  }
}

variable "noncurrent_version_expiration_days" {
  description = "Days after which noncurrent object versions (overwritten or deleted objects) are permanently removed."
  type        = number
  default     = 30

  validation {
    condition     = var.noncurrent_version_expiration_days >= 1 && floor(var.noncurrent_version_expiration_days) == var.noncurrent_version_expiration_days
    error_message = "noncurrent_version_expiration_days must be an integer greater than or equal to 1."
  }
}
