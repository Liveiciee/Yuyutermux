from flask import Blueprint, request, jsonify
import subprocess
import os
import re
from utils import PROJECT_DIR, rate_limit, sanitize_error, _safe_env

github_bp = Blueprint('github', __name__)

# ── SECURITY: Valid branch name pattern ──────────────────────────────────────
BRANCH_NAME_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$')

# ── SECURITY: Valid remote name pattern ──────────────────────────────────────
REMOTE_NAME_RE = re.compile(r'^[a-zA-Z0-9._\-]+$')


def git_run(args: list, cwd: str = None, input_data: str = None) -> tuple:
    """Run git command, return (success, stdout, stderr)."""
    try:
        result = subprocess.run(
            ['git'] + args,
            capture_output=True,
            text=True,
            cwd=cwd or PROJECT_DIR,
            timeout=30,
            input=input_data,
            # BUG FIX: Pass filtered env so YUYUTERMUX_TOKEN is not inherited.
            # git can print env vars in error messages (e.g. GIT_TRACE output),
            # and a compromised git hook could dump the full environment.
            env=_safe_env(),
        )
        ok = result.returncode == 0
        stdout = sanitize_error(result.stdout.strip())
        stderr = sanitize_error(result.stderr.strip())
        return ok, stdout, stderr
    except subprocess.TimeoutExpired:
        return False, '', 'Operation timed out (30s)'
    except FileNotFoundError:
        return False, '', 'git not found — install with: pkg install git'
    except Exception:
        return False, '', 'Git operation failed'


def _is_repo() -> bool:
    ok, _, _ = git_run(['rev-parse', '--git-dir'])
    return ok


def _validate_branch_name(name: str) -> bool:
    """Validate branch name to prevent injection."""
    return bool(name and BRANCH_NAME_RE.match(name) and len(name) <= 255)


# ── STATUS ────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/status')
@rate_limit(max_requests=30, window=60)
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
        # BUG FIX: Was `x, y, filepath = line[0], line[1], line[3:]` with no guard.
        # git status --porcelain output is always ≥ 4 chars for modified/staged entries
        # (XY + space + path), but an empty or malformed line (e.g. from a corrupt
        # git index or a future git format change) would cause IndexError here.
        # Guard: skip any line shorter than 4 characters.
        if len(line) < 4:
            continue
        x, y, filepath = line[0], line[1], line[3:]
        filepath = sanitize_error(filepath)
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
                url = parts[1]
                if '@' in url:
                    try:
                        scheme_rest = url.split('://', 1)
                        if len(scheme_rest) == 2:
                            user_pass_host = scheme_rest[1].split('@', 1)
                            if len(user_pass_host) == 2:
                                url = f"{scheme_rest[0]}://***@{user_pass_host[1]}"
                    except Exception:
                        pass
                remotes.append({'name': parts[0], 'url': url})
                seen.add(parts[0])

    # Ahead / behind (best effort — fails if no upstream)
    ahead = behind = 0
    _, ab, _ = git_run(['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
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
@rate_limit(max_requests=20, window=60)
def git_log():
    try:
        limit = min(int(request.args.get('limit', 15)), 50)
    except (ValueError, TypeError):
        limit = 15

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
                'message': sanitize_error(parts[2]),
                'author': sanitize_error(parts[3]), 'time': parts[4]
            })
    return jsonify({"success": True, "commits": commits})


# ── BRANCHES ──────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/branches')
@rate_limit(max_requests=20, window=60)
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
@rate_limit(max_requests=5, window=60)
def git_init():
    ok, out, err = git_run(['init'])
    if ok:
        return jsonify({"success": True, "message": out or "Repository initialized"})
    return jsonify({"success": False, "error": err})


# ── STAGE / UNSTAGE / DISCARD ─────────────────────────────────────────────────

@github_bp.route('/api/git/add', methods=['POST'])
@rate_limit(max_requests=20, window=60)
def git_add():
    data = request.json or {}
    files = data.get('files', ['.'])
    if isinstance(files, str):
        files = [files]

    for f in files:
        if '..' in str(f):
            return jsonify({"success": False, "error": "Invalid path"})

    ok, out, err = git_run(['add', '--'] + [str(f) for f in files])
    if ok:
        return jsonify({"success": True, "message": f"Staged: {', '.join(str(f) for f in files)}"})
    return jsonify({"success": False, "error": err})


@github_bp.route('/api/git/unstage', methods=['POST'])
@rate_limit(max_requests=20, window=60)
def git_unstage():
    data = request.json or {}
    filepath = data.get('file', '.')
    if '..' in str(filepath):
        return jsonify({"success": False, "error": "Invalid path"})
    ok, out, err = git_run(['restore', '--staged', '--', str(filepath)])
    if ok:
        return jsonify({"success": True, "message": f"Unstaged: {filepath}"})
    return jsonify({"success": False, "error": err})


@github_bp.route('/api/git/discard', methods=['POST'])
@rate_limit(max_requests=10, window=60)
def git_discard():
    data = request.json or {}
    filepath = data.get('file', '')
    if not filepath:
        return jsonify({"success": False, "error": "File path required"})
    if '..' in str(filepath):
        return jsonify({"success": False, "error": "Invalid path"})
    ok, out, err = git_run(['restore', '--', str(filepath)])
    if ok:
        return jsonify({"success": True, "message": f"Discarded: {filepath}"})
    return jsonify({"success": False, "error": err})


# ── COMMIT ────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/commit', methods=['POST'])
@rate_limit(max_requests=15, window=60)
def git_commit():
    data = request.json or {}
    message = data.get('message', '').strip()
    if not message:
        return jsonify({"success": False, "error": "Commit message required"})

    if len(message) > 5000:
        return jsonify({"success": False, "error": "Commit message too long (max 5000 chars)"})

    ok, out, err = git_run(['commit', '-m', message])
    if ok:
        return jsonify({"success": True, "message": out})
    return jsonify({"success": False, "error": err or out})


# ── PUSH / PULL / FETCH ───────────────────────────────────────────────────────

@github_bp.route('/api/git/push', methods=['POST'])
@rate_limit(max_requests=10, window=60)
def git_push():
    data = request.json or {}
    remote = data.get('remote', 'origin')
    branch = data.get('branch', '')
    force = data.get('force', False)

    if not REMOTE_NAME_RE.match(remote):
        return jsonify({"success": False, "error": "Invalid remote name"})

    if branch and not _validate_branch_name(branch):
        return jsonify({"success": False, "error": "Invalid branch name"})

    args = ['push']
    if force:
        args.append('--force')
    if data.get('set_upstream'):
        args.append('-u')
    args.append(remote)
    if branch:
        args.append(branch)
    else:
        args.append('HEAD')

    ok, out, err = git_run(args)
    msg = out or err or 'Push successful'
    if ok:
        return jsonify({"success": True, "message": msg})
    if 'no upstream branch' in err or 'set-upstream' in err:
        return jsonify({"success": False, "error": err, "needs_upstream": True})
    return jsonify({"success": False, "error": err or out})


@github_bp.route('/api/git/pull', methods=['POST'])
@rate_limit(max_requests=10, window=60)
def git_pull():
    data = request.json or {}
    remote = data.get('remote', 'origin')
    branch = data.get('branch', '')

    if not REMOTE_NAME_RE.match(remote):
        return jsonify({"success": False, "error": "Invalid remote name"})
    if branch and not _validate_branch_name(branch):
        return jsonify({"success": False, "error": "Invalid branch name"})

    args = ['pull', remote]
    if branch:
        args.append(branch)
    ok, out, err = git_run(args)
    if ok:
        return jsonify({"success": True, "message": out or 'Pull successful'})
    return jsonify({"success": False, "error": err or out})


@github_bp.route('/api/git/fetch', methods=['POST'])
@rate_limit(max_requests=10, window=60)
def git_fetch():
    ok, out, err = git_run(['fetch', '--all'])
    if ok:
        return jsonify({"success": True, "message": out or 'Fetch complete'})
    return jsonify({"success": False, "error": err})


# ── BRANCH ────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/checkout', methods=['POST'])
@rate_limit(max_requests=10, window=60)
def git_checkout():
    data = request.json or {}
    branch = data.get('branch', '').strip()
    create = data.get('create', False)

    if not branch:
        return jsonify({"success": False, "error": "Branch name required"})

    if not _validate_branch_name(branch):
        return jsonify({"success": False, "error": "Invalid branch name. Use only letters, numbers, dots, hyphens, underscores, and slashes."})

    args = ['checkout', '-b', branch] if create else ['checkout', branch]
    ok, out, err = git_run(args)
    if ok:
        return jsonify({"success": True, "message": out or f"Switched to {branch}"})
    return jsonify({"success": False, "error": err})


# ── REMOTE ────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/remote', methods=['POST'])
@rate_limit(max_requests=5, window=60)
def git_remote():
    data = request.json or {}
    action = data.get('action', 'add')
    name = data.get('name', 'origin')
    url = data.get('url', '').strip()

    if not REMOTE_NAME_RE.match(name):
        return jsonify({"success": False, "error": "Invalid remote name"})

    if url and not re.match(r'^(https?://|git://|ssh://|git@)', url):
        return jsonify({"success": False, "error": "Invalid remote URL format"})

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
@rate_limit(max_requests=10, window=60)
def git_config():
    if request.method == 'GET':
        _, name, _ = git_run(['config', '--global', 'user.name'])
        _, email, _ = git_run(['config', '--global', 'user.email'])
        return jsonify({"success": True, "name": name[:100] if name else '', "email": email[:100] if email else ''})

    data = request.json or {}
    msgs = []

    for key, val in [('user.name', data.get('name', '')), ('user.email', data.get('email', ''))]:
        if val:
            if len(val) > 200:
                return jsonify({"success": False, "error": f"{key.split('.')[1].title()} too long"})
            if re.search(r'[\x00-\x1f\x7f\n\r]', val):
                return jsonify({"success": False, "error": f"Invalid {key.split('.')[1].title()}"})
            ok, _, err = git_run(['config', '--global', key, val])
            if not ok:
                return jsonify({"success": False, "error": err})
            msgs.append(f"{key.split('.')[1].title()}: {val}")

    return jsonify({"success": True, "message": ', '.join(msgs) or "No changes"})


# ── DIFF ──────────────────────────────────────────────────────────────────────

@github_bp.route('/api/git/diff')
@rate_limit(max_requests=20, window=60)
def git_diff():
    filepath = request.args.get('file', '')
    if '..' in filepath:
        return jsonify({"success": False, "diff": ""})

    staged = request.args.get('staged', '0') == '1'
    args = ['diff']
    if staged:
        args.append('--staged')
    if filepath:
        args.extend(['--', filepath])
    _, out, _ = git_run(args)
    out = sanitize_error(out)
    return jsonify({"success": True, "diff": out})
