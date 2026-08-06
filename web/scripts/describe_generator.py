#!/usr/bin/env python3
"""Dump a click generator script's parameters as JSON, so the app can build a form.

Every parametric model in the catalog is a `click` command, and a click command
already knows its whole schema: each option's flags, type, choices, default,
whether it is a flag, whether it is required, and a line of help text. Asking it
is the only way to build a customiser form that cannot drift from the script --
the alternative is a hand-written schema per model that goes stale the first
time someone adds an option.

    python describe_generator.py path/to/dogcup.py

Run this with the *model's own* interpreter (`<model>/.venv/bin/python`), not
the app's: importing the module pulls in build123d and OCC, which only exist
there. It costs a few seconds, which is why the caller caches the result
against the script's mtime.

Nothing here is specific to any one model. A new generator that uses click
needs no code in this file.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

try:
    import click
except ImportError:  # pragma: no cover - the venv is the model's, not ours
    sys.exit(json.dumps({"error": "click is not installed in this interpreter"}))


def load_module(script: Path):
    """Import the script without it having to be a package.

    Its own folder goes on `sys.path` first: generator scripts sit next to
    helpers they import by bare name (`lipbalm_holder` imports `bambu3mf`), and
    those are not importable from anywhere else.
    """
    sys.path.insert(0, str(script.parent))
    spec = importlib.util.spec_from_file_location(script.stem, script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def find_command(module) -> click.Command:
    """The one click command in the module.

    Taken by scanning the module's values rather than by looking for a name:
    the decorator replaces `main` with a Command object, but nothing says the
    function has to be called `main`.
    """
    commands = [v for v in vars(module).values() if isinstance(v, click.Command)]
    if not commands:
        raise RuntimeError("no click command found in this script")
    if len(commands) > 1:
        # Prefer one actually named `main`; otherwise the first is as good a
        # guess as any and the frontmatter can always name the script exactly.
        named = [c for c in commands if c.name == "main"]
        return named[0] if named else commands[0]
    return commands[0]


def type_of(param: click.Parameter) -> dict:
    """The param's type, flattened to something a form can render.

    `click.Choice` carries its own options, which become a select. Everything
    else reduces to the type's own name -- "text", "float", "integer",
    "boolean", "path".
    """
    if isinstance(param.type, click.Choice):
        return {"type": "choice", "choices": list(param.type.choices)}
    if getattr(param, "is_flag", False):
        return {"type": "flag"}
    # Tested by class, not by name: `click.Path` calls itself "file" or
    # "directory" depending on its flags, and neither string says "this one
    # takes a filesystem path". These are the parameters that must never carry
    # a browser-supplied value, so misclassifying one is the expensive mistake.
    if isinstance(param.type, click.Path):
        return {"type": "path"}
    name = getattr(param.type, "name", "text")
    if name in ("float", "integer", "text", "boolean"):
        return {"type": name}
    return {"type": "text"}


def jsonable(value):
    """Defaults can be `Path`, tuples, or anything else click allowed.

    Click marks "no default at all" with an internal sentinel rather than None,
    and stringifying it puts a literal "Sentinel.UNSET" in the form. Anything
    from click's own module is that sentinel and means the same as None.
    """
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if type(value).__module__.split(".")[0] == "click":
        return None
    return str(value)


def describe(param: click.Parameter) -> dict | None:
    """One option, or None for the ones a form has no business showing."""
    if not isinstance(param, click.Option):
        return None
    # --help is click's own, and never a model parameter.
    if param.name == "help" or param.is_eager and param.name == "help":
        return None

    spec = {
        "name": param.name,
        # The long flag, which is what gets passed on the command line. Click
        # lists them longest-first only by accident, so pick explicitly.
        "opt": max(param.opts, key=len),
        "aliases": [o for o in param.opts if o != max(param.opts, key=len)],
        # `--step/--no-step` — the off switch lives here, not in opts.
        "secondary": param.secondary_opts[0] if param.secondary_opts else None,
        "help": param.help or "",
        "required": bool(param.required),
        # `multiple=True` — the flag may be given more than once, and every
        # occurrence counts. A form has to render that as a list you add rows
        # to, not as one box: collapsing it to a single value would silently
        # drop everything after the first, which on a keycap order is every
        # name but one.
        "multiple": bool(getattr(param, "multiple", False)),
        "default": jsonable(param.default),
        # `show_default="fitted to the handle"` is a human explanation of what
        # happens when the option is left alone, and it is often the only place
        # that behaviour is written down. Worth surfacing as placeholder text.
        "default_hint": (
            param.show_default if isinstance(param.show_default, str) else None
        ),
    }
    spec.update(type_of(param))
    return spec


def dependent_defaults(module) -> dict:
    """Options whose default follows the value of another option.

    Click has no way to say "my default depends on that field", because a CLI
    has no live form to react to — you just pass the flag. A form does, and the
    difference matters: one field standing in for a choice the customer already
    made above it is a field that is wrong for every choice but one.

    So a script may declare it, as `DEPENDENT_DEFAULTS`:

        DEPENDENT_DEFAULTS = {
            "--revision": {"on": "--variant",
                           "map": {"snap": "C", "tongue": "B"}},
        }

    The SCRIPT owns the mapping, not this repo and not the frontmatter, for the
    same reason the form itself is read from click: the script can derive it
    from whatever it already reads, so it cannot drift from what it builds. The
    joint study reads its letters out of its own README.

    Anything malformed is dropped rather than raising. A bad hint is a field
    that does not pre-fill; a raise here is a model that cannot be customised
    at all.
    """
    raw = getattr(module, "DEPENDENT_DEFAULTS", None)
    if not isinstance(raw, dict):
        return {}
    out = {}
    for opt, spec in raw.items():
        if not isinstance(opt, str) or not isinstance(spec, dict):
            continue
        on = spec.get("on")
        mapping = spec.get("map")
        if not isinstance(on, str) or not isinstance(mapping, dict):
            continue
        pairs = {
            str(k): v for k, v in mapping.items()
            if isinstance(v, (str, int, float, bool))
        }
        if pairs:
            out[opt] = {"on": on, "map": pairs}
    return out


def multi_fields(module) -> dict:
    """How a repeatable option's ONE ENTRY is shaped.

    `multiple=True` says a flag may be given more than once. It cannot say that
    one occurrence is a name AND a count joined by a colon, because on a command
    line you just type the colon. A form has no such affordance: a single box
    where the colon means something is a box only its author can fill.

    So a script may declare it, as `MULTI_FIELDS`:

        MULTI_FIELDS = {
            "--word": {
                "add_label": "Add name",
                "separator": ":",
                "parts": [
                    {"key": "text", "label": "Name", "type": "text"},
                    {"key": "times", "label": "Times", "type": "integer",
                     "default": "1", "width": "narrow"},
                ],
            },
        }

    The SCRIPT owns it, like DEPENDENT_DEFAULTS above and for the same reason:
    it sits beside the parser that reads the entry back, so the two cannot
    disagree about what a colon separates.

    A repeatable option with no declaration is still a list — just of plain
    single boxes, which is the right rendering for a flag that takes one value
    per occurrence. Anything malformed is dropped rather than raised: a bad
    declaration should cost the two-box layout, not the whole customiser.
    """
    raw = getattr(module, "MULTI_FIELDS", None)
    if not isinstance(raw, dict):
        return {}

    out = {}
    for opt, spec in raw.items():
        if not isinstance(opt, str) or not isinstance(spec, dict):
            continue
        parts = []
        for part in spec.get("parts") or ():
            if not isinstance(part, dict):
                continue
            key = part.get("key")
            if not isinstance(key, str) or not key:
                continue
            parts.append({
                "key": key,
                "label": str(part.get("label") or key),
                "type": part.get("type")
                        if part.get("type") in ("text", "integer", "float",
                                                "choice")
                        else "text",
                # A part may bind to a catalog folder on its own, which the
                # whole option cannot do once it is a list: `--icon` carries an
                # icon AND a count, and only the first half is an icon id. The
                # browser sends the id; the path is resolved server-side, which
                # is what keeps this from being an arbitrary-file parameter.
                "source": (part["source"]
                           if part.get("source") in ("fonts", "filaments", "icons")
                           else None),
                "placeholder": (str(part["placeholder"])
                                if part.get("placeholder") is not None else None),
                "default": (str(part["default"])
                            if part.get("default") is not None else None),
                "width": "narrow" if part.get("width") == "narrow" else "wide",
            })
        if not parts:
            continue
        out[opt] = {
            "add_label": str(spec.get("add_label") or "Add"),
            "empty_label": (str(spec["empty_label"])
                            if spec.get("empty_label") is not None else None),
            # Only meaningful with two parts or more; a one-part entry is its
            # own value and joining it with anything would corrupt it.
            "separator": str(spec.get("separator") or ""),
            "parts": parts,
        }
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: describe_generator.py SCRIPT.py"}))
        return 2

    script = Path(sys.argv[1]).resolve()
    try:
        module = load_module(script)
        command = find_command(module)
    except Exception as exc:
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))
        return 1

    params = [p for p in (describe(p) for p in command.params) if p]
    print(json.dumps({
        "script": script.name,
        "command": command.name,
        "help": (command.help or "").strip(),
        "params": params,
        "dependent_defaults": dependent_defaults(module),
        "multi_fields": multi_fields(module),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
