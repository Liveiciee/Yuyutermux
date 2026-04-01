export const ViewportFix = {
    init() {
        if ('virtualKeyboard' in navigator) navigator.virtualKeyboard.overlaysContent = false;
        const update = () => {
            const h = window.visualViewport?.height ?? window.innerHeight;
            document.documentElement.style.setProperty('--vvh', `${Math.round(h)}px`);
        };
        update();
        window.visualViewport?.addEventListener('resize', update);
        window.addEventListener('resize', update);
    }
};
