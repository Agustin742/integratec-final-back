mock_provider "aws" {
  # The mock returns a random string for data source JSON, so the lifecycle policy
  # document is pinned to a well-formed value; its content is guarded by the static
  # scan below and the wiring by the policy assertions.
  override_data {
    target = module.registry.data.aws_ecr_lifecycle_policy_document.this
    values = {
      json = "{\"rules\":[]}"
    }
  }
}

variables {
  project                 = "aula-virtual"
  allowed_origins         = ["https://app.example.com"]
  password_reset_url_base = "https://app.example.com/reset-password"
}

run "one_repository_per_service" {
  command = apply

  assert {
    condition     = toset(keys(module.registry.repository_names)) == toset(["api", "realtime"])
    error_message = "There must be exactly one repository per service: api and realtime."
  }

  assert {
    condition     = module.registry.repository_names["api"] == "${var.project}-prod-api" && module.registry.repository_names["realtime"] == "${var.project}-prod-realtime"
    error_message = "Repository names must be <prefix>-<service>."
  }

  assert {
    condition     = toset(keys(output.ecr_repository_urls)) == toset(["api", "realtime"]) && toset(keys(output.ecr_repository_arns)) == toset(["api", "realtime"])
    error_message = "The root must expose the URL and ARN of each repository, keyed by service."
  }
}

run "repositories_are_immutable_scanned_and_protected" {
  command = apply

  assert {
    condition     = alltrue([for s in module.registry.repository_settings : s.image_tag_mutability == "IMMUTABLE"])
    error_message = "Image tags must be immutable."
  }

  assert {
    condition     = alltrue([for s in module.registry.repository_settings : s.scan_on_push == true])
    error_message = "Images must be scanned on push."
  }

  assert {
    condition     = alltrue([for s in module.registry.repository_settings : s.encryption_type == "AES256"])
    error_message = "Repositories must be encrypted with AES256."
  }

  assert {
    condition     = alltrue([for s in module.registry.repository_settings : s.force_delete == false])
    error_message = "Repositories must not be force-deleted with images inside."
  }
}

run "lifecycle_policy_is_attached_to_each_repository" {
  command = apply

  assert {
    condition     = toset(keys(module.registry.lifecycle_policies)) == toset(["api", "realtime"])
    error_message = "Each repository must have a lifecycle policy."
  }

  assert {
    condition     = alltrue([for p in module.registry.lifecycle_policies : p == "{\"rules\":[]}"])
    error_message = "The lifecycle policy must come from the aws_ecr_lifecycle_policy_document data source."
  }
}

run "lifecycle_rules_protect_release_images" {
  command = plan

  # Rule contents come from the module output built from the same locals that feed
  # the policy document (the mock cannot render the document itself).
  assert {
    condition     = length(module.registry.lifecycle_rules) == 3 && length(distinct([for r in module.registry.lifecycle_rules : r.priority])) == 3
    error_message = "The lifecycle policy must have exactly three rules with distinct priorities."
  }

  assert {
    condition     = module.registry.lifecycle_rules[0].tag_status == "untagged" && module.registry.lifecycle_rules[0].count_type == "sinceImagePushed" && module.registry.lifecycle_rules[0].count_number == 7
    error_message = "Rule 1 must expire untagged images 7 days after push."
  }

  assert {
    condition     = module.registry.lifecycle_rules[1].tag_status == "tagged" && module.registry.lifecycle_rules[1].tag_prefix_list == ["release-"] && module.registry.lifecycle_rules[1].count_type == "imageCountMoreThan" && module.registry.lifecycle_rules[1].count_number == 20
    error_message = "Rule 2 must keep the last 20 images tagged with the release- prefix."
  }

  assert {
    condition     = module.registry.lifecycle_rules[2].tag_status == "any" && module.registry.lifecycle_rules[2].count_type == "sinceImagePushed" && module.registry.lifecycle_rules[2].count_number == 30
    error_message = "Rule 3 must expire any remaining image 30 days after push."
  }

  assert {
    condition     = module.registry.lifecycle_rules[2].priority == max([for r in module.registry.lifecycle_rules : r.priority]...) && module.registry.lifecycle_rules[0].priority < module.registry.lifecycle_rules[1].priority
    error_message = "The tag_status any rule must have the highest priority number (ECR evaluates it last) and the untagged rule must precede the release rule."
  }
}

run "static_scan_of_registry_module" {
  command = plan

  # The var.project != "" terms give each assertion a reference to the configuration;
  # Terraform rejects conditions that only call file functions on constants.
  assert {
    condition     = var.project != "" && length(fileset("../../modules/registry", "*.tf")) > 0
    error_message = "The static scan found no .tf files in modules/registry; check the relative path."
  }

  assert {
    condition = var.project != "" && length([
      for f in fileset("../../modules/registry", "*.tf") : f
      if can(regex("MUTABLE", replace(file("../../modules/registry/${f}"), "IMMUTABLE", "")))
    ]) == 0
    error_message = "No repository may use mutable tags."
  }

  assert {
    condition     = var.project != "" && length(regexall("(?m)^[[:space:]]*image_tag_mutability[[:space:]]*=[[:space:]]*\"IMMUTABLE\"", file("../../modules/registry/repository.tf"))) == 1
    error_message = "image_tag_mutability must be set to IMMUTABLE once."
  }
}

run "rejects_invalid_name_prefix" {
  command = plan

  module {
    source = "../../modules/registry"
  }

  variables {
    name_prefix = "Bad_Prefix"
  }

  expect_failures = [var.name_prefix]
}

run "rejects_empty_services" {
  command = plan

  module {
    source = "../../modules/registry"
  }

  variables {
    name_prefix = "aula-virtual-prod"
    services    = []
  }

  expect_failures = [var.services]
}

run "rejects_uppercase_service" {
  command = plan

  module {
    source = "../../modules/registry"
  }

  variables {
    name_prefix = "aula-virtual-prod"
    services    = ["Api"]
  }

  expect_failures = [var.services]
}

run "rejects_underscore_service" {
  command = plan

  module {
    source = "../../modules/registry"
  }

  variables {
    name_prefix = "aula-virtual-prod"
    services    = ["real_time"]
  }

  expect_failures = [var.services]
}

run "rejects_zero_max_release_images" {
  command = plan

  module {
    source = "../../modules/registry"
  }

  variables {
    name_prefix        = "aula-virtual-prod"
    max_release_images = 0
  }

  expect_failures = [var.max_release_images]
}

run "rejects_zero_untagged_expiry_days" {
  command = plan

  module {
    source = "../../modules/registry"
  }

  variables {
    name_prefix          = "aula-virtual-prod"
    untagged_expiry_days = 0
  }

  expect_failures = [var.untagged_expiry_days]
}

run "rejects_zero_non_release_expiry_days" {
  command = plan

  module {
    source = "../../modules/registry"
  }

  variables {
    name_prefix             = "aula-virtual-prod"
    non_release_expiry_days = 0
  }

  expect_failures = [var.non_release_expiry_days]
}

run "rejects_empty_release_tag_prefix" {
  command = plan

  module {
    source = "../../modules/registry"
  }

  variables {
    name_prefix        = "aula-virtual-prod"
    release_tag_prefix = ""
  }

  expect_failures = [var.release_tag_prefix]
}

run "rejects_release_tag_prefix_with_invalid_characters" {
  command = plan

  module {
    source = "../../modules/registry"
  }

  variables {
    name_prefix        = "aula-virtual-prod"
    release_tag_prefix = "release/*"
  }

  expect_failures = [var.release_tag_prefix]
}
