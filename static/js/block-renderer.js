/**
 * block-renderer.js — Renders parsed blocks as interactive form cards.
 * Handles DOM rendering, form syncing, and text reconstruction.
 */

export const BlockRenderer = {
  container: null,

  /**
   * Render all blocks as cards into the given container.
   * @param {Array<Block>} blocks
   * @param {string} language
   * @param {HTMLElement} container
   */
  render(blocks, language, container) {
    this.container = container
    if (!container) return
    container.innerHTML = ''

    for (const block of blocks) {
      const card = this._createCard(block, language)
      container.appendChild(card)
    }
  },

  /**
   * Read all form inputs back into block.content, mark dirty blocks.
   * @param {Array<Block>} blocks
   */
  syncFromDOM(blocks) {
    if (!this.container) return

    for (const block of blocks) {
      const card = this.container.querySelector(`[data-block-id="${block.id}"]`)
      if (!card) continue

      const type = block.type
      const body = card.querySelector('.block-card-body')

      switch (type) {
        case 'import':
          block.content.line = body.querySelector('.block-input')?.value || ''
          block._dirty = true
          break

        case 'export':
          block.content.line = body.querySelector('.block-input')?.value || ''
          block._dirty = true
          break

        case 'function': {
          if (block.language === 'python') {
            block.content.name = body.querySelector('[data-field="name"]')?.value || ''
            block.content.params = (body.querySelector('[data-field="params"]')?.value || '').split(',').map(s => s.trim()).filter(Boolean)
            block.content.decorators = (body.querySelector('[data-field="decorators"]')?.value || '').split(',').map(s => s.trim()).filter(Boolean)
            block.content.body = body.querySelector('.block-body')?.value || ''
          } else {
            block.content.name = body.querySelector('[data-field="name"]')?.value || ''
            block.content.params = (body.querySelector('[data-field="params"]')?.value || '').split(',').map(s => s.trim()).filter(Boolean)
            block.content.async = body.querySelector('[data-field="async"]')?.checked || false
            block.content.body = body.querySelector('.block-body')?.value || ''
          }
          block._dirty = true
          break
        }

        case 'class': {
          block.content.name = body.querySelector('[data-field="name"]')?.value || ''
          block.content.inherits = body.querySelector('[data-field="inherits"]')?.value || ''
          block.content.body = body.querySelector('.block-body')?.value || ''
          block._dirty = true
          break
        }

        case 'variable': {
          if (block.language === 'javascript') {
            block.content.kind = body.querySelector('[data-field="kind"]')?.value || 'const'
            block.content.name = body.querySelector('[data-field="name"]')?.value || ''
            block.content.value = body.querySelector('[data-field="value"]')?.value || ''
          } else if (block.language === 'css') {
            block.content.name = body.querySelector('[data-field="name"]')?.value || ''
            block.content.value = body.querySelector('[data-field="value"]')?.value || ''
          }
          block._dirty = true
          break
        }

        case 'rule': {
          block.content.selector = body.querySelector('[data-field="selector"]')?.value || ''
          const propRows = body.querySelectorAll('.block-prop-row')
          block.content.properties = []
          propRows.forEach(row => {
            const name = row.querySelector('[data-field="prop-name"]')?.value || ''
            const value = row.querySelector('[data-field="prop-value"]')?.value || ''
            if (name) block.content.properties.push({ name, value })
          })
          block._dirty = true
          break
        }

        case 'media':
        case 'keyframes':
        case 'raw_text':
          block.content.body = body.querySelector('.block-body')?.value || ''
          if (type === 'raw_text') {
            block.content.text = block.content.body
          }
          block._dirty = true
          break
      }
    }
  },

  /**
   * Convert blocks array back to source text string.
   * @param {Array<Block>} blocks
   * @returns {string}
   */
  blocksToText(blocks) {
    const parts = []

    for (const block of blocks) {
      let text
      if (block._dirty === false) {
        text = block._raw
      } else {
        text = this._generateFromContent(block)
      }

      parts.push(text)
    }

    // Join with newlines and trim trailing whitespace
    let result = parts.join('\n')
    return result.trimEnd()
  },

  /* ── Card creation ────────────────────────────────────────── */

  _createCard(block, language) {
    const card = document.createElement('div')
    card.className = 'block-card'
    card.dataset.blockId = block.id
    card.dataset.type = block.type

    const typeLabels = {
      import: 'IMPORT',
      export: 'EXPORT',
      function: 'FUNCTION',
      class: 'CLASS',
      variable: 'VARIABLE',
      rule: 'RULE',
      media: 'MEDIA',
      keyframes: 'KEYFRAMES',
      raw_text: 'RAW'
    }

    // Header
    const header = document.createElement('div')
    header.className = 'block-card-header'

    const label = document.createElement('span')
    label.className = 'block-type-label'
    label.textContent = typeLabels[block.type] || block.type.toUpperCase()

    const collapseBtn = document.createElement('button')
    collapseBtn.className = 'block-card-collapse paper-btn small ghost'
    collapseBtn.textContent = '−'
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      card.classList.toggle('collapsed')
      collapseBtn.textContent = card.classList.contains('collapsed') ? '+' : '−'
    })

    header.appendChild(label)
    header.appendChild(collapseBtn)
    card.appendChild(header)

    // Body
    const bodyEl = document.createElement('div')
    bodyEl.className = 'block-card-body'

    this._renderCardBody(bodyEl, block)

    card.appendChild(bodyEl)

    // Mark dirty on any input event
    bodyEl.addEventListener('input', () => {
      block._dirty = true
    }, { passive: true })

    return card
  },

  _renderCardBody(body, block) {
    switch (block.type) {
      case 'import':
        this._renderImportCard(body, block)
        break
      case 'export':
        this._renderExportCard(body, block)
        break
      case 'function':
        if (block.language === 'python') {
          this._renderPythonFunctionCard(body, block)
        } else {
          this._renderJSFunctionCard(body, block)
        }
        break
      case 'class':
        this._renderClassCard(body, block)
        break
      case 'variable':
        if (block.language === 'javascript') {
          this._renderJSVariableCard(body, block)
        } else if (block.language === 'css') {
          this._renderCSSVariableCard(body, block)
        }
        break
      case 'rule':
        this._renderCSSRuleCard(body, block)
        break
      case 'media':
      case 'keyframes':
      case 'raw_text':
      default:
        this._renderRawTextCard(body, block)
        break
    }
  },

  /* ── Python cards ────────────────────────────────────────── */

  _renderImportCard(body, block) {
    body.innerHTML = `
      <div class="block-field">
        <label class="block-field-label">Line</label>
        <input class="block-input" value="${this._escAttr(block.content.line)}">
      </div>
    `
  },

  _renderPythonFunctionCard(body, block) {
    const c = block.content
    body.innerHTML = `
      <div class="block-field">
        <label class="block-field-label">Decorators</label>
        <input class="block-input" data-field="decorators" value="${this._escAttr(c.decorators.join(', '))}">
      </div>
      <div class="block-field">
        <label class="block-field-label">Name</label>
        <input class="block-input" data-field="name" value="${this._escAttr(c.name)}">
      </div>
      <div class="block-field">
        <label class="block-field-label">Parameters</label>
        <input class="block-input" data-field="params" value="${this._escAttr(c.params.join(', '))}">
      </div>
      <div class="block-field">
        <label class="block-field-label">Body</label>
        <textarea class="block-input block-body" spellcheck="false">${this._escHTML(c.body)}</textarea>
      </div>
    `
  },

  _renderClassCard(body, block) {
    const c = block.content
    body.innerHTML = `
      <div class="block-field">
        <label class="block-field-label">Name</label>
        <input class="block-input" data-field="name" value="${this._escAttr(c.name)}">
      </div>
      <div class="block-field">
        <label class="block-field-label">Inherits</label>
        <input class="block-input" data-field="inherits" value="${this._escAttr(c.inherits)}">
      </div>
      <div class="block-field">
        <label class="block-field-label">Body</label>
        <textarea class="block-input block-body" spellcheck="false">${this._escHTML(c.body)}</textarea>
      </div>
    `
  },

  /* ── JavaScript cards ────────────────────────────────────── */

  _renderExportCard(body, block) {
    body.innerHTML = `
      <div class="block-field">
        <label class="block-field-label">Line</label>
        <input class="block-input" value="${this._escAttr(block.content.line)}">
      </div>
    `
  },

  _renderJSFunctionCard(body, block) {
    const c = block.content
    body.innerHTML = `
      <div class="block-field" style="flex-direction:row;align-items:center;gap:8px">
        <label class="block-field-label" style="margin:0">Async</label>
        <input type="checkbox" data-field="async" ${c.async ? 'checked' : ''} style="width:auto">
      </div>
      <div class="block-field">
        <label class="block-field-label">Name</label>
        <input class="block-input" data-field="name" value="${this._escAttr(c.name)}">
      </div>
      <div class="block-field">
        <label class="block-field-label">Parameters</label>
        <input class="block-input" data-field="params" value="${this._escAttr(c.params.join(', '))}">
      </div>
      <div class="block-field">
        <label class="block-field-label">Body</label>
        <textarea class="block-input block-body" spellcheck="false">${this._escHTML(c.body)}</textarea>
      </div>
    `
  },

  _renderJSVariableCard(body, block) {
    const c = block.content
    body.innerHTML = `
      <div class="block-field">
        <label class="block-field-label">Kind</label>
        <select class="block-input" data-field="kind">
          <option value="const" ${c.kind === 'const' ? 'selected' : ''}>const</option>
          <option value="let" ${c.kind === 'let' ? 'selected' : ''}>let</option>
          <option value="var" ${c.kind === 'var' ? 'selected' : ''}>var</option>
        </select>
      </div>
      <div class="block-field">
        <label class="block-field-label">Name</label>
        <input class="block-input" data-field="name" value="${this._escAttr(c.name)}">
      </div>
      <div class="block-field">
        <label class="block-field-label">Value</label>
        <input class="block-input" data-field="value" value="${this._escAttr(c.value)}">
      </div>
    `
  },

  /* ── CSS cards ───────────────────────────────────────────── */

  _renderCSSRuleCard(body, block) {
    const c = block.content
    const propsHTML = c.properties.map((p, i) => `
      <div class="block-prop-row">
        <input class="block-input" data-field="prop-name" value="${this._escAttr(p.name)}" placeholder="property">
        <input class="block-input" data-field="prop-value" value="${this._escAttr(p.value)}" placeholder="value">
        <button class="block-prop-del paper-btn small ghost" data-del-idx="${i}" title="Remove">&times;</button>
      </div>
    `).join('')

    body.innerHTML = `
      <div class="block-field">
        <label class="block-field-label">Selector</label>
        <input class="block-input" data-field="selector" value="${this._escAttr(c.selector)}">
      </div>
      <div class="block-field">
        <label class="block-field-label">Properties</label>
        <div class="block-props-list">
          ${propsHTML}
        </div>
      </div>
      <button class="paper-btn small block-prop-add" data-action="add-prop">+ Add Property</button>
    `

    // Bind add/remove property buttons
    const propsList = body.querySelector('.block-props-list')

    body.querySelector('[data-action="add-prop"]').addEventListener('click', () => {
      const row = document.createElement('div')
      row.className = 'block-prop-row'
      row.innerHTML = `
        <input class="block-input" data-field="prop-name" value="" placeholder="property">
        <input class="block-input" data-field="prop-value" value="" placeholder="value">
        <button class="block-prop-del paper-btn small ghost" title="Remove">&times;</button>
      `
      row.querySelector('.block-prop-del').addEventListener('click', function () {
        row.remove()
      })
      propsList.appendChild(row)
      // Dispatch input event to mark dirty
      body.dispatchEvent(new Event('input', { bubbles: true }))
    })

    propsList.querySelectorAll('.block-prop-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.block-prop-row')
        if (row) row.remove()
        body.dispatchEvent(new Event('input', { bubbles: true }))
      })
    })
  },

  _renderCSSVariableCard(body, block) {
    const c = block.content
    body.innerHTML = `
      <div class="block-field">
        <label class="block-field-label">Name</label>
        <input class="block-input" data-field="name" value="${this._escAttr(c.name)}">
      </div>
      <div class="block-field">
        <label class="block-field-label">Value</label>
        <input class="block-input" data-field="value" value="${this._escAttr(c.value)}">
      </div>
    `
  },

  /* ── Raw text / media / keyframes ────────────────────────── */

  _renderRawTextCard(body, block) {
    const text = block.type === 'raw_text' ? (block.content.text || '') : (block.content.body || '')
    body.innerHTML = `
      <span class="block-raw-label">Raw text — edit freely</span>
      <textarea class="block-input block-body" spellcheck="false">${this._escHTML(text)}</textarea>
    `
  },

  /* ── Text generation from content ────────────────────────── */

  _generateFromContent(block) {
    const c = block.content

    switch (block.type) {
      case 'import':
        return c.line || ''

      case 'export':
        return c.line || ''

      case 'function': {
        if (block.language === 'python') {
          let lines = ''
          if (c.decorators && c.decorators.length > 0) {
            lines += c.decorators.join('\n') + '\n'
          }
          lines += `def ${c.name || 'unnamed'}(${(c.params || []).join(', ')}):`
          if (c.body) {
            lines += '\n' + c.body
          }
          return lines
        } else {
          const asyncStr = c.async ? 'async ' : ''
          const paramsStr = (c.params || []).join(', ')
          if (c.arrow) {
            let result = `${asyncStr}${c.name || 'unnamed'} = (${paramsStr}) =>`
            if (c.body) {
              // Check if the body looks like a single-line expression (no braces, no newlines)
              const bodyTrimmed = c.body.trim()
              if (!bodyTrimmed.includes('\n') && !bodyTrimmed.startsWith('{')) {
                result += ' ' + bodyTrimmed
              } else {
                result += ' {\n' + bodyTrimmed + '\n}'
              }
            }
            return result
          } else {
            let result = `${asyncStr}function ${c.name || 'unnamed'}(${paramsStr}) {`
            if (c.body) {
              result += '\n' + c.body + '\n}'
            } else {
              result += '}'
            }
            return result
          }
        }
      }

      case 'class': {
        const inheritsStr = c.inherits ? `(${c.inherits})` : ''
        let result = `class ${c.name || 'unnamed'}${inheritsStr}:`
        if (c.body) {
          result += '\n' + c.body
        }
        return result
      }

      case 'variable': {
        if (block.language === 'javascript') {
          return `${c.kind || 'const'} ${c.name || ''} = ${c.value || ''}`
        } else if (block.language === 'css') {
          return `  ${c.name || '--var'}: ${c.value || ''};`
        }
        return ''
      }

      case 'rule': {
        const props = (c.properties || []).map(p => `  ${p.name}: ${p.value};`).join('\n')
        return `${c.selector || '.selector'} {\n${props}\n}`
      }

      case 'media':
        return `${c.query || '@media'} {\n${c.body || ''}\n}`

      case 'keyframes':
        return `@keyframes ${c.name || 'name'} {\n${c.body || ''}\n}`

      case 'raw_text':
        return c.text || c.body || ''

      default:
        return c.text || ''
    }
  },

  /* ── Utility ─────────────────────────────────────────────── */

  _escAttr(str) {
    if (!str) return ''
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  },

  _escHTML(str) {
    if (!str) return ''
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
}
