import secrets
from flask import Blueprint, render_template, redirect, request, make_response, jsonify
from utils import AUTH_TOKEN, check_auth, rate_limit

pages_bp = Blueprint('pages', __name__)

_COOKIE_NAME = 'yuyu_token'
_MARKER_COOKIE = 'yuyu_authed'
_COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days

def _page_guard():
    if not check_auth():
        return redirect('/login')

@pages_bp.route('/')
def index():
    guard = _page_guard()
    if guard:
        return guard
    return render_template('index.html')

@pages_bp.route('/docs')
def docs():
    guard = _page_guard()
    if guard:
        return guard
    return render_template('docs.html')

@pages_bp.route('/login')
def login():
    if check_auth():
        return redirect('/')
    error = request.args.get('error', '')
    return render_template('login.html', error=error)

@pages_bp.route('/api/auth/login', methods=['POST'])
@rate_limit(max_requests=5, window=60)
def auth_login():
    data = request.get_json(silent=True) or {}
    token = (data.get('token') or '').strip()

    if not token:
        return jsonify({"success": False, "error": "Authentication failed"}), 401

    if not AUTH_TOKEN or not secrets.compare_digest(token, AUTH_TOKEN):
        return jsonify({"success": False, "error": "Authentication failed"}), 401

    resp = make_response(jsonify({"success": True, "redirect": "/"}))

    resp.set_cookie(
        _COOKIE_NAME,
        token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        samesite='Lax',
        path='/'
    )

    resp.set_cookie(
        _MARKER_COOKIE,
        '1',
        max_age=_COOKIE_MAX_AGE,
        httponly=False,
        samesite='Lax',
        path='/'
    )

    return resp

@pages_bp.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    resp = make_response(jsonify({"success": True, "redirect": "/login"}))
    resp.delete_cookie(_COOKIE_NAME, path='/')
    resp.delete_cookie(_MARKER_COOKIE, path='/')
    return resp
