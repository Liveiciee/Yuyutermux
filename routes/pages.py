import secrets
from flask import Blueprint, render_template, redirect, request, make_response
from utils import AUTH_TOKEN, check_auth

pages_bp = Blueprint('pages', __name__)

_COOKIE_NAME = 'yuyu_token'
_COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


def _page_guard():
    """Redirect to /login if no valid cookie for page routes."""
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
def auth_login():
    data = request.get_json(silent=True) or {}
    token = (data.get('token') or '').strip()

    if not token:
        return redirect('/login?error=Token+tidak+boleh+kosong')

    if not AUTH_TOKEN or not secrets.compare_digest(token, AUTH_TOKEN):
        return redirect('/login?error=Token+salah+%E2%80%94+cek+terminal+Termux')

    resp = make_response(redirect('/'))
    resp.set_cookie(
        _COOKIE_NAME,
        token,
        max_age=_COOKIE_MAX_AGE,
        httponly=False,
        samesite='Strict',
        path='/'
    )
    return resp


@pages_bp.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    resp = make_response(redirect('/login'))
    resp.delete_cookie(_COOKIE_NAME, path='/')
    return resp
