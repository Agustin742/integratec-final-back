"""Structural checks for the service base-image reproducibility contract."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]


class DockerfileTests(unittest.TestCase):
    def test_service_stages_share_an_immutable_node_22_image(self):
        images = []
        for service in ("api", "realtime"):
            with self.subTest(service=service):
                dockerfile = ROOT / "apps" / service / "Dockerfile"
                stages = re.findall(
                    r"^FROM\s+(\S+)\s+AS\s+(\S+)\s*$",
                    dockerfile.read_text(encoding="utf-8"),
                    re.MULTILINE | re.IGNORECASE,
                )
                self.assertEqual([stage for _, stage in stages], ["builder", "runner"])
                for image, stage in stages:
                    with self.subTest(stage=stage):
                        self.assertRegex(
                            image,
                            r"^node:22\.\d+\.\d+-alpine@sha256:[0-9a-f]{64}$",
                        )
                    images.append(image)
        self.assertEqual(len(set(images)), 1)


if __name__ == "__main__":
    unittest.main()
