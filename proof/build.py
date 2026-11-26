#!/usr/bin/env python3
"""Build the phase-0 offline HTML proof from the shared JSON fixture.

This is deliberately a static, replaceable proof. It makes no API calls and
does not claim that any placeholder is approved Jump content.
"""

from __future__ import annotations

import base64
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PROOF = Path(__file__).resolve().parent
SOURCE = ROOT / "examples" / "presentation.example.json"
OUTPUT = PROOF / "dist" / "deck.html"
SITE_OUTPUT = ROOT / "preview-dev3" / "editor-dev2.html"
WEB_OUTPUT = ROOT / "apps" / "web" / "public" / "editor-dev2.html"
HOSTED_OUTPUT = ROOT / "dist" / "editor-dev2.html"

EXPECTED_SLOTS = {
    "cover": {"title", "subtitle", "image"},
    "textImage": {"title", "body", "image"},
    "twoColumns": {"title", "leftHeading", "leftBody", "rightHeading", "rightBody"},
    "metrics": {"title", "subtitle", "metrics"},
    "case": {"title", "challenge", "solution", "outcome", "image"},
    "closing": {"title", "body", "image"},
}
IMAGE_MIMES = {"image/svg+xml", "image/png", "image/jpeg", "image/webp"}
EXTERNAL_REFERENCE = re.compile(r"(?:https?:|file:|//|@import)", re.IGNORECASE)


class DependencyScanner(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.errors: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"iframe", "object", "embed", "link"}:
            self.errors.append(f"Unsupported external-capable element: {tag}")
        for name, value in attrs:
            if name in {"src", "href"} and value and not (value.startswith("#") or value.startswith("data:")):
                self.errors.append(f"External HTML reference: {tag}[{name}]={value}")


def fail(message: str) -> None:
    raise ValueError(message)


def read_json() -> dict:
    try:
        data = json.loads(SOURCE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"Missing fixture: {SOURCE}")
    except json.JSONDecodeError as error:
        fail(f"Invalid fixture JSON: {error}")
    if not isinstance(data, dict):
        fail("The fixture root must be an object")
    return data


def unique_id(value: object, seen: set[str], label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{label} must have a non-empty string id")
    if value in seen:
        fail(f"Duplicate id: {value}")
    seen.add(value)
    return value


def validate_and_inline(data: dict) -> None:
    for key in ("schemaVersion", "id", "documentRevision", "title", "locale", "theme", "assets", "slides", "metadata"):
        if key not in data:
            fail(f"Missing presentation field: {key}")

    if not isinstance(data["schemaVersion"], str) or not data["schemaVersion"]:
        fail("schemaVersion must be a non-empty string")
    if not isinstance(data["documentRevision"], int) or data["documentRevision"] < 0:
        fail("documentRevision must be a non-negative integer")
    if data["theme"].get("aspectRatio") != "16:9":
        fail("The phase-0 proof supports only theme.aspectRatio = '16:9'")
    if not isinstance(data["assets"], list) or not isinstance(data["slides"], list):
        fail("assets and slides must be arrays")

    seen: set[str] = set()
    unique_id(data["id"], seen, "Presentation")
    assets: dict[str, dict] = {}
    for asset in data["assets"]:
        if not isinstance(asset, dict):
            fail("Every asset must be an object")
        asset_id = unique_id(asset.get("id"), seen, "Asset")
        if asset.get("kind") != "image" or asset.get("mimeType") not in IMAGE_MIMES:
            fail(f"Unsupported image asset: {asset_id}")
        relative = asset.get("path")
        if not isinstance(relative, str) or not relative.startswith("assets/"):
            fail(f"Asset {asset_id} must use a repository-relative assets/ path")
        if EXTERNAL_REFERENCE.search(relative) or "\\" in relative:
            fail(f"Remote or malformed asset path: {relative}")
        path = (ROOT / relative).resolve()
        try:
            path.relative_to((ROOT / "assets").resolve())
        except ValueError:
            fail(f"Asset path leaves assets/: {relative}")
        if not path.is_file():
            fail(f"Missing asset {asset_id}: {path}")
        content = path.read_bytes()
        if asset["mimeType"] == "image/svg+xml":
            # Git may check out SVG text with CRLF on Windows; embed stable bytes.
            content = content.replace(b"\r\n", b"\n")
            svg = content.decode("utf-8")
            svg_without_namespace = svg.replace('http://www.w3.org/2000/svg', '').replace('http://www.w3.org/1999/xlink', '')
            if EXTERNAL_REFERENCE.search(svg_without_namespace):
                fail(f"SVG asset {asset_id} has an external reference")
            if re.search(r"(?:href|src)\s*=\s*['\"](?!#|data:)", svg, re.IGNORECASE):
                fail(f"SVG asset {asset_id} references another file")
        asset["dataUri"] = f"data:{asset['mimeType']};base64,{base64.b64encode(content).decode('ascii')}"
        assets[asset_id] = asset

    layouts: set[str] = set()
    for slide in data["slides"]:
        if not isinstance(slide, dict):
            fail("Every slide must be an object")
        slide_id = unique_id(slide.get("id"), seen, "Slide")
        layout = slide.get("layout")
        if layout not in EXPECTED_SLOTS:
            fail(f"Unsupported layout in {slide_id}: {layout}")
        if layout in layouts:
            fail(f"Phase-0 fixture must have one {layout} slide")
        layouts.add(layout)
        blocks = slide.get("blocks")
        if not isinstance(blocks, list):
            fail(f"Slide {slide_id} blocks must be an array")
        slots: set[str] = set()
        for block in blocks:
            if not isinstance(block, dict):
                fail(f"Slide {slide_id} contains a non-object block")
            block_id = unique_id(block.get("id"), seen, "Block")
            slot, kind, value = block.get("slot"), block.get("kind"), block.get("value")
            if not isinstance(slot, str) or not isinstance(value, dict):
                fail(f"Block {block_id} must have slot and value")
            slots.add(slot)
            if kind == "text" and not isinstance(value.get("text"), str):
                fail(f"Text block {block_id} needs value.text")
            elif kind == "image":
                if value.get("assetId") not in assets or not isinstance(value.get("alt"), str):
                    fail(f"Image block {block_id} needs an existing assetId and alt")
            elif kind == "metric":
                if slot != "metrics" or not isinstance(value.get("value"), str) or not isinstance(value.get("label"), str):
                    fail(f"Metric block {block_id} needs value and label strings")
            else:
                if kind not in {"text", "image", "metric"}:
                    fail(f"Unsupported block kind in {block_id}: {kind}")
            expected_kind = "image" if slot == "image" else "metric" if slot == "metrics" else "text"
            if kind != expected_kind:
                fail(f"Block {block_id} slot {slot} must be {expected_kind}")
        if slots != EXPECTED_SLOTS[layout]:
            fail(f"Slide {slide_id} ({layout}) slots are {sorted(slots)}; expected {sorted(EXPECTED_SLOTS[layout])}")
        for slot in slots - {"metrics"}:
            if sum(block["slot"] == slot for block in blocks) != 1:
                fail(f"Slide {slide_id} must have exactly one {slot} block")
        metric_count = sum(block["slot"] == "metrics" for block in blocks)
        if layout == "metrics" and not 2 <= metric_count <= 3:
            fail(f"Slide {slide_id} needs two or three metric blocks")

    if layouts != set(EXPECTED_SLOTS) or len(data["slides"]) != 6:
        fail(f"Phase-0 fixture needs exactly six layouts: {', '.join(EXPECTED_SLOTS)}")


def build() -> None:
    data = read_json()
    validate_and_inline(data)
    css = (PROOF / "deck.css").read_text(encoding="utf-8")
    js = (PROOF / "deck.js").read_text(encoding="utf-8")
    if re.search(r"@import|url\s*\(", css, re.IGNORECASE):
        fail("Stylesheet contains an external-capable import or URL")
    # HTML parser safe: fixture text can never end the application/json tag.
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    if "</script" in js.lower() or "</style" in css.lower():
        fail("Inline source contains an HTML closing tag")
    html = (PROOF / "template.html").read_text(encoding="utf-8")
    html = html.replace("/*__DECK_CSS__*/", css).replace("/*__DECK_DATA__*/", payload).replace("/*__DECK_JS__*/", js)
    scanner = DependencyScanner()
    scanner.feed(html)
    if scanner.errors:
        fail("; ".join(scanner.errors))
    for output in (OUTPUT, SITE_OUTPUT, WEB_OUTPUT, HOSTED_OUTPUT):
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(html, encoding="utf-8")
        print(f"Built {output.relative_to(ROOT)}: 6 layouts, {len(data['assets'])} inlined assets, {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    try:
        build()
    except (OSError, ValueError, KeyError, AttributeError) as error:
        print(f"Build failed: {error}", file=sys.stderr)
        sys.exit(1)
