from flask import Blueprint, request, Response, stream_with_context, jsonify
import subprocess
import shlex
import os
from utils import PROJECT_DIR

terminal_bp = Blueprint('terminal', __name__)

# Process management: dict keyed by a simple counter so concurrent
# requests don't stomp each other. For Termux single-user use,
# we still only allow one active process but track it cleanly.
_active_processes: dict[int, subprocess.Popen] = {}
_proc_counter = 0
current_dir = PROJECT_DIR


@terminal_bp.route('/api/execute/cwd', methods=['GET'])
def api_get_cwd():
    home = os.path.expanduser('~')
    display = current_dir.replace(home, '~', 1)
    return jsonify({"success": True, "cwd": current_dir, "display": display})


@terminal_bp.route('/api/execute/stream', methods=['POST'])
def api_execute_stream():
    global current_dir, _proc_counter
    data = request.json or {}
    command = data.get('command', '').strip()

    if not command:
        return jsonify({"success": False, "error": "No command"}), 400

    # ── Handle `cd` natively so the working directory actually changes ──
    if command.startswith('cd') and (len(command) == 2 or command[2] in (' ', '\t')):
        try:
            parts = shlex.split(command)
            if len(parts) == 1 or parts[1] in ('~', ''):
                new_dir = os.path.expanduser('~')
            else:
                target = os.path.expanduser(parts[1])
                new_dir = target if os.path.isabs(target) else os.path.normpath(
                    os.path.join(current_dir, target)
                )

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
        except Exception as e:
            def _cd_exc():
                yield f"cd: error: {e}\n[EXIT_CODE:1]\n"
            return Response(stream_with_context(_cd_exc()), mimetype='text/plain')

    # ── Normal command ──
    try:
        cmd_parts = shlex.split(command)
    except ValueError as e:
        return jsonify({"success": False, "error": f"Parse error: {e}"}), 400

    _proc_counter += 1
    proc_id = _proc_counter

    def generate():
        try:
            proc = subprocess.Popen(
                cmd_parts,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                cwd=current_dir,
            )
            _active_processes[proc_id] = proc

            for line in iter(proc.stdout.readline, ''):
                if line:
                    yield line

            proc.stdout.close()
            proc.wait()
            yield f"\n[EXIT_CODE:{proc.returncode}]\n"
        except FileNotFoundError:
            yield f"{cmd_parts[0]}: command not found\n[EXIT_CODE:127]\n"
        except PermissionError:
            yield f"{cmd_parts[0]}: Permission denied\n[EXIT_CODE:126]\n"
        except Exception as e:
            yield f"\n[ERROR:{str(e)}]\n"
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
            proc.kill()
            killed.append(pid)

    if killed:
        return jsonify({"success": True, "message": f"Killed {len(killed)} process(es)"})
    return jsonify({"success": False, "message": "No running processes found"})
