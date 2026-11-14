variable "name_prefix" {
  description = "Prefix for resource names, including project and environment (for example aula-virtual-prod)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,60}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3 to 62 characters: lowercase letters, digits and hyphens only, starting with a letter and ending with a letter or digit."
  }
}

variable "vpc_id" {
  description = "ID of the VPC that holds the host."
  type        = string
}

variable "subnet_id" {
  description = "ID of the public subnet the host is launched in."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type of the host. Limited to x86_64 burstable types so container images stay amd64 and the AMI lookup stays valid."
  type        = string
  default     = "t3.small"

  validation {
    condition     = contains(["t3.small", "t3.medium", "t3.large", "t3a.small", "t3a.medium", "t3a.large"], var.instance_type)
    error_message = "instance_type must be an x86_64 burstable type: t3.small, t3.medium, t3.large, t3a.small, t3a.medium or t3a.large."
  }
}

variable "root_volume_size_gb" {
  description = "Size in GiB of the encrypted gp3 root volume (room for Docker images and logs)."
  type        = number
  default     = 20

  validation {
    condition     = var.root_volume_size_gb == floor(var.root_volume_size_gb) && var.root_volume_size_gb >= 20 && var.root_volume_size_gb <= 100
    error_message = "root_volume_size_gb must be a whole number between 20 and 100."
  }
}

variable "docker_compose_version" {
  description = "Pinned docker/compose release installed as the Docker CLI plugin (not packaged in Amazon Linux 2023)."
  type        = string
  default     = "v5.7.1"

  validation {
    condition     = can(regex("^v[0-9]+[.][0-9]+[.][0-9]+$", var.docker_compose_version))
    error_message = "docker_compose_version must be a release tag such as v5.7.1."
  }
}

variable "docker_compose_sha256" {
  description = "SHA-256 of the docker-compose-linux-x86_64 asset of docker_compose_version, taken from the release .sha256 asset; the user data refuses to install a binary that does not match. Update it together with the version."
  type        = string
  default     = "af426722a8af5de812fcee30cc1c39f0639f5f723cbadefb25e5d4db054064cf"

  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.docker_compose_sha256))
    error_message = "docker_compose_sha256 must be 64 lowercase hexadecimal characters."
  }
}
