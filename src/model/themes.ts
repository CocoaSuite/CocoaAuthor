import { defaultStyles, type StyleSet, type TextStyleDef, type StyleKey } from './types'

type Theme = { text?: Partial<Record<StyleKey, Partial<TextStyleDef>>>; accent?: string; link?: string; grid?: string; tableHead?: string; calloutBg?: string }

const THEMES: Record<string, Theme> = {
  'Public Relations': {},
  Content: {
    accent: '#2f6b4f', link: '#2f6b4f', grid: '#cfdad3', tableHead: '#e8f1ec', calloutBg: '#eef5f0',
    text: {
      title: { font: 'Lora', size: 32, weight: 600, color: '#1d2a23' },
      subtitle: { font: 'Lora', italic: true, color: '#55685d' },
      h1: { font: 'Lora', size: 21, weight: 600, color: '#1d2a23' },
      h2: { size: 13.5, weight: 600, color: '#2f6b4f' },
      h4: { color: '#2f6b4f' },
      body: { font: 'Source Serif 4', size: 11, lineHeight: 1.55 },
      list: { font: 'Source Serif 4', size: 11 },
      quote: { font: 'Lora', color: '#2f6b4f' }
    }
  },
  Advertising: {
    accent: '#d1452c', link: '#c2410c', grid: '#e3d6d0', tableHead: '#1d1d1f', calloutBg: '#fbefe9',
    text: {
      title: { font: 'Inter', size: 38, weight: 700, tracking: -0.02, lineHeight: 1.05, color: '#111111' },
      subtitle: { size: 13, weight: 500, color: '#d1452c', caps: true, tracking: 0.06 },
      h1: { font: 'Inter', size: 22, weight: 700, tracking: -0.01, color: '#111111', before: 20 },
      h2: { size: 12, weight: 700, caps: true, tracking: 0.06, color: '#d1452c' },
      h3: { size: 11.5, weight: 700 },
      h4: { color: '#d1452c' },
      table: { size: 9 },
      quote: { font: 'Inter', italic: false, weight: 600, size: 13, color: '#111111' }
    }
  },
  Marketing: {
    accent: '#5b3fa0', link: '#5b3fa0', grid: '#d6d0e6', tableHead: '#efebf8', calloutBg: '#f3f0fa',
    text: {
      title: { font: 'Source Serif 4', size: 34, weight: 600, color: '#1e1838' },
      subtitle: { color: '#6b6386' },
      h1: { font: 'Source Serif 4', size: 22, weight: 600, color: '#1e1838' },
      h2: { size: 14, weight: 600, color: '#5b3fa0' },
      h4: { color: '#5b3fa0' },
      quote: { font: 'Source Serif 4', color: '#5b3fa0' }
    }
  }
}

export function themeStyles(category: string): StyleSet {
  const d = defaultStyles()
  const t = THEMES[category] || {}
  const text = { ...d.text }
  for (const k in t.text || {}) (text as any)[k] = { ...(d.text as any)[k], ...(t.text as any)[k] }
  return { ...d, ...t, text } as StyleSet
}
