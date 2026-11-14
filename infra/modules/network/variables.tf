variable "name_prefix" {
  description = "Prefix for resource names, including project and environment (for example aula-virtual-prod)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,60}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be lowercase letters, digits and hyphens."
  }
}

variable "vpc_cidr" {
  description = "IPv4 CIDR block of the VPC. Must be a /16 so the /24 subnets carved from it fit."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && try(tonumber(split("/", var.vpc_cidr)[1]) == 16, false)
    error_message = "vpc_cidr must be a valid IPv4 CIDR block with a /16 prefix, such as 10.0.0.0/16."
  }
}

variable "private_subnet_count" {
  description = "Number of private subnets (one per availability zone) for the RDS subnet group; between 2 and 3."
  type        = number
  default     = 2

  validation {
    condition     = var.private_subnet_count >= 2 && var.private_subnet_count <= 3 && floor(var.private_subnet_count) == var.private_subnet_count
    error_message = "private_subnet_count must be an integer between 2 and 3."
  }
}
