mock_provider "aws" {
  override_data {
    target = data.aws_caller_identity.current
    values = {
      account_id = "123456789012"
    }
  }

  override_resource {
    target = aws_iam_openid_connect_provider.github
    values = {
      arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    }
  }

  override_resource {
    target = aws_iam_role.github_actions
    values = {
      arn = "arn:aws:iam::123456789012:role/aula-virtual-github-actions"
    }
  }
}

run "github_oidc_provider_trusts_only_sts_audience" {
  command = apply

  assert {
    condition     = aws_iam_openid_connect_provider.github.url == "https://token.actions.githubusercontent.com"
    error_message = "The OIDC provider must point to GitHub Actions."
  }

  assert {
    condition     = tolist(aws_iam_openid_connect_provider.github.client_id_list) == tolist(["sts.amazonaws.com"])
    error_message = "The only accepted audience must be sts.amazonaws.com."
  }
}

run "role_is_assumable_only_from_main_via_oidc" {
  command = apply

  assert {
    condition     = jsondecode(aws_iam_role.github_actions.assume_role_policy).Statement[0].Action == "sts:AssumeRoleWithWebIdentity"
    error_message = "The role must only be assumable through web identity federation."
  }

  assert {
    condition     = jsondecode(aws_iam_role.github_actions.assume_role_policy).Statement[0].Principal.Federated == aws_iam_openid_connect_provider.github.arn
    error_message = "The trusted principal must be the GitHub OIDC provider."
  }

  assert {
    condition     = jsondecode(aws_iam_role.github_actions.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    error_message = "The trust policy must pin the audience."
  }

  assert {
    condition     = jsondecode(aws_iam_role.github_actions.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:Agustin742/integratec-final-back:ref:refs/heads/main"
    error_message = "The trust policy must pin the subject to the main branch of the backend repository, without wildcards."
  }

  assert {
    condition     = length(jsondecode(aws_iam_role.github_actions.assume_role_policy).Statement) == 1
    error_message = "The trust policy must contain a single statement."
  }
}

run "role_policy_is_least_privilege_on_state" {
  command = apply

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.github_actions_state.policy).Statement :
      alltrue([for action in statement.Action : !strcontains(action, "*")])
    ])
    error_message = "The role policy must not use wildcard actions."
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.github_actions_state.policy).Statement :
      alltrue([for resource in statement.Resource : resource != "*"])
    ])
    error_message = "The role policy must not grant access to every resource."
  }

  assert {
    condition = contains(
      flatten([for statement in jsondecode(aws_iam_role_policy.github_actions_state.policy).Statement : statement.Resource]),
      "arn:aws:s3:::aula-virtual-tfstate-123456789012/prod/terraform.tfstate"
    )
    error_message = "The role must be able to reach the prod state object."
  }

  assert {
    condition     = output.github_actions_role_arn == "arn:aws:iam::123456789012:role/aula-virtual-github-actions"
    error_message = "The role ARN must be exported for the CI workflow."
  }
}

run "rejects_invalid_github_repository" {
  command = plan

  variables {
    github_repository = "not a repository"
  }

  expect_failures = [var.github_repository]
}

run "rejects_wildcard_branch" {
  command = plan

  variables {
    github_branch = "*"
  }

  expect_failures = [var.github_branch]
}

run "rejects_branch_with_leading_slash" {
  command = plan

  variables {
    github_branch = "/main"
  }

  expect_failures = [var.github_branch]
}

run "rejects_branch_with_parent_segment" {
  command = plan

  variables {
    github_branch = "release/../main"
  }

  expect_failures = [var.github_branch]
}

run "accepts_nested_branch_name" {
  command = plan

  variables {
    github_branch = "release/v1.0"
  }

  assert {
    condition     = endswith(jsondecode(aws_iam_role.github_actions.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"], ":ref:refs/heads/release/v1.0")
    error_message = "A valid nested branch name must be accepted verbatim."
  }
}
