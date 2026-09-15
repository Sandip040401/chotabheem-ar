/**
 * compile-target.js
 * One-time script to compile bheem_marker.jpg into targets.mind
 * Run: node compile-target.js
 * Output: public/assets/targets.mind
 */

import { Compiler } from 'mind-ar/src/image-target/compiler.js'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createCanvas, loadImage } from 'canvas'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function compile() {
  console.log('Loading marker image...')
  const imagePath = path.join(__dirname, 'public', 'assets', 'bheem_marker.jpg')
  const outputPath = path.join(__dirname, 'public', 'assets', 'targets.mind')

  try {
    const img = await loadImage(imagePath)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)

    console.log('Image size: ' + img.width + 'x' + img.height)
    console.log('Compiling feature points (this may take 20-60 seconds)...')

    const compiler = new Compiler()
    await compiler.compileImageTargets([canvas], (progress) => {
      process.stdout.write('\rProgress: ' + (progress * 100).toFixed(1) + '%')
    })

    const exportedBuffer = await compiler.exportData()
    writeFileSync(outputPath, Buffer.from(exportedBuffer))

    console.log('\nDone! targets.mind saved to: public/assets/targets.mind')
    console.log('You can now run the app with: npm run dev')
  } catch (err) {
    console.error('\nCompilation failed:', err.message)
    console.log('\nAlternative: Use the web compiler at:')
    console.log('   https://hiukim.github.io/mind-ar-js-doc/tools/compile')
    console.log('   Upload: public/assets/bheem_marker.jpg')
    console.log('   Download: targets.mind -> place in public/assets/')
    process.exit(1)
  }
}

compile()
