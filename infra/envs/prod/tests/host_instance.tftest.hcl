mock_provider "aws" {}

# The mock returns random strings for data sources, so the AMI lookup is pinned.
override_data {
  target = module.host.data.aws_ssm_parameter.al2023_ami
  values = {
    value = "ami-0123456789abcdef0"
  }
}

# The Elastic IP address is also pinned for the whole file (the mock would
# otherwise return a random string), so the sslip.io name can be asserted.
override_resource {
  target          = module.host.aws_eip.host
  override_during = apply
  values = {
    public_ip = "203.0.113.10"
  }
}

variables {
  project = "aula-virtual"
}

run "instance_defaults_and_placement" {
  command = apply

  assert {
    condition     = module.host.instance_type == "t3.small"
    error_message = "The host must default to t3.small."
  }

  assert {
    condition     = module.host.instance_ami == "ami-0123456789abcdef0"
    error_message = "The host must use the AMI resolved from the AL2023 SSM parameter."
  }

  assert {
    condition     = module.host.instance_subnet_id == module.network.public_subnet_id
    error_message = "The host must live in the public subnet."
  }

  assert {
    condition     = toset(module.host.instance_security_group_ids) == toset([module.host.security_group_id])
    error_message = "The host must use only the host security group."
  }

  assert {
    condition     = module.host.instance_tags["Name"] == "${var.project}-prod-host"
    error_message = "The host must carry the Name tag <prefix>-host."
  }

  assert {
    condition     = module.host.instance_id != null && module.host.private_ip != null
    error_message = "The host must expose its instance id and private IP."
  }
}

run "instance_requires_imdsv2" {
  command = apply

  assert {
    condition = (
      module.host.instance_metadata_options.http_endpoint == "enabled" &&
      module.host.instance_metadata_options.http_tokens == "required"
    )
    error_message = "IMDSv2 must be required (http_tokens = required)."
  }

  assert {
    condition     = module.host.instance_metadata_options.http_put_response_hop_limit == 2
    error_message = "The hop limit must be 2 so containers can reach IMDSv2."
  }
}

run "root_volume_is_encrypted_gp3" {
  command = apply

  assert {
    condition = (
      module.host.instance_root_block_device.encrypted == true &&
      module.host.instance_root_block_device.volume_type == "gp3" &&
      module.host.instance_root_block_device.volume_size == 20 &&
      module.host.instance_root_block_device.delete_on_termination == true
    )
    error_message = "The root volume must be an encrypted 20 GiB gp3 volume deleted with the instance."
  }
}

run "elastic_ip_is_attached_to_the_instance" {
  command = apply

  assert {
    condition     = module.host.eip_domain == "vpc"
    error_message = "The Elastic IP must be in the VPC domain."
  }

  assert {
    condition     = module.host.eip_instance_id == module.host.instance_id
    error_message = "The Elastic IP must be associated with the host instance."
  }

  assert {
    condition     = module.host.eip_tags["Name"] == "${var.project}-prod-host-eip"
    error_message = "The Elastic IP must carry the Name tag <prefix>-host-eip."
  }
}

run "instance_role_trusts_ec2_and_only_has_ssm_core" {
  command = apply

  assert {
    condition = (
      length(jsondecode(module.host.instance_role_assume_role_policy).Statement) == 1 &&
      jsondecode(module.host.instance_role_assume_role_policy).Statement[0].Principal.Service == "ec2.amazonaws.com" &&
      jsondecode(module.host.instance_role_assume_role_policy).Statement[0].Action == "sts:AssumeRole"
    )
    error_message = "The role must only be assumable by ec2.amazonaws.com."
  }

  assert {
    condition     = module.host.instance_role_managed_policy_arns == ["arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"]
    error_message = "The role must have exactly the AmazonSSMManagedInstanceCore managed policy."
  }

  assert {
    condition     = module.host.instance_role_name == "${var.project}-prod-host-role"
    error_message = "The role must be named <prefix>-host-role."
  }

  assert {
    condition     = module.host.instance_profile_name == "${var.project}-prod-host-profile" && module.host.instance_profile_role == module.host.instance_role_name
    error_message = "The instance profile must be <prefix>-host-profile and wrap the host role."
  }

  assert {
    condition     = module.host.instance_iam_instance_profile == module.host.instance_profile_name
    error_message = "The instance must use the host instance profile."
  }
}

run "user_data_installs_docker_and_verifies_compose" {
  command = apply

  assert {
    condition = (
      strcontains(module.host.user_data, "dnf -y install docker") &&
      strcontains(module.host.user_data, "systemctl enable --now docker") &&
      strcontains(module.host.user_data, "usermod -aG docker ec2-user") &&
      strcontains(module.host.user_data, "amazon-ssm-agent")
    )
    error_message = "User data must install and start Docker, add ec2-user to the docker group and enable the SSM agent."
  }

  assert {
    condition = (
      strcontains(module.host.user_data, "/usr/local/lib/docker/cli-plugins/docker-compose") &&
      strcontains(module.host.user_data, "sha256sum -c") &&
      strcontains(module.host.user_data, "docker/compose/releases/download/v5.7.1/") &&
      strcontains(module.host.user_data, "af426722a8af5de812fcee30cc1c39f0639f5f723cbadefb25e5d4db054064cf")
    )
    error_message = "User data must download the pinned Compose release and verify its sha256."
  }

  assert {
    condition     = !strcontains(module.host.user_data, "\r")
    error_message = "User data must use LF line endings."
  }

  assert {
    condition     = startswith(module.host.user_data, "#!/bin/bash") && strcontains(module.host.user_data, "set -euo pipefail")
    error_message = "User data must be a strict bash script."
  }

  assert {
    condition = (
      strcontains(module.host.user_data, "host-bootstrap.log") &&
      strcontains(module.host.user_data, "https://github.com")
    )
    error_message = "User data must log to a file and wait for outbound HTTPS before installing."
  }
}

run "user_data_does_not_touch_ssh_or_install_caddy" {
  command = apply

  assert {
    condition     = !strcontains(lower(module.host.user_data), "sshd") && !strcontains(module.host.user_data, "22/tcp") && !strcontains(lower(module.host.user_data), "port 22")
    error_message = "User data must not configure SSH or open port 22."
  }

  assert {
    condition     = !strcontains(lower(module.host.user_data), "caddy")
    error_message = "Caddy is installed by a later task, not by this user data."
  }
}

run "host_module_has_no_extra_iam_or_key_resources" {
  command = plan

  # Static guard (the var.project reference only satisfies the test framework's
  # requirement that a condition refer to configuration): deployment permissions
  # belong to #61, and the host has no SSH key.
  assert {
    condition = var.project != "" && length([
      for f in fileset("../../modules/host", "*.tf") : f
      if can(regex("resource[[:space:]]+\"(aws_iam_role_policy|aws_iam_policy|aws_iam_user|aws_key_pair)\"", file("../../modules/host/${f}")))
    ]) == 0
    error_message = "The host module must not declare inline or customer-managed IAM policies, IAM users or key pairs."
  }

  assert {
    condition     = var.project != "" && length(regexall("(?m)^[[:space:]]*resource[[:space:]]+\"aws_iam_role_policy_attachment\"", file("../../modules/host/iam.tf"))) == 1
    error_message = "iam.tf must declare exactly one policy attachment (SSM managed instance core)."
  }

  assert {
    condition = var.project != "" && length([
      for f in fileset("../../modules/host", "*.tf") : f
      if can(regex("(?m)^[[:space:]]*key_name[[:space:]]*=", file("../../modules/host/${f}")))
    ]) == 0
    error_message = "The instance must not set key_name."
  }
}

run "sslip_domain_is_derived_from_the_elastic_ip" {
  command = apply

  assert {
    condition     = output.host_public_ip == "203.0.113.10"
    error_message = "The interim DNS name must be the dashed Elastic IP under sslip.io."
  }

  assert {
    condition     = output.host_sslip_domain == "203-0-113-10.sslip.io"
    error_message = "The interim DNS name must be the dashed Elastic IP under sslip.io."
  }

  assert {
    condition     = output.host_instance_id == module.host.instance_id
    error_message = "The prod root must expose the host instance id."
  }
}

run "rejects_unsafe_instance_type" {
  command = plan
  variables {
    host_instance_type = "m6g.large"
  }
  expect_failures = [var.host_instance_type]
}

run "rejects_arm_instance_type" {
  command = plan
  variables {
    host_instance_type = "t4g.small"
  }
  expect_failures = [var.host_instance_type]
}

run "rejects_too_small_root_volume" {
  command = plan
  variables {
    host_root_volume_size_gb = 4
  }
  expect_failures = [var.host_root_volume_size_gb]
}

run "rejects_too_large_root_volume" {
  command = plan
  variables {
    host_root_volume_size_gb = 500
  }
  expect_failures = [var.host_root_volume_size_gb]
}
