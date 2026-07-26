import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const outputDirectory = path.join(process.cwd(), 'assets', 'images');
await mkdir(outputDirectory, { recursive: true });

const photographs = [
  ['Chanel_IMG.jpg', 'chanel'],
  ['Dior_IMG.jpg', 'dior'],
  ['Creed_ING.jpg', 'creed'],
  ['Tom Ford_IMG.jpg', 'tom-ford']
];

const variants = [
  { variant: 'card', width: 480, webpQuality: 76 },
  // Hero exports match the area the browser actually paints. The previous
  // portrait "desktop" files downloaded thousands of off-screen pixels before
  // background-size: cover discarded them.
  { variant: 'hero-mobile', width: 720, height: 1280, webpQuality: 72, avifQuality: 46 },
  { variant: 'hero-desktop', width: 1600, height: 1000, webpQuality: 72, avifQuality: 46 },
  // Support mastheads are shallow. Pre-cropping avoids downloading tall,
  // multi-megapixel hero images only to discard most of them with CSS cover.
  { variant: 'support-mobile', width: 720, height: 800, webpQuality: 70 },
  { variant: 'support-desktop', width: 1600, height: 480, webpQuality: 70 }
];

for (const [source, name] of photographs) {
  for (const { variant, width, height, webpQuality, avifQuality } of variants) {
    const pipeline = sharp(path.join(process.cwd(), source))
      .rotate()
      .resize({
        width,
        ...(height ? { height, fit: 'cover', position: 'centre' } : {}),
        withoutEnlargement: true
      });

    await pipeline
      .clone()
      .webp({ quality: webpQuality, effort: 6, smartSubsample: true })
      .toFile(path.join(outputDirectory, `${name}-${variant}.webp`));

    if (avifQuality) {
      await pipeline
        .clone()
        .avif({ quality: avifQuality, effort: 7, chromaSubsampling: '4:2:0' })
        .toFile(path.join(outputDirectory, `${name}-${variant}.avif`));
    }
  }
}

await sharp(path.join(process.cwd(), 'emblem.png'))
  .resize({ width: 96, withoutEnlargement: true })
  .webp({ quality: 88, alphaQuality: 90, effort: 6 })
  .toFile(path.join(outputDirectory, 'emblem-96.webp'));

const heroAvifCount = photographs.length * variants.filter(({ avifQuality }) => Boolean(avifQuality)).length;
console.log(`Optimized ${photographs.length * variants.length + heroAvifCount + 1} image assets in ${outputDirectory}.`);
