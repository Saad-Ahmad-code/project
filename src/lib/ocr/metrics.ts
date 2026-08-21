export function ocrSuccess(source: string): void {
  console.debug(`OCR success on ${source}`);
}

export function ocrFailure(source: string, err?: unknown): void {
  console.error(`OCR failure on ${source}`, err);
}
