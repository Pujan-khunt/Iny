import { describe, it, expect, vi, beforeEach } from "vitest";
import { SetDefaultMessTool } from "../../src/tools/SetDefaultMessTool";
import { AccessControlPort } from "../../src/core/ports/AccessControlPort";

describe("SetDefaultMessTool", () => {
	let mockAccessControl: AccessControlPort;

	beforeEach(() => {
		mockAccessControl = {
			authenticate: vi.fn(),
			getUser: vi.fn(),
			setDefaultVendor: vi.fn().mockResolvedValue(undefined),
		};
	});

	it("exposes definition with correct name and schema", () => {
		const tool = new SetDefaultMessTool(mockAccessControl);
		expect(tool.name).toBe("set_default_mess");
		expect(tool.description).toContain("default mess");
		expect(tool.definition.name).toBe("set_default_mess");
	});

	it("successfully updates user default vendor and returns terminal confirmation", async () => {
		const tool = new SetDefaultMessTool(mockAccessControl);
		const result = await tool.execute({ vendor: "tcb" }, { userId: "919876543210" });

		expect(result.isTerminal).toBe(true);
		expect(result.content).toContain("default vendor has been updated to *TCB*");
		expect(mockAccessControl.setDefaultVendor).toHaveBeenCalledWith("919876543210", "tcb");
	});

	it("updates default vendor to cheftalk_regular", async () => {
		const tool = new SetDefaultMessTool(mockAccessControl);
		const result = await tool.execute({ vendor: "cheftalk_regular" }, { userId: "919876543210" });

		expect(result.isTerminal).toBe(true);
		expect(result.content).toContain("default vendor has been updated to *Cheftalk*");
		expect(mockAccessControl.setDefaultVendor).toHaveBeenCalledWith(
			"919876543210",
			"cheftalk_regular",
		);
	});

	it("updates default vendor to cheftalk_jain", async () => {
		const tool = new SetDefaultMessTool(mockAccessControl);
		const result = await tool.execute({ vendor: "cheftalk_jain" }, { userId: "919876543210" });

		expect(result.isTerminal).toBe(true);
		expect(result.content).toContain("default vendor has been updated to *Cheftalk Jain*");
		expect(mockAccessControl.setDefaultVendor).toHaveBeenCalledWith(
			"919876543210",
			"cheftalk_jain",
		);
	});

	it("returns terminal error message when execution context lacks userId", async () => {
		const tool = new SetDefaultMessTool(mockAccessControl);
		const result = await tool.execute({ vendor: "tcb" });

		expect(result.isTerminal).toBe(true);
		expect(result.content).toContain("Error: No user identity found");
		expect(mockAccessControl.setDefaultVendor).not.toHaveBeenCalled();
	});

	it("returns validation error when invalid vendor argument is provided", async () => {
		const tool = new SetDefaultMessTool(mockAccessControl);
		const result = await tool.execute(
			{ vendor: "invalid_vendor" as any },
			{ userId: "919876543210" },
		);

		expect(result.isTerminal).toBe(false);
		expect(result.content).toContain("Error: Invalid tool arguments");
		expect(mockAccessControl.setDefaultVendor).not.toHaveBeenCalled();
	});
});
