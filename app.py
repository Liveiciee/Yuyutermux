import os
import secrets
from flask import Flask, jsonify, request, make_response

from utils import (
    PROJECT_DIR, check_auth, set_security_headers,
    AUTH_TOKEN, secrets as utils_secrets
)

from routes.pages import pages_bp
from routes.terminal import terminal_bp
from routes.files import files_bp
from routes.github import github_bp

app = Flask(__name__, static_folder='static')
app.secret_key = secrets.token_bytes(32)

# ── SECURITY: Disable debug in production ────────────────────────────────────
DEBUG_MODE = os.environ.get('YUYUTERMUX_DEBUG', '0') == '1'

# ── SECURITY: Bind to localhost only by default ──────────────────────────────
APP_HOST = os.environ.get('YUYUTERMUX_HOST', '127.0.0.1')

try:
    APP_PORT = int(os.environ.get('YUYUTERMUX_PORT', '5000'))
except (ValueError, TypeError):
    APP_PORT = 5000
    print(f"[WARN] Invalid YUYUTERMUX_PORT value, defaulting to {APP_PORT}")

# ── SECURITY: Global auth check for all /api/ routes ─────────────────────────
_AUTH_EXEMPT = {'/api/health', '/api/auth/login', '/api/auth/logout', '/api/verify-token'}

@app.before_request
def global_auth_check():
    """Require authentication for all API endpoints except exempted ones."""
    if request.path.startswith('/api/') and request.path not in _AUTH_EXEMPT:
        if not check_auth():
            return jsonify({"success": False, "error": "Unauthorized"}), 401


# ── SECURITY: Add security headers to ALL responses ──────────────────────────
@app.after_request
def add_security_headers(response):
    return set_security_headers(response)


# ── HEALTH CHECK (no auth required, lightweight) ─────────────────────────────
@app.route('/api/health')
def health_check():
    return jsonify({"status": "ok", "service": "yuyutermux"})


# ── CSRF: Require Content-Type for POST/PUT/DELETE ───────────────────────────
@app.before_request
def enforce_json_content_type():
    """Reject POST requests without proper Content-Type to prevent CSRF."""
    if request.method in ('POST', 'PUT', 'DELETE'):
        if request.path in _AUTH_EXEMPT:
            return  # login/logout/verify handle their own content-type
        ct = request.content_type or ''
        if not (ct.startswith('application/json') or
                ct.startswith('multipart/form-data')):
            return jsonify({"success": False, "error": "Invalid Content-Type"}), 415


# ── NEW ENDPOINT: Token Verification for Steroid Auth ────────────────────────
@app.route('/api/verify-token', methods=['POST'])
def verify_token():
    """
    Endpoint untuk validasi token oleh frontend (Steroid Auth).
    Menerima JSON: {"token": "xxx"}
    Returns: {"valid": true/false}
    """
    data = request.get_json(silent=True) or {}
    token = data.get('token', '').strip()
    
    if not token:
        return jsonify({"valid": False}), 400
    
    # Jika tidak ada token diset di env, anggap valid (mode dev/backward compat)
    if not AUTH_TOKEN:
        return jsonify({"valid": True})
    
    # Validasi token dengan constant-time comparison
    is_valid = utils_secrets.compare_digest(token, AUTH_TOKEN)
    return jsonify({"valid": is_valid})


# ── Register blueprints ──────────────────────────────────────────────────────
app.register_blueprint(pages_bp)
app.register_blueprint(terminal_bp)
app.register_blueprint(files_bp)
app.register_blueprint(github_bp)


# ── STARTUP ──────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 50)
    print("  Yuyutermux Server")
    print("=" * 50)
    print(f"  Host:   {APP_HOST}")
    print(f"  Port:   {APP_PORT}")
    print(f"  Debug:  {DEBUG_MODE}")
    if AUTH_TOKEN:
        print(f"  Auth:   ENABLED (in-memory, new token each run)")
    else:
        print(f"  Auth:   DISABLED (set YUYUTERMUX_TOKEN env)")
    print("=" * 50)

    app.run(
        host=APP_HOST,
        port=APP_PORT,
        threads=16,
        debug=DEBUG_MODE
    )
