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
  project = "aula-virtual"
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

run "static_scan_of_registry_module" {
  command = plan

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

  assert {
    condition     = var.project != "" && length(regexall("(?m)^[[:space:]]*count_type[[:space:]]*=[[:space:]]*\"sinceImagePushed\"", file("../../modules/registry/lifecycle.tf"))) == 1 && length(regexall("(?m)^[[:space:]]*tag_status[[:space:]]*=[[:space:]]*\"untagged\"", file("../../modules/registry/lifecycle.tf"))) == 1
    error_message = "Untagged images must expire by age (sinceImagePushed)."
  }

  assert {
    condition     = var.project != "" && length(regexall("(?m)^[[:space:]]*count_type[[:space:]]*=[[:space:]]*\"imageCountMoreThan\"", file("../../modules/registry/lifecycle.tf"))) == 1 && length(regexall("(?m)^[[:space:]]*count_number[[:space:]]*=[[:space:]]*var[.]max_image_count", file("../../modules/registry/lifecycle.tf"))) == 1
    error_message = "The last var.max_image_count images must be kept (imageCountMoreThan)."
  }

  assert {
    condition     = var.project != "" && regex("priority[[:space:]]*=[[:space:]]*([0-9]+)[[:space:]]+description[^\n]*[[:space:]]+selection[[:space:]]*[{][[:space:]]*tag_status[[:space:]]*=[[:space:]]*\"untagged\"", file("../../modules/registry/lifecycle.tf"))[0] == "1" && regex("priority[[:space:]]*=[[:space:]]*([0-9]+)[[:space:]]+description[^\n]*[[:space:]]+selection[[:space:]]*[{][[:space:]]*tag_status[[:space:]]*=[[:space:]]*\"any\"", file("../../modules/registry/lifecycle.tf"))[0] == "2"
    error_message = "The tag_status any rule must have the highest priority number (evaluated last)."
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

run "rejects_zero_max_image_count" {
  command = plan

  module {
    source = "../../modules/registry"
  }

  variables {
    name_prefix     = "aula-virtual-prod"
    max_image_count = 0
  }

  expect_failures = [var.max_image_count]
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
