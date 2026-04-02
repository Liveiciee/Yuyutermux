import os
from flask import request, jsonify, Response

HOME_DIR = os.path.expanduser('~')
PROJECT_DIR = os.path.join(HOME_DIR, 'Yuyutermux')
MAX_FILE_SIZE = 1024 * 1024  # 1MB


def validate_path(user_path: str) -> str | None:
    """Resolve path, restrict ke PROJECT_DIR."""
    if not user_path:
        return PROJECT_DIR
    base = user_path if os.path.isabs(user_path) else os.path.join(PROJECT_DIR, user_path)
    resolved = os.path.realpath(base)
    return resolved if resolved.startswith(PROJECT_DIR) else None


def json_ok(**kwargs) -> tuple[Response, int]:
    return jsonify({"success": True, **kwargs}), 200


def json_err(msg: str, code: int = 500, **kwargs) -> tuple[Response, int]:
    return jsonify({"success": False, "error": msg, **kwargs}), code


def get_req_path() -> str:
    """Extract path dari request (GET args atau POST json)."""
    if request.method == 'GET':
        return request.args.get('path', '')
    return (request.get_json(silent=True) or {}).get('path', '')
