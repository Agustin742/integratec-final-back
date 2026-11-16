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
    error_message = "private_subnet_ids must contain at least 2 subnet ids (RDS needs two availability zones)."
  }
}

variable "host_security_group_id" {
  description = "ID of the EC2 host security group; the only source allowed to reach the database on 5432."
  type        = string
}
