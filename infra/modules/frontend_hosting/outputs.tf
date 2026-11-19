output "app_id" {
  description = "ID of the Amplify app."
  value       = aws_amplify_app.this.id
}

output "default_domain" {
  description = "Default Amplify domain of the app (for example d123.amplifyapp.com)."
  value       = aws_amplify_app.this.default_domain
}

output "branch_url" {
  description = "HTTPS URL of the deployed branch: the origin the backend must allow (CORS)."
  value       = "https://${aws_amplify_branch.this.branch_name}.${aws_amplify_app.this.default_domain}"
}

output "app_settings" {
  description = "Settings of the app as configured on the resource, for tests and review. token_configured is true if a GitHub token was set (it must never be)."
  value = {
    name                  = aws_amplify_app.this.name
    repository            = aws_amplify_app.this.repository
    platform              = aws_amplify_app.this.platform
    environment_variables = aws_amplify_app.this.environment_variables
    custom_rules          = aws_amplify_app.this.custom_rule
    enable_basic_auth     = aws_amplify_app.this.enable_basic_auth
    token_configured      = nonsensitive(aws_amplify_app.this.access_token != null || aws_amplify_app.this.oauth_token != null)
  }
}

output "branch_settings" {
  description = "Settings of the deployed branch as configured on the resource, for tests and review."
  value = {
    branch_name           = aws_amplify_branch.this.branch_name
    stage                 = aws_amplify_branch.this.stage
    framework             = aws_amplify_branch.this.framework
    enable_auto_build     = aws_amplify_branch.this.enable_auto_build
    enable_basic_auth     = aws_amplify_branch.this.enable_basic_auth
    environment_variables = aws_amplify_branch.this.environment_variables
  }
}
