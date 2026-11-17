# Storage is bounded without expiring the image that runs on the single host.
# ECR does not expire an image with a lower-priority rule once a higher-priority
# rule's selection matched it, so release images are governed only by rule 2:
#   1. untagged images (superseded or failed pushes) expire quickly;
#   2. images tagged with var.release_tag_prefix keep the newest var.max_release_images;
#   3. every other image (for example CI builds) expires by age.
# The tag_status "any" rule must have the highest priority number, so it is last.
# The deploy pipeline (#58) must tag deployable images with the release prefix, or
# rule 3 will expire them.
locals {
  lifecycle_rules = [
    {
      priority        = 1
      description     = "Expire untagged images ${var.untagged_expiry_days} days after push."
      tag_status      = "untagged"
      tag_prefix_list = null
      count_type      = "sinceImagePushed"
      count_unit      = "days"
      count_number    = var.untagged_expiry_days
    },
    {
      priority        = 2
      description     = "Keep only the last ${var.max_release_images} images tagged ${var.release_tag_prefix}*."
      tag_status      = "tagged"
      tag_prefix_list = [var.release_tag_prefix]
      count_type      = "imageCountMoreThan"
      count_unit      = null
      count_number    = var.max_release_images
    },
    {
      priority        = 3
      description     = "Expire any remaining image ${var.non_release_expiry_days} days after push."
      tag_status      = "any"
      tag_prefix_list = null
      count_type      = "sinceImagePushed"
      count_unit      = "days"
      count_number    = var.non_release_expiry_days
    },
  ]
}

data "aws_ecr_lifecycle_policy_document" "this" {
  dynamic "rule" {
    for_each = local.lifecycle_rules

    content {
      priority    = rule.value.priority
      description = rule.value.description

      selection {
        tag_status      = rule.value.tag_status
        tag_prefix_list = rule.value.tag_prefix_list
        count_type      = rule.value.count_type
        count_unit      = rule.value.count_unit
        count_number    = rule.value.count_number
      }

      action {
        type = "expire"
      }
    }
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each = aws_ecr_repository.this

  repository = each.value.name
  policy     = data.aws_ecr_lifecycle_policy_document.this.json
}
