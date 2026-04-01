from flask import Flask, jsonify, request
import os

app = Flask(__name__, static_folder='static', static_url_path='/static')

# ========== KONFIGURASI ==========
HOME_DIR = os.path.expanduser('~')
PROJECT_DIR = os.path.join(HOME_DIR, 'Yuyutermux')
MAX_FILE_SIZE = 1024 * 1024  # 1MB

# ========== HELPERS ==========
def validate_path(user_path: str) -> str:
    """Resolve path, restrict ke PROJECT_DIR."""
    if not user_path:
        return PROJECT_DIR
    resolved = os.path.realpath(
        user_path if os.path.isabs(user_path)
        else os.path.join(PROJECT_DIR, user_path)
    )
    return resolved if resolved.startswith(PROJECT_DIR) else PROJECT_DIR

def json_ok(**kwargs) -> tuple:
    return jsonify({"success": True, **kwargs})

def json_err(msg: str, code: int = 500, **kwargs) -> tuple:
    return jsonify({"success": False, "error": msg, **kwargs}), code

def get_req_path() -> str:
    """Extract path dari request (GET args atau POST json)."""
    if request.method == 'GET':
        return request.args.get('path', '')
    return (request.json or {}).get('path', '')

# ========== BLUEPRINTS ==========
# ========== REGISTER BLUEPRINTS ==========
from routes.pages import pages_bp
from routes.terminal import terminal_bp
from routes.files import files_bp

app.register_blueprint(pages_bp)
app.register_blueprint(terminal_bp)
app.register_blueprint(files_bp)

# ========== ENTRY POINT ==========
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
