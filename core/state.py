"""
core/state.py
=============
Shared mutable state that must be visible to both the agent pipeline (writers)
and the FastAPI endpoint layer (readers).

Anything that changes during a fix run and needs to be polled via an API
endpoint belongs here.  Pure configuration constants go in core/constants.py.

Exports:
  FIX_PROGRESS          — {incident_id: {step, message, pct}} updated live
  get_fix_progress(id)  — safe reader used by /fix-progress endpoint
"""

from typing import Any, Dict, Optional

# ─────────────────────────────────────────────
# LIVE FIX PROGRESS
# ─────────────────────────────────────────────
# Written by OrchestratorAgent._set_progress() during each fix run.
# Read by GET /fix-progress?incident_id=... in main.py.
# Keys:   incident_id (str)
# Values: {"step": str, "message": str, "pct": int, ...}
FIX_PROGRESS: Dict[str, Dict[str, Any]] = {}


def get_fix_progress(incident_id: str) -> Optional[Dict[str, Any]]:
    """Return the current progress snapshot for incident_id, or None."""
    return FIX_PROGRESS.get(incident_id)
