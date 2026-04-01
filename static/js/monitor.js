import { api } from './api.js';

export const SystemMonitor = {
    interval: null,
    minimized: false,
    el: null,

    init() {
        this.el = document.getElementById('systemLog');
        this.refresh();
    },

    async refresh() {
        const { ok, data } = await api.get('/api/system/log');
        if (ok && data?.log) {
            this.appendBulk(data.log);
        } else {
            this.log('UI INITIALIZED', 'info');
        }
    },

    appendBulk(text) {
        const frag = document.createDocumentFragment();
        text.split('\n').forEach(line => {
            if (!line.trim()) return;
            let cls = 'log-line info';
            if (line.includes('ERROR')) cls = 'log-line error';
            else if (line.includes('WARNING')) cls = 'log-line warning';
            const div = document.createElement('div');
            div.className = cls;
            div.textContent = line;
            frag.appendChild(div);
        });
        this.el.appendChild(frag);
        this.scrollToBottom();
    },

    log(message, type = 'info') {
        const ts = new Date().toLocaleTimeString();
        let cls = 'log-line info';
        if (type === 'error') cls = 'log-line error';
        else if (type === 'warning') cls = 'log-line warning';
        else if (type === 'success') cls = 'log-line success';
        const div = document.createElement('div');
        div.className = cls;
        div.textContent = `[${ts}] ${message}`;
        this.el.appendChild(div);
        this.scrollToBottom();
    },

    scrollToBottom() {
        this.el.scrollTop = this.el.scrollHeight;
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
    },

    toggle() {
        this.minimized = !this.minimized;
        document.getElementById('systemLog').classList.toggle('hidden', this.minimized);
        document.getElementById('systemMinimal').classList.toggle('hidden', !this.minimized);
        document.getElementById('toggleSystemBtn').textContent = this.minimized ? '[ + ]' : '[ - ]';
    },

    toggleAuto() {
        const btn = document.getElementById('autoRefreshBtn');
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            btn.textContent = '[ AUTO ]';
            btn.classList.remove('primary');
        } else {
            this.refresh();
            this.interval = setInterval(() => this.refresh(), 5000);
            btn.textContent = '[ STOP ]';
            btn.classList.add('primary');
        }
    }
};
