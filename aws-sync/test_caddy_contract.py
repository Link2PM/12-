from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEPLOY = ROOT / "deploy"
VERIFIER_PATH = DEPLOY / "verify_caddy_contract.py"
SPEC = importlib.util.spec_from_file_location("healthy_verify_caddy_contract", VERIFIER_PATH)
if SPEC is None or SPEC.loader is None:  # pragma: no cover - import failure is explicit
    raise RuntimeError(f"cannot import {VERIFIER_PATH}")
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)


class HealthyCaddyContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.root_text = (DEPLOY / "Caddyfile.example").read_text(encoding="utf-8")
        cls.fragment_text = (DEPLOY / "healthy.caddy").read_text(encoding="utf-8")

    def assert_invalid(self, root: str | None = None, fragment: str | None = None) -> None:
        with self.assertRaises(VERIFIER.ContractError):
            VERIFIER.verify_contract(
                self.root_text if root is None else root,
                self.fragment_text if fragment is None else fragment,
            )

    def test_canonical_shared_root_and_fragment_pass(self) -> None:
        VERIFIER.verify_contract(self.root_text, self.fragment_text)

    def test_missing_root_import_fails_closed(self) -> None:
        self.assert_invalid(root="api.example.test {\n respond 204\n}\n")

    def test_nested_or_duplicate_root_import_fails_closed(self) -> None:
        nested = "example.test {\n import /etc/caddy/healthy.caddy\n}\n"
        self.assert_invalid(root=nested)
        self.assert_invalid(root=self.root_text + "\nimport /etc/caddy/healthy.caddy\n")

    def test_inline_static_only_health_site_in_shared_root_is_rejected(self) -> None:
        broken_root = self.root_text + """
health.gaindar.com {
    tls internal
    root * /srv/healthy
    file_server
    encode gzip
}
"""
        self.assert_invalid(root=broken_root)

    def test_static_only_fragment_fails_closed(self) -> None:
        static_only = """
health.gaindar.com {
    tls internal
    root * /srv/healthy
    file_server
    encode gzip
}
"""
        self.assert_invalid(fragment=static_only)

    def test_missing_or_wrong_reverse_proxy_fails_closed(self) -> None:
        missing = self.fragment_text.replace("\t\t\treverse_proxy 127.0.0.1:8787\n", "")
        wrong = self.fragment_text.replace("127.0.0.1:8787", "127.0.0.1:8000")
        self.assert_invalid(fragment=missing)
        self.assert_invalid(fragment=wrong)

    def test_incomplete_exact_api_matcher_fails_closed(self) -> None:
        incomplete = self.fragment_text.replace(" /api/health/", "")
        self.assert_invalid(fragment=incomplete)

    def test_unknown_api_before_exact_api_is_rejected_as_shadow_risk(self) -> None:
        sync_start = self.fragment_text.index("\t\t@healthy_sync path ")
        unknown_start = self.fragment_text.index("\t\t@unknown_api path ")
        static_start = self.fragment_text.index("\t\thandle {\n", unknown_start)
        sync_section = self.fragment_text[sync_start:unknown_start]
        unknown_section = self.fragment_text[unknown_start:static_start]
        shadowed = (
            self.fragment_text[:sync_start]
            + unknown_section
            + sync_section
            + self.fragment_text[static_start:]
        )
        self.assert_invalid(fragment=shadowed)

    def test_site_level_encode_that_can_transform_api_is_rejected(self) -> None:
        unsafe = self.fragment_text.replace("\ttls internal\n", "\ttls internal\n\tencode gzip\n", 1)
        self.assert_invalid(fragment=unsafe)

    def test_static_handler_must_retain_compression(self) -> None:
        uncompressed = self.fragment_text.replace("\t\t\tencode zstd gzip\n", "", 1)
        self.assert_invalid(fragment=uncompressed)


if __name__ == "__main__":
    unittest.main()
