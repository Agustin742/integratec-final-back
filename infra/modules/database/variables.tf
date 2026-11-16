variable "name_prefix" {
  description = "Prefix for resource names, including project and environment (for example aula-virtual-prod)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,60}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3 to 62 characters: lowercase letters, digits and hyphens only, starting with a letter and ending with a letter or digit."
  }
}

variable "vpc_id" {
  description = "ID of the VPC that holds the database."
  type        = string
}

variable "private_subnet_ids" {
  description = "IDs of the private subnets for the DB subnet group; RDS requires subnets in at least two availability zones."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "private_subnet_ids must contain at least 2 subnet ids."
  }
}

variable "private_subnet_availability_zones" {
  description = "Availability zone of each subnet in private_subnet_ids, in the same order."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_availability_zones) == length(var.private_subnet_ids)
    error_message = "private_subnet_availability_zones must have one entry per subnet in private_subnet_ids."
  }

  validation {
    condition     = length(toset(var.private_subnet_availability_zones)) >= 2
    error_message = "The private subnets must span at least 2 distinct availability zones (an RDS requirement)."
  }
}

variable "host_security_group_id" {
  description = "ID of the EC2 host security group; the only source allowed to reach the database on 5432."
  type        = string
}
