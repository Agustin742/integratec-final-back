# Two rules keep storage bounded without touching images that are still deployable:
# untagged layers (superseded or failed pushes) expire quickly, and every tagged
# image beyond the newest var.max_image_count expires. ECR requires the
# tag_status "any" rule to have the highest priority number, so it is evaluated last.
data "aws_ecr_lifecycle_policy_document" "this" {
  rule {
    priority    = 1
    description = "Expire untagged images ${var.untagged_expiry_days} days after push."

    selection {
      tag_status   = "untagged"
      count_type   = "sinceImagePushed"
      count_unit   = "days"
      count_number = var.untagged_expiry_days
    }

    action {
      type = "expire"
    }
  }

  rule {
    priority    = 2
    description = "Keep only the last ${var.max_image_count} images."

    selection {
      tag_status   = "any"
      count_type   = "imageCountMoreThan"
      count_number = var.max_image_count
    }

    action {
      type = "expire"
    }
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each = aws_ecr_repository.this

  repository = each.value.name
  policy     = data.aws_ecr_lifecycle_policy_document.this.json
}
