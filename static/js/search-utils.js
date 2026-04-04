export function buildHighlightPattern(query, caseSensitive) {
  const flags = caseSensitive ? 'g' : 'gi'
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped, flags)
}

// Escape HTML, but preserve <mark> tags
function escapeHtmlPreservingMarks(text) {
  return text.replace(/[&<>"']/g, (c) => {
    if (c === '<') return '&lt;'
    if (c === '>') return '&gt;'
    if (c === '&') return '&amp;'
    if (c === '"') return '&quot;'
    if (c === "'") return '&#39;'
    return c
  })
}

export function highlightMatch(text, query, caseSensitive) {
  if (!text || !query) return escapeHtmlPreservingMarks(String(text))
  
  const pattern = buildHighlightPattern(query, caseSensitive)
  // Split raw text into matched parts and non-matched parts
  const parts = []
  let lastIndex = 0
  let match
  
  // Reset regex lastIndex
  pattern.lastIndex = 0
  while ((match = pattern.exec(text)) !== null) {
    // Add text before match (unescaped)
    if (match.index > lastIndex) {
      parts.push(escapeHtmlPreservingMarks(text.substring(lastIndex, match.index)))
    }
    // Add matched text wrapped in <mark> (but still need to escape inside the matched text)
    parts.push(`<mark>${escapeHtmlPreservingMarks(match[0])}</mark>`)
    lastIndex = pattern.lastIndex
  }
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(escapeHtmlPreservingMarks(text.substring(lastIndex)))
  }
  
  return parts.join('')
}

export function escapeHtml(s) {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  }[c]))
}