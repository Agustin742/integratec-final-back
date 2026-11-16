mock_provider "aws" {
  # The mock generates random values for computed nested blocks, so the managed
  # master user secret is pinned to a well-formed value.
  override_resource {
    target = module.database.aws_db_instance.this
    values = {
      address  = "aula-virtual-prod-db.abcdefghij.us-east-2.rds.amazonaws.com"
      endpoint = "aula-virtual-prod-db.abcdefghij.us-east-2.rds.amazonaws.com:5432"
      port     = 5432
      master_user_secret = [{
        secret_arn    = "arn:aws:secretsmanager:us-east-2:123456789012:secret:rds!db-00000000-0000-0000-0000-000000000000-AbCdEf"
        kms_key_id    = "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000000"
        secret_status = "active"
      }]
    }
  }
}

variables {
  project = "aula-virtual"
}

run "instance_engine_and_sizing" {
  command = apply

  assert {
    condition     = module.database.instance_settings.engine == "postgres" && module.database.instance_settings.engine_version == "16"
    error_message = "The instance must run PostgreSQL pinned to major version 16."
  }

  assert {
    condition     = module.database.instance_settings.instance_class == "db.t4g.micro"
    error_message = "The default instance class must be db.t4g.micro."
  }

  assert {
    condition     = module.database.instance_settings.storage_type == "gp3" && module.database.instance_settings.allocated_storage == 20
    error_message = "Storage must be 20 GiB of gp3."
  }

  assert {
    condition     = module.database.instance_settings.multi_az == false
    error_message = "The instance must be single-AZ."
  }

  assert {
    condition     = module.database.instance_settings.identifier == "${var.project}-prod-db"
    error_message = "The instance identifier must be <prefix>-db."
  }
}

run "instance_is_private_encrypted_and_protected" {
  command = apply

  assert {
    condition     = module.database.instance_settings.storage_encrypted == true
    error_message = "Storage must be encrypted."
  }

  assert {
    condition     = module.database.instance_settings.publicly_accessible == false
    error_message = "The instance must not be publicly accessible."
  }

  assert {
    condition     = module.database.instance_settings.deletion_protection == true
    error_message = "Deletion protection must be enabled."
  }

  assert {
    condition     = module.database.instance_settings.skip_final_snapshot == false && can(regex("^[a-z][a-z0-9]*(-[a-z0-9]+)*$", module.database.instance_settings.final_snapshot_identifier))
    error_message = "A final snapshot with a valid identifier must be taken on deletion."
  }

  assert {
    condition     = module.database.instance_settings.backup_retention_period == 7
    error_message = "Backups must be retained for 7 days by default."
  }

  assert {
    condition     = module.database.instance_settings.apply_immediately == false
    error_message = "Changes must wait for the maintenance window."
  }
}

run "instance_uses_the_database_network_resources" {
  command = apply

  assert {
    condition     = module.database.instance_settings.db_subnet_group_name == module.database.subnet_group_name
    error_message = "The instance must use the database subnet group."
  }

  assert {
    condition     = toset(module.database.instance_settings.vpc_security_group_ids) == toset([module.database.security_group_id])
    error_message = "The instance must use only the database security group."
  }
}

run "master_credentials_are_managed_by_rds" {
  command = apply

  assert {
    condition     = module.database.instance_settings.manage_master_user_password == true
    error_message = "The master password must be generated and stored by RDS in Secrets Manager."
  }

  assert {
    condition     = output.database_master_user_secret_arn == module.database.master_user_secret_arn && startswith(output.database_master_user_secret_arn, "arn:aws:secretsmanager:")
    error_message = "The root must expose the master user secret ARN."
  }

  assert {
    condition     = output.database_endpoint == module.database.endpoint && output.database_port == 5432 && output.database_name == module.database.db_name
    error_message = "The root must expose the endpoint, port and database name."
  }
}

run "outputs_never_expose_credentials" {
  command = plan

  assert {
    condition     = var.project != "" && length(regexall("(?m)^output[[:space:]]+\"[a-z_]*(password|username)[a-z_]*\"", file("outputs.tf"))) == 0
    error_message = "The root must not output the master username or password."
  }

  assert {
    condition     = var.project != "" && length(regexall("(?m)^output[[:space:]]+\"[a-z_]*(password|username)[a-z_]*\"", file("../../modules/database/outputs.tf"))) == 0
    error_message = "The database module must not output the master username or password."
  }
}

run "database_module_instance_static_guards" {
  command = plan

  assert {
    condition     = var.project != "" && length(fileset("../../modules/database", "*.tf")) > 0
    error_message = "The static scan found no .tf files in modules/database; check the relative path."
  }

  assert {
    condition     = var.project != "" && length(regexall("(?m)^[[:space:]]*prevent_destroy[[:space:]]*=[[:space:]]*true[[:space:]]*$", file("../../modules/database/instance.tf"))) == 1
    error_message = "The DB instance must set prevent_destroy = true."
  }

  assert {
    condition = var.project != "" && length([
      for f in fileset("../../modules/database", "*.tf") : f
      if can(regex("(?m)^[[:space:]]*password[[:space:]]*=", file("../../modules/database/${f}")))
    ]) == 0
    error_message = "No password argument may be set anywhere in modules/database."
  }

  assert {
    condition = var.project != "" && length([
      for f in fileset("../../modules/database", "*.tf") : f
      if can(regex("(?m)^[[:space:]]*max_allocated_storage[[:space:]]*=", file("../../modules/database/${f}")))
    ]) == 0
    error_message = "Storage autoscaling (max_allocated_storage) must not be configured."
  }

  assert {
    condition     = var.project != "" && length(regexall("(?m)^[[:space:]]*publicly_accessible[[:space:]]*=[[:space:]]*false[[:space:]]*$", file("../../modules/database/instance.tf"))) == 1
    error_message = "publicly_accessible must be the literal false."
  }

  assert {
    condition     = var.project != "" && length(regexall("(?m)^[[:space:]]*deletion_protection[[:space:]]*=[[:space:]]*true[[:space:]]*$", file("../../modules/database/instance.tf"))) == 1
    error_message = "deletion_protection must be the literal true."
  }
}

run "rejects_backup_retention_of_zero" {
  command = plan

  module {
    source = "../../modules/database"
  }

  variables {
    name_prefix                       = "aula-virtual-prod"
    vpc_id                            = "vpc-0123456789abcdef0"
    private_subnet_ids                = ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"]
    private_subnet_availability_zones = ["us-east-2a", "us-east-2b"]
    host_security_group_id            = "sg-0123456789abcdef0"
    backup_retention_period           = 0
  }

  expect_failures = [var.backup_retention_period]
}

run "rejects_backup_retention_above_35" {
  command = plan

  module {
    source = "../../modules/database"
  }

  variables {
    name_prefix                       = "aula-virtual-prod"
    vpc_id                            = "vpc-0123456789abcdef0"
    private_subnet_ids                = ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"]
    private_subnet_availability_zones = ["us-east-2a", "us-east-2b"]
    host_security_group_id            = "sg-0123456789abcdef0"
    backup_retention_period           = 36
  }

  expect_failures = [var.backup_retention_period]
}

run "rejects_invalid_database_name" {
  command = plan

  module {
    source = "../../modules/database"
  }

  variables {
    name_prefix                       = "aula-virtual-prod"
    vpc_id                            = "vpc-0123456789abcdef0"
    private_subnet_ids                = ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"]
    private_subnet_availability_zones = ["us-east-2a", "us-east-2b"]
    host_security_group_id            = "sg-0123456789abcdef0"
    db_name                           = "aula-virtual"
  }

  expect_failures = [var.db_name]
}

run "rejects_reserved_master_username" {
  command = plan

  module {
    source = "../../modules/database"
  }

  variables {
    name_prefix                       = "aula-virtual-prod"
    vpc_id                            = "vpc-0123456789abcdef0"
    private_subnet_ids                = ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"]
    private_subnet_availability_zones = ["us-east-2a", "us-east-2b"]
    host_security_group_id            = "sg-0123456789abcdef0"
    master_username                   = "postgres"
  }

  expect_failures = [var.master_username]
}
