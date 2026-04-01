import { api, esc, SERVER_HINT_TEXT } from './api.js';
import { Storage } from './storage.js';

export const Terminal = {
    area: document.getElementById('outputArea'),
    history: [],
    idx: -1,
    activeCmd: '',
    MAX_ENTRIES: 30,

    add(cmd) {
        this.area.querySelector('.placeholder')?.remove();

        const entry = document.createElement('div');
        entry.className = 'output-entry';
        entry.innerHTML = `
            <div class="cmd-line">
                <span><strong>></strong> ${esc(cmd)}</span>
                <span style="opacity:0.5">${new Date().toLocaleTimeString()}</span>
            </div>
            <pre class="output-content"></pre>
            <div class="hang-warning hidden" style="color:#FACC15;padding:8px;font-family:var(--mono);font-size:12px;border-top:1px dashed var(--border);">
                ⚠️ NO OUTPUT FOR 10s. HUNG PROCESS?
                <button class="paper-btn small" style="margin-left:8px;border-color:#FACC15;color:#FACC15;" onclick="Terminal.kill(this)">[ KILL ]</button>
            </div>
            <div class="output-actions">
                <button class="paper-btn small act-copy">[ COPY RAW LOG ]</button>
                <button class="paper-btn small act-del">[ DEL ]</button>
            </div>`;

        const pre = entry.querySelector('.output-content');
        const warning = entry.querySelector('.hang-warning');
        let hangTimer = null;
        const controller = new AbortController();

        const stopHangTimer = () => { if (hangTimer) { clearTimeout(hangTimer); hangTimer = null; } };
        const resetHangTimer = () => {
            stopHangTimer();
            warning.classList.add('hidden');
            hangTimer = setTimeout(() => { warning.classList.remove('hidden'); }, 10000);
        };

        entry.querySelector('.act-copy').onclick = function() {
            navigator.clipboard.writeText(pre.textContent).then(() => this.textContent = '[ OK ]');
        };
        entry.querySelector('.act-del').onclick = () => { stopHangTimer(); controller.abort(); entry.remove(); };

        this.area.appendChild(entry);
        const entries = this.area.querySelectorAll('.output-entry');
        if (entries.length > this.MAX_ENTRIES) entries[0].remove();
        this.area.scrollTop = this.area.scrollHeight;

        this.history.push(cmd);
        if (this.history.length > 50) this.history.shift();
        resetHangTimer();

        return { pre, resetHangTimer, stopHangTimer, controller };
    },

    async run() {
        const input = document.getElementById('cmdInput');
        const cmd = input.value.trim();
        if (!cmd) return;

        input.value = '';
        input.style.height = '24px';
        this.activeCmd = cmd;

        const btn = document.getElementById('sendBtn');
        btn.textContent = '[ STREAMING ]';
        btn.disabled = true;
        input.focus();
        this.idx = -1;

        const { pre, resetHangTimer, stopHangTimer, controller } = this.add(cmd);
        let isError = false;

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
                const code = exitMatch[1];
                isError = code !== '0';
            }
            pre.textContent = text.replace(/\[EXIT_CODE:\d+\]\n?/g, '').replace(/\[ERROR:.*?\]\n?/g, '');

        } catch (err) {
            if (err.name === 'AbortError') {
                api.post('/api/execute/kill');
                return;
            }
            pre.textContent = `STREAM ERROR: ${err.message}`;
            isError = true;
        } finally {
            stopHangTimer();
            btn.textContent = '[ EXEC ]';
            btn.disabled = false;
            Storage.save();
        }
        if (isError) pre.closest('.output-entry').classList.add('error');
    },

    async kill(btnEl) {
        btnEl.textContent = '[ KILLING... ]';
        await api.post('/api/execute/kill');
        btnEl.closest('.hang-warning').innerHTML = '🛑 PROCESS TERMINATED';
    },

    log(message, isError = false) {
        this.area.querySelector('.placeholder')?.remove();
        const entry = document.createElement('div');
        entry.className = `output-entry${isError ? ' error' : ''}`;
        entry.innerHTML = `
            <div class="cmd-line">
                <span><strong>></strong> ${esc(message)}</span>
                <span style="opacity:0.5">${new Date().toLocaleTimeString()}</span>
            </div>
            <pre class="output-content">${esc(message)}</pre>
            <div class="output-actions">
                <button class="paper-btn small act-copy">[ COPY ]</button>
                <button class="paper-btn small act-del">[ DEL ]</button>
            </div>`;
        entry.querySelector('.act-copy').onclick = function() {
            navigator.clipboard.writeText(this.closest('.output-entry').querySelector('pre').textContent)
                .then(() => this.textContent = '[ OK ]');
        };
        entry.querySelector('.act-del').onclick = () => entry.remove();
        this.area.appendChild(entry);
        const entries = this.area.querySelectorAll('.output-entry');
        if (entries.length > this.MAX_ENTRIES) entries[0].remove();
        this.area.scrollTop = this.area.scrollHeight;
        Storage.save();
    },

    navUp() {
        if (this.idx < this.history.length - 1) {
            this.idx++;
            document.getElementById('cmdInput').value = this.history[this.history.length - 1 - this.idx];
        }
    },
    navDown() {
        if (this.idx > 0) {
            this.idx--;
            document.getElementById('cmdInput').value = this.history[this.history.length - 1 - this.idx];
        } else if (this.idx === 0) {
            this.idx = -1;
            document.getElementById('cmdInput').value = '';
        }
    }
};
