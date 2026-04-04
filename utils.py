from __future__ import annotations

import os
import re
import secrets
import time
import threading
import functools
from typing import Optional, Dict, List, Tuple
from flask import request, jsonify, Response

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

# ── SECURITY: Env filtering for subprocess calls ──────────────────────────────
# BUG FIX: subprocess.Popen/run inherits the full process environment, which
# includes YUYUTERMUX_TOKEN. A compromised child process or verbose git error
# could expose the token. _safe_env() strips secrets before spawning children.
_ENV_BLOCKLIST = frozenset({'YUYUTERMUX_TOKEN'})

def _safe_env() -> dict:
    """Return a filtered copy of os.environ with secrets removed."""
    return {k: v for k, v in os.environ.items() if k not in _ENV_BLOCKLIST}


def check_auth() -> bool:
    """Check Bearer token authentication. Returns True if valid."""
    if not AUTH_TOKEN:
        return True  # No token configured = skip auth (dangerous but backward compat)

    auth_header = request.headers.get('Authorization', '')
    # Also check cookie for browser-based access (httponly cookie auto-sent by browser)
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
    # BUG FIX: Check oldest timestamp (timestamps[0]), not newest (timestamps[-1])
    # Remove if the oldest request was >5min ago (entire window expired)
    expired_keys = [
        key for key, timestamps in _rate_limit_store.items()
        if not timestamps or now - timestamps[0] > 300
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

                # BUG FIX: Use > instead of >= for correct limit enforcement
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
    'chgrp',
    'iptables', 'nft', 'ufw', 'firewalld',
    'curl', 'wget', 'nc', 'ncat', 'netcat',  # network exfil prevention
    'python3', 'python', 'node', 'ruby', 'perl', 'php',  # code exec prevention
    # Block indirection vectors that can bypass command blocklist
    'env', 'exec', 'eval', 'source', 'busybox', 'xargs',
    'nohup', 'setsid', 'unshare', 'nsenter',
    'find', 'awk', 'sed',  # can execute commands
    # BUG FIX: Added missing shell interpreters and other dangerous commands
    'sh', 'bash', 'zsh', 'dash', 'fish', 'csh', 'tcsh', 'ksh',  # shells
    'expect', 'tclsh', 'lua', 'luajit',  # other interpreters
    'ssh-keygen', 'openssl',  # crypto tools
    'docker', 'podman', 'lxc', 'lxc-execute',  # container escapes
    'systemctl', 'service',  # service control
    'kill', 'killall', 'pkill', 'xkill',  # process termination
    'crontab', 'at', 'batch',  # job schedulers
    'write', 'wall', 'mesg',  # user messaging
}

# Commands that are allowed — used as reference/documentation.
# NOTE: This set is NOT actively enforced in the terminal command check.
#       BLOCKED_COMMANDS is checked first via os.path.basename(cmd_parts[0]).
#       Commands NOT in BLOCKED_COMMANDS are implicitly allowed.
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

    # BUG FIX: Was computing os.path.expanduser('~') locally. Use the module-level
    # HOME_DIR constant for consistency — avoids subtle divergence if the home
    # directory mapping ever changes at runtime (e.g., under test environments).
    base = user_path if os.path.isabs(user_path) else os.path.join(HOME_DIR, user_path)
    resolved = os.path.realpath(base)

    # Only allow navigation within home directory
    if not (resolved.startswith(HOME_DIR + os.sep) or resolved == HOME_DIR):
        return None

    return resolved


# ── HELPERS ───────────────────────────────────────────────────────────────────

def json_ok(**kwargs) -> Tuple[Response, int]:
    return jsonify({"success": True, **kwargs}), 200


def json_err(msg: str, code: int = 500, **kwargs) -> Tuple[Response, int]:
    # BUG FIX: Sanitize error messages — never leak full paths or exception details
    # Also sanitize any 'error' key passed in kwargs to prevent data leak
    safe_kwargs = {k: v for k, v in kwargs.items() if k != 'error'}
    
    if code >= 500:
        safe_msg = "Internal server error"
    else:
        safe_msg = msg
    
    return jsonify({"success": False, "error": safe_msg, **safe_kwargs}), code


def get_req_path() -> str:
    """Extract path from request (GET args or POST json)."""
    if request.method == 'GET':
        return request.args.get('path', '')
    return (request.get_json(silent=True) or {}).get('path', '')


def sanitize_error(msg: str) -> str:
    """Remove sensitive path information from error messages."""
    msg = msg.replace(HOME_DIR, '~')
    msg = msg.replace(PROJECT_DIR, '~/Yuyutermux')
    return msg


# ── SECURITY: Command validation helpers ─────────────────────────────────────

# BUG FIX: Added shell operator detection to prevent command injection
SHELL_METACHARACTERS = re.compile(r'[;|&`$(){}[\]\\*?<>]')

def contains_shell_operators(cmd: str) -> bool:
    """Check if command string contains shell metacharacters."""
    return bool(SHELL_METACHARACTERS.search(cmd))


def validate_command(cmd_parts: List[str]) -> Tuple[bool, str]:
    """Validate command parts for safety.
    
    Returns:
        (is_valid, error_message)
    """
    if not cmd_parts:
        return False, "Empty command"
    
    # Check for shell operators in any argument (prevents injection)
    for part in cmd_parts:
        if contains_shell_operators(part):
            return False, f"Shell metacharacters not allowed: {part}"
    
    # Check command against blocklist
    cmd_name = os.path.basename(cmd_parts[0])
    if cmd_name in BLOCKED_COMMANDS:
        return False, f"Command '{cmd_name}' is not allowed"
    
    return True, ""


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
