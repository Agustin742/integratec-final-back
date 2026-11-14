output "security_group_id" {
  description = "ID of the host security group; the intended source for the RDS ingress rule added in #60."
  value       = aws_security_group.host.id
}

output "security_group_name" {
  description = "Generated name of the host security group."
  value       = aws_security_group.host.name
}

output "security_group_name_prefix" {
  description = "Name prefix of the host security group."
  value       = aws_security_group.host.name_prefix
}

output "security_group_tags" {
  description = "Tags set on the host security group."
  value       = aws_security_group.host.tags
}

output "security_group_vpc_id" {
  description = "ID of the VPC the host security group belongs to."
  value       = aws_security_group.host.vpc_id
}

output "ingress_rules" {
  description = "Ingress rules of the host security group (protocol, ports and source), derived from the single ingress rule resource, for tests and review."
  value = [
    for r in values(aws_vpc_security_group_ingress_rule.this) : {
      ip_protocol = r.ip_protocol
      from_port   = r.from_port
      to_port     = r.to_port
      cidr_ipv4   = r.cidr_ipv4
      cidr_ipv6   = r.cidr_ipv6
    }
  ]
}

output "egress_rules" {
  description = "Egress rules of the host security group (protocol and destination), for tests and review."
  value = [
    for r in [aws_vpc_security_group_egress_rule.all] : {
      ip_protocol = r.ip_protocol
      cidr_ipv4   = r.cidr_ipv4
    }
  ]
}

output "instance_id" {
  description = "ID of the EC2 host."
  value       = aws_instance.host.id
}

output "public_ip" {
  description = "Elastic IP of the host (the only public address)."
  value       = aws_eip.host.public_ip
}

output "private_ip" {
  description = "Private IP of the host in the public subnet."
  value       = aws_instance.host.private_ip
}

output "instance_role_name" {
  description = "Name of the host IAM role; the deployment issue (#61) attaches its permissions to it."
  value       = aws_iam_role.host.name
}

output "instance_role_assume_role_policy" {
  description = "Trust policy of the host IAM role (JSON), for tests and review."
  value       = aws_iam_role.host.assume_role_policy
}

output "instance_role_managed_policy_arns" {
  description = "Managed policies attached to the host role, for tests and review."
  value       = [aws_iam_role_policy_attachment.ssm_core.policy_arn]
}

output "instance_profile_name" {
  description = "Name of the host instance profile."
  value       = aws_iam_instance_profile.host.name
}

output "instance_profile_role" {
  description = "Name of the role wrapped by the host instance profile."
  value       = aws_iam_instance_profile.host.role
}

output "instance_type" {
  description = "Instance type of the host."
  value       = aws_instance.host.instance_type
}

output "instance_ami" {
  description = "AMI the host was launched from."
  value       = aws_instance.host.ami
}

output "instance_subnet_id" {
  description = "Subnet the host is in."
  value       = aws_instance.host.subnet_id
}

output "instance_security_group_ids" {
  description = "Security groups attached to the host."
  value       = aws_instance.host.vpc_security_group_ids
}

output "instance_key_name" {
  description = "SSH key pair of the host; null by design."
  value       = aws_instance.host.key_name
}

output "instance_iam_instance_profile" {
  description = "Instance profile attached to the host."
  value       = aws_instance.host.iam_instance_profile
}

output "instance_tags" {
  description = "Tags set on the host instance."
  value       = aws_instance.host.tags
}

output "instance_metadata_options" {
  description = "Instance metadata (IMDS) settings of the host."
  value       = aws_instance.host.metadata_options[0]
}

output "instance_root_block_device" {
  description = "Root volume settings of the host."
  value       = aws_instance.host.root_block_device[0]
}

output "user_data" {
  description = "Rendered first-boot script of the host (contains no secrets)."
  value       = aws_instance.host.user_data
}

output "eip_domain" {
  description = "Domain of the host Elastic IP."
  value       = aws_eip.host.domain
}

output "eip_instance_id" {
  description = "Instance the Elastic IP is attached to."
  value       = aws_eip.host.instance
}

output "eip_tags" {
  description = "Tags set on the Elastic IP."
  value       = aws_eip.host.tags
}
