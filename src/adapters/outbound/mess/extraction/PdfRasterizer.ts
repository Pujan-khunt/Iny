import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

export class PdfRasterizer {
  /**
   * Rasterizes page 1 of a PDF buffer into a PNG buffer using native pdftoppm.
   *
   * @param pdfBuffer The raw binary buffer of the PDF file.
   * @param dpi DPI resolution for rasterization (default: 300).
   * @returns A Buffer containing the raw PNG bytes.
   */
  static async rasterizePageOneToPng(pdfBuffer: Buffer, dpi: number = 300): Promise<Buffer> {
    if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
      throw new Error('Invalid or empty PDF buffer provided');
    }

    const uniqueId = `pdf_raster_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const tempDir = os.tmpdir();
    const pdfPath = path.join(tempDir, `${uniqueId}.pdf`);
    const outPrefix = path.join(tempDir, uniqueId);
    const pngPath = `${outPrefix}.png`;

    try {
      await fs.promises.writeFile(pdfPath, pdfBuffer);
      await execFileAsync('pdftoppm', [
        '-png',
        '-r',
        String(dpi),
        '-singlefile',
        pdfPath,
        outPrefix,
      ]);
      const pngBuffer = await fs.promises.readFile(pngPath);
      return pngBuffer;
    } finally {
      await Promise.allSettled([
        fs.promises.unlink(pdfPath),
        fs.promises.unlink(pngPath),
      ]);
    }
  }

  async rasterizePageOneToPng(pdfBuffer: Buffer, dpi: number = 300): Promise<Buffer> {
    return PdfRasterizer.rasterizePageOneToPng(pdfBuffer, dpi);
  }
}
