# Security group of the database. It uses name_prefix with create_before_destroy so
# a change that forces replacement builds the new group first: a fixed name would
# clash with the old group, which cannot be deleted while the instance uses it.
resource "aws_security_group" "database" {
  name_prefix = "${var.name_prefix}-db-sg-"
  description = "Database: PostgreSQL 5432 from the EC2 host security group only"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-db-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# The only way in: PostgreSQL from the host security group. There is no CIDR
# ingress, so nothing outside the host can reach the database. Rules are standalone
# resources (not inline blocks) so later issues can add rules without fighting this
# group.
resource "aws_vpc_security_group_ingress_rule" "postgres_from_host" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = var.host_security_group_id
  description                  = "PostgreSQL from the EC2 host security group"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432

  # Recreated before the old rule goes away when the group is replaced.
  lifecycle {
    create_before_destroy = true
  }
}

# There are deliberately no egress rules: RDS does not initiate connections, and the
# AWS provider removes the default allow-all egress rule of a security group it
# manages in a VPC, so this group allows no outbound traffic.
