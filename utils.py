import os
import secrets
import time
import functools
from flask import request, jsonify, Response, g
from werkzeug.exceptions import TooManyRequests

HOME_DIR = os.path.expanduser('~')
PROJECT_DIR = os.path.join(HOME_DIR, 'Yuyutermux')
MAX_FILE_SIZE = 1024 * 1024  # 1MB
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50MB upload limit

# ── SECURITY: In-memory token auth (fresh every run) ──────────────────────────
AUTH_TOKEN = os.environ.get('YUYUTERMUX_TOKEN', '')
if not AUTH_TOKEN:
    AUTH_TOKEN = secrets.token_urlsafe(32)

# Always print token on startup — run.sh will grep this line
print(f"[YUYU-TOKEN] {AUTH_TOKEN}", flush=True)


def check_auth():
    """Check Bearer token authentication. Returns True if valid."""
    if not AUTH_TOKEN:
        return True  # No token configured = skip auth (dangerous but backward compat)

    auth_header = request.headers.get('Authorization', '')
    # Also check cookie for browser-based access
    auth_cookie = request.cookies.get('yuyu_token', '')

    token = ''
    if auth_header.startswith('Bearer '):
        token = auth_header[7:]
    elif auth_cookie:
        token = auth_cookie

    # Constant-time comparison to prevent timing attacks
    if not token:
        return False
    return secrets.compare_digest(token, AUTH_TOKEN)


def require_auth(f):
    """Decorator: require valid auth token for endpoint."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not check_auth():
            return jsonify({"success": False, "error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


# ── SECURITY: Rate limiting ───────────────────────────────────────────────────
_rate_limit_store: dict[str, list[float]] = {}


def rate_limit(max_requests: int = 30, window: int = 60):
    """Rate limiter decorator. Default: 30 requests per 60 seconds per IP."""
    def decorator(f):
        @functools.wraps(f)
        def decorated(*args, **kwargs):
            client_ip = request.remote_addr or 'unknown'
            now = time.time()
            key = f"{client_ip}:{f.__name__}"

            if key not in _rate_limit_store:
                _rate_limit_store[key] = []

            # Clean old entries
            _rate_limit_store[key] = [
                t for t in _rate_limit_store[key] if now - t < window
            ]

            if len(_rate_limit_store[key]) >= max_requests:
                return jsonify({
                    "success": False,
                    "error": f"Rate limit exceeded ({max_requests}/{window}s)"
                }), 429

            _rate_limit_store[key].append(now)
            return f(*args, **kwargs)
        return decorated
    return decorator


def rate_limit_execute(max_requests: int = 10, window: int = 60):
    """Stricter rate limit for command execution endpoints."""
    return rate_limit(max_requests, window)


# ── SECURITY: Path validation (hardened) ──────────────────────────────────────

# Commands that are explicitly DANGEROUS - never allow these
BLOCKED_COMMANDS = {
    'rm', 'rmdir', 'mkfs', 'dd', 'fdisk', 'parted', 'mkswap',
    'shutdown', 'reboot', 'halt', 'poweroff', 'init',
    'passwd', 'su', 'sudo', 'chroot', 'mount', 'umount',
    'chmod', 'chown', 'chgrp',
    'iptables', 'nft', 'ufw', 'firewalld',
    'curl', 'wget', 'nc', 'ncat', 'netcat',  # network exfil prevention
    'python3', 'python', 'node', 'ruby', 'perl', 'php',  # code exec prevention
}


def validate_path(user_path: str) -> str | None:
    """Validate and resolve path, ensuring it stays within PROJECT_DIR.
    Prevents directory traversal via symlinks, '..' sequences, etc."""
    if not user_path:
        return PROJECT_DIR

    # Reject obvious traversal patterns early
    if '..' in user_path:
        return None

    base = user_path if os.path.isabs(user_path) else os.path.join(PROJECT_DIR, user_path)
    resolved = os.path.realpath(base)

    # Ensure resolved path starts with PROJECT_DIR (with trailing slash check)
    if not resolved.startswith(PROJECT_DIR + os.sep) and resolved != PROJECT_DIR:
        return None

    return resolved


def validate_path_terminal(user_path: str) -> str | None:
    """Lighter path validation for terminal cd — allows HOME but not system dirs."""
    if not user_path:
        return PROJECT_DIR

    if '..' in user_path:
        return None

    base = user_path if os.path.isabs(user_path) else os.path.join(os.path.expanduser('~'), user_path)
    resolved = os.path.realpath(base)

    # Block dangerous system directories
    blocked_prefixes = ['/proc', '/sys', '/dev', '/boot', '/lib', '/lib64', '/usr/lib', '/bin', '/sbin']
    for prefix in blocked_prefixes:
        if resolved.startswith(prefix + os.sep) or resolved == prefix:
            return None

    return resolved


# ── HELPERS ───────────────────────────────────────────────────────────────────

def json_ok(**kwargs) -> tuple[Response, int]:
    return jsonify({"success": True, **kwargs}), 200


def json_err(msg: str, code: int = 500, **kwargs) -> tuple[Response, int]:
    # Sanitize error messages — never leak full paths or exception details
    safe_msg = msg
    if code >= 500:
        safe_msg = "Internal server error"
    return jsonify({"success": False, "error": safe_msg, **kwargs}), code


def get_req_path() -> str:
    """Extract path dari request (GET args atau POST json)."""
    if request.method == 'GET':
        return request.args.get('path', '')
    return (request.get_json(silent=True) or {}).get('path', '')


def sanitize_error(msg: str) -> str:
    """Remove sensitive path information from error messages."""
    msg = msg.replace(HOME_DIR, '~')
    msg = msg.replace(PROJECT_DIR, '~/Yuyutermux')
    return msg


# ── SECURITY: Security headers for all responses ──────────────────────────────

def set_security_headers(response: Response) -> Response:
    """Add security headers to all HTTP responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    return response
