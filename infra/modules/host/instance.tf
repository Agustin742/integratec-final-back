locals {
  # CRLF is normalized to LF because a Windows checkout with autocrlf would
  # otherwise ship carriage returns that break the script on Linux.
  user_data = replace(templatefile("${path.module}/user_data.sh.tftpl", {
    compose_version = var.docker_compose_version
    compose_sha256  = var.docker_compose_sha256
  }), "\r\n", "\n")
}

# Latest Amazon Linux 2023 x86_64 AMI published by AWS.
data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_instance" "host" {
  ami                    = nonsensitive(data.aws_ssm_parameter.al2023_ami.value)
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.host.id]
  iam_instance_profile   = aws_iam_instance_profile.host.name
  user_data              = local.user_data

  # No key pair and no SSH: administration is through SSM Session Manager.

  # IMDSv2 only. Hop limit 2 lets containers (one extra network hop) reach the
  # metadata service for the instance role credentials later; with 1 they could not.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    encrypted             = true
    delete_on_termination = true
  }

  tags = {
    Name = "${var.name_prefix}-host"
  }

  lifecycle {
    # The AMI parameter moves whenever AWS publishes a new image; without this
    # every plan would propose replacing the host (and its running containers).
    # An AMI upgrade is a deliberate replacement:
    #   terraform apply -replace=module.host.aws_instance.host
    ignore_changes = [ami]
  }
}

# The subnet does not auto-assign public IPs, so the Elastic IP is the only public
# address. It is attached through the EIP resource itself (one resource, no separate
# association to keep in sync). associate_public_ip_address is not used because the
# automatic address is released on association and can show as drift.
resource "aws_eip" "host" {
  domain   = "vpc"
  instance = aws_instance.host.id

  tags = {
    Name = "${var.name_prefix}-host-eip"
  }
}
