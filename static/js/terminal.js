import { api, esc, SERVER_HINT_TEXT } from './api.js';
import { Storage } from './storage.js';

// ===== TOAST SYSTEM =====
const Toast = {
    container: null,

    init() {
        this.container = document.getElementById('toastContainer');
    },

    show(message, type = 'info', duration = 3000) {
        if (!this.container) return;
        const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || 'ℹ'}</span>
            <span>${esc(message)}</span>
        `;
        this.container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('removing');
            toast.addEventListener('animationend', () => toast.remove());
        }, duration);
    }
};

// ===== STATUS BAR =====
const StatusBar = {
    startTime: Date.now(),
    cmdCount: 0,
    timer: null,

    init() {
        // Start session timer
        this.timer = setInterval(() => this.updateTime(), 1000);
        this.updateTime();
        this.checkConnection();
        // Check connection periodically
        setInterval(() => this.checkConnection(), 15000);
    },

    updateTime() {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        const el = document.getElementById('statusTime');
        if (el) el.textContent = `${mins}:${secs}`;
    },

    incrementCmd() {
        this.cmdCount++;
        const el = document.getElementById('statusCmdCount');
        if (el) el.textContent = `${this.cmdCount} cmd${this.cmdCount !== 1 ? 's' : ''}`;
    },

    async checkConnection() {
        const dot = document.getElementById('statusDot');
        const conn = document.getElementById('statusConnection');
        try {
            const res = await fetch('/api/files/list?path=', { method: 'GET', signal: AbortSignal.timeout(3000) });
            if (res.ok) {
                dot.className = 'status-dot connected';
                conn.textContent = 'CONNECTED';
            } else {
                throw new Error();
            }
        } catch {
            dot.className = 'status-dot error';
            conn.textContent = 'OFFLINE';
        }
    }
};

// ===== TERMINAL =====
export const Terminal = {
    area: document.getElementById('outputArea'),
    history: [],
    idx: -1,
    activeCmd: '',
    MAX_ENTRIES: 30,

    add(cmd) {
        this.area.querySelector('.placeholder')?.remove();

        const entry = document.createElement('div');
        entry.className = 'output-entry running';
        entry.innerHTML = `
            <div class="cmd-line">
                <div>
                    <strong>$</strong> ${esc(cmd)}
                    <span class="cmd-spinner" id="spinner-${Date.now()}">
                        <span class="spinner-dots"><span></span><span></span><span></span></span>
                        RUNNING
                    </span>
                </div>
                <span class="cmd-time">${new Date().toLocaleTimeString()}</span>
            </div>
            <pre class="output-content"></pre>
            <div class="hang-warning hidden">
                No output for 10s. Hung process?
                <button class="paper-btn small" style="border-color:var(--warning);color:var(--warning);" onclick="Terminal.kill(this)">KILL</button>
            </div>
            <div class="output-actions hidden">
                <button class="paper-btn small act-copy">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>
                    COPY
                </button>
                <button class="paper-btn small act-del">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
                    DELETE
                </button>
            </div>`;

        const pre = entry.querySelector('.output-content');
        const warning = entry.querySelector('.hang-warning');
        const actions = entry.querySelector('.output-actions');
        const spinner = entry.querySelector('.cmd-spinner');
        let hangTimer = null;
        const controller = new AbortController();

        const stopHangTimer = () => { if (hangTimer) { clearTimeout(hangTimer); hangTimer = null; } };
        const resetHangTimer = () => {
            stopHangTimer();
            warning.classList.add('hidden');
            hangTimer = setTimeout(() => { warning.classList.remove('hidden'); }, 10000);
        };

        const setDone = (success, exitCode) => {
            if (spinner) spinner.remove();
            entry.classList.remove('running');
            entry.classList.add(success ? 'success' : 'error');
            actions.classList.remove('hidden');

            // Add status badge
            const badge = document.createElement('span');
            badge.className = `cmd-status-badge ${success ? 'success' : 'error'}`;
            badge.textContent = success ? `✓ EXIT 0` : `✗ EXIT ${exitCode}`;
            entry.querySelector('.cmd-line > div').appendChild(badge);
        };

        entry.querySelector('.act-copy').onclick = function() {
            navigator.clipboard.writeText(pre.textContent).then(() => {
                this.innerHTML = '<span style="color:var(--success)">✓</span> COPIED';
                setTimeout(() => this.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg> COPY', 1500);
            });
        };
        entry.querySelector('.act-del').onclick = () => { stopHangTimer(); controller.abort(); entry.remove(); };

        this.area.appendChild(entry);
        const entries = this.area.querySelectorAll('.output-entry');
        if (entries.length > this.MAX_ENTRIES) entries[0].remove();
        this.area.scrollTop = this.area.scrollHeight;

        this.history.push(cmd);
        if (this.history.length > 50) this.history.shift();
        resetHangTimer();
        StatusBar.incrementCmd();

        return { pre, resetHangTimer, stopHangTimer, controller, setDone };
    },

    async run() {
        const input = document.getElementById('cmdInput');
        const cmd = input.value.trim();
        if (!cmd) return;

        input.value = '';
        input.style.height = '22px';
        this.activeCmd = cmd;

        const btn = document.getElementById('sendBtn');
        btn.classList.add('streaming');
        btn.disabled = true;
        input.focus();
        this.idx = -1;

        // Update char count
        document.getElementById('inputCharCount').textContent = '0 chars';

        const { pre, resetHangTimer, stopHangTimer, controller, setDone } = this.add(cmd);
        let isError = false;
        let exitCode = 0;

        try {
            const res = await fetch('/api/execute/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd }),
                signal: controller.signal
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                pre.textContent += chunk;
                resetHangTimer();
                this.area.scrollTop = this.area.scrollHeight;
                if (chunk.includes('[ERROR:')) isError = true;
            }

            const text = pre.textContent;
            const exitMatch = text.match(/\[EXIT_CODE:(\d+)\]/);
            if (exitMatch) {
                exitCode = exitMatch[1];
                isError = exitCode !== '0';
            }
            pre.textContent = text.replace(/\[EXIT_CODE:\d+\]\n?/g, '').replace(/\[ERROR:.*?\]\n?/g, '');

        } catch (err) {
            if (err.name === 'AbortError') {
                api.post('/api/execute/kill');
                Toast.show('Process terminated', 'warning');
                return;
            }
            pre.textContent = `STREAM ERROR: ${err.message}`;
            isError = true;
            exitCode = 1;
        } finally {
            stopHangTimer();
            btn.classList.remove('streaming');
            btn.disabled = false;
            Storage.save();
        }

        setDone(!isError, exitCode);
        if (isError) {
            Toast.show(`Command failed (exit ${exitCode})`, 'error');
        }
    },

    async kill(btnEl) {
        btnEl.textContent = 'KILLING...';
        await api.post('/api/execute/kill');
        btnEl.closest('.hang-warning').innerHTML = 'Process terminated';
        Toast.show('Process terminated', 'warning');
    },

    log(message, isError = false) {
        this.area.querySelector('.placeholder')?.remove();
        const entry = document.createElement('div');
        entry.className = `output-entry${isError ? ' error' : ' success'}`;
        entry.innerHTML = `
            <div class="cmd-line">
                <div><strong>$</strong> ${esc(message)}</div>
                <span class="cmd-time">${new Date().toLocaleTimeString()}</span>
            </div>
            <pre class="output-content">${esc(message)}</pre>
            <div class="output-actions">
                <button class="paper-btn small act-copy">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>
                    COPY
                </button>
                <button class="paper-btn small act-del">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
                    DELETE
                </button>
            </div>`;
        entry.querySelector('.act-copy').onclick = function() {
            navigator.clipboard.writeText(this.closest('.output-entry').querySelector('pre').textContent)
                .then(() => { this.innerHTML = '<span style="color:var(--success)">✓</span>'; setTimeout(() => this.innerHTML = 'COPY', 1500); });
        };
        entry.querySelector('.act-del').onclick = () => entry.remove();
        this.area.appendChild(entry);
        const entries = this.area.querySelectorAll('.output-entry');
        if (entries.length > this.MAX_ENTRIES) entries[0].remove();
        this.area.scrollTop = this.area.scrollHeight;
        Storage.save();
    },

    clearAll() {
        const entries = this.area.querySelectorAll('.output-entry');
        if (entries.length === 0) return;
        entries.forEach(e => {
            e.style.transition = 'opacity 0.2s, transform 0.2s';
            e.style.opacity = '0';
            e.style.transform = 'translateY(-4px)';
        });
        setTimeout(() => {
            this.area.innerHTML = `<div class="placeholder">
                <div class="placeholder-icon"><span class="placeholder-cursor">&gt;_</span></div>
                <div class="placeholder-text">READY FOR COMMANDS</div>
                <div class="placeholder-hint">Ctrl+Enter to execute &middot; Extra keys below</div>
            </div>`;
            Toast.show('Terminal cleared', 'info');
        }, 200);
    },

    navUp() {
        if (this.idx < this.history.length - 1) {
            this.idx++;
            document.getElementById('cmdInput').value = this.history[this.history.length - 1 - this.idx];
            document.getElementById('cmdInput').dispatchEvent(new Event('input'));
        }
    },
    navDown() {
        if (this.idx > 0) {
            this.idx--;
            document.getElementById('cmdInput').value = this.history[this.history.length - 1 - this.idx];
            document.getElementById('cmdInput').dispatchEvent(new Event('input'));
        } else if (this.idx === 0) {
            this.idx = -1;
            document.getElementById('cmdInput').value = '';
            document.getElementById('cmdInput').dispatchEvent(new Event('input'));
        }
    }
};

// ===== COMMAND SUGGESTIONS =====
const Suggestions = {
    dropdown: null,
    input: null,
    activeIndex: -1,
    visible: false,

    init() {
        this.dropdown = document.getElementById('suggestionsDropdown');
        this.input = document.getElementById('cmdInput');
        if (!this.dropdown || !this.input) return;

        this.input.addEventListener('input', () => this.update());
        this.input.addEventListener('keydown', (e) => this.handleKey(e));
        this.input.addEventListener('blur', () => {
            setTimeout(() => this.hide(), 150);
        });
    },

    update() {
        const val = this.input.value.trim().toLowerCase();
        if (val.length < 1 || Terminal.history.length === 0) {
            this.hide();
            return;
        }

        const matches = Terminal.history
            .filter((cmd, i, arr) => arr.indexOf(cmd) === i) // unique
            .filter(cmd => cmd.toLowerCase().includes(val))
            .slice(0, 5);

        if (matches.length === 0) { this.hide(); return; }

        this.activeIndex = -1;
        this.dropdown.innerHTML = matches.map((m, i) => `
            <div class="suggestion-item" data-index="${i}" data-value="${esc(m)}">
                ${esc(m)}
                <span class="suggestion-hint">↑↓ enter</span>
            </div>
        `).join('');

        this.dropdown.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.select(item.dataset.value);
            });
        });

        this.show();
    },

    handleKey(e) {
        if (!this.visible) return;
        const items = this.dropdown.querySelectorAll('.suggestion-item');
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.activeIndex = Math.min(this.activeIndex + 1, items.length - 1);
            this.highlight(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.activeIndex = Math.max(this.activeIndex - 1, -1);
            this.highlight(items);
            if (this.activeIndex === -1) Terminal.navUp();
        } else if (e.key === 'Tab') {
            if (this.activeIndex >= 0) {
                e.preventDefault();
                this.select(items[this.activeIndex].dataset.value);
            }
        } else if (e.key === 'Enter' && e.ctrlKey && this.activeIndex >= 0) {
            e.preventDefault();
            this.select(items[this.activeIndex].dataset.value);
        }
    },

    highlight(items) {
        items.forEach((item, i) => {
            item.classList.toggle('active', i === this.activeIndex);
        });
    },

    select(value) {
        this.input.value = value;
        this.input.focus();
        this.hide();
        this.input.dispatchEvent(new Event('input'));
    },

    show() {
        this.dropdown.classList.remove('hidden');
        this.visible = true;
    },

    hide() {
        this.dropdown.classList.add('hidden');
        this.visible = false;
        this.activeIndex = -1;
    }
};

export { Toast, StatusBar, Suggestions };
