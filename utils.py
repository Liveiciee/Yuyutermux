from __future__ import annotations

import os
import secrets
import time
import threading
import functools
from typing import Union, Optional, Dict, List, Tuple
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


def check_auth() -> bool:
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


# ── SECURITY: Rate limiting (with periodic cleanup) ──────────────────────────
_rate_limit_store: Dict[str, List[float]] = {}
_rate_limit_lock = threading.Lock()
_RATE_CLEANUP_INTERVAL = 120  # Clean stale entries every 2 minutes
_last_cleanup = 0.0


def _cleanup_rate_limits(now: float) -> None:
    """Remove expired entries from rate limit store to prevent memory leak."""
    global _last_cleanup
    if now - _last_cleanup < _RATE_CLEANUP_INTERVAL:
        return
    _last_cleanup = now
    expired_keys = [
        key for key, timestamps in _rate_limit_store.items()
        if not timestamps or now - timestamps[-1] > 300  # Remove if last request was >5min ago
    ]
    for key in expired_keys:
        del _rate_limit_store[key]


def rate_limit(max_requests: int = 30, window: int = 60):
    """Rate limiter decorator. Default: 30 requests per 60 seconds per IP."""
    def decorator(f):
        @functools.wraps(f)
        def decorated(*args, **kwargs):
            client_ip = request.remote_addr or 'unknown'
            now = time.time()
            key = f"{client_ip}:{f.__name__}"

            with _rate_limit_lock:
                _cleanup_rate_limits(now)

                if key not in _rate_limit_store:
                    _rate_limit_store[key] = []

                # Clean old entries within window
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
# BUG FIX #2: Hapus chmod, chown dari BLOCKED — user butuh manage permission file.
# BUG FIX #2: Hapus duplikat 'perl' (ada di baris 125 dan 129).
BLOCKED_COMMANDS = {
    'rm', 'rmdir', 'mkfs', 'dd', 'fdisk', 'parted', 'mkswap',
    'shutdown', 'reboot', 'halt', 'poweroff', 'init',
    'passwd', 'su', 'sudo', 'chroot', 'mount', 'umount',
    'chgrp',
    'iptables', 'nft', 'ufw', 'firewalld',
    'curl', 'wget', 'nc', 'ncat', 'netcat',  # network exfil prevention
    'python3', 'python', 'node', 'ruby', 'perl', 'php',  # code exec prevention
    # FIX: Block indirection vectors that can bypass command blocklist
    'env', 'exec', 'eval', 'source', 'busybox', 'xargs',
    'nohup', 'setsid', 'unshare', 'nsenter',
    'find', 'awk', 'sed',  # can execute commands
}

# Commands that are allowed — used as reference/documentation.
# NOTE: This set is NOT actively enforced in the terminal command check.
#       BLOCKED_COMMANDS is checked first via os.path.basename(cmd_parts[0]).
#       Commands NOT in BLOCKED_COMMANDS are implicitly allowed.
# BUG FIX #3: Bersihkan konflik — hapus entry yang juga ada di BLOCKED_COMMANDS.
ALLOWED_GNU_COREUTILS = {
    'ls', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'sort',
    'uniq', 'grep', 'diff', 'file', 'stat', 'which', 'whoami',
    'date', 'cal', 'uptime', 'df', 'du', 'free', 'ps', 'top',
    'echo', 'printf', 'pwd', 'cd', 'mkdir', 'touch', 'cp', 'mv',
    'ln', 'chmod', 'chown', 'tree', 'clear', 'reset',
    'git', 'pip', 'pip3', 'npm', 'yarn', 'cargo', 'go',
    'make', 'cmake', 'gcc', 'g++', 'cc',
    'vim', 'nano', 'vi', 'ed',
    'tar', 'gzip', 'gunzip', 'bzip2', 'bunzip2', 'zip', 'unzip',
    'xz', '7z', '7za',
    'base64', 'md5sum', 'sha256sum', 'sha512sum',
    'cut', 'tr', 'paste', 'tee', 'split', 'join',
    'basename', 'dirname', 'realpath', 'readlink',
    'id', 'hostname', 'uname', 'arch', 'nproc',
    'printenv', 'export', 'set', 'unset', 'alias',
    'history', 'type', 'command', 'builtin',
    'true', 'false', 'test', '[',
    'sleep', 'wait', 'exit', 'logout',
    'man', 'help', 'info',
    'ssh', 'scp', 'rsync', 'sftp',
    'ping', 'ifconfig', 'ip', 'ss', 'netstat',
    'dig', 'nslookup', 'host',
    'apt', 'apt-get', 'pkg', 'termux-setup-storage',
}


def validate_path(user_path: str) -> Optional[str]:
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


def validate_path_terminal(user_path: str) -> Optional[str]:
    """Path validation for terminal cd — restricts to within home directory."""
    if not user_path:
        return PROJECT_DIR

    if '..' in user_path:
        return None

    base = user_path if os.path.isabs(user_path) else os.path.join(os.path.expanduser('~'), user_path)
    resolved = os.path.realpath(base)

    home = os.path.expanduser('~')
    # Only allow navigation within home directory
    if not (resolved.startswith(home + os.sep) or resolved == home):
        return None

    return resolved


# ── HELPERS ───────────────────────────────────────────────────────────────────

def json_ok(**kwargs) -> Tuple[Response, int]:
    return jsonify({"success": True, **kwargs}), 200


def json_err(msg: str, code: int = 500, **kwargs) -> Tuple[Response, int]:
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
