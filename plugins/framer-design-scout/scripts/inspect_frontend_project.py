#!/usr/bin/env python3
"""Inspect a frontend project and print a compact design-oriented summary."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Iterable


FRONTEND_MARKERS = (
    "src",
    "app",
    "pages",
    "components",
    "styles",
    "public",
    "assets",
)

STYLE_EXTENSIONS = {".css", ".scss", ".sass", ".less", ".pcss"}
COMPONENT_EXTENSIONS = {".tsx", ".jsx", ".vue", ".svelte", ".astro"}


def iter_files(root: Path, names: Iterable[str], extensions: set[str], limit: int = 40) -> list[str]:
    results: list[str] = []
    ignored = {"node_modules", ".git", "out", "dist", "build", ".next", "coverage"}
    for base_name in names:
        base = root / base_name
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if len(results) >= limit:
                return results
            if any(part in ignored for part in path.parts):
                continue
            if path.is_file() and path.suffix.lower() in extensions:
                results.append(str(path))
    return results


def read_package(package_root: Path) -> dict:
    package_path = package_root / "package.json"
    if not package_path.exists():
        return {}
    try:
        return json.loads(package_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"error": "package.json is not valid JSON"}


def discover_package_roots(root: Path) -> list[Path]:
    roots = [root]
    for workspace_name in ("apps", "packages"):
        workspace_root = root / workspace_name
        if not workspace_root.exists():
            continue
        for package_json in workspace_root.glob("*/package.json"):
            roots.append(package_json.parent)
    return roots


def main() -> int:
    root = Path(os.environ.get("FRAMER_SCOUT_PROJECT_ROOT", os.getcwd())).resolve()
    package_roots = discover_package_roots(root)
    package_summaries = []
    dependencies = {}
    component_files: list[str] = []
    style_files: list[str] = []

    for package_root in package_roots:
        package = read_package(package_root)
        for key in ("dependencies", "devDependencies"):
            value = package.get(key)
            if isinstance(value, dict):
                dependencies.update(value)
        package_summaries.append(
            {
                "path": str(package_root.relative_to(root)) if package_root != root else ".",
                "name": package.get("name"),
                "scripts": package.get("scripts", {}),
            }
        )
        component_files.extend(iter_files(package_root, FRONTEND_MARKERS, COMPONENT_EXTENSIONS))
        style_files.extend(iter_files(package_root, FRONTEND_MARKERS, STYLE_EXTENSIONS))

    frontend_signals = [
        name
        for name in (
            "react",
            "next",
            "vite",
            "vue",
            "svelte",
            "astro",
            "tailwindcss",
            "styled-components",
            "@emotion/react",
            "framer-motion",
            "lucide-react",
        )
        if name in dependencies
    ]

    summary = {
        "projectRoot": str(root),
        "packages": package_summaries,
        "frontendSignals": frontend_signals,
        "componentFiles": [str(Path(path).relative_to(root)) for path in component_files[:60]],
        "styleFiles": [str(Path(path).relative_to(root)) for path in style_files[:60]],
    }

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
