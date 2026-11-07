/** Validated PDF page count and first-page dimensions in PDF points. */
export interface PdfInspection {
	readonly pageCount: number;
	readonly widthPoints: number;
	readonly heightPoints: number;
}

/** Rendered first-page PNG bytes and measured output metadata. */
export interface PdfPageRender {
	readonly pngBytes: Uint8Array;
	readonly widthPixels: number;
	readonly heightPixels: number;
	readonly dpi: number;
	readonly elapsedMs: number;
}

/** Bounded PDF inspection and rendering capability, without business acceptance policy. */
export interface PdfRasterizationPort {
	/**
	 * Inspects a PDF before rendering and reports its page count and first-page dimensions.
	 * @param pdf Complete original PDF bytes.
	 * @param signal Optional invocation cancellation context.
	 * @returns Validated document geometry.
	 * @throws On invalid input, inspection failure, resource limits, timeout, or cancellation.
	 */
	inspect(pdf: Uint8Array, signal?: AbortSignal): Promise<PdfInspection>;
	/**
	 * Renders the first page using 600 DPI unless an explicit valid override is supplied.
	 * @param pdf Complete original PDF bytes.
	 * @param dpi Optional positive finite render resolution.
	 * @param signal Optional invocation cancellation context.
	 * @returns PNG bytes, pixel dimensions, actual DPI, and elapsed milliseconds.
	 * @throws On invalid input/DPI, failed rendering, resource limits, timeout, or cancellation.
	 */
	renderFirstPage(pdf: Uint8Array, dpi?: number, signal?: AbortSignal): Promise<PdfPageRender>;
}
