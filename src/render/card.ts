import type { Font } from 'fontkit';
import sharp from 'sharp';
import { CatalogError } from '../modules/rollpig/catalog.js';
import type { PigDetails } from '../modules/rollpig/types.js';
import { escapeXml, textBlock } from './text.js';

const WIDTH = 720;
const PADDING = 44;
const IMAGE_SIZE = 384;
const TEXT_WIDTH = WIDTH - PADDING * 2;

export async function renderCard(pig: PigDetails, source: Buffer, font: Font): Promise<Buffer> {
  const name = textBlock(font, pig.name, 44, TEXT_WIDTH, '#513c37', true);
  const description = textBlock(font, pig.description, 28, TEXT_WIDTH, '#aa6158', true);
  const analysis = textBlock(font, pig.analysis, 26, TEXT_WIDTH, '#513c37');
  const imageTop = PADDING + name.height + 20;
  const descriptionTop = imageTop + IMAGE_SIZE + 20;
  const analysisTop = descriptionTop + description.height + 36;
  const height = analysisTop + analysis.height + PADDING;
  if (height > 4096) throw new CatalogError('INVALID_RESOURCE', 'Rendered card exceeds 4096 pixels in height.');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}">
    <title>${escapeXml(pig.name)}</title>
    <desc>${escapeXml(`${pig.description}\n${pig.analysis}`)}</desc>
    <rect width="${WIDTH}" height="${height}" fill="#fff9f4"/>
    ${name.svg(PADDING, PADDING)}
    ${description.svg(PADDING, descriptionTop)}
    <path d="M${PADDING} ${analysisTop - 18}H${WIDTH - PADDING}" stroke="#eadbd2"/>
    ${analysis.svg(PADDING, analysisTop)}
  </svg>`;
  const image = await sharp(source, { limitInputPixels: 32_000_000 })
    .rotate()
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toColourspace('srgb')
    .png()
    .toBuffer();
  return sharp(Buffer.from(svg))
    .composite([{ input: image, left: (WIDTH - IMAGE_SIZE) / 2, top: imageTop }])
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}
