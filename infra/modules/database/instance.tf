# Production PostgreSQL. Destroying or replacing this instance must be called out in
# the pull request; prevent_destroy must be removed deliberately, in a reviewed
# change, before the database can be deleted.
resource "aws_db_instance" "this" {
  identifier = "${var.name_prefix}-db"

  # Major version only: RDS picks the minor and applies minor upgrades in the
  # maintenance window. Major upgrades stay a deliberate change.
  engine                      = "postgres"
  engine_version              = "16"
  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false

  instance_class    = var.instance_class
  allocated_storage = var.allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true
  multi_az          = false

  db_name  = var.db_name
  username = var.master_username

  # RDS generates the master password and keeps it in Secrets Manager; no password
  # is ever set in Terraform or stored in its state.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false

  # Backups are taken in the early UTC morning (03:00-04:00 in Argentina, UTC-3) and
  # maintenance runs on Sunday after the backup window, so the two never overlap.
  backup_retention_period  = var.backup_retention_period
  backup_window            = "06:00-07:00"
  maintenance_window       = "sun:08:00-sun:09:00"
  copy_tags_to_snapshot    = true
  delete_automated_backups = false

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-db-final"

  apply_immediately = false

  # No IAM database authentication, Performance Insights or log exports: monitoring
  # and alarms are added by the CloudWatch issue (#62).

  tags = {
    Name = "${var.name_prefix}-db"
  }

  lifecycle {
    prevent_destroy = true
  }
}
