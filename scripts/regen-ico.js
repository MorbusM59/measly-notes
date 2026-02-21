const path = require('path');
const fs = require('fs');
async function main() {
  try {
    const sharp = require('sharp');
    const pngToIco = require('png-to-ico');
    const assets = path.join(process.cwd(), 'assets');
    const src = path.join(assets, 'icon.png');
    if (!fs.existsSync(src)) throw new Error('source icon.png not found');

    const sizes = [16, 32, 48, 256];
    const tempFiles = [];
    for (const s of sizes) {
      const out = path.join(assets, `._ico_${s}.png`);
      await sharp(src).resize(s, s, { fit: 'cover' }).png().toFile(out);
      tempFiles.push(out);
    }

    const pngToIcoModule = pngToIco && pngToIco.default ? pngToIco.default : pngToIco;
    if (typeof pngToIcoModule !== 'function') throw new Error('png-to-ico export is not a function');
    const buf = await pngToIcoModule(tempFiles);
    const outIco = path.join(assets, 'icon.ico');
    fs.writeFileSync(outIco, buf);
    console.log('Wrote', outIco);

    // cleanup temp
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch {}
    }
  } catch (err) {
    console.error('regen-ico failed:', err && err.message ? err.message : err);
    process.exit(1);
  }
}
main();
