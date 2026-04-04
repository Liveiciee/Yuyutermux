from __future__ import annotations

import inspect
import re
from functools import lru_cache
from typing import Any, Dict, List, Optional

from flask import Blueprint, current_app, jsonify

docs_bp = Blueprint("docs", __name__)

_EXCLUDED_PREFIXES = (
    "/static/",
    "/api/auth/",
    "/api/verify-token",
    "/api/docs/",
    "/login",
    "/favicon",
)

_URL_VAR_RE = re.compile(r"<(?:\w+:)?(\w+)>")

_GROUP_LABELS = {
    "api": "API",
    "files": "Files",
    "git": "Git",
    "execute": "Terminal",
    "project": "Project",
    "auth": "Authentication",
    "docs": "Docs",
}

_METADATA_STORE: Dict[str, Dict[str, Any]] = {}

def api_metadata(
    summary: Optional[str] = None,
    details: Optional[str] = None,
    request_schema: Optional[str] = None,
    response_schema: Optional[str] = None,
):
    def decorator(func):
        _METADATA_STORE[func.__name__] = {
            "summary": summary or "",
            "details": details or "",
            "request_schema": request_schema,
            "response_schema": response_schema,
        }
        return func
    return decorator

def _is_excluded(rule_path: str) -> bool:
    for prefix in _EXCLUDED_PREFIXES:
        if rule_path.startswith(prefix) or rule_path == prefix.rstrip("/"):
            return True
    return False

def _extract_docstring(func) -> tuple[str, str]:
    """Return (summary, full_docstring). Full docstring keeps line breaks."""
    meta = _METADATA_STORE.get(func.__name__)
    if meta and (meta["summary"] or meta["details"]):
        return meta["summary"], meta["details"]

    doc = inspect.getdoc(func)
    if not doc:
        return "", ""

    lines = doc.split("\n")
    summary = lines[0].strip() if lines else ""
    full = doc.strip()   # keep original line breaks
    return summary, full

def _extract_url_params(rule: Any) -> List[Dict[str, str]]:
    params: List[Dict[str, str]] = []
    for match in _URL_VAR_RE.finditer(rule.rule):
        name = match.group(1)
        converter = rule._converters.get(name)
        if converter:
            converter_type = converter.__class__.__name__.lower().replace("converter", "")
            if not converter_type:
                converter_type = "string"
        else:
            converter_type = "string"
        params.append({"name": name, "type": converter_type})
    return params

def _resolve_view_func(rule: Any):
    try:
        if rule.endpoint == "static":
            return None
        return current_app.view_functions.get(rule.endpoint)
    except Exception:
        return None

def _group_key(path: str) -> str:
    segments = [s for s in path.strip("/").split("/") if s]
    if not segments:
        return "Root"

    first = segments[0]
    if first == "api" and len(segments) > 1:
        return _GROUP_LABELS.get(segments[1], segments[1].title())
    return _GROUP_LABELS.get(first, first.title())

@lru_cache(maxsize=1)
def _build_docs_data():
    groups: Dict[str, List[Dict[str, Any]]] = {}

    for rule in sorted(current_app.url_map.iter_rules(), key=lambda r: r.rule):
        if _is_excluded(rule.rule):
            continue

        methods = sorted(m for m in rule.methods if m not in ("OPTIONS", "HEAD"))
        if not methods:
            continue

        view_func = _resolve_view_func(rule)
        if view_func is None:
            continue

        unwrapped = view_func
        depth = 0
        while hasattr(unwrapped, "__wrapped__") and depth < 5:
            unwrapped = unwrapped.__wrapped__
            depth += 1

        summary, details = _extract_docstring(unwrapped)
        params = _extract_url_params(rule)
        key = _group_key(rule.rule)

        entry = {
            "path": rule.rule,
            "methods": methods,
            "summary": summary,
            "details": details,   # now full docstring
            "params": params,
        }

        meta = _METADATA_STORE.get(unwrapped.__name__)
        if meta:
            if meta.get("request_schema"):
                entry["request_schema"] = meta["request_schema"]
            if meta.get("response_schema"):
                entry["response_schema"] = meta["response_schema"]

        groups.setdefault(key, []).append(entry)

    return groups

def invalidate_docs_cache():
    _build_docs_data.cache_clear()

@docs_bp.route("/api/docs/endpoints")
def api_docs_endpoints():
    groups = _build_docs_data()
    return jsonify({
        "success": True,
        "groups": groups,
        "total": sum(len(v) for v in groups.values()),
    })
