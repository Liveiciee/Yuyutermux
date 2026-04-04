export const ModalKeyboard = {
  _ta: null,
  _box: null,
  _timeoutId: null,
  _boundOnFocus: null,
  _boundOnBlur: null,

  init() {
    this._ta = document.getElementById('modalContent')
    this._box = document.getElementById('modalBox')
    if (!this._ta || !this._box) return

    this._boundOnFocus = this._onFocus.bind(this)
    this._boundOnBlur = this._onBlur.bind(this)
    this._ta.addEventListener('focus', this._boundOnFocus)
    this._ta.addEventListener('blur', this._boundOnBlur)
  },

  _onFocus() {
    if (this._box) this._box.classList.add('keyboard-open')
  },

  _onBlur() {
    if (this._timeoutId) clearTimeout(this._timeoutId)
    this._timeoutId = setTimeout(() => {
      if (this._ta && this._box && document.activeElement !== this._ta) {
        this._box.classList.remove('keyboard-open')
      }
      this._timeoutId = null
    }, 200)
  },

  destroy() {
    if (this._ta) {
      if (this._boundOnFocus) this._ta.removeEventListener('focus', this._boundOnFocus)
      if (this._boundOnBlur) this._ta.removeEventListener('blur', this._boundOnBlur)
    }
    if (this._timeoutId) clearTimeout(this._timeoutId)
    this._ta = null
    this._box = null
    this._boundOnFocus = null
    this._boundOnBlur = null
  }
}