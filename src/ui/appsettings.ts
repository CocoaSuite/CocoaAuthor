import { native, type AppIconTheme } from '../storage/store'
import { h } from '../util'
import { modal, toast } from './dialogs'

// Previews of the two app icons, the same artwork the desktop app ships.
const SVG: Record<AppIconTheme, string> = {
  amethyst: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="author app icon"><rect width="100" height="100" rx="17.5" fill="#1D1B33"/><g transform="translate(23 21) scale(1.036)"><path d="M44 6C39.5 1.9 34.5 0 28 0C12.5 0 0 12.5 0 28C0 43.5 12.5 56 28 56C34.5 56 39.5 54.1 44 50L36 40C33.8 42 31.3 43 28 43C19.7 43 13 36.3 13 28C13 19.7 19.7 13 28 13C31.3 13 33.8 14 36 16L44 6Z" fill="#ABA6D6"/><path d="M25 41.5L31.3333 31.3C29.1111 26.9 35.7778 17.4 41.3333 15.2C44.6667 13.66 48 13 51.3333 13C51.3333 17.4 50.2222 20.7 48 24L40.2222 28L47.5 26C44.1667 29.3 35.7778 34.6 33.5556 34.6L28.5 39.5L25 41.5Z" fill="#ABA6D6"/></g></svg>',
  midnight: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="author app icon"><rect width="100" height="100" rx="17.5" fill="#141A24"/><g transform="translate(23 21) scale(1.036)"><path d="M44 6C39.5 1.9 34.5 0 28 0C12.5 0 0 12.5 0 28C0 43.5 12.5 56 28 56C34.5 56 39.5 54.1 44 50L36 40C33.8 42 31.3 43 28 43C19.7 43 13 36.3 13 28C13 19.7 19.7 13 28 13C31.3 13 33.8 14 36 16L44 6Z" fill="#8AA7D9"/><path d="M25 41.5L31.3333 31.3C29.1111 26.9 35.7778 17.4 41.3333 15.2C44.6667 13.66 48 13 51.3333 13C51.3333 17.4 50.2222 20.7 48 24L40.2222 28L47.5 26C44.1667 29.3 35.7778 34.6 33.5556 34.6L28.5 39.5L25 41.5Z" fill="#8AA7D9"/></g></svg>'
}
const NAMES: [AppIconTheme, string][] = [['amethyst', 'Amethyst'], ['midnight', 'Midnight']]

/** Desktop settings: the app icon and a desktop shortcut. */
export function appSettingsDialog() {
  const n = native
  if (!n?.setAppIcon) return
  const pick = h('div', { class: 'iconpick', role: 'radiogroup', 'aria-label': 'App icon' })
  const draw = (cur: AppIconTheme) => {
    pick.innerHTML = ''
    for (const [t, label] of NAMES) {
      const art = h('span', { class: 'art' }); art.innerHTML = SVG[t]
      pick.append(h('button', { class: t === cur ? 'on' : '', role: 'radio', 'aria-checked': String(t === cur), onclick: async () => {
        try { draw(await n.setAppIcon!(t)) } catch (e: any) { toast(e.message, 4000) }
      } }, art, label))
    }
  }
  draw('amethyst')
  n.appIcon?.().then(draw)
  const win = n.platform === 'win32'
  const m = modal('Settings', [
    h('div', { class: 'sec' }, 'App icon'),
    pick,
    h('div', { class: 'hint' }, win ? 'Used for CocoaAuthor windows, the taskbar, CocoaAuthor shortcuts and the icons of CocoaAuthor documents and PDFs that open in it.' : 'Used for CocoaAuthor windows and the Dock.'),
    win ? h('div', { class: 'sec' }, 'Shortcut') : '',
    win ? h('div', { class: 'fr' }, h('button', { onclick: async () => {
      try { await n.createShortcut!(); toast('Shortcut created on the desktop') } catch (e: any) { toast(e.message, 4000) }
    } }, 'Create desktop shortcut'), h('span', { class: 'hint' }, 'Uses the icon chosen above.')) : '',
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => m.close() }, 'Done'))
  ])
}
