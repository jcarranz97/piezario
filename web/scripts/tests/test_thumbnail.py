"""Tests for the thumbnail generator's pure logic.

These cover STL parsing and the model-discovery rules that must stay in sync
with `walk()` in `web/lib/catalog.ts` — the folder-is-a-model invariant. The
matplotlib `render()` path is intentionally not exercised here; it needs a
heavy GL-free drawing stack and produces an image, not a value to assert on.
"""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

import thumbnail

DEFAULT_EXCLUDE = thumbnail.DEFAULT_EXCLUDE
DEFAULT_OUTPUT_DIRS = thumbnail.DEFAULT_OUTPUT_DIRS


# --------------------------------------------------------------------------
# STL loading
# --------------------------------------------------------------------------


def _binary_stl(triangles: list[list[list[float]]]) -> bytes:
    out = bytearray(b"\0" * 80)  # 80-byte header
    out += struct.pack("<I", len(triangles))
    for tri in triangles:
        out += struct.pack("<3f", 0.0, 0.0, 0.0)  # normal (recomputed later)
        for vertex in tri:
            out += struct.pack("<3f", *vertex)
        out += struct.pack("<H", 0)  # attribute byte count
    return bytes(out)


_TRIANGLE = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]

_ASCII_STL = """solid demo
 facet normal 0 0 0
  outer loop
   vertex 0 0 0
   vertex 1 0 0
   vertex 0 1 0
  endloop
 endfacet
endsolid demo
"""


def test_load_binary_stl(tmp_path: Path) -> None:
    path = tmp_path / "part.stl"
    path.write_bytes(_binary_stl([_TRIANGLE, _TRIANGLE]))
    tris = thumbnail.load_stl(path)
    assert tris.shape == (2, 3, 3)
    assert tris[0].tolist() == _TRIANGLE


def test_load_ascii_stl(tmp_path: Path) -> None:
    path = tmp_path / "part.stl"
    path.write_text(_ASCII_STL)
    tris = thumbnail.load_stl(path)
    assert tris.shape == (1, 3, 3)
    assert tris[0].tolist() == _TRIANGLE


def test_load_stl_rejects_tiny_files(tmp_path: Path) -> None:
    path = tmp_path / "bad.stl"
    path.write_bytes(b"too small")
    with pytest.raises(ValueError):
        thumbnail.load_stl(path)


def test_binary_detection_beats_a_solid_header(tmp_path: Path) -> None:
    # A binary STL whose header happens to start with the word "solid" must
    # still be read as binary, because its size matches the triangle count.
    raw = bytearray(_binary_stl([_TRIANGLE]))
    raw[0:5] = b"solid"
    path = tmp_path / "tricky.stl"
    path.write_bytes(bytes(raw))
    tris = thumbnail.load_stl(path)
    assert tris.shape == (1, 3, 3)


# --------------------------------------------------------------------------
# Exclusion rules (mirror of isExcluded in lib/config.ts)
# --------------------------------------------------------------------------


def test_is_excluded_dotfiles_and_patterns() -> None:
    assert thumbnail.is_excluded(".git", ".git", [])
    assert thumbnail.is_excluded(".venv", "a/.venv", [])
    assert thumbnail.is_excluded("node_modules", "node_modules", ["node_modules"])
    assert not thumbnail.is_excluded("models", "models", ["node_modules"])


def test_is_excluded_path_scoped_pattern() -> None:
    assert thumbnail.is_excluded("scratch", "examples/scratch", ["examples/scratch"])
    assert not thumbnail.is_excluded("scratch", "other/scratch", ["examples/scratch"])


# --------------------------------------------------------------------------
# Model discovery (the folder-is-a-model invariant)
# --------------------------------------------------------------------------


def test_is_model_dir_leaf_and_category(tmp_path: Path) -> None:
    root = tmp_path
    model = root / "keychains" / "tag"
    model.mkdir(parents=True)
    (model / "tag.stl").write_bytes(b"x")

    # A leaf folder is a model.
    assert thumbnail.is_model_dir(model, DEFAULT_EXCLUDE, DEFAULT_OUTPUT_DIRS, root)
    # Its parent has a subfolder, so it is a category, not a model.
    assert not thumbnail.is_model_dir(
        model.parent, DEFAULT_EXCLUDE, DEFAULT_OUTPUT_DIRS, root
    )


def test_output_folder_does_not_demote_a_model(tmp_path: Path) -> None:
    root = tmp_path
    gen = root / "gadgets" / "box"
    (gen / "out").mkdir(parents=True)
    (gen / "box.py").write_text("# generator")
    (gen / "out" / "box.stl").write_bytes(b"x")

    # box/ holds only an out/ subfolder → still a model.
    assert thumbnail.is_model_dir(gen, DEFAULT_EXCLUDE, DEFAULT_OUTPUT_DIRS, root)


def test_find_model_dirs(tmp_path: Path) -> None:
    root = tmp_path
    (root / "keychains" / "tag").mkdir(parents=True)
    (root / "keychains" / "tag" / "tag.stl").write_bytes(b"x")
    (root / "decor" / "vase").mkdir(parents=True)
    (root / "decor" / "vase" / "vase.stl").write_bytes(b"x")
    # An excluded category is skipped entirely.
    (root / "node_modules" / "junk").mkdir(parents=True)
    (root / "node_modules" / "junk" / "x.stl").write_bytes(b"x")

    found = {p.relative_to(root).as_posix() for p in thumbnail.find_model_dirs(
        root, DEFAULT_EXCLUDE, DEFAULT_OUTPUT_DIRS
    )}
    assert found == {"keychains/tag", "decor/vase"}


# --------------------------------------------------------------------------
# config, images and STL picking
# --------------------------------------------------------------------------


def test_load_config_reads_catalog_yaml(tmp_path: Path) -> None:
    root = tmp_path / "models"
    root.mkdir()
    (tmp_path / "catalog.yaml").write_text(
        "exclude:\n  - node_modules\n  - scratch\noutput_dirs:\n  - out\n"
    )
    exclude, outputs = thumbnail.load_config(root)
    assert exclude == ["node_modules", "scratch"]
    assert outputs == ["out"]


def test_load_config_defaults_without_a_file(tmp_path: Path) -> None:
    root = tmp_path / "models"
    root.mkdir()
    exclude, outputs = thumbnail.load_config(root)
    assert exclude == DEFAULT_EXCLUDE
    assert outputs == DEFAULT_OUTPUT_DIRS


def test_has_image(tmp_path: Path) -> None:
    model = tmp_path / "m"
    model.mkdir()
    (model / "part.stl").write_bytes(b"x")
    assert not thumbnail.has_image(model)
    (model / "cover.png").write_bytes(b"x")
    assert thumbnail.has_image(model)


def test_pick_stl_prefers_the_largest_including_output(tmp_path: Path) -> None:
    model = tmp_path / "m"
    (model / "out").mkdir(parents=True)
    (model / "small.stl").write_bytes(b"x" * 10)
    (model / "out" / "big.stl").write_bytes(b"x" * 1000)
    chosen = thumbnail.pick_stl(model, DEFAULT_OUTPUT_DIRS)
    assert chosen is not None
    assert chosen.name == "big.stl"


def test_pick_stl_returns_none_when_no_stl(tmp_path: Path) -> None:
    model = tmp_path / "m"
    model.mkdir()
    (model / "readme.md").write_text("nothing to render")
    assert thumbnail.pick_stl(model, DEFAULT_OUTPUT_DIRS) is None
