from flask import Blueprint, request, Response, stream_with_context, jsonify, session
import subprocess
import shlex
import os
import signal
import threading
import time
from utils import (
    PROJECT_DIR, validate_path_terminal, json_ok, json_err,
    rate_limit_execute, BLOCKED_COMMANDS, sanitize_error, _safe_env
)

terminal_bp = Blueprint('terminal', __name__)

_active_processes: dict = {}
_proc_counter = 0
_proc_lock = threading.Lock()
_proc_counter_lock = threading.Lock()

_SESSION_CWD_KEY = 'terminal_cwd'

def get_session_cwd():
    return session.get(_SESSION_CWD_KEY, PROJECT_DIR)

def set_session_cwd(path):
    session[_SESSION_CWD_KEY] = path

MAX_PROCESS_TIMEOUT = 300  # 5 minutes

def _kill_after_timeout(proc, proc_id, deadline):
    """Kill process group after deadline if still running."""
    now = time.time()
    if now < deadline:
        time.sleep(deadline - now)
    with _proc_lock:
        if proc_id in _active_processes and _active_processes.get(proc_id) is proc:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                pass

@terminal_bp.route('/api/execute/cwd', methods=['GET'])
def api_get_cwd():
    try:
        current_dir = get_session_cwd()
        home = os.path.expanduser('~')
        display = current_dir.replace(home, '~', 1)
    except Exception:
        display = '~'
        current_dir = PROJECT_DIR
    return jsonify({"success": True, "cwd": display, "display": display})

@terminal_bp.route('/api/execute/stream', methods=['POST'])
@rate_limit_execute(max_requests=15, window=60)
def api_execute_stream():
    global _proc_counter
    data = request.json or {}
    command = data.get('command', '').strip()
    if not command:
        return jsonify({"success": False, "error": "No command"}), 400
    if len(command) > 10000:
        return jsonify({"success": False, "error": "Command too long (max 10000 chars)"}), 413
    try:
        cmd_parts = shlex.split(command)
    except ValueError as e:
        return jsonify({"success": False, "error": f"Parse error: {e}"}), 400
    if not cmd_parts:
        return jsonify({"success": False, "error": "Empty command"}), 400
    base_cmd = os.path.basename(cmd_parts[0])
    if base_cmd in BLOCKED_COMMANDS:
        return jsonify({"success": False, "error": f"Command '{base_cmd}' is blocked for security"}), 403

    # Handle cd natively
    if base_cmd == 'cd':
        try:
            if len(cmd_parts) == 1 or cmd_parts[1] in ('~', ''):
                new_dir = os.path.expanduser('~')
            else:
                target = os.path.expanduser(cmd_parts[1])
                new_dir = target if os.path.isabs(target) else os.path.normpath(
                    os.path.join(get_session_cwd(), target)
                )
            validated = validate_path_terminal(new_dir)
            if not validated:
                def _cd_blocked():
                    yield f"cd: restricted: cannot access that directory\n[EXIT_CODE:1]\n"
                return Response(stream_with_context(_cd_blocked()), mimetype='text/plain')
            if os.path.isdir(validated):
                set_session_cwd(validated)
                def _cd_ok():
                    yield f"\n[EXIT_CODE:0]\n"
                return Response(stream_with_context(_cd_ok()), mimetype='text/plain')
            else:
                target_name = cmd_parts[1] if len(cmd_parts) > 1 else ''
                def _cd_err():
                    yield f"cd: {target_name}: No such file or directory\n[EXIT_CODE:1]\n"
                return Response(stream_with_context(_cd_err()), mimetype='text/plain')
        except Exception:
            def _cd_exc():
                yield f"cd: error: invalid arguments\n[EXIT_CODE:1]\n"
            return Response(stream_with_context(_cd_exc()), mimetype='text/plain')

    with _proc_counter_lock:
        _proc_counter += 1
        proc_id = _proc_counter

    current_cwd = get_session_cwd()

    def generate(cwd):
        proc = None
        timeout_thread = None
        try:
            proc = subprocess.Popen(
                cmd_parts,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                cwd=cwd,
                preexec_fn=os.setsid,
                env=_safe_env(),
            )
            with _proc_lock:
                _active_processes[proc_id] = proc

            deadline = time.time() + MAX_PROCESS_TIMEOUT
            timeout_thread = threading.Thread(target=_kill_after_timeout, args=(proc, proc_id, deadline), daemon=True)
            timeout_thread.start()

            for line in iter(proc.stdout.readline, ''):
                if line:
                    yield line

            proc.stdout.close()
            proc.wait()
            yield f"\n[EXIT_CODE:{proc.returncode}]\n"
        except FileNotFoundError:
            yield f"{base_cmd}: command not found\n[EXIT_CODE:127]\n"
        except PermissionError:
            yield f"{base_cmd}: Permission denied\n[EXIT_CODE:126]\n"
        except MemoryError:
            yield f"Out of memory\n[EXIT_CODE:137]\n"
        except Exception:
            yield f"\n[ERROR:internal error]\n"
        finally:
            with _proc_lock:
                _active_processes.pop(proc_id, None)

    return Response(stream_with_context(generate(current_cwd)), mimetype='text/plain')

@terminal_bp.route('/api/execute/kill', methods=['POST'])
def api_execute_kill():
    with _proc_lock:
        if not _active_processes:
            return jsonify({"success": False, "message": "No active process"})
        snapshot = list(_active_processes.items())
    killed = []
    for pid, proc in snapshot:
        if proc.poll() is None:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                killed.append(pid)
            except (ProcessLookupError, PermissionError):
                try:
                    proc.kill()
                    killed.append(pid)
                except Exception:
                    pass
    if killed:
        return jsonify({"success": True, "message": f"Killed {len(killed)} process(es)"})
    return jsonify({"success": False, "message": "No running processes found"})