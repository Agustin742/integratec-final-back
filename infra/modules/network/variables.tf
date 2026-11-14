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
    condition     = try(can(cidrnetmask(var.vpc_cidr)) && cidrsubnet(var.vpc_cidr, 0, 0) == var.vpc_cidr && split("/", var.vpc_cidr)[1] == "16", false)
    error_message = "vpc_cidr must be an IPv4 network address with a /16 prefix, such as 10.0.0.0/16 (no host bits set)."
  }
}

variable "availability_zones" {
  description = "Availability zones to use, in order: the public subnet goes in the first one and one private subnet is created per zone. At least two distinct zones (RDS subnet group requirement)."
  type        = list(string)
  default     = ["us-east-2a", "us-east-2b"]

  validation {
    condition     = length(var.availability_zones) >= 2 && length(distinct(var.availability_zones)) == length(var.availability_zones)
    error_message = "availability_zones must list at least two distinct availability zones."
  }
}
