// Draws the app icon and the installer images from SVG.
// Run: npm run icons   (writes build/icon.png, build/installerSidebar.bmp, build/installerHeader.bmp)
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const buildDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
mkdirSync(buildDir, { recursive: true })

/** The mark: a browser window with test steps, and a green check. Drawn on a 512 grid. */
const mark = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b6ef0"/>
      <stop offset="1" stop-color="#1e3a8a"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#0b1a4a" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <g filter="url(#shadow)">
    <rect x="88" y="118" width="336" height="260" rx="30" fill="#ffffff"/>
    <path d="M88 148a30 30 0 0 1 30-30h276a30 30 0 0 1 30 30v26H88z" fill="#dbe5ff"/>
    <circle cx="124" cy="146" r="9" fill="#f87171"/>
    <circle cx="152" cy="146" r="9" fill="#fbbf24"/>
    <circle cx="180" cy="146" r="9" fill="#34d399"/>
    <rect x="124" y="208" width="150" height="22" rx="11" fill="#3b6ef0"/>
    <rect x="124" y="250" width="210" height="22" rx="11" fill="#c7d4fb"/>
    <rect x="124" y="292" width="120" height="22" rx="11" fill="#c7d4fb"/>
  </g>
  <g filter="url(#shadow)">
    <circle cx="380" cy="372" r="82" fill="#22c55e" stroke="#ffffff" stroke-width="14"/>
    <path d="M342 374l26 26 52-56" fill="none" stroke="#ffffff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${mark}</svg>`

/** Installer side panel (welcome and finish pages): 164 x 314. */
const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="side" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2f5bd3"/>
      <stop offset="1" stop-color="#14286b"/>
    </linearGradient>
  </defs>
  <rect width="164" height="314" fill="url(#side)"/>
  <svg x="32" y="54" width="100" height="100" viewBox="0 0 512 512">${mark}</svg>
  <text x="82" y="188" text-anchor="middle" font-family="Segoe UI, Arial" font-size="15" font-weight="700" fill="#ffffff">QA-ASD-STE100</text>
  <text x="82" y="210" text-anchor="middle" font-family="Segoe UI, Arial" font-size="11" fill="#c7d4fb">Automated tests,</text>
  <text x="82" y="226" text-anchor="middle" font-family="Segoe UI, Arial" font-size="11" fill="#c7d4fb">without writing code</text>
</svg>`

/** Installer header (other pages): 150 x 57, white with the mark on the right. */
const header = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#ffffff"/>
  <svg x="100" y="6" width="44" height="44" viewBox="0 0 512 512">${mark}</svg>
</svg>`

function render(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true } }).render()
}

/** NSIS needs BMP for its images: 24-bit, rows bottom-up, padded to 4 bytes. */
function toBmp(image) {
  const { width, height, pixels } = image
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const data = Buffer.alloc(54 + rowSize * height)
  data.write('BM', 0)
  data.writeUInt32LE(data.length, 2)
  data.writeUInt32LE(54, 10)
  data.writeUInt32LE(40, 14)
  data.writeInt32LE(width, 18)
  data.writeInt32LE(height, 22)
  data.writeUInt16LE(1, 26)
  data.writeUInt16LE(24, 28)
  data.writeUInt32LE(rowSize * height, 34)
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      // Blend onto white, so any transparent edge looks right.
      const a = pixels[i + 3] / 255
      const blend = (c) => Math.round(c * a + 255 * (1 - a))
      data[row + x * 3] = blend(pixels[i + 2])
      data[row + x * 3 + 1] = blend(pixels[i + 1])
      data[row + x * 3 + 2] = blend(pixels[i])
    }
  }
  return data
}

writeFileSync(join(buildDir, 'icon.png'), render(icon, 512).asPng())
writeFileSync(join(buildDir, 'installerSidebar.bmp'), toBmp(render(sidebar, 164)))
writeFileSync(join(buildDir, 'installerHeader.bmp'), toBmp(render(header, 150)))
console.log('Icons written to build/')
