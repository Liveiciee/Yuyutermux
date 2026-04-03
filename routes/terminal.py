from flask import Blueprint, request, Response, stream_with_context, jsonify
import subprocess
import shlex
import os
import signal
from utils import (
    PROJECT_DIR, validate_path_terminal, json_ok, json_err,
    rate_limit_execute, BLOCKED_COMMANDS, sanitize_error
)

terminal_bp = Blueprint('terminal', __name__)

# Process management: dict keyed by a simple counter so concurrent
# requests don't stomp each other.
_active_processes: dict[int, subprocess.Popen] = {}
_proc_counter = 0
current_dir = PROJECT_DIR


@terminal_bp.route('/api/execute/cwd', methods=['GET'])
def api_get_cwd():
    home = os.path.expanduser('~')
    # SECURITY: Don't leak real path, only show display path
    try:
        display = current_dir.replace(home, '~', 1)
    except Exception:
        display = '~'
    return jsonify({"success": True, "cwd": current_dir, "display": display})


@terminal_bp.route('/api/execute/stream', methods=['POST'])
@rate_limit_execute(max_requests=15, window=60)
def api_execute_stream():
    global current_dir, _proc_counter
    data = request.json or {}
    command = data.get('command', '').strip()

    if not command:
        return jsonify({"success": False, "error": "No command"}), 400

    # ── SECURITY: Check command length to prevent buffer attacks ──
    if len(command) > 10000:
        return jsonify({"success": False, "error": "Command too long (max 10000 chars)"}), 413

    # ── SECURITY: Validate command parts ──
    try:
        cmd_parts = shlex.split(command)
    except ValueError as e:
        return jsonify({"success": False, "error": f"Parse error: {e}"}), 400

    if not cmd_parts:
        return jsonify({"success": False, "error": "Empty command"}), 400

    # ── SECURITY: Check for blocked commands ──
    base_cmd = os.path.basename(cmd_parts[0])
    if base_cmd in BLOCKED_COMMANDS:
        return jsonify({"success": False, "error": f"Command '{base_cmd}' is blocked for security"}), 403

    # ── Handle `cd` natively so the working directory actually changes ──
    if base_cmd == 'cd' and (len(command) == 2 or command[2] in (' ', '\t')):
        try:
            parts = shlex.split(command)
            if len(parts) == 1 or parts[1] in ('~', ''):
                new_dir = os.path.expanduser('~')
            else:
                target = os.path.expanduser(parts[1])
                new_dir = target if os.path.isabs(target) else os.path.normpath(
                    os.path.join(current_dir, target)
                )

            # SECURITY: Validate cd destination
            validated = validate_path_terminal(new_dir)
            if not validated:
                def _cd_blocked():
                    yield f"cd: restricted: cannot access that directory\n[EXIT_CODE:1]\n"
                return Response(stream_with_context(_cd_blocked()), mimetype='text/plain')

            if os.path.isdir(new_dir):
                current_dir = new_dir
                def _cd_ok():
                    yield f"\n[EXIT_CODE:0]\n"
                return Response(stream_with_context(_cd_ok()), mimetype='text/plain')
            else:
                target_name = parts[1] if len(parts) > 1 else ''
                def _cd_err():
                    yield f"cd: {target_name}: No such file or directory\n[EXIT_CODE:1]\n"
                return Response(stream_with_context(_cd_err()), mimetype='text/plain')
        except Exception:
            def _cd_exc():
                yield f"cd: error: invalid arguments\n[EXIT_CODE:1]\n"
            return Response(stream_with_context(_cd_exc()), mimetype='text/plain')

    _proc_counter += 1
    proc_id = _proc_counter

    def generate():
        proc = None
        try:
            proc = subprocess.Popen(
                cmd_parts,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                cwd=current_dir,
                preexec_fn=os.setsid,  # Create process group for clean killing
            )
            _active_processes[proc_id] = proc

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
            # SECURITY: Don't leak exception details to client
            yield f"\n[ERROR:internal error]\n"
        finally:
            _active_processes.pop(proc_id, None)

    return Response(stream_with_context(generate()), mimetype='text/plain')


@terminal_bp.route('/api/execute/kill', methods=['POST'])
def api_execute_kill():
    if not _active_processes:
        return jsonify({"success": False, "message": "No active process"})

    killed = []
    for pid, proc in list(_active_processes.items()):
        if proc.poll() is None:
            try:
                # Kill entire process group (children too)
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
