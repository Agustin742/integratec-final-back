# The deployed branch. Changing branch_name forces a replacement without
# create_before_destroy: Terraform deletes the old Amplify branch, then creates the new
# one, which does not start a build until a job is started (see infra/README.md before
# moving from develop to main).
resource "aws_amplify_branch" "this" {
  app_id      = aws_amplify_app.this.id
  branch_name = var.branch_name

  stage             = "PRODUCTION"
  framework         = "Web"
  enable_auto_build = true

  enable_basic_auth = false
}
