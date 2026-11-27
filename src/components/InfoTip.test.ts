import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'

import InfoTip from './InfoTip.vue'

const renderTip = () => {
  const app = createSSRApp({ render: () => h(InfoTip, { text: 'Explains the field' }) })
  return renderToString(app)
}

describe('InfoTip', () => {
  it('renders the text in a tooltip the button describes itself with', async () => {
    const html = await renderTip()

    const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1]
    const tooltipId = html.match(/id="([^"]+)"[^>]*role="tooltip"/)?.[1]

    expect(html).toContain('Explains the field')
    expect(describedBy).toBeTruthy()
    expect(describedBy).toBe(tooltipId)
  })

  it('renders the bubble as a manual popover anchored to the button', async () => {
    const html = await renderTip()

    const buttonAnchor = html.match(/anchor-name:\s*([^;"]+)/)?.[1]
    const bubbleAnchor = html.match(/position-anchor:\s*([^;"]+)/)?.[1]

    expect(html).toContain('role="tooltip" popover="manual"')
    expect(buttonAnchor).toMatch(/^--tip-/)
    expect(bubbleAnchor).toBe(buttonAnchor)
  })
})
