export const ModalKeyboard = {
    init() {
        const box = document.getElementById('modalBox');
        const ta = document.getElementById('modalContent');
        if (!box || !ta) return;

        // Kalau fokus ke editor, sembunyin file list (biar ruang editor lega)
        ta.addEventListener('focus', () => {
            box.classList.add('keyboard-open');
        });

        ta.addEventListener('blur', () => {
            setTimeout(() => {
                if (document.activeElement !== ta) {
                    box.classList.remove('keyboard-open');
                }
            }, 200);
        });
    }
};
