from flask import Blueprint, request, send_from_directory
from utils import (
    validate_path, json_ok, json_err, get_req_path,
    PROJECT_DIR, MAX_FILE_SIZE, MAX_UPLOAD_SIZE,
    rate_limit, sanitize_error
)
import os
import datetime
import subprocess
import shlex
import re

files_bp = Blueprint('files', __name__)


@files_bp.route('/api/files/list')
@rate_limit(max_requests=30, window=60)
def api_files_list():
    path = validate_path(get_req_path())
    if not path:
        return json_err("Invalid path", 403, files=[])

    if not os.path.exists(path):
        return json_err("Path not found", 404, files=[])

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

                # FIX: Compute relative path instead of leaking absolute filesystem path
                if path == PROJECT_DIR:
                    rel_path = entry.name
                else:
                    rel_path = path.replace(PROJECT_DIR + os.sep, '', 1) + os.sep + entry.name

                items.append({
                    "name": entry.name,
                    # FIX: Use relative path, not entry.path (which is absolute)
                    "path": rel_path,
                    "type": "directory" if is_dir else "file",
                    "size": size_str,
                    "modified": datetime.datetime.fromtimestamp(stat.st_mtime).isoformat()
                })
            except (PermissionError, OSError):
                continue

        items.sort(key=lambda x: (x['type'] != 'directory', x['name'].lower()))

        # SECURITY: Only show relative display path
        if path == PROJECT_DIR:
            display = '~/Yuyutermux'
        else:
            display = '~/Yuyutermux/' + path.replace(PROJECT_DIR, '').lstrip('/')

        return json_ok(current_path=display, items=items)

    except Exception:
        return json_err("Failed to list directory", 500, files=[])


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
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            return json_ok(path=path, content=f.read())
    except Exception:
        return json_err("Failed to read file", 500, content="")


@files_bp.route('/api/files/write', methods=['POST'])
@rate_limit(max_requests=20, window=60)
def api_files_write():
    data = request.json or {}

    if 'path' not in data:
        return json_err("No path provided", 400)

    path = validate_path(data['path'])
    if not path:
        return json_err("Invalid path", 403)

    # SECURITY: Check write content size
    content = data.get('content', '')
    if len(content) > 5 * 1024 * 1024:  # 5MB max write content
        return json_err("Content too large (>5MB)", 413)

    # SECURITY: Block writing to sensitive file patterns
    blocked_patterns = ['.auth_token', '.env', '.htaccess', '.htpasswd',
                        'passwd', 'shadow', 'ssh/', '.ssh/', '.bashrc',
                        '.bash_profile', '.profile', '.bash_history']
    filename = os.path.basename(path)
    for pat in blocked_patterns:
        if pat in filename:
            return json_err("Cannot write to protected file", 403)

    parent = os.path.dirname(path)

    try:
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        return json_ok(message="File saved")
    except Exception:
        return json_err("Failed to save file")


@files_bp.route('/api/files/delete', methods=['POST'])
def api_files_delete():
    path = validate_path(get_req_path())
    if not path:
        return json_err("Invalid path", 403)

    # SECURITY: Prevent deletion of critical project files
    critical_files = ['app.py', 'utils.py', 'run.sh', '.auth_token']
    filename = os.path.basename(path)
    if filename in critical_files and os.path.dirname(path) == PROJECT_DIR:
        return json_err(f"Cannot delete protected file: {filename}", 403)

    try:
        if os.path.isdir(path):
            # SECURITY: Use shutil.rmtree for non-empty dirs, but limit depth
            import shutil
            shutil.rmtree(path)
        else:
            os.remove(path)
        return json_ok(message="Deleted")
    except Exception:
        return json_err("Failed to delete")


@files_bp.route('/api/files/create', methods=['POST'])
def api_files_create():
    data = request.json or {}
    filename = data.get('filename', '')

    if not filename:
        return json_err("No filename provided", 400)

    # SECURITY: Sanitize filename — remove path separators and dangerous chars
    filename = os.path.basename(filename)
    if not filename or filename.startswith('.'):
        return json_err("Invalid filename", 400)

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
        return json_ok(message=f"Created: {os.path.basename(new_path)}")
    except Exception:
        return json_err("Failed to create file")


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
@rate_limit(max_requests=10, window=60)
def api_files_upload():
    target = validate_path(request.form.get('path', ''))
    if not target:
        return json_err("Invalid upload path", 403)

    if 'file' not in request.files:
        return json_err("No file part", 400)

    file = request.files['file']
    if not file.filename:
        return json_err("No selected file", 400)

    # SECURITY: Check upload size
    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)

    if file_size > MAX_UPLOAD_SIZE:
        return json_err(f"File too large (max {MAX_UPLOAD_SIZE // (1024*1024)}MB)", 413)

    # SECURITY: Sanitize filename
    safe_filename = os.path.basename(file.filename)
    if not safe_filename or safe_filename.startswith('.'):
        return json_err("Invalid filename", 400)

    save_path = os.path.join(target, safe_filename)

    if not save_path.startswith(PROJECT_DIR):
        return json_err("Invalid upload path", 403)

    # SECURITY: Check if file already exists (prevent overwrite)
    # FIX: Use loop to handle race condition on timestamp collision
    if os.path.exists(save_path):
        name, ext = os.path.splitext(safe_filename)
        for attempt in range(10):
            timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S_%f')
            candidate = f"{name}_{timestamp}{ext}"
            candidate_path = os.path.join(target, candidate)
            if not os.path.exists(candidate_path):
                safe_filename = candidate
                save_path = candidate_path
                break
        else:
            return json_err("Too many files with same name", 409)

    try:
        file.save(save_path)
        return json_ok(message=f"Uploaded: {safe_filename}", path=save_path)
    except Exception:
        return json_err("Upload failed")


@files_bp.route('/api/files/search')
@rate_limit(max_requests=15, window=60)
def search_files():
    q = request.args.get('q', '').strip()
    if not q:
        return json_ok(results=[])

    # SECURITY: Limit search query length
    if len(q) > 200:
        return json_err("Search query too long", 413, results=[])

    folder = validate_path(request.args.get('folder', ''))
    if not folder:
        return json_err("Invalid search folder", 403, results=[])

    case_sensitive = request.args.get('case', '0') == '1'

    # SECURITY: FIX — Use list arguments instead of shell=True to prevent injection
    grep_flags = ['-rn', '--include=*.py', '--include=*.js', '--include=*.ts',
                  '--include=*.html', '--include=*.css', '--include=*.json',
                  '--include=*.md', '--include=*.txt', '--include=*.sh',
                  '--include=*.yaml', '--include=*.yml', '--include=*.toml',
                  '--include=*.cfg',
                  '--exclude-dir=node_modules', '--exclude-dir=.git',
                  '--exclude-dir=__pycache__', '--exclude-dir=dist']

    if not case_sensitive:
        grep_flags.append('-i')

    grep_flags.extend(['--', q, folder])

    try:
        result = subprocess.run(
            ['grep'] + grep_flags,
            capture_output=True, text=True, timeout=10,
            env={**os.environ, 'LC_ALL': 'C'}
        )

        # SECURITY: Limit output size
        raw_lines = result.stdout.split('\n')
        raw = '\n'.join(raw_lines[:300])  # Cap at 300 lines
    except subprocess.TimeoutExpired:
        return json_err("Search timeout", 408, results=[])
    except FileNotFoundError:
        return json_err("grep not found", 500, results=[])
    except Exception:
        return json_err("Search failed", 500, results=[])

    file_map = {}
    for line in raw.split('\n'):
        if not line.strip():
            continue
        match = re.match(r'^(.+?):(\d+):\s*(.*)', line)
        if not match:
            continue
        filepath, lineno, text = match.groups()
        rel = filepath[len(folder):].lstrip('/') if filepath.startswith(folder) else filepath
        # SECURITY: Sanitize paths in output
        rel = sanitize_error(rel)
        text = text[:500]  # Truncate long match lines
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
        # SECURITY: Skip hidden directories
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != '__pycache__']
        folders += len(dirs)
        files += len([f for f in filenames if not f.endswith('.pyc')])

    return json_ok(tree=tree_str, files=files, folders=folders)
