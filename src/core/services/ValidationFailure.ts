import type { ValidationResult } from "../entities/FoodIngestion";

/** Creates the shared conservative rejection result for evidence validation. */
export function validationFailure(detail: string): ValidationResult<never> {
	return { ok: false, reason: "ambiguous_content", detail };
}
