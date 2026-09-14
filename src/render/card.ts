import type { Font } from 'fontkit';
import sharp from 'sharp';
import { CatalogError } from '../modules/rollpig/catalog.js';
import type { PigDetails } from '../modules/rollpig/types.js';
import { escapeXml, textBlock } from './text.js';

/** 成品卡片的固定宽度，单位为像素。 */
const WIDTH = 720;
/** 卡片四周的内容留白，单位为像素。 */
const PADDING = 44;
/** 原图等比缩放后占用的正方形区域边长，单位为像素。 */
const IMAGE_SIZE = 384;
const TEXT_WIDTH = WIDTH - PADDING * 2;

/**
 * 将猪猪文案、原图和指定字体合成为完整 PNG 卡片。
 *
 * @remarks
 * 卡片固定宽 720 像素，高度随文案增长且不超过 4096 像素。
 * 原图解码限制为 3200 万像素，按方向信息旋转后等比放入 384 像素区域。
 * 文案绘制为 SVG 字形轮廓，输出不依赖系统字体；此函数不写入文件。
 *
 * @param pig - 已通过清单校验的猪猪标识和文案。
 * @param source - 可由 sharp 完整解码的原图文件内容。
 * @param font - 覆盖全部文案字符的已加载字体。
 * @returns 完整 PNG 文件的字节缓冲区。
 * @throws {@link CatalogError}
 * 文案不可绘制或成品高度超过上限。
 * @throws Error
 * 原图解码、缩放或图片合成失败。
 */
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
