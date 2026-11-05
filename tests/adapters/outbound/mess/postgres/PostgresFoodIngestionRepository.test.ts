import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../../../../../src/adapters/outbound/mess/postgres/schema";

describe("food ingestion persistence schema", () => {
	it("defines durable activation, admission, and operation audit tables", () => {
		expect(schema).toHaveProperty("foodIngestionSettings");
		expect(schema).toHaveProperty("foodAnnouncementIngestions");
		expect(schema).toHaveProperty("messIngestionOperationAudits");
	});

	it("retains malformed model responses as text, separately from structured assessment", () => {
		const columns = getTableColumns(schema.foodAnnouncementIngestions);
		expect(columns.rawExtraction.getSQLType()).toBe("text");
		expect(columns.rawVerification.getSQLType()).toBe("text");
		for (const field of ["candidate", "evidence", "verification", "corrections"]) {
			expect(columns).toHaveProperty(field);
		}
		for (const field of ["model", "promptVersion", "recognizedType"]) {
			expect(columns).toHaveProperty(field);
		}
	});

	it("declares work fencing, terminal state, source identity and audit lookup constraints", () => {
		const config = getTableConfig(schema.foodAnnouncementIngestions);
		expect(config.foreignKeys).toHaveLength(1);
		expect(config.checks.map((check) => check.name)).toEqual(
			expect.arrayContaining([
				"chk_food_ingestion_attempts",
				"chk_food_ingestion_lease",
				"chk_food_ingestion_completion",
				"chk_food_ingestion_identity",
			]),
		);
		expect(config.indexes.map((index) => index.config.name)).toContain(
			"idx_food_ingestion_runnable",
		);
		const audit = getTableConfig(schema.messIngestionOperationAudits);
		expect(audit.indexes.map((index) => index.config.name)).toEqual(
			expect.arrayContaining(["idx_mess_audit_source", "idx_mess_audit_fact_keys"]),
		);
	});
});
