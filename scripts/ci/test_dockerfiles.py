"""Structural checks for the service base-image reproducibility contract."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]


class DockerfileTests(unittest.TestCase):
    def test_service_stages_share_an_immutable_node_22_image_from_the_ecr_public_mirror(self):
        images = []
        for service in ("api", "realtime"):
            with self.subTest(service=service):
                dockerfile = ROOT / "apps" / service / "Dockerfile"
                stages = re.findall(
                    r"^FROM\s+(\S+)\s+AS\s+(\S+)\s*$",
                    dockerfile.read_text(encoding="utf-8"),
                    re.MULTILINE | re.IGNORECASE,
                )
                expected = ["builder", "migrate", "runner"] if service == "api" else ["builder", "runner"]
                self.assertEqual([stage for _, stage in stages], expected)
                for image, stage in stages:
                    if stage == "migrate":
                        continue  # derived from the builder stage, so it shares its base image
                    with self.subTest(stage=stage):
                        self.assertRegex(
                            image,
                            r"^public\.ecr\.aws/docker/library/node:22\.\d+\.\d+-alpine@sha256:[0-9a-f]{64}$",
                        )
                    images.append(image)
        self.assertEqual(len(set(images)), 1)


class ApiMigrateStageTests(unittest.TestCase):
    def setUp(self):
        self.text = (ROOT / "apps" / "api" / "Dockerfile").read_text(encoding="utf-8")
        self.stages = re.findall(
            r"^FROM\s+(\S+)\s+AS\s+(\S+)\s*$", self.text, re.MULTILINE | re.IGNORECASE
        )

    def migrate_block(self):
        match = re.search(
            r"^FROM\s+\S+\s+AS\s+migrate\s*$(.*?)(?=^FROM\s|\Z)",
            self.text,
            re.MULTILINE | re.IGNORECASE | re.DOTALL,
        )
        self.assertIsNotNone(match, "the api Dockerfile needs a migrate stage")
        return match.group(1)

    def test_runner_stays_the_final_stage_so_a_plain_build_is_the_runtime_image(self):
        self.assertEqual(self.stages[-1][1], "runner")
        self.assertIn("migrate", [stage for _, stage in self.stages])

    def test_migrate_stage_derives_from_the_builder_that_has_the_prisma_cli(self):
        self.assertIn(("builder", "migrate"), [(base, stage) for base, stage in self.stages])

    def test_migrate_stage_runs_as_non_root_and_deploys_migrations_by_default(self):
        block = self.migrate_block()
        self.assertRegex(block, r"(?m)^USER node\s*$")
        self.assertRegex(block, r"(?m)^WORKDIR /app/apps/api\s*$")
        self.assertRegex(
            block,
            r'(?m)^CMD \["(?:\./)?node_modules/\.bin/prisma",\s*"migrate",\s*"deploy",\s*"--schema",\s*"prisma/schema\.prisma"\]\s*$',
        )
        self.assertNotIn("DATABASE_URL", block, "the URL comes from the environment at run time")


if __name__ == "__main__":
    unittest.main()
