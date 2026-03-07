#!/usr/bin/env node
/** Creates fixtures/ocr-test.png - white image with black "123456" for OCR automation. */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Jimp, loadFont } from 'jimp';
import { SANS_32_BLACK } from 'jimp/fonts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '..', 'fixtures', 'ocr-test.png');

mkdirSync(dirname(out), { recursive: true });

const img = new Jimp({ width: 200, height: 60, color: 0xffffffff });
const font = await loadFont(SANS_32_BLACK);
img.print({ font, x: 20, y: 15, text: '123456' });
await img.write(out);
console.log('Wrote:', out);
