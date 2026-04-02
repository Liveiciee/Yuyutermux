export const API_BASE = '';

export const SERVER_HINT_HTML = '<br><span style="opacity:0.7;font-size:11px">Server-nya nyalakan dulu di terminal 😍</span>';
export const SERVER_HINT_TEXT = '\nServer-nya nyalakan dulu di terminal 😍';

export const esc = (s) => s ? s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : '';

export const api = {
    async request(url, options = {}) {
        try {
            const res = await fetch(API_BASE + url, {
                ...options,
                headers: { 'Content-Type': 'application/json', ...options.headers }
            });
            return { ok: res.ok, status: res.status, data: await res.json() };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    },
    get: (url) => api.request(url),
    post: (url, body) => api.request(url, { method: 'POST', body: JSON.stringify(body) })
};

// ===== ANSI COLOR PARSER =====
const ANSI_CODES = {
    '0': '', '1': 'ansi-bold', '2': 'ansi-dim', '3': 'ansi-italic',
    '4': 'ansi-underline', '30': 'ansi-black', '31': 'ansi-red',
    '32': 'ansi-green', '33': 'ansi-yellow', '34': 'ansi-blue',
    '35': 'ansi-magenta', '36': 'ansi-cyan', '37': 'ansi-white',
    '90': 'ansi-black', '91': 'ansi-red', '92': 'ansi-green',
    '93': 'ansi-yellow', '94': 'ansi-blue', '95': 'ansi-magenta',
    '96': 'ansi-cyan', '97': 'ansi-white'
};

export function parseAnsi(text) {
    if (!text) return '';
    return text.replace(/\x1b\[([0-9;]*)m/g, (match, codes) => {
        return '</span>' + (codes ? `<span class="${codes.split(';').map(c => ANSI_CODES[c] || '').filter(Boolean).join(' ')}">` : '');
    });
}

// ===== FILE TYPE ICONS =====
const FILE_ICONS = {
    py: { icon: '🐍', cls: 'py' },
    js: { icon: '⚡', cls: 'js' },
    ts: { icon: '🔷', cls: 'js' },
    html: { icon: '🌐', cls: 'html' },
    htm: { icon: '🌐', cls: 'html' },
    css: { icon: '🎨', cls: 'css' },
    json: { icon: '📋', cls: 'json' },
    md: { icon: '📝', cls: 'md' },
    txt: { icon: '📄', cls: 'default' },
    sh: { icon: '⚙️', cls: 'sh' },
    yaml: { icon: '⚙️', cls: 'sh' },
    yml: { icon: '⚙️', cls: 'sh' },
    toml: { icon: '⚙️', cls: 'sh' },
    cfg: { icon: '⚙️', cls: 'sh' },
    log: { icon: '📋', cls: 'default' },
    zip: { icon: '📦', cls: 'default' },
    png: { icon: '🖼️', cls: 'default' },
    jpg: { icon: '🖼️', cls: 'default' },
    gitignore: { icon: '🔀', cls: 'default' },
};

export function getFileIcon(name, isDir) {
    if (isDir) return { icon: '📁', cls: 'dir' };
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const noExt = name.startsWith('.') ? name.slice(1) : null;
    return FILE_ICONS[noExt || ext] || FILE_ICONS[ext] || { icon: '📄', cls: 'default' };
}
