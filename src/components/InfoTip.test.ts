import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'

import InfoTip from './InfoTip.vue'

describe('InfoTip', () => {
  it('renders the text in a tooltip the button describes itself with', async () => {
    const app = createSSRApp({ render: () => h(InfoTip, { text: 'Explains the field' }) })
    const html = await renderToString(app)

    const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1]
    const tooltipId = html.match(/id="([^"]+)" role="tooltip"/)?.[1]

    expect(html).toContain('Explains the field')
    expect(describedBy).toBeTruthy()
    expect(describedBy).toBe(tooltipId)
  })
})
