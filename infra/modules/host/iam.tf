# Instance role of the host. This module only attaches SSM Session Manager access
# (AmazonSSMManagedInstanceCore). The deployment permissions (ECR pull, secrets,
# config, files bucket, log writes) live in modules/runtime_access, which attaches
# one inline policy to this role by name (instance_role_name).
resource "aws_iam_role" "host" {
  name = "${var.name_prefix}-host-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  tags = {
    Name = "${var.name_prefix}-host-role"
  }
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "host" {
  name = "${var.name_prefix}-host-profile"
  role = aws_iam_role.host.name

  tags = {
    Name = "${var.name_prefix}-host-profile"
  }
}
