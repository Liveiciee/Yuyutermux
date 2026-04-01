export const Editor = {
    ta: null,
    gutter: null,

    init() {
        this.ta = document.getElementById('modalContent');
        this.gutter = document.getElementById('lineNumbers');
        if (!this.ta || !this.gutter) return;

        this.ta.addEventListener('input', () => this.updateGutter());
        this.ta.addEventListener('scroll', () => this.syncScroll());
        this.ta.addEventListener('keydown', (e) => this.handleKeys(e));
        
        this.updateGutter();
    },

    updateGutter() {
        const lines = this.ta.value.split('\n').length;
        let html = '';
        for (let i = 1; i <= lines; i++) {
            html += i + '\n';
        }
        this.gutter.textContent = html;
    },

    syncScroll() {
        this.gutter.scrollTop = this.ta.scrollTop;
    },

    handleKeys(e) {
        // Tab support (masukin 4 spasi)
        if (e.key === 'Tab') {
            e.preventDefault();
            this.insertAtCursor('    ');
        }
        
        // Auto-indent on Enter
        if (e.key === 'Enter') {
            e.preventDefault();
            const start = this.ta.selectionStart;
            const val = this.ta.value;
            
            // Cari baris sekarang
            const lineStart = val.lastIndexOf('\n', start - 1) + 1;
            const currentLine = val.substring(lineStart, start);
            
            // Ambil indent/spasi awal baris ini
            const indent = currentLine.match(/^\s*/)[0];
            
            // Khusus Python: kalau baris diakhiri ':' (def, if, for, class, dll), tambah indent
            const extraIndent = currentLine.trimEnd().endsWith(':') ? '    ' : '';
            
            this.insertAtCursor('\n' + indent + extraIndent);
        }
    },

    insertAtCursor(text) {
        const start = this.ta.selectionStart;
        const end = this.ta.selectionEnd;
        this.ta.value = this.ta.value.substring(0, start) + text + this.ta.value.substring(end);
        this.ta.selectionStart = this.ta.selectionEnd = start + text.length;
        this.updateGutter();
    },

    // Dipanggil pas file baru di-load
    onLoad() {
        this.updateGutter();
        // Reset scroll posisi
        this.ta.scrollTop = 0;
        this.gutter.scrollTop = 0;
    }
};
