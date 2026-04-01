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
