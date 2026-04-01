/**
 * Pure Functions untuk Global Search
 * NO DOM, NO CSS VARIABLES, NO SIDE EFFECTS
 * Bisa di-test di Node.js tanpa browser.
 */

export function buildHighlightPattern(query, caseSensitive) {
    const flags = caseSensitive ? 'g' : 'gi';
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, flags);
}

export function highlightMatch(text, query, caseSensitive) {
    const safe = escapeHtml(text);
    const pattern = buildHighlightPattern(query, caseSensitive);
    return safe.replace(pattern, match => 
        `<mark>${match}</mark>`
    );
}

export function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Bonus: Kalau suatu saat mau test di terminal
// node -e "import('./search-utils.js').then(m => console.log(m.highlightMatch('<script>', 'script', false)))"
