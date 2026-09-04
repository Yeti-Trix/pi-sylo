/**
 * Pre-flight HTML policy before injecting skill widget HTML into a sandboxed iframe (ADR-31 / §13.1).
 * Host parses markup and rejects sensitive fields before srcdoc assignment.
 */

import syloSurfaceCss from '@skill-builder/assets/sylo-surface.css?inline'

export class SkillSurfacePolicyError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'SkillSurfacePolicyError'
    this.code = code
  }
}

function normType(t: string | null): string {
  return (t ?? '').trim().toLowerCase()
}

function autocompleteIsPayment(v: string | null): boolean {
  if (!v) return false
  const a = v.trim().toLowerCase()
  return (
    a.includes('cc-') ||
    a === 'one-time-code' ||
    a.includes('otp') ||
    a.includes('card')
  )
}

/**
 * Walk inputs / textareas in a parsed document subtree.
 * Used for fragments wrapped in <html><body>…</body></html> for parsing only.
 */
export function assertWidgetMarkupPassesPolicy(doc: Document): void {
  const inputs = doc.querySelectorAll('input, textarea')
  for (const el of inputs) {
    if (el.tagName === 'TEXTAREA') continue
    if (!(el instanceof HTMLInputElement)) continue
    const type = normType(el.getAttribute('type'))
    if (type === 'password') {
      throw new SkillSurfacePolicyError('password_input', 'Widget markup contains a password field')
    }
    if (autocompleteIsPayment(el.getAttribute('autocomplete'))) {
      throw new SkillSurfacePolicyError('sensitive_autocomplete', 'Widget markup contains a sensitive autocomplete field')
    }
  }
}

/** Theme CSS variables + base body styles for skill iframes. */
export function skillSurfaceThemeStyleBlock(): string {
  return `:root {
  --color-surface: #1a1b1e;
  --color-text: #e8e9ec;
  --color-border: #3d3f45;
  --color-accent: #6b9fff;
}
body {
  margin: 0;
  font: 14px/1.4 system-ui, sans-serif;
  background: var(--color-surface);
  color: var(--color-text);
}`
}

/** Full `<style>` payload: theme + shared surface utilities (`packages/skill-builder/assets/sylo-surface.css`). */
export function skillSurfaceInjectedStyles(): string {
  return `${skillSurfaceThemeStyleBlock()}\n${syloSurfaceCss}`
}
