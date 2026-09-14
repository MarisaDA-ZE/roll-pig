import type { Font } from 'fontkit';
import { CatalogError } from '../modules/rollpig/catalog.js';

const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const closing = /^[，。！？、；：）》」』】”’!?;,.:)]/u;
const opening = /[（《「『【“‘(]$/u;

export function escapeXml(text: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  return text.replace(/[&<>"']/g, (character) => entities[character]!);
}

function textWidth(font: Font, text: string, size: number): number {
  if (!text) return 0;
  const run = font.layout(text);
  return (Math.max(run.advanceWidth, run.bbox.maxX) - Math.min(0, run.bbox.minX)) * size / font.unitsPerEm;
}

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

export function textBlock(font: Font, text: string, size: number, width: number, color: string, centered = false) {
  const lines = wrapText(font, text, size, width);
  const scale = size / font.unitsPerEm;
  const lineHeight = Math.ceil((font.ascent - font.descent + font.lineGap) * scale) + 8;
  return {
    height: lines.length * lineHeight,
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
