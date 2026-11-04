# GitHub Actions authenticates to AWS with short-lived OIDC tokens instead of
# long-lived access keys (decision D6).

data "aws_caller_identity" "current" {}

locals {
  github_oidc_host = "token.actions.githubusercontent.com"

  # Must match the bucket created by infra/bootstrap.
  state_bucket_arn = "arn:aws:s3:::${var.project}-tfstate-${data.aws_caller_identity.current.account_id}"
  state_key        = "${local.environment}/terraform.tfstate"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://${local.github_oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "github_actions" {
  name                 = "${var.project}-${local.environment}-github-actions"
  description          = "Assumed by GitHub Actions on ${var.github_repository}@${var.github_branch} through OIDC."
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Action    = "sts:AssumeRoleWithWebIdentity"
        Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
        Condition = {
          StringEquals = {
            "${local.github_oidc_host}:aud" = "sts.amazonaws.com"
            "${local.github_oidc_host}:sub" = "repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"
          }
        }
      }
    ]
  })
}

# Least privilege: read/write the prod state and its lock file, and read the
# identity resources managed here so plans can refresh them. Later issues add
# only the permissions their resources need.
resource "aws_iam_role_policy" "github_actions_state" {
  name = "terraform-state-${local.environment}"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListStateBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [local.state_bucket_arn]
      },
      {
        Sid      = "ReadWriteState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = ["${local.state_bucket_arn}/${local.state_key}"]
      },
      {
        Sid      = "ManageStateLock"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${local.state_bucket_arn}/${local.state_key}.tflock"]
      },
      {
        Sid      = "ReadOwnIdentity"
        Effect   = "Allow"
        Action   = ["iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies"]
        Resource = [aws_iam_role.github_actions.arn]
      },
      {
        Sid      = "ReadOidcProvider"
        Effect   = "Allow"
        Action   = ["iam:GetOpenIDConnectProvider"]
        Resource = [aws_iam_openid_connect_provider.github.arn]
      }
    ]
  })
}
