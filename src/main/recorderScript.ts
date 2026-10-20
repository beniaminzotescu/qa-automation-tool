// Runs inside every page of the live browser (added with addInitScript). It reports what happens
// (clicks, typing, choices, Enter) with a description of each element, through the
// window.__qaRecord binding. In check mode, a click chooses the element to check and does not
// reach the page. It is plain JavaScript text so the bundler can't change it.
//
// The main process sets the mode with window.__qaSetMode('record' | 'check-text' | 'check-visible'),
// and who is acting with window.__qaSetActor('user' | 'claude'): Claude's clicks and typing get a short
// highlight, so the tester can follow what Claude does.

export const RECORDER_SCRIPT = String.raw`
(() => {
  if (window.__qaRecorderInstalled) return
  window.__qaRecorderInstalled = true

  let mode = 'record'
  let actor = 'user'
  let highlight = null

  const send = (event) => {
    if (typeof window.__qaRecord === 'function') window.__qaRecord(event).catch(() => {})
  }

  window.__qaSetMode = (next) => {
    mode = next
    if (mode === 'record') hideHighlight()
  }

  window.__qaSetActor = (next) => {
    actor = next
  }

  // A short outline around what Claude just used.
  const flash = (el) => {
    const rect = el.getBoundingClientRect()
    const box = document.createElement('div')
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      left: rect.left - 3 + 'px',
      top: rect.top - 3 + 'px',
      width: rect.width + 6 + 'px',
      height: rect.height + 6 + 'px',
      border: '3px solid #d97706',
      borderRadius: '4px',
      boxShadow: '0 0 0 4px rgba(217, 119, 6, 0.25)',
      transition: 'opacity 0.6s'
    })
    document.documentElement.appendChild(box)
    setTimeout(() => (box.style.opacity = '0'), 700)
    setTimeout(() => box.remove(), 1400)
  }

  // --- Element descriptions ---------------------------------------------------------

  const INTERACTIVE = 'button, a[href], input, select, textarea, label, summary, [role], [onclick], [contenteditable="true"]'

  const actionTarget = (target) => target.closest(INTERACTIVE) || target

  const implicitRole = (el) => {
    const tag = el.tagName.toLowerCase()
    if (tag === 'button') return 'button'
    if (tag === 'a' && el.hasAttribute('href')) return 'link'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (/^h[1-6]$/.test(tag)) return 'heading'
    if (tag === 'input') {
      const type = el.type
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'submit' || type === 'button') return 'button'
      return 'textbox'
    }
    return null
  }

  const clean = (text, max = 80) => {
    const value = (text || '').replace(/\s+/g, ' ').trim()
    if (!value) return null
    return value.length > max ? value.slice(0, max) + '…' : value
  }

  const labelText = (el) => {
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const text = labelledBy.split(' ').map((id) => (document.getElementById(id) || {}).textContent || '').join(' ')
      if (clean(text)) return clean(text)
    }
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
      if (label) return clean(label.textContent)
    }
    const wrapping = el.closest('label')
    return wrapping ? clean(wrapping.textContent) : null
  }

  const accessibleName = (el) =>
    clean(el.getAttribute('aria-label')) ||
    labelText(el) ||
    clean(el.getAttribute('placeholder')) ||
    clean(el.getAttribute('title')) ||
    clean(el.getAttribute('alt')) ||
    (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button') ? clean(el.value) : null) ||
    clean(el.innerText)

  const cssPath = (el) => {
    const parts = []
    let node = el
    while (node && node !== document.body && parts.length < 5) {
      let part = node.tagName.toLowerCase()
      if (node.id) {
        parts.unshift(part + '#' + CSS.escape(node.id))
        break
      }
      const parent = node.parentElement
      if (parent) {
        const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName)
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')'
      }
      parts.unshift(part)
      node = parent
    }
    return parts.join(' > ')
  }

  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || implicitRole(el),
    name: accessibleName(el),
    testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa'),
    id: el.id || null,
    nameAttr: el.getAttribute('name'),
    placeholder: el.getAttribute('placeholder'),
    text: clean(el.innerText, 200),
    css: cssPath(el)
  })

  const isTextField = (el) =>
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !['checkbox', 'radio', 'submit', 'button', 'file', 'range', 'color'].includes(el.type))

  const fillEvent = (el) => {
    const masked = el instanceof HTMLInputElement && el.type === 'password'
    return { type: 'fill', element: describe(el), value: masked ? null : el.value, masked }
  }

  // --- Recording ----------------------------------------------------------------------

  window.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || event.target === highlight) return
    const el = actionTarget(event.target)
    if (actor === 'claude') flash(el)
    if (mode !== 'record') {
      // Check mode: the click chooses what to check; the page does not see it.
      event.preventDefault()
      event.stopImmediatePropagation()
      if (mode === 'check-text') send({ type: 'check-text', element: describe(el), value: clean(el.innerText, 200), masked: false })
      else send({ type: 'check-visible', element: describe(el), value: null, masked: false })
      return
    }
    // Typing is recorded when the field changes, not when it is clicked.
    if (isTextField(el) || el instanceof HTMLSelectElement || el instanceof HTMLOptionElement) return
    send({ type: 'click', element: describe(el), value: null, masked: false })
  }, true)

  // Check mode also stops the press itself, so menus and buttons don't react.
  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
    window.addEventListener(type, (event) => {
      if (mode !== 'record' && event.target !== highlight) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }, true)
  }

  window.addEventListener('change', (event) => {
    if (!(event.target instanceof Element)) return
    if (actor === 'claude') flash(event.target)
    if (mode !== 'record') return
    const el = event.target
    if (el instanceof HTMLSelectElement) {
      const chosen = el.selectedOptions[0] ? el.selectedOptions[0].textContent : el.value
      send({ type: 'select', element: describe(el), value: clean(chosen, 200), masked: false })
    } else if (isTextField(el)) {
      send(fillEvent(el))
    }
  }, true)

  window.addEventListener('keydown', (event) => {
    if (mode !== 'record' || event.key !== 'Enter' || !(event.target instanceof Element)) return
    const el = event.target
    if (el instanceof HTMLTextAreaElement) return
    if (isTextField(el)) send(fillEvent(el))
    send({ type: 'press', element: describe(el), value: 'Enter', masked: false })
  }, true)

  // --- Highlight in check mode --------------------------------------------------------

  const showHighlight = (el) => {
    if (!highlight) {
      highlight = document.createElement('div')
      Object.assign(highlight.style, {
        position: 'fixed',
        zIndex: '2147483647',
        pointerEvents: 'none',
        border: '2px solid #2f5bd3',
        background: 'rgba(47, 91, 211, 0.12)',
        borderRadius: '3px'
      })
      document.documentElement.appendChild(highlight)
    }
    const rect = el.getBoundingClientRect()
    Object.assign(highlight.style, {
      display: 'block',
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px'
    })
  }

  const hideHighlight = () => {
    if (highlight) highlight.style.display = 'none'
  }

  window.addEventListener('mouseover', (event) => {
    if (mode === 'record' || !(event.target instanceof Element) || event.target === highlight) return
    showHighlight(actionTarget(event.target))
  }, true)
})()
`
