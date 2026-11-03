# CocoaAuthor

CocoaAuthor is the writing and publishing workspace of the Cocoa suite. Write and structure long professional documents, then publish them as PDF or editable Word files.

It runs in the browser (hosted on GitHub Pages) and as a desktop app for Windows, macOS and Linux. Both use the same code and the same document format.

## Features

- Document library with search, sorting, status, archive, duplicate and delete
- 20 templates for public relations, content, advertising and marketing
- Live page layout as you type, or a single long page
- Outline panel to navigate, rename, reorder, promote and demote sections
- Styles for title, subtitle, headings, body, quotes, lists, captions, tables, footnotes, headers and footers
- Images with crop and alignment, tables, callouts, quotes, dividers, page breaks and section breaks with their own orientation and page numbering
- Links to websites, email addresses and phone numbers, and to headings, figures, tables, bookmarks and pages in the same document
- Automatic table of contents, cross-references, footnotes and endnotes
- Headers and footers with page numbers, different first page and odd/even pages
- Preview that shows exactly what the PDF will contain
- PDF export with embedded fonts, selectable text, working links, a clickable table of contents, bookmarks and metadata
- Word export with native heading styles, lists, tables, images, hyperlinks, bookmarks, cross-references, footnotes, endnotes, table of contents, headers, footers and optional embedded fonts
- Word import (text, headings, lists, tables, images, links, notes and page layout)
- Autosave, undo and redo

## Documents and storage

- **Web:** documents are stored in the browser (IndexedDB). Nothing is uploaded.
- **Desktop:** documents are stored in the app's data folder on your computer.

Use **Export → CocoaAuthor file** to save a portable `.cocoaauthor` file. Open it in either version with **Open or import**, or by dropping it onto the library. The file contains the full document, its settings, styles and images.

## Development

Requires Node.js 22.

```sh
npm install
npm run dev        # web app at http://localhost:5180
npm run build      # production build in dist/
npm run desktop    # build and run the desktop app
npm run dist       # build desktop installers into release/
```

## Deployment

### Web (GitHub Pages)

1. In the repository settings, open **Pages** and set **Source** to **GitHub Actions**.
2. Push to `main`. The `Deploy web app` workflow builds the app and publishes it.

The build uses relative paths and hash-based routes, so it works at a project URL such as `https://<user>.github.io/CocoaAuthor/` and survives page refreshes.

### Desktop

Push a tag such as `v1.0.0`. The `Build desktop app` workflow builds installers for Windows (`.exe`), macOS (`.dmg`) and Linux (`.AppImage`, `.deb`) and attaches them to a GitHub release. It can also be run by hand from the Actions tab, which uploads the installers as build artifacts.

The installers are not code-signed. Windows and macOS will show a warning the first time the app is opened.

## Fonts

CocoaAuthor bundles Inter, Source Serif 4, Lora, Playfair Display and JetBrains Mono under the SIL Open Font License. See `public/fonts/LICENSES.txt`.
