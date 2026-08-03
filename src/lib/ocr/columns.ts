export function isCentered(minX: number, maxX: number, imgWidth: number): boolean {
  const midX = minX + (maxX - minX) / 2;
  const leftMargin = minX;
  const rightMargin = imgWidth - maxX;
  return midX > imgWidth * 0.25 && midX < imgWidth * 0.75 &&
    (maxX - minX) < imgWidth * 0.7 && Math.abs(leftMargin - rightMargin) < imgWidth * 0.2;
}

export interface ColumnLine {
  x: number;
  y: number;
  w: number;
  isCentered: boolean;
  hasPrice: boolean;
  text: string;
}

export function detectColumns<T extends ColumnLine>(lines: T[]): { lines: T[]; xMin: number; xMax: number }[] {
  if (lines.length === 0) return [];
  const imgWidth = Math.max(...lines.map(l => l.x + l.w), 1);
  if (imgWidth === 0) return [{ lines, xMin: 0, xMax: 0 }];

  const mid = imgWidth / 2;
  const leftLines = lines.filter(l => l.x + l.w / 2 < mid);
  const rightLines = lines.filter(l => l.x + l.w / 2 >= mid);

  if (leftLines.length >= 2 && rightLines.length >= 2) {
    const isPriceOnly = (l: { text: string }) => /^[$€£¥]?\s*\d+(?:[.,]\d{1,2})?\s*$/.test(l.text.trim());
    const leftPriceShare = leftLines.filter(isPriceOnly).length / leftLines.length;
    const rightPriceShare = rightLines.filter(isPriceOnly).length / rightLines.length;
    if (leftPriceShare >= 0.6 || rightPriceShare >= 0.6) {
      return [{ lines: lines.sort((a, b) => a.y - b.y), xMin: 0, xMax: imgWidth }];
    }

    const leftSpan = leftLines.filter(l => !l.isCentered);
    const rightSpan = rightLines.filter(l => !l.isCentered);
    const leftMaxX = leftSpan.length ? Math.max(...leftSpan.map(l => l.x + l.w)) : Math.max(...leftLines.map(l => l.x + l.w));
    const rightMinX = rightSpan.length ? Math.min(...rightSpan.map(l => l.x)) : Math.min(...rightLines.map(l => l.x));
    if (rightMinX - leftMaxX > imgWidth * 0.08) {
      return [
        { lines: leftLines.sort((a, b) => a.y - b.y), xMin: 0, xMax: leftMaxX },
        { lines: rightLines.sort((a, b) => a.y - b.y), xMin: rightMinX, xMax: imgWidth },
      ];
    }
  }

  return [{ lines: lines.sort((a, b) => a.y - b.y), xMin: 0, xMax: imgWidth }];
}