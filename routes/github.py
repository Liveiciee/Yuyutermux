from flask import Blueprint, request, jsonify
import subprocess
import os
from utils import PROJECT_DIR

github_bp = Blueprint('github', __name__)


def git_run(args: list, cwd: str = None, input_data: str = None) -> tuple[bool, str, str]:
    """Run git command, return (success, stdout, stderr)."""
    try:
        result = subprocess.run(
            ['git'] + args,
            capture_output=True,
            text=True,
            cwd=cwd or PROJECT_DIR,
            timeout=30,
            input=input_data,
        )
        return result.returncode == 0, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, '', 'Operation timed out (30s)'
    except FileNotFoundError:
        return False, '', 'git not found — install with: pkg install git'
    except Exception as e:
        return False, '', str(e)


def _is_repo() -> bool:
    ok, _, _ = git_run(['rev-parse', '--git-dir'])
    return ok


# ── STATUS ────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/status')
def git_status():
    if not _is_repo():
        return jsonify({"success": True, "is_repo": False})

    _, branch, _ = git_run(['branch', '--show-current'])
    if not branch:
        _, short_hash, _ = git_run(['rev-parse', '--short', 'HEAD'])
        branch = f'detached@{short_hash}' if short_hash else 'unknown'

    _, porcelain, _ = git_run(['status', '--porcelain'])

    staged, unstaged, untracked = [], [], []
    for line in (porcelain or '').split('\n'):
        if not line:
            continue
        x, y, filepath = line[0], line[1], line[3:]
        if x == '?' and y == '?':
            untracked.append(filepath)
        else:
            if x not in (' ', '?'):
                staged.append({'status': x, 'file': filepath})
            if y not in (' ', '?'):
                unstaged.append({'status': y, 'file': filepath})

    # Remotes
    _, remote_raw, _ = git_run(['remote', '-v'])
    remotes, seen = [], set()
    for line in (remote_raw or '').split('\n'):
        if line and '(fetch)' in line:
            parts = line.split()
            if len(parts) >= 2 and parts[0] not in seen:
                remotes.append({'name': parts[0], 'url': parts[1]})
                seen.add(parts[0])

    # Ahead / behind (best effort — fails if no upstream)
    ahead = behind = 0
    _, ab, _ = git_run(['rev-list', '--left-right', '--count', f'HEAD...@{{u}}'])
    if ab:
        parts = ab.split()
        if len(parts) == 2:
            try:
                ahead, behind = int(parts[0]), int(parts[1])
            except ValueError:
                pass

    return jsonify({
        "success": True,
        "is_repo": True,
        "branch": branch,
        "staged": staged,
        "unstaged": unstaged,
        "untracked": untracked,
        "remotes": remotes,
        "ahead": ahead,
        "behind": behind,
    })


# ── LOG ───────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/log')
def git_log():
    limit = min(int(request.args.get('limit', 15)), 50)
    ok, out, err = git_run([
        'log', f'--max-count={limit}',
        '--pretty=format:%H|%h|%s|%an|%ar'
    ])
    if not ok:
        return jsonify({"success": False, "error": err, "commits": []})

    commits = []
    for line in out.split('\n'):
        if not line:
            continue
        parts = line.split('|', 4)
        if len(parts) == 5:
            commits.append({
                'hash': parts[0], 'short': parts[1],
                'message': parts[2], 'author': parts[3], 'time': parts[4]
            })
    return jsonify({"success": True, "commits": commits})


# ── BRANCHES ──────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/branches')
def git_branches():
    ok, out, err = git_run(['branch', '-a'])
    if not ok:
        return jsonify({"success": False, "error": err, "branches": []})

    branches = []
    for line in out.split('\n'):
        if not line or 'HEAD ->' in line:
            continue
        is_current = line.startswith('*')
        name = line.strip().lstrip('* ')
        if name:
            branches.append({'name': name, 'current': is_current})

    return jsonify({"success": True, "branches": branches})


# ── INIT ──────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/init', methods=['POST'])
def git_init():
    ok, out, err = git_run(['init'])
    if ok:
        return jsonify({"success": True, "message": out or "Repository initialized"})
    return jsonify({"success": False, "error": err})


# ── STAGE / UNSTAGE / DISCARD ─────────────────────────────────────────────────

@github_bp.route('/api/git/add', methods=['POST'])
def git_add():
    data = request.json or {}
    files = data.get('files', ['.'])
    if isinstance(files, str):
        files = [files]
    ok, out, err = git_run(['add', '--'] + files)
    if ok:
        return jsonify({"success": True, "message": f"Staged: {', '.join(files)}"})
    return jsonify({"success": False, "error": err})


@github_bp.route('/api/git/unstage', methods=['POST'])
def git_unstage():
    data = request.json or {}
    filepath = data.get('file', '.')
    ok, out, err = git_run(['restore', '--staged', '--', filepath])
    if ok:
        return jsonify({"success": True, "message": f"Unstaged: {filepath}"})
    return jsonify({"success": False, "error": err})


@github_bp.route('/api/git/discard', methods=['POST'])
def git_discard():
    data = request.json or {}
    filepath = data.get('file', '')
    if not filepath:
        return jsonify({"success": False, "error": "File path required"})
    ok, out, err = git_run(['restore', '--', filepath])
    if ok:
        return jsonify({"success": True, "message": f"Discarded: {filepath}"})
    return jsonify({"success": False, "error": err})


# ── COMMIT ────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/commit', methods=['POST'])
def git_commit():
    data = request.json or {}
    message = data.get('message', '').strip()
    if not message:
        return jsonify({"success": False, "error": "Commit message required"})
    ok, out, err = git_run(['commit', '-m', message])
    if ok:
        return jsonify({"success": True, "message": out})
    return jsonify({"success": False, "error": err or out})


# ── PUSH / PULL / FETCH ───────────────────────────────────────────────────────

@github_bp.route('/api/git/push', methods=['POST'])
def git_push():
    data = request.json or {}
    remote = data.get('remote', 'origin')
    branch = data.get('branch', '')
    force = data.get('force', False)

    args = ['push', remote]
    if branch:
        args.append(branch)
    if force:
        args.append('--force')
    if data.get('set_upstream'):
        args.extend(['-u', remote, branch or 'HEAD'])

    ok, out, err = git_run(args)
    msg = out or err or 'Push successful'
    if ok:
        return jsonify({"success": True, "message": msg})
    # Suggest --set-upstream if needed
    if 'no upstream branch' in err or 'set-upstream' in err:
        return jsonify({"success": False, "error": err, "needs_upstream": True})
    return jsonify({"success": False, "error": err or out})


@github_bp.route('/api/git/pull', methods=['POST'])
def git_pull():
    data = request.json or {}
    remote = data.get('remote', 'origin')
    branch = data.get('branch', '')
    args = ['pull', remote]
    if branch:
        args.append(branch)
    ok, out, err = git_run(args)
    if ok:
        return jsonify({"success": True, "message": out or 'Pull successful'})
    return jsonify({"success": False, "error": err or out})


@github_bp.route('/api/git/fetch', methods=['POST'])
def git_fetch():
    ok, out, err = git_run(['fetch', '--all'])
    if ok:
        return jsonify({"success": True, "message": out or 'Fetch complete'})
    return jsonify({"success": False, "error": err})


# ── BRANCH ────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/checkout', methods=['POST'])
def git_checkout():
    data = request.json or {}
    branch = data.get('branch', '').strip()
    create = data.get('create', False)
    if not branch:
        return jsonify({"success": False, "error": "Branch name required"})
    args = ['checkout', '-b', branch] if create else ['checkout', branch]
    ok, out, err = git_run(args)
    if ok:
        return jsonify({"success": True, "message": out or f"Switched to {branch}"})
    return jsonify({"success": False, "error": err})


# ── REMOTE ────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/remote', methods=['POST'])
def git_remote():
    data = request.json or {}
    action = data.get('action', 'add')
    name = data.get('name', 'origin')
    url = data.get('url', '').strip()

    if action == 'add':
        if not url:
            return jsonify({"success": False, "error": "URL required"})
        ok, out, err = git_run(['remote', 'add', name, url])
        if not ok and 'already exists' in err:
            ok, out, err = git_run(['remote', 'set-url', name, url])
    elif action == 'remove':
        ok, out, err = git_run(['remote', 'remove', name])
    else:
        return jsonify({"success": False, "error": "Unknown action"})

    if ok:
        return jsonify({"success": True, "message": f"Remote '{name}' updated"})
    return jsonify({"success": False, "error": err})


# ── CONFIG ────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/config', methods=['GET', 'POST'])
def git_config():
    if request.method == 'GET':
        _, name, _ = git_run(['config', '--global', 'user.name'])
        _, email, _ = git_run(['config', '--global', 'user.email'])
        return jsonify({"success": True, "name": name, "email": email})

    data = request.json or {}
    msgs = []
    for key, val in [('user.name', data.get('name', '')), ('user.email', data.get('email', ''))]:
        if val:
            ok, _, err = git_run(['config', '--global', key, val])
            if not ok:
                return jsonify({"success": False, "error": err})
            msgs.append(f"{key.split('.')[1].title()}: {val}")

    return jsonify({"success": True, "message": ', '.join(msgs) or "No changes"})


# ── DIFF ──────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/diff')
def git_diff():
    filepath = request.args.get('file', '')
    staged = request.args.get('staged', '0') == '1'
    args = ['diff']
    if staged:
        args.append('--staged')
    if filepath:
        args.extend(['--', filepath])
    _, out, _ = git_run(args)
    return jsonify({"success": True, "diff": out})
