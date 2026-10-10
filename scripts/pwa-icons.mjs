// Deterministic code-native icons; no remote image service or assets.
import sharp from "sharp";
import { mkdirSync } from "node:fs";
const directory = new URL("../public/pwa/", import.meta.url);
mkdirSync(directory, { recursive: true });
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#101310"/><path d="M136 160h72v48h-24v96h24v48h-72V160zm168 0h72v192h-72v-48h24v-96h-24v-48z" fill="#b8f49b"/><path d="m214 224 42 64 42-64" fill="none" stroke="#b8f49b" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/></svg>');
for (const [size, filename] of [[192, "icon-192.png"], [512, "icon-512.png"], [180, "apple-touch-icon.png"]]) await sharp(svg).resize(size, size).png().toFile(new URL(filename, directory).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
