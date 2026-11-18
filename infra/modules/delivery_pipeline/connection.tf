# Link between AWS and the GitHub repository that CodePipeline uses as its source.
# The connection is created PENDING: the one-time GitHub authorization handshake can
# only be completed by a person in the console (Developer Tools > Settings >
# Connections). Until then connection_status stays PENDING and the pipeline cannot run.
resource "aws_codeconnections_connection" "this" {
  name          = "${var.name_prefix}-github"
  provider_type = "GitHub"

  tags = {
    Name = "${var.name_prefix}-github"
  }
}
