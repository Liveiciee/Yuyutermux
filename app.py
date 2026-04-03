from flask import Flask, jsonify

from utils import PROJECT_DIR

from routes.pages import pages_bp
from routes.terminal import terminal_bp
from routes.files import files_bp
from routes.github import github_bp

app = Flask(__name__, static_folder='static')


@app.route('/api/health')
def health_check():
    return jsonify({"status": "ok", "service": "yuyutermux"})


app.register_blueprint(pages_bp)
app.register_blueprint(terminal_bp)
app.register_blueprint(files_bp)
app.register_blueprint(github_bp)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, threads=8,  debug=True)
