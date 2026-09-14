import type { Font } from 'fontkit';
import { CatalogError } from '../modules/rollpig/catalog.js';

const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const closing = /^[，。！？、；：）》」』】”’!?;,.:)]/u;
const opening = /[（《「『【“‘(]$/u;

/**
 * 转义用于 SVG 文本节点的五种 XML 特殊字符。
 *
 * @param text - 原始文本；调用方负责排除 XML 不允许的控制字符。
 * @returns 将特殊字符替换为 XML 实体后的字符串。
 */
export function escapeXml(text: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  return text.replace(/[&<>"']/g, (character) => entities[character]!);
}

/**
 * 根据字形推进量和实际外轮廓计算文本占用宽度。
 *
 * @param font - 已加载的字体。
 * @param text - 待测量的单行文本。
 * @param size - 字号，单位为像素。
 * @returns 文本外轮廓与推进范围共同占用的像素宽度，空文本返回 0。
 */
function textWidth(font: Font, text: string, size: number): number {
  if (!text) return 0;
  const run = font.layout(text);
  return (Math.max(run.advanceWidth, run.bbox.maxX) - Math.min(0, run.bbox.minX)) * size / font.unitsPerEm;
}

/**
 * 按真实字形宽度和字素边界换行，并检查文本是否可由指定字体绘制。
 *
 * @remarks
 * 保留显式换行及空段落，将制表符替换为四个空格。
 * 自动换行时尽量保留英文单词，并调整中文开闭标点的位置。
 * 文本长度按 UTF-16 码元计数，最多 4096；不会拆开一个字素簇。
 *
 * @param font - 用于字形检查与宽度测量的字体。
 * @param text - 原始文案，可包含多段文本。
 * @param size - 正数字号，单位为像素。
 * @param width - 可用文本区域的正数宽度，单位为像素。
 * @returns 按显示顺序排列的文本行，空段落对应空字符串。
 * @throws {@link CatalogError}
 * 文本过长、包含非法 XML 字符、字体缺字或单个字素超过可用宽度。
 */
export function wrapText(font: Font, text: string, size: number, width: number): string[] {
  if (text.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(text)) {
    throw new CatalogError('INVALID_RESOURCE', 'Text exceeds 4096 characters or contains invalid XML characters.');
  }
  for (const character of text) {
    if (!/\s/u.test(character) && !font.hasGlyphForCodePoint(character.codePointAt(0)!)) {
      throw new CatalogError('INVALID_RESOURCE', `Font does not contain character: ${character}.`);
    }
  }
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    let remaining = Array.from(graphemes.segment(paragraph), (part) => part.segment);
    if (!remaining.length) lines.push('');
    while (remaining.length) {
      let end = 0;
      while (end < remaining.length && textWidth(font, remaining.slice(0, end + 1).join(''), size) <= width) end++;
      if (!end) throw new CatalogError('INVALID_RESOURCE', 'A character exceeds the text area width.');
      if (end < remaining.length) {
        // 尽量保留完整英文单词，避免中文闭标点出现在行首、开标点出现在行尾。
        const word = remaining.slice(0, end).join('').match(/[A-Za-z0-9_]+$/)?.[0];
        if (word && /^[A-Za-z0-9_]/.test(remaining[end]!) && word.length < end) end -= word.length;
        while (end > 1 && (closing.test(remaining[end]!) || opening.test(remaining[end - 1]!))) end--;
      }
      lines.push(remaining.slice(0, end).join('').trimEnd());
      remaining = remaining.slice(end);
      while (remaining.length && /^\s+$/u.test(remaining[0]!)) remaining.shift();
    }
  }
  return lines;
}

/**
 * 将多行文本排版为可定位的 SVG 字形轮廓块。
 *
 * @remarks
 * SVG 直接使用字体轮廓，无需目标系统安装字体。
 * 颜色由调用方提供可信的 SVG 填充值，不在此处转义。
 *
 * @param font - 已加载的字体。
 * @param text - 待排版的文案。
 * @param size - 正数字号，单位为像素。
 * @param width - 文本区域的正数宽度，单位为像素。
 * @param color - 字形填充色，例如十六进制颜色字符串。
 * @param centered - 是否在文本区域内逐行居中，默认左对齐。
 * @returns 文本块像素高度及按给定坐标生成 SVG 片段的方法。
 * @throws {@link CatalogError}
 * 文本无法通过长度、字符、字形或行宽校验。
 */
export function textBlock(font: Font, text: string, size: number, width: number, color: string, centered = false) {
  const lines = wrapText(font, text, size, width);
  const scale = size / font.unitsPerEm;
  const lineHeight = Math.ceil((font.ascent - font.descent + font.lineGap) * scale) + 8;
  return {
    /** 包含空段落和行间距的文本块高度，单位为像素。 */
    height: lines.length * lineHeight,
    /**
     * 将已排版的各行字形放置到指定起点。
     *
     * @param left - 文本区域左侧的像素坐标。
     * @param top - 文本区域顶部的像素坐标。
     * @returns 可嵌入外层 SVG 的字形分组片段。
     */
    svg(left: number, top: number): string {
      return lines.map((line, lineIndex) => {
        if (!line) return '';
        const run = font.layout(line);
        const inset = centered ? (width - textWidth(font, line, size)) / 2 : 0;
        const x = left + inset - Math.min(0, run.bbox.minX) * scale;
        const y = top + font.ascent * scale + lineIndex * lineHeight;
        let cursorX = 0;
        let cursorY = 0;
        const paths = run.glyphs.map((glyph, index) => {
          const position = run.positions[index]!;
          const path = `<path transform="translate(${cursorX + position.xOffset} ${cursorY + position.yOffset})" d="${glyph.path.toSVG()}"/>`;
          cursorX += position.xAdvance;
          cursorY += position.yAdvance;
          return path;
        }).join('');
        // SVG 使用字体轮廓，不依赖系统字体或 SVG 渲染器的字体回退。
        return `<g fill="${color}" transform="translate(${x} ${y}) scale(${scale} ${-scale})">${paths}</g>`;
      }).join('');
    },
  };
}
