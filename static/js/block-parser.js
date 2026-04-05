/**
 * block-parser.js — Regex-based source code parser for Block Mode Editor.
 * No AST, no eval, zero build step — pure regex line-by-line parsing.
 *
 * Roundtrip: blocksToText(blocks) === original content for unmodified blocks.
 *
 * CSS blank-line model matches Python:
 *   • Rule _raw has NO trailing \n (same as Python line split strips \n)
 *   • After each rule: skip first \n (line-ending), count remaining \n → blank lines
 *   • 1 blank line → raw_text _raw=''  (blocksToText adds \n → gives \n\n = blank line)
 *   • 2 blank lines → raw_text _raw='\n' etc.
 */

let _uid = 0
function mkid() { return `block_${Date.now()}_${_uid++}` }
function mkblock(type, language, content, raw) {
  return { id: mkid(), type, language, content, _raw: raw, _dirty: false }
}

export function parseToBlocks(content, language) {
  if (!content) return []
  switch (language) {
    case 'python':     return parsePython(content)
    case 'javascript': return parseJavaScript(content)
    case 'css':        return parseCSS(content)
    default:
      return [mkblock('raw_text', language, { text: content }, content)]
  }
}

/* ══════════════════════════════════════════════════════════════════
   PYTHON PARSER
   ══════════════════════════════════════════════════════════════════ */

function parsePython(content) {
  const lines = content.split('\n')
  const blocks = []
  let i = 0

  const isIndented = (l) => /^\s/.test(l)

  function collectBody(startI) {
    const body = []
    let j = startI
    while (j < lines.length) {
      const l = lines[j]
      if (l.trim() === '') {
        // Keep blank lines only if next line is still indented (part of body)
        if (j + 1 < lines.length && isIndented(lines[j + 1])) {
          body.push(l); j++
        } else break
      } else if (isIndented(l)) {
        body.push(l); j++
      } else break
    }
    return { body, nextI: j }
  }

  while (i < lines.length) {
    const line = lines[i]

    // Blank lines → raw_text (same as Python's model, _raw = '' for 1 blank line)
    if (line.trim() === '') {
      const start = i
      while (i < lines.length && lines[i].trim() === '') i++
      const raw = lines.slice(start, i).join('\n')
      blocks.push(mkblock('raw_text', 'python', { text: raw }, raw))
      continue
    }

    // Import
    if (/^(import |from \S+ import)/.test(line)) {
      blocks.push(mkblock('import', 'python', { line }, line))
      i++; continue
    }

    // Decorator(s) — look AHEAD for def
    if (/^@/.test(line) && !isIndented(line)) {
      const decLines = []
      while (i < lines.length && /^@/.test(lines[i]) && !isIndented(lines[i])) {
        decLines.push(lines[i]); i++
      }
      if (i < lines.length && /^def\s/.test(lines[i])) {
        const defLine = lines[i]; i++
        const { body, nextI } = collectBody(i); i = nextI
        const raw = [...decLines, defLine, ...body].join('\n')
        const m = defLine.match(/^def\s+(\w+)\s*\(([^)]*)/)
        blocks.push(mkblock('function', 'python', {
          decorators: decLines.map(l => l.trim()),
          name: m ? m[1] : '',
          params: m && m[2] ? m[2].split(',').map(p => p.trim()).filter(Boolean) : [],
          body: body.join('\n')
        }, raw))
      } else {
        blocks.push(mkblock('raw_text', 'python', { text: decLines.join('\n') }, decLines.join('\n')))
      }
      continue
    }

    // Function (no decorators)
    if (/^def\s/.test(line)) {
      i++
      const { body, nextI } = collectBody(i); i = nextI
      const raw = [line, ...body].join('\n')
      const m = line.match(/^def\s+(\w+)\s*\(([^)]*)/)
      blocks.push(mkblock('function', 'python', {
        decorators: [],
        name: m ? m[1] : '',
        params: m && m[2] ? m[2].split(',').map(p => p.trim()).filter(Boolean) : [],
        body: body.join('\n')
      }, raw))
      continue
    }

    // Class
    if (/^class\s/.test(line)) {
      i++
      const { body, nextI } = collectBody(i); i = nextI
      const raw = [line, ...body].join('\n')
      const m = line.match(/^class\s+(\w+)(?:\(([^)]*))?/)
      blocks.push(mkblock('class', 'python', {
        name: m ? m[1] : '',
        inherits: m && m[2] ? m[2].replace(/\).*/, '') : '',
        body: body.join('\n')
      }, raw))
      continue
    }

    // Raw text fallback
    const rawLines = [line]; i++
    while (i < lines.length) {
      const l = lines[i]
      if (l.trim() === '') break
      if (!isIndented(l) && /^(import |from \S+ import|@|def\s|class\s)/.test(l)) break
      rawLines.push(l); i++
    }
    blocks.push(mkblock('raw_text', 'python', { text: rawLines.join('\n') }, rawLines.join('\n')))
  }

  return blocks
}

/* ══════════════════════════════════════════════════════════════════
   JAVASCRIPT PARSER
   ══════════════════════════════════════════════════════════════════ */

function parseJavaScript(content) {
  const lines = content.split('\n')
  const blocks = []
  let i = 0

  function collectBraceBody(firstLine, startI) {
    let depth = (firstLine.match(/{/g)||[]).length - (firstLine.match(/}/g)||[]).length
    const bl = []; let j = startI
    while (j < lines.length && depth > 0) {
      bl.push(lines[j])
      depth += (lines[j].match(/{/g)||[]).length - (lines[j].match(/}/g)||[]).length
      j++
    }
    return { bodyLines: bl, nextI: j }
  }

  while (i < lines.length) {
    const line = lines[i]

    // Blank lines
    if (line.trim() === '') {
      const start = i
      while (i < lines.length && lines[i].trim() === '') i++
      const raw = lines.slice(start, i).join('\n')
      blocks.push(mkblock('raw_text', 'javascript', { text: raw }, raw))
      continue
    }

    // Import
    if (/^import\s/.test(line)) {
      blocks.push(mkblock('import', 'javascript', { line }, line))
      i++; continue
    }

    // Single-line export (not a declaration)
    if (/^export\s/.test(line) && !/^export\s+(default\s+)?(async\s+)?(function|const|let|var)\s/.test(line)) {
      blocks.push(mkblock('export', 'javascript', { line }, line))
      i++; continue
    }

    // Function patterns
    const fd = line.match(/^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)/)
    const fe = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\s*\(([^)]*)/)
    const fa = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>(.*)/)
    const fo = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(\w+)\s*=>(.*)/)

    if (fd || fe || fa || fo) {
      const isAsync = /\basync\b/.test(line)
      const isArrow = !!(fa || fo)
      let name = '', params = []
      if (fd)      { name = fd[1]; params = fd[2].split(',').map(p=>p.trim()).filter(Boolean) }
      else if (fe) { name = fe[1]; params = fe[2].split(',').map(p=>p.trim()).filter(Boolean) }
      else if (fa) { name = fa[1]; params = fa[2].split(',').map(p=>p.trim()).filter(Boolean) }
      else if (fo) { name = fo[1]; params = [fo[2]].filter(Boolean) }

      if (line.includes('{')) {
        const { bodyLines, nextI } = collectBraceBody(line, i + 1)
        i = nextI
        const raw = [line, ...bodyLines].join('\n')
        const innerLines = bodyLines.slice(0, -1)
        blocks.push(mkblock('function', 'javascript',
          { name, params, body: innerLines.join('\n'), async: isAsync, arrow: isArrow }, raw))
      } else {
        // Single-line arrow: const f = x => expr
        const expr = (fa ? fa[3] : fo ? fo[3] : '').trim().replace(/;$/, '')
        blocks.push(mkblock('function', 'javascript',
          { name, params, body: expr, async: isAsync, arrow: isArrow }, line))
        i++
      }
      continue
    }

    // Single-line variable
    const vm = line.match(/^(?:export\s+)?(const|let|var)\s+(\w+)\s*=\s*(.+)$/)
    if (vm) {
      const val = vm[3].trim()
      const opens  = (val.match(/{|\[|\(/g)||[]).length
      const closes = (val.match(/}|\]|\)/g)||[]).length
      if (opens === closes) {
        blocks.push(mkblock('variable', 'javascript',
          { kind: vm[1], name: vm[2], value: val.replace(/;$/, '') }, line))
        i++; continue
      }
    }

    // Raw text fallback
    const rawLines = [line]; i++
    while (i < lines.length) {
      const l = lines[i]
      if (l.trim() === '') break
      if (/^(import\s|export\s|const\s|let\s|var\s|function\s|async\s+function\s)/.test(l)) break
      rawLines.push(l); i++
    }
    blocks.push(mkblock('raw_text', 'javascript', { text: rawLines.join('\n') }, rawLines.join('\n')))
  }

  return blocks
}

/* ══════════════════════════════════════════════════════════════════
   CSS PARSER
   ══════════════════════════════════════════════════════════════════
   Blank-line model (mirrors Python line-based model):
   • Rule _raw does NOT include trailing \n (like Python split strips \n)
   • After rule: skip first \n (line-ending); count remaining \n = blank lines
   • N blank lines → raw_text _raw = '\n'.repeat(N-1)
     (blocksToText adds its own \n → N total = correct blank lines)
   ══════════════════════════════════════════════════════════════════ */

function parseCSS(content) {
  const blocks = []
  const len = content.length
  let pos = 0

  // Handle optional leading whitespace/blank lines before first rule
  const leadWsEnd = content.search(/\S/)
  if (leadWsEnd > 0) {
    const leadWs = content.slice(0, leadWsEnd)
    // Convert to same model: count newlines
    const newlines = (leadWs.match(/\n/g) || []).length
    if (newlines > 1) {
      blocks.push(mkblock('raw_text', 'css', { text: '\n'.repeat(newlines - 1) }, '\n'.repeat(newlines - 1)))
    }
    pos = leadWsEnd
  }

  while (pos < len) {
    const braceStart = content.indexOf('{', pos)
    if (braceStart === -1) {
      const rest = content.slice(pos).trimEnd()
      if (rest) blocks.push(mkblock('raw_text', 'css', { text: rest }, rest))
      break
    }

    const prefix = content.slice(pos, braceStart).trim()
    if (!prefix) { pos = braceStart + 1; continue }

    // Find matching }
    let depth = 1, cur = braceStart + 1
    while (cur < len && depth > 0) {
      if (content[cur] === '{') depth++
      else if (content[cur] === '}') depth--
      cur++
    }
    // cur is now right after '}'  (cur-1 = position of '}')

    const innerContent = content.slice(braceStart + 1, cur - 1)
    const fullBlock = content.slice(pos, cur)  // selector + { body } (no trailing \n)

    // Skip first \n after } (the line-ending, not counted as blank line)
    if (cur < len && content[cur] === '\n') cur++

    // Count remaining \n = blank lines between rules
    const blankStart = cur
    while (cur < len && content[cur] === '\n') cur++
    const blankCount = cur - blankStart
    pos = cur

    // Create the rule block
    if (/^@media\b/.test(prefix)) {
      blocks.push(mkblock('media', 'css', { query: prefix, body: innerContent }, fullBlock))
    } else if (/^@keyframes\b/.test(prefix)) {
      const nm = prefix.match(/@keyframes\s+(\S+)/)
      blocks.push(mkblock('keyframes', 'css', { name: nm ? nm[1] : prefix, body: innerContent }, fullBlock))
    } else if (/^:root\b/.test(prefix)) {
      // Keep :root as ONE block to preserve roundtrip
      blocks.push(mkblock('root_vars', 'css', { properties: parseCSSProperties(innerContent) }, fullBlock))
    } else if (prefix) {
      blocks.push(mkblock('rule', 'css', { selector: prefix, properties: parseCSSProperties(innerContent) }, fullBlock))
    } else {
      blocks.push(mkblock('raw_text', 'css', { text: fullBlock }, fullBlock))
    }

    // Add blank-line separator blocks (same model as Python)
    // N blank lines → _raw = '\n'.repeat(N-1) (blocksToText adds 1 \n → N total)
    if (blankCount > 0) {
      const wsRaw = '\n'.repeat(blankCount - 1)
      blocks.push(mkblock('raw_text', 'css', { text: wsRaw }, wsRaw))
    }
  }

  return blocks
}
function parseCSSProperties(content) {
  const cleaned = content.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  return cleaned.split('\n')
    .map(l => l.trim())
    .filter(t => t && t.includes(':'))
    .map(t => {
      const ci = t.indexOf(':')
      if (ci < 1) return null
      return {
        name: t.slice(0, ci).trim(),
        value: t.slice(ci + 1).replace(/;$/, '').trim()
      }
    })
    .filter(Boolean)
}
