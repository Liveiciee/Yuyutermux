from flask import Blueprint, request, send_from_directory
from utils import validate_path, json_ok, json_err, get_req_path, PROJECT_DIR, MAX_FILE_SIZE
import os
import datetime
import subprocess
import shlex
import re

files_bp = Blueprint('files', __name__)


@files_bp.route('/api/files/list')
def api_files_list():
    path = validate_path(get_req_path())
    if not path:
        return json_err("Invalid path", 403, files=[])

    if not os.path.exists(path):
        return json_err(f"Path not found: {path}", 404, files=[])

    try:
        items = []
        for entry in os.scandir(path):
            try:
                stat = entry.stat()
                is_dir = entry.is_dir()

                # Human-readable file size
                size_str = "-"
                if not is_dir:
                    size = stat.st_size
                    if size < 1024:
                        size_str = f"{size} B"
                    elif size < 1024 * 1024:
                        size_str = f"{size/1024:.1f}K"
                    else:
                        size_str = f"{size/1024/1024:.1f}M"

                items.append({
                    "name": entry.name,
                    "path": entry.path,
                    "type": "directory" if is_dir else "file",
                    "size": size_str,
                    "modified": datetime.datetime.fromtimestamp(stat.st_mtime).isoformat()
                })
            except PermissionError:
                continue

        items.sort(key=lambda x: (x['type'] != 'directory', x['name'].lower()))

        if path == PROJECT_DIR:
            display = '~/Yuyutermux'
        else:
            display = '~/Yuyutermux/' + path.replace(PROJECT_DIR, '').lstrip('/')

        return json_ok(current_path=display, items=items)

    except Exception as e:
        return json_err(str(e), 500, files=[])


@files_bp.route('/api/files/read', methods=['POST'])
def api_files_read():
    path = validate_path(get_req_path())
    if not path:
        return json_err("Invalid file path", 403, content="")

    if not os.path.isfile(path):
        return json_err("Invalid file path", 400, content="")

    if os.path.getsize(path) > MAX_FILE_SIZE:
        return json_err("File too large (>1MB)", 413, content="")

    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            return json_ok(path=path, content=f.read())
    except Exception as e:
        return json_err(str(e), 500, content="")


@files_bp.route('/api/files/write', methods=['POST'])
def api_files_write():
    data = request.json or {}

    if 'path' not in data:
        return json_err("No path provided", 400)

    path = validate_path(data['path'])
    if not path:
        return json_err("Invalid path", 403)

    parent = os.path.dirname(path)

    try:
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(data.get('content', ''))
        return json_ok(message=f"File saved: {path}")
    except Exception as e:
        return json_err(str(e))


@files_bp.route('/api/files/delete', methods=['POST'])
def api_files_delete():
    path = validate_path(get_req_path())
    if not path:
        return json_err("Invalid path", 403)

    try:
        if os.path.isdir(path):
            os.rmdir(path)
        else:
            os.remove(path)
        return json_ok(message=f"Deleted: {path}")
    except Exception as e:
        return json_err(str(e))


@files_bp.route('/api/files/create', methods=['POST'])
def api_files_create():
    data = request.json or {}
    filename = data.get('filename', '')

    if not filename:
        return json_err("No filename provided", 400)

    dir_path = validate_path(data.get('path', ''))
    if not dir_path:
        return json_err("Invalid path", 403)

    new_path = os.path.join(dir_path, os.path.basename(filename))

    if not new_path.startswith(PROJECT_DIR):
        return json_err("Cannot create outside project directory", 403)

    if os.path.exists(new_path):
        return json_err("File already exists", 409)

    try:
        open(new_path, 'w').close()
        return json_ok(message=f"Created: {new_path}")
    except Exception as e:
        return json_err(str(e))


@files_bp.route('/api/files/download')
def api_files_download():
    path = validate_path(get_req_path())
    if not path:
        return json_err("Invalid path", 403)

    if not os.path.isfile(path):
        return json_err("File not found", 404)

    return send_from_directory(
        os.path.dirname(path),
        os.path.basename(path),
        as_attachment=True,
        download_name=os.path.basename(path)
    )


@files_bp.route('/api/files/upload', methods=['POST'])
def api_files_upload():
    target = validate_path(request.form.get('path', ''))
    if not target:
        return json_err("Invalid upload path", 403)

    if 'file' not in request.files:
        return json_err("No file part", 400)

    file = request.files['file']
    if not file.filename:
        return json_err("No selected file", 400)

    save_path = os.path.join(target, os.path.basename(file.filename))

    if not save_path.startswith(PROJECT_DIR):
        return json_err("Invalid upload path", 403)

    try:
        file.save(save_path)
        return json_ok(message=f"Uploaded: {file.filename}", path=save_path)
    except Exception as e:
        return json_err(str(e))


@files_bp.route('/api/files/search')
def search_files():
    q = request.args.get('q', '').strip()
    if not q:
        return json_ok(results=[])

    # FIX Bug #2: validate_path can return None â€” handle it properly
    folder = validate_path(request.args.get('folder', ''))
    if not folder:
        return json_err("Invalid search folder", 403, results=[])

    case_sensitive = request.args.get('case', '0') == '1'

    flags = [
        '-rn',
        '--include=*.py', '--include=*.js', '--include=*.ts',
        '--include=*.html', '--include=*.css', '--include=*.json',
        '--include=*.md', '--include=*.txt', '--include=*.sh',
        '--include=*.yaml', '--include=*.yml', '--include=*.toml',
        '--include=*.cfg',
        '--exclude-dir=node_modules', '--exclude-dir=.git',
        '--exclude-dir=__pycache__', '--exclude-dir=dist'
    ]

    if not case_sensitive:
        flags.append('-i')

    pattern = re.escape(q)
    cmd = f"grep {' '.join(flags)} -- {shlex.quote(pattern)} {shlex.quote(folder)} 2>/dev/null | head -300"

    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
        raw = result.stdout
    except subprocess.TimeoutExpired:
        return json_err("Search timeout", 408)
    except Exception as e:
        return json_err(str(e))

    file_map = {}
    for line in raw.split('\n'):
        if not line.strip():
            continue
        match = re.match(r'^(.+?):(\d+):\s*(.*)', line)
        if not match:
            continue
        filepath, lineno, text = match.groups()
        rel = filepath[len(folder):].lstrip('/') if filepath.startswith(folder) else filepath
        if rel not in file_map:
            file_map[rel] = []
        file_map[rel].append({"line": int(lineno), "text": text.strip()})

    results = sorted(
        [{"file": f, "matches": m} for f, m in file_map.items()],
        key=lambda x: len(x['matches']),
        reverse=True
    )
    return json_ok(results=results)


@files_bp.route('/api/project/info')
def project_info():
    tree_str = ""
    try:
        r = subprocess.run(
            ['tree', '--charset=ascii', '--dirsfirst', '-I', '__pycache__|*.pyc'],
            capture_output=True, text=True, timeout=2, cwd=PROJECT_DIR
        )
        if r.returncode == 0:
            tree_str = r.stdout
        else:
            tree_str = "Command 'tree' not found"
    except Exception:
        tree_str = "Error generating tree"

    files, folders = 0, 0
    for root, dirs, filenames in os.walk(PROJECT_DIR):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != '__pycache__']
        folders += len(dirs)
        files += len([f for f in filenames if not f.endswith('.pyc')])

    return json_ok(tree=tree_str, files=files, folders=folders)
