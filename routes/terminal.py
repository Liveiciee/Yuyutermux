from flask import Blueprint, request, Response, stream_with_context
import subprocess
import shlex

terminal_bp = Blueprint('terminal', __name__)
active_process = None

@terminal_bp.route('/api/execute/stream', methods=['POST'])
def api_execute_stream():
    global active_process
    data = request.json
    command = data.get('command', '')

    if not command:
        return {"error": "No command"}, 400

    try:
        cmd_parts = shlex.split(command)
    except Exception as e:
        return {"error": f"Invalid: {e}"}, 400

    def generate():
        global active_process
        try:
            active_process = subprocess.Popen(
                cmd_parts, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1
            )
            for line in iter(active_process.stdout.readline, ''):
                if line: yield line

            active_process.stdout.close()
            active_process.wait()
            yield f"\n[EXIT_CODE:{active_process.returncode}]\n"
        except Exception as e:
            yield f"\n[ERROR:{str(e)}]\n"
        finally:
            active_process = None

    return Response(stream_with_context(generate()), mimetype='text/plain')

@terminal_bp.route('/api/execute/kill', methods=['POST'])
def api_execute_kill():
    global active_process
    if active_process and active_process.poll() is None:
        active_process.kill()
        return {"success": True, "message": "Process killed"}
    return {"success": False, "message": "No active process"}
