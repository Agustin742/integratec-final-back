# Service roles of the Terraform runner projects (decision D19). One role per project,
# assumable only by CodeBuild on behalf of that project in this account.
#
# SECURITY TRADE-OFF (D19): the apply role must be able to change every kind of resource
# the prod root manages, including IAM roles and policies named <name_prefix>-*, which
# includes the role itself. Anyone who controls the Terraform code that the approved plan
# was built from can therefore escalate. It is mitigated, not removed, by the manual
# approval of a saved plan and by the branch protection of `develop`. The plan role cannot
# change anything but its logs, artifacts and the state lock.
locals {
  state_bucket_arn = "arn:aws:s3:::${local.state_bucket_name}"
  state_object_arn = "${local.state_bucket_arn}/${var.state_key}"
  state_lock_arn   = "${local.state_object_arn}.tflock"

  # ARN fragments of the prod account and region.
  account_arn_suffix = "${var.region}:${local.account_id}"
  iam_arn_prefix     = "arn:aws:iam::${local.account_id}"
  prefix_bucket_arn  = "arn:aws:s3:::${var.name_prefix}-*"

  plan_role_name  = "${local.plan_project_name}-role"
  apply_role_name = "${local.apply_project_name}-role"

  # Like the project ARNs below, built from the name instead of read from the resource: the
  # policies need the project ARNs for their trust conditions, and a role ARN known at plan
  # time keeps the CodeBuild projects independent of the provider's computed values.
  plan_role_arn  = "${local.iam_arn_prefix}:role/${local.plan_role_name}"
  apply_role_arn = "${local.iam_arn_prefix}:role/${local.apply_role_name}"

  # The ARN of each project is built from its name, not read from the resource: the project
  # references its role, so reading it back here would create a dependency cycle.
  plan_project_arn  = "arn:aws:codebuild:${local.account_arn_suffix}:project/${local.plan_project_name}"
  apply_project_arn = "arn:aws:codebuild:${local.account_arn_suffix}:project/${local.apply_project_name}"

  # Statements both roles share: build logs, pipeline artifacts and the state backend.
  common_policy_statements = [
    {
      Sid    = "WriteBuildLogs"
      Effect = "Allow"
      Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
      # The log group is created in logs.tf, so logs:CreateLogGroup is not needed. Log
      # stream permissions apply to "<group arn>:*".
      Resource = ["${aws_cloudwatch_log_group.codebuild.arn}:*"]
    },
    {
      Sid      = "ArtifactBucketObjects"
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
      Resource = ["${aws_s3_bucket.artifacts.arn}/*"]
    },
    {
      Sid      = "ArtifactBucketLocation"
      Effect   = "Allow"
      Action   = ["s3:GetBucketAcl", "s3:GetBucketLocation"]
      Resource = [aws_s3_bucket.artifacts.arn]
    },
    {
      Sid      = "ListStateBucket"
      Effect   = "Allow"
      Action   = ["s3:ListBucket"]
      Resource = [local.state_bucket_arn]
    },
    {
      # S3 native locking (use_lockfile = true): Terraform writes and deletes <key>.tflock.
      Sid      = "ManageStateLock"
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      Resource = [local.state_lock_arn]
    },
  ]

  # The plan only reads the state. ReadOnlyAccess (attached below) is what lets the refresh
  # read every managed service; it also includes s3:GetObject on every bucket, so reading
  # uploaded files and secret values is denied explicitly (a deny wins over any allow).
  plan_policy_statements = concat(
    local.common_policy_statements,
    [
      {
        Sid      = "ReadState"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = [local.state_object_arn]
      },
      {
        Sid    = "DenyReadingApplicationData"
        Effect = "Deny"
        Action = ["s3:GetObject", "s3:GetObjectVersion", "secretsmanager:GetSecretValue"]
        Resource = [
          "arn:aws:s3:::${var.name_prefix}-files-*/*",
          "arn:aws:secretsmanager:${local.account_arn_suffix}:secret:*",
        ]
      },
    ],
  )

  # Apply changes what the prod root manages. Services whose resources carry the project
  # prefix are scoped to it. Where AWS generates the name (Amplify app ids, connection ids)
  # the statement is scoped to the service ARN, and EC2 has no usable resource-level
  # permission for most actions, so it is limited by region instead.
  apply_policy_statements = concat(
    local.common_policy_statements,
    [
      {
        Sid      = "ReadWriteState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = [local.state_object_arn]
      },
      {
        Sid    = "ManageProjectIdentities"
        Effect = "Allow"
        Action = [
          "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole", "iam:UpdateRoleDescription",
          "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole", "iam:ListRoleTags",
          "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy", "iam:ListRolePolicies",
          "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
          "iam:CreatePolicy", "iam:DeletePolicy", "iam:GetPolicy", "iam:TagPolicy", "iam:UntagPolicy",
          "iam:ListPolicyTags", "iam:CreatePolicyVersion", "iam:DeletePolicyVersion",
          "iam:GetPolicyVersion", "iam:ListPolicyVersions",
          "iam:CreateInstanceProfile", "iam:DeleteInstanceProfile", "iam:GetInstanceProfile",
          "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile",
          "iam:TagInstanceProfile", "iam:UntagInstanceProfile", "iam:ListInstanceProfileTags",
        ]
        Resource = [
          "${local.iam_arn_prefix}:role/${var.name_prefix}-*",
          "${local.iam_arn_prefix}:policy/${var.name_prefix}-*",
          "${local.iam_arn_prefix}:instance-profile/${var.name_prefix}-*",
        ]
      },
      {
        Sid      = "PassProjectRoles"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = ["${local.iam_arn_prefix}:role/${var.name_prefix}-*"]
        Condition = {
          StringEquals = {
            "iam:PassedToService" = ["ec2.amazonaws.com", "codebuild.amazonaws.com", "codepipeline.amazonaws.com"]
          }
        }
      },
      {
        # The first RDS instance of an account creates this role; later applies find it.
        Sid      = "CreateRdsServiceLinkedRole"
        Effect   = "Allow"
        Action   = ["iam:CreateServiceLinkedRole"]
        Resource = ["${local.iam_arn_prefix}:role/aws-service-role/rds.amazonaws.com/AWSServiceRoleForRDS"]
        Condition = {
          StringEquals = { "iam:AWSServiceName" = "rds.amazonaws.com" }
        }
      },
      {
        # Most EC2 actions (VPC, subnets, route tables, security groups, Elastic IP,
        # instances, volumes) cannot be limited to named resources, so "*" is used and
        # the region is the boundary.
        Sid      = "ManageNetworkAndHost"
        Effect   = "Allow"
        Action   = ["ec2:*"]
        Resource = ["*"]
        Condition = {
          StringEquals = { "aws:RequestedRegion" = var.region }
        }
      },
      {
        # Default parameter and option groups (default.postgres16, default:postgres-16) do
        # not carry the project prefix, so the whole RDS ARN space of the account and
        # region is allowed.
        Sid      = "ManageDatabase"
        Effect   = "Allow"
        Action   = ["rds:*"]
        Resource = ["arn:aws:rds:${local.account_arn_suffix}:*"]
      },
      {
        Sid      = "ReadDatabaseMetadata"
        Effect   = "Allow"
        Action   = ["rds:Describe*", "rds:ListTagsForResource"]
        Resource = ["*"]
      },
      {
        # With manage_master_user_password RDS creates and owns the master secret (rds!db-*)
        # with the caller's permissions. GetSecretValue is deliberately absent.
        Sid    = "ManageRdsManagedSecret"
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret", "secretsmanager:DeleteSecret", "secretsmanager:DescribeSecret",
          "secretsmanager:TagResource", "secretsmanager:UntagResource", "secretsmanager:UpdateSecret",
          "secretsmanager:GetResourcePolicy", "secretsmanager:PutResourcePolicy",
          "secretsmanager:DeleteResourcePolicy", "secretsmanager:ListSecretVersionIds",
        ]
        Resource = ["arn:aws:secretsmanager:${local.account_arn_suffix}:secret:rds!*"]
      },
      {
        # No key is created by this stack; the AWS managed key aws/secretsmanager is used
        # through Secrets Manager only.
        Sid      = "DescribeKeys"
        Effect   = "Allow"
        Action   = ["kms:DescribeKey"]
        Resource = ["*"]
      },
      {
        Sid      = "UseKeysThroughSecretsManager"
        Effect   = "Allow"
        Action   = ["kms:CreateGrant", "kms:Decrypt", "kms:GenerateDataKey"]
        Resource = ["*"]
        Condition = {
          StringEquals = { "kms:ViaService" = "secretsmanager.${var.region}.amazonaws.com" }
        }
      },
      {
        # Secret containers only: Terraform never reads or writes secret values.
        Sid    = "ManageProjectSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret", "secretsmanager:DeleteSecret", "secretsmanager:DescribeSecret",
          "secretsmanager:TagResource", "secretsmanager:UntagResource", "secretsmanager:UpdateSecret",
          "secretsmanager:GetResourcePolicy", "secretsmanager:PutResourcePolicy",
          "secretsmanager:DeleteResourcePolicy", "secretsmanager:ListSecretVersionIds",
        ]
        Resource = ["arn:aws:secretsmanager:${local.account_arn_suffix}:secret:${var.name_prefix}/*"]
      },
      {
        Sid    = "ManageProjectParameters"
        Effect = "Allow"
        Action = [
          "ssm:PutParameter", "ssm:DeleteParameter", "ssm:DeleteParameters", "ssm:GetParameter",
          "ssm:GetParameters", "ssm:AddTagsToResource", "ssm:RemoveTagsFromResource", "ssm:ListTagsForResource",
        ]
        Resource = ["arn:aws:ssm:${local.account_arn_suffix}:parameter/${var.name_prefix}/*"]
      },
      {
        # The host AMI is resolved from the public Amazon Linux parameter (account-less ARN).
        Sid      = "ReadPublicAmiParameter"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = ["arn:aws:ssm:${var.region}::parameter/aws/service/*"]
      },
      {
        Sid      = "ReadParameterMetadata"
        Effect   = "Allow"
        Action   = ["ssm:DescribeParameters"]
        Resource = ["*"]
      },
      {
        Sid      = "ManageEcrRepositories"
        Effect   = "Allow"
        Action   = ["ecr:*"]
        Resource = ["arn:aws:ecr:${local.account_arn_suffix}:repository/${var.name_prefix}-*"]
      },
      {
        # Bucket-level actions only (no "/*"): the apply role cannot read or delete objects
        # of the files bucket. The artifact objects have their own statement above.
        Sid      = "ManageProjectBuckets"
        Effect   = "Allow"
        Action   = ["s3:*"]
        Resource = [local.prefix_bucket_arn]
      },
      {
        Sid    = "ManageProjectLogGroups"
        Effect = "Allow"
        Action = ["logs:*"]
        Resource = [
          "arn:aws:logs:${local.account_arn_suffix}:log-group:/${var.name_prefix}/*",
          "arn:aws:logs:${local.account_arn_suffix}:log-group:/${var.name_prefix}/*:*",
        ]
      },
      {
        # logs:DescribeLogGroups is authorized on the log group listing, not on one group.
        Sid      = "ListLogGroups"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = ["*"]
      },
      {
        # Amplify app ids are generated by AWS, so the app cannot be scoped by name.
        Sid      = "ManageAmplifyApps"
        Effect   = "Allow"
        Action   = ["amplify:*"]
        Resource = ["arn:aws:amplify:${local.account_arn_suffix}:apps/*"]
      },
      {
        # Connection ids are generated by AWS. Both service prefixes are listed because the
        # provider may call either API namespace.
        Sid    = "ManageCodeConnections"
        Effect = "Allow"
        Action = ["codeconnections:*", "codestar-connections:*"]
        Resource = [
          "arn:aws:codeconnections:${local.account_arn_suffix}:connection/*",
          "arn:aws:codestar-connections:${local.account_arn_suffix}:connection/*",
        ]
      },
      {
        Sid      = "ListCodeConnections"
        Effect   = "Allow"
        Action   = ["codeconnections:ListConnections", "codestar-connections:ListConnections"]
        Resource = ["*"]
      },
      {
        Sid      = "ManageCodeBuildProjects"
        Effect   = "Allow"
        Action   = ["codebuild:*"]
        Resource = ["arn:aws:codebuild:${local.account_arn_suffix}:project/${var.name_prefix}-*"]
      },
      {
        Sid      = "ManageCodePipelines"
        Effect   = "Allow"
        Action   = ["codepipeline:*"]
        Resource = ["arn:aws:codepipeline:${local.account_arn_suffix}:${var.name_prefix}-*"]
      },
      {
        Sid      = "ManageProjectAlarmTopics"
        Effect   = "Allow"
        Action   = ["sns:*"]
        Resource = ["arn:aws:sns:${local.account_arn_suffix}:${var.name_prefix}-*"]
      },
      {
        # Metric alarms are named <name_prefix>-*; scoping to the alarm ARN prefix keeps
        # PutMetricAlarm, DeleteAlarms, DescribeAlarms and tagging inside this environment.
        Sid    = "ManageProjectAlarms"
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricAlarm",
          "cloudwatch:DeleteAlarms",
          "cloudwatch:DescribeAlarms",
          "cloudwatch:TagResource",
          "cloudwatch:UntagResource",
          "cloudwatch:ListTagsForResource",
        ]
        Resource = ["arn:aws:cloudwatch:${local.account_arn_suffix}:alarm:${var.name_prefix}-*"]
      },
      {
        # AWS Budgets does not support resource-level ARNs for ViewBudget or ModifyBudget
        # (which covers create, update and delete of budgets, notifications and subscribers),
        # so "*" is required; tagging is scoped to <name_prefix>-* below.
        Sid      = "ManageBudgets"
        Effect   = "Allow"
        Action   = ["budgets:ViewBudget", "budgets:ModifyBudget"]
        Resource = ["*"]
      },
      {
        Sid      = "TagProjectBudgets"
        Effect   = "Allow"
        Action   = ["budgets:TagResource", "budgets:UntagResource", "budgets:ListTagsForResource"]
        Resource = ["arn:aws:budgets::${local.account_id}:budget/${var.name_prefix}-*"]
      },
    ],
    # The GitHub OIDC provider exists only when enable_github_oidc is true.
    [for _ in range(var.enable_github_oidc ? 1 : 0) :
      {
        Sid    = "ManageGithubOidcProvider"
        Effect = "Allow"
        Action = [
          "iam:CreateOpenIDConnectProvider", "iam:DeleteOpenIDConnectProvider", "iam:GetOpenIDConnectProvider",
          "iam:TagOpenIDConnectProvider", "iam:UntagOpenIDConnectProvider", "iam:ListOpenIDConnectProviderTags",
          "iam:UpdateOpenIDConnectProviderThumbprint", "iam:AddClientIDToOpenIDConnectProvider",
          "iam:RemoveClientIDFromOpenIDConnectProvider",
        ]
        Resource = ["${local.iam_arn_prefix}:oidc-provider/token.actions.githubusercontent.com"]
      }
    ],
  )
}

resource "aws_iam_role" "terraform_plan" {
  name        = local.plan_role_name
  description = "Service role of the ${local.plan_project_name} CodeBuild project: read-only plus logs, artifacts and the state lock."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "codebuild.amazonaws.com" }
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = local.account_id
          "aws:SourceArn"     = local.plan_project_arn
        }
      }
    }]
  })

  tags = {
    Name = local.plan_role_name
  }
}

resource "aws_iam_role" "terraform_apply" {
  name        = local.apply_role_name
  description = "Service role of the ${local.apply_project_name} CodeBuild project: applies the approved plan to the prod resources."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "codebuild.amazonaws.com" }
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = local.account_id
          "aws:SourceArn"     = local.apply_project_arn
        }
      }
    }]
  })

  tags = {
    Name = local.apply_role_name
  }
}

# ReadOnlyAccess is used instead of a hand-written list because the refresh reads every
# managed service (EC2, RDS, IAM, ECR, S3, SSM, Secrets Manager, CloudWatch Logs and Alarms,
# SNS, AWS Budgets, Amplify, CodeConnections, CodeBuild, CodePipeline), and a missing read
# would fail the plan of the approval stage. The inline policy below denies the two data reads it would add.
resource "aws_iam_role_policy_attachment" "terraform_plan_read_only" {
  role       = aws_iam_role.terraform_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy" "terraform_plan" {
  name = "${local.plan_project_name}-policy"
  role = aws_iam_role.terraform_plan.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.plan_policy_statements
  })
}

resource "aws_iam_role_policy" "terraform_apply" {
  name = "${local.apply_project_name}-policy"
  role = aws_iam_role.terraform_apply.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.apply_policy_statements
  })
}
