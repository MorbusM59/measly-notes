const path = require('path');
const fs = require('fs');
async function main() {
  try {
    const pngToIco = require('png-to-ico');
    const assets = path.join(process.cwd(), 'assets');
    const src = path.join(assets, 'icon.png');
    if (!fs.existsSync(src)) throw new Error('source icon.png not found');
    console.log('Creating ICO from', src);
    const buf = await pngToIco(src);
    const out = path.join(assets, 'icon.ico');
    fs.writeFileSync(out, buf);
    console.log('Wrote', out);
  } catch (err) {
    console.error('make-ico failed:', err && err.message ? err.message : err);
    process.exit(1);
  }
}
main();
