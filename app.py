import os
import sys
from flask import Flask, jsonify, request

from utils import (
    PROJECT_DIR, check_auth, set_security_headers,
    AUTH_TOKEN
)

from routes.pages import pages_bp
from routes.terminal import terminal_bp
from routes.files import files_bp
from routes.github import github_bp

app = Flask(__name__, static_folder='static')

# ── SECURITY: Disable debug in production ────────────────────────────────────
# NEVER run with debug=True in production — it exposes the Werkzeug debugger
# which allows Remote Code Execution (RCE)
DEBUG_MODE = os.environ.get('YUYUTERMUX_DEBUG', '0') == '1'

# ── SECURITY: Bind to localhost only by default ──────────────────────────────
# Prevents exposure to the network. Override with YUYUTERMUX_HOST env var.
APP_HOST = os.environ.get('YUYUTERMUX_HOST', '127.0.0.1')
APP_PORT = int(os.environ.get('YUYUTERMUX_PORT', '5000'))

# ── SECURITY: Global auth check for all /api/ routes ─────────────────────────
@app.before_request
def global_auth_check():
    """Require authentication for all API endpoints except health."""
    if request.path.startswith('/api/') and request.path != '/api/health':
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
        ct = request.content_type or ''
        # Allow multipart (file upload) and JSON
        if not (ct.startswith('application/json') or
                ct.startswith('multipart/form-data')):
            return jsonify({"success": False, "error": "Invalid Content-Type"}), 415


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
        print(f"  Auth:   ENABLED (token: .auth_token)")
    else:
        print(f"  Auth:   DISABLED (set YUYUTERMUX_TOKEN env)")
    print("=" * 50)

    app.run(
        host=APP_HOST,
        port=APP_PORT,
        threads=8,
        debug=DEBUG_MODE
    )
