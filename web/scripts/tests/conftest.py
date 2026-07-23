"""Make thumbnail.py importable as a module from the tests."""

import sys
from pathlib import Path

# scripts/ is the parent of this tests/ folder.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
