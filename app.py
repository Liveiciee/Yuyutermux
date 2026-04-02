from flask import Flask, jsonify

# Import utils DULU
from utils import validate_path, json_ok, json_err, get_req_path, PROJECT_DIR, MAX_FILE_SIZE

# Baru import blueprints (setelah utils ke-load)
from routes.pages import pages_bp
from routes.terminal import terminal_bp
from routes.files import files_bp

app = Flask(__name__, static_folder='static')


@app.route('/api/health')
def health_check():
    return jsonify({"status": "ok", "service": "yuyutermux"})


app.register_blueprint(pages_bp)
app.register_blueprint(terminal_bp)
app.register_blueprint(files_bp)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
