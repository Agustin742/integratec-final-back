# Places the database in the private subnets, one per availability zone. It uses
# name_prefix with create_before_destroy for the same reason as the security group:
# a fixed name blocks replacement once an RDS instance is attached to the group.
resource "aws_db_subnet_group" "this" {
  name_prefix = "${var.name_prefix}-db-subnets-"
  subnet_ids  = var.private_subnet_ids

  tags = {
    Name = "${var.name_prefix}-db-subnets"
  }

  lifecycle {
    create_before_destroy = true
  }
}
