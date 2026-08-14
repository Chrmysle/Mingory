const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const outputDir = path.resolve(__dirname, "../miniprogram/images/tabbar");
fs.mkdirSync(outputDir, { recursive: true });

const icons = {
  home: '<path d="M10 29 32 10l22 19v24H39V38H25v15H10Z"/><path d="M7 31 32 8l25 23"/>',
  sell: '<path d="M12 22v-8h8M44 14h8v8M52 42v8h-8M20 50h-8v-8"/><path d="M25 24h14M25 31h14M25 38h10"/><circle cx="32" cy="31" r="14"/>',
  product: '<path d="m10 21 22-11 22 11-22 11Z"/><path d="M10 21v25l22 10 22-10V21M32 32v24"/>',
  inventory: '<path d="M9 16h46v13H9ZM12 29h40v25H12Z"/><path d="M26 37h12M26 45h12"/>',
  statistics: '<path d="M10 53h44M14 48V34h9v14M28 48V22h9v26M42 48V11h9v37"/>',
};

function svg(paths, color) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`);
}

async function run() {
  for (const [name, paths] of Object.entries(icons)) {
    await sharp(svg(paths, "#858B96")).png().toFile(path.join(outputDir, `${name}.png`));
    await sharp(svg(paths, "#4DA3FF")).png().toFile(path.join(outputDir, `${name}-active.png`));
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
