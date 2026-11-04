terraform {
  required_version = "~> 1.16"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.71"
    }
  }

  # Partial configuration: the bucket name contains the AWS account ID, so it is
  # supplied at init time with -backend-config (see prod.s3.tfbackend.example).
  backend "s3" {
    key          = "prod/terraform.tfstate"
    region       = "sa-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
