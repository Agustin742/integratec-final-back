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


variable "instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"

  validation {
    condition     = can(regex("^db[.][a-z0-9]+[.][a-z0-9]+$", var.instance_class))
    error_message = "instance_class must look like db.t4g.micro."
  }
}

variable "allocated_storage" {
  description = "Allocated storage in GiB (gp3). Storage autoscaling is intentionally not configured."
  type        = number
  default     = 20

  validation {
    condition     = var.allocated_storage >= 20 && var.allocated_storage <= 65536 && var.allocated_storage == floor(var.allocated_storage)
    error_message = "allocated_storage must be a whole number of GiB between 20 and 65536."
  }
}

variable "db_name" {
  description = "Name of the initial PostgreSQL database."
  type        = string
  default     = "aula_virtual"

  validation {
    condition     = can(regex("^[a-z][a-z0-9_]{0,62}$", var.db_name))
    error_message = "db_name must be 1 to 63 characters: lowercase letters, digits and underscores, starting with a letter."
  }
}

variable "master_username" {
  description = "Master user name. The password is generated and stored by RDS in Secrets Manager; it is never an input."
  type        = string
  default     = "aula_admin"

  validation {
    condition     = can(regex("^[a-z][a-z0-9_]{0,62}$", var.master_username))
    error_message = "master_username must be 1 to 63 characters: lowercase letters, digits and underscores, starting with a letter."
  }

  validation {
    condition     = !contains(["postgres", "admin", "rdsadmin", "rds_superuser", "public", "root"], var.master_username) && !startswith(var.master_username, "pg_") && !startswith(var.master_username, "rds")
    error_message = "master_username must not be a reserved name (postgres, admin, rdsadmin, rds_superuser, public, root) nor start with pg_ or rds."
  }
}

variable "backup_retention_period" {
  description = "Days to keep automated backups (point-in-time recovery window), 1 to 35."
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_period >= 1 && var.backup_retention_period <= 35 && var.backup_retention_period == floor(var.backup_retention_period)
    error_message = "backup_retention_period must be a whole number of days between 1 and 35."
  }
}
