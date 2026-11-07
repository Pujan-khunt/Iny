const supportedBatches = new Set([
	"2027",
	"2028",
	"2028 A",
	"2028 B",
	"2029",
	"2029 A",
	"2029 B",
	"2029 C",
	"2029 D",
	"2030",
	"2030 A",
	"2030 B",
	"2030 C",
	"2030 D",
	"2030 E",
	"ALL_BATCHES",
	"ALL_OTHER_BATCHES",
]);

/** Returns whether a batch token belongs to the configured campus cohorts. */
export function isSupportedCampusBatch(batch: string): boolean {
	return supportedBatches.has(batch);
}
