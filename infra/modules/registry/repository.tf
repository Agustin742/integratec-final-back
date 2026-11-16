resource "aws_ecr_repository" "this" {
  for_each = var.services

  name = "${var.name_prefix}-${each.key}"

  # Immutable tags keep a deployed tag pointing at the same image forever.
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "${var.name_prefix}-${each.key}"
  }
}
