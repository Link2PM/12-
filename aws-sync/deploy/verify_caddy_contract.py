#!/usr/bin/env python3
"""Fail closed when the shared Caddy config drops Healthy's API contract.

This verifier intentionally checks ownership as well as route content:

* the shared root must import ``/etc/caddy/healthy.caddy`` exactly once at the
  top level and must not inline ``health.gaindar.com``;
* the Healthy-owned fragment must keep the exact API matcher ahead of the
  broad unknown-API matcher;
* compression is allowed only in the static handler, never around the API.

It is a repository/deployment guard, not a Caddy syntax parser, and it does not
recursively prove the contents of unrelated imported files. Run it before
``caddy validate``; then run the documented direct-origin smoke after reload.
"""

from __future__ import annotations

import argparse
import shlex
import sys
from pathlib import Path
from typing import Sequence


CANONICAL_IMPORT = "/etc/caddy/healthy.caddy"
PRODUCTION_ROOT = Path("/etc/caddy/Caddyfile")
HEALTHY_HOST = "health.gaindar.com"
HEALTHY_UPSTREAM = "127.0.0.1:8787"
SYNC_PATHS = (
    "/api/sync",
    "/api/sync/",
    "/api/snapshot",
    "/api/snapshot/",
    "/api/health",
    "/api/health/",
)
UNKNOWN_API_PATHS = ("/api", "/api/*")
MUTABLE_PATHS = ("/", "/index.html", "/plan.js", "/sw.js")


class ContractError(ValueError):
    """Raised when a Caddy file is syntactically plausible but unsafe."""


def _strip_comment(line: str) -> str:
    quote: str | None = None
    escaped = False
    result: list[str] = []
    for character in line:
        if escaped:
            result.append(character)
            escaped = False
            continue
        if character == "\\" and quote is not None:
            result.append(character)
            escaped = True
            continue
        if quote is not None:
            result.append(character)
            if character == quote:
                quote = None
            continue
        if character in {"'", '"'}:
            quote = character
            result.append(character)
            continue
        if character == "#":
            break
        result.append(character)
    return "".join(result).strip()


def _logical_lines(text: str) -> list[str]:
    return [clean for raw in text.splitlines() if (clean := _strip_comment(raw))]


def _is_block_opener(line: str) -> bool:
    # Caddy placeholders such as {path} are arguments, not structural braces.
    return line.endswith("{")


def _extract_block(lines: Sequence[str], opener: str) -> tuple[list[str], int, int]:
    matches = [index for index, line in enumerate(lines) if line == opener]
    if len(matches) != 1:
        raise ContractError(f"expected exactly one {opener!r} block, found {len(matches)}")
    start = matches[0]
    depth = 0
    for index in range(start, len(lines)):
        line = lines[index]
        if _is_block_opener(line):
            depth += 1
        elif line == "}":
            depth -= 1
            if depth == 0:
                return list(lines[start + 1 : index]), start, index
            if depth < 0:
                break
    raise ContractError(f"unterminated {opener!r} block")


def _direct_lines(lines: Sequence[str]) -> list[str]:
    """Return directives immediately inside a block, preserving order."""
    direct: list[str] = []
    depth = 0
    for line in lines:
        if line == "}":
            depth -= 1
            if depth < 0:
                raise ContractError("unbalanced closing brace")
            continue
        if depth == 0:
            direct.append(line)
        if _is_block_opener(line):
            depth += 1
    if depth != 0:
        raise ContractError("unbalanced block braces")
    return direct


def _tokens(line: str) -> tuple[str, ...]:
    try:
        return tuple(shlex.split(line))
    except ValueError as error:
        raise ContractError(f"cannot parse directive {line!r}: {error}") from error


def _site_opener_mentions_healthy(line: str) -> bool:
    """Recognize common Caddy address spellings for the Healthy host."""
    if not _is_block_opener(line):
        return False
    for token in _tokens(line[:-1].strip()):
        for address in token.split(","):
            normalized = address.strip().lower()
            for scheme in ("https://", "http://"):
                if normalized.startswith(scheme):
                    normalized = normalized[len(scheme) :]
                    break
            authority = normalized.split("/", 1)[0]
            if authority == HEALTHY_HOST or authority.startswith(f"{HEALTHY_HOST}:"):
                return True
    return False


def verify_root_contract(root_text: str) -> None:
    lines = _logical_lines(root_text)
    direct = _direct_lines(lines)
    import_line = f"import {CANONICAL_IMPORT}"
    import_count = direct.count(import_line)
    if import_count != 1:
        raise ContractError(
            f"shared root must contain exactly one top-level {import_line!r}; found {import_count}"
        )
    if any(_site_opener_mentions_healthy(line) for line in lines):
        raise ContractError("shared root must not inline the Healthy site block")


def verify_fragment_contract(fragment_text: str) -> None:
    lines = _logical_lines(fragment_text)
    site, start, end = _extract_block(lines, f"{HEALTHY_HOST} {{")
    if start != 0 or end != len(lines) - 1:
        raise ContractError("Healthy fragment must contain only the canonical site block")

    site_direct = _direct_lines(site)
    if site_direct != ["tls internal", "route {"]:
        raise ContractError(
            "Healthy site must contain only 'tls internal' followed by the ordered route block"
        )

    route, _, _ = _extract_block(site, "route {")
    expected_sync_matcher = "@healthy_sync path " + " ".join(SYNC_PATHS)
    expected_unknown_matcher = "@unknown_api path " + " ".join(UNKNOWN_API_PATHS)
    expected_route_direct = [
        expected_sync_matcher,
        "handle @healthy_sync {",
        expected_unknown_matcher,
        "handle @unknown_api {",
        "handle {",
    ]
    route_direct = _direct_lines(route)
    if route_direct != expected_route_direct:
        raise ContractError(
            "route order or matchers changed: exact Healthy API must precede unknown /api and static"
        )

    if _tokens(route_direct[0]) != ("@healthy_sync", "path", *SYNC_PATHS):
        raise ContractError("Healthy API matcher must contain all exact sync, snapshot, and health paths")
    if _tokens(route_direct[2]) != ("@unknown_api", "path", *UNKNOWN_API_PATHS):
        raise ContractError("unknown API matcher must cover only /api and /api/*")

    sync_handler, _, _ = _extract_block(route, "handle @healthy_sync {")
    if _direct_lines(sync_handler) != [f"reverse_proxy {HEALTHY_UPSTREAM}"]:
        raise ContractError(f"Healthy API handler must proxy only to {HEALTHY_UPSTREAM}")

    unknown_handler, _, _ = _extract_block(route, "handle @unknown_api {")
    if _direct_lines(unknown_handler) != ["respond 404"]:
        raise ContractError("unknown Healthy API paths must return 404")

    static_handler, _, _ = _extract_block(route, "handle {")
    static_direct = _direct_lines(static_handler)
    expected_static = [
        "encode zstd gzip",
        "root * /srv/healthy",
        "@mutable path " + " ".join(MUTABLE_PATHS),
        'header @mutable Cache-Control "no-cache, must-revalidate"',
        "try_files {path} /index.html",
        "file_server",
    ]
    if static_direct != expected_static:
        raise ContractError(
            "static handler must retain isolated compression, cache headers, SPA fallback, and file server"
        )

    # The exact direct-line checks above already exclude encode from the site,
    # route, API, and unknown handlers. Keep an explicit diagnostic as a guard
    # if the accepted grammar is broadened later.
    non_static_directives = (
        site_direct
        + route_direct
        + _direct_lines(sync_handler)
        + _direct_lines(unknown_handler)
    )
    if any(_tokens(line)[:1] == ("encode",) for line in non_static_directives):
        raise ContractError("API responses must not be wrapped by Caddy encode")


def verify_contract(root_text: str, fragment_text: str) -> None:
    verify_root_contract(root_text)
    verify_fragment_contract(fragment_text)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=PRODUCTION_ROOT,
        help="shared root Caddyfile (default: /etc/caddy/Caddyfile)",
    )
    parser.add_argument(
        "--candidate-fragment",
        type=Path,
        help=(
            "repository/staging candidate only; production mode deliberately reads "
            f"the installed {CANONICAL_IMPORT} named by the root import"
        ),
    )
    return parser


def resolve_fragment_path(root_path: Path, candidate_fragment: Path | None) -> tuple[Path, str]:
    """Bind production verification to the fragment the root actually imports."""
    if candidate_fragment is None:
        return Path(CANONICAL_IMPORT), "installed"
    if root_path.resolve(strict=False) == PRODUCTION_ROOT.resolve(strict=False):
        raise ContractError(
            "candidate fragment cannot be paired with the production root; "
            f"omit --candidate-fragment to inspect installed {CANONICAL_IMPORT}"
        )
    return candidate_fragment, "candidate"


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        fragment_path, mode = resolve_fragment_path(args.root, args.candidate_fragment)
        root_text = args.root.read_text(encoding="utf-8")
        fragment_text = fragment_path.read_text(encoding="utf-8")
        verify_contract(root_text, fragment_text)
    except (OSError, ContractError) as error:
        print(f"FAIL: Healthy Caddy contract: {error}", file=sys.stderr)
        return 1
    print(
        f"PASS ({mode}): shared root imports the Healthy-owned fragment and exact "
        "API/static route contract is intact"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
