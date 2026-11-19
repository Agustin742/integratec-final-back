# The Amplify app was created once in the console (GitHub App connection, scoped to the
# frontend repository) and brought under Terraform with import blocks in envs/prod.
#
# access_token and oauth_token are deliberately NOT set: Terraform would store the token
# in the state file. The existing GitHub App connection needs neither, and the provider
# documents omitting access_token when importing an existing app.
#
# build_spec and custom_headers are deliberately NOT set either: the build comes from
# amplify.yml and the security headers from customHttp.yml, both versioned in the
# frontend repository.
resource "aws_amplify_app" "this" {
  name       = "${var.name_prefix}-front"
  repository = var.repository_url
  platform   = "WEB"

  # The environment is public: every VITE_* value is compiled into the browser bundle,
  # so only non-secret origins belong here.
  environment_variables = {
    VITE_APP_ENV      = var.app_env
    VITE_API_BASE_URL = var.api_base_url
    VITE_REALTIME_URL = var.realtime_url
  }

  # SPA fallback: every path without a static-asset extension is served index.html with
  # status 200 (a rewrite, not a redirect). Must stay identical to the rewrite rule in
  # the frontend docs/routing.md.
  custom_rule {
    source = "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|wasm)$)([^.]+$)/>"
    target = "/index.html"
    status = "200"
  }

  enable_basic_auth = false
}
