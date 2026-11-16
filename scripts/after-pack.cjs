// Fails the desktop build if libraries end up packed into the app a second time.
// Everything the app uses is bundled into dist/ by Vite, and the Electron side loads only
// Node's own modules, so the packed app needs no node_modules. If a future change really
// needs a package at runtime in electron/, add it to "dependencies" and to ALLOWED below.
const fs = require('fs')
const path = require('path')

const ALLOWED = []
const LIMIT_MB = 60

exports.default = async function afterPack(ctx) {
  const res = ctx.electronPlatformName === 'darwin'
    ? path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(ctx.appOutDir, 'resources')
  const pkg = require('../package.json')
  const extra = Object.keys(pkg.dependencies || {}).filter(d => !ALLOWED.includes(d))
  if (extra.length) throw new Error(`Runtime dependencies would be packed into the app: ${extra.join(', ')}. Move them to devDependencies (Vite bundles them) or allow them in scripts/after-pack.cjs.`)
  if (fs.existsSync(path.join(res, 'app.asar.unpacked'))) throw new Error('app.asar.unpacked exists: native modules were packed into the app.')
  const mb = fs.statSync(path.join(res, 'app.asar')).size / 1048576
  console.log(`  • packed app ${mb.toFixed(1)} MB`)
  if (mb > LIMIT_MB) throw new Error(`The packed app is ${mb.toFixed(1)} MB, over the ${LIMIT_MB} MB limit. Check what electron-builder packed.`)
}
