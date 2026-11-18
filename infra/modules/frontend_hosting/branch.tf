# The deployed branch. Changing branch_name makes Terraform replace this resource: it
# creates the new Amplify branch and deletes the old one (see infra/README.md before
# moving from develop to main).
resource "aws_amplify_branch" "this" {
  app_id      = aws_amplify_app.this.id
  branch_name = var.branch_name

  stage             = "PRODUCTION"
  framework         = "Web"
  enable_auto_build = true

  enable_basic_auth = false
}
