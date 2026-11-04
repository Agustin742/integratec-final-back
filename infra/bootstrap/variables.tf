variable "region" {
  description = "AWS region that hosts the Terraform state bucket (decision D5)."
  type        = string
  default     = "sa-east-1"
}

variable "project" {
  description = "Lowercase project prefix used in resource names and the Project tag."
  type        = string
  default     = "aula-virtual"
}
