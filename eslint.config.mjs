import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";

export default tseslint.config(
	{
		ignores: [
			"dist/**",
			"node_modules/**",
			"coverage/**",
			".worktrees/**",
			".superpowers/**",
			"drizzle/**",
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts", "drizzle.config.ts"],
		plugins: {
			import: importPlugin,
		},
		rules: {
			"max-lines": [
				"error",
				{
					max: 150,
					skipBlankLines: true,
					skipComments: true,
				},
			],
			"max-lines-per-function": [
				"error",
				{
					max: 40,
					skipBlankLines: true,
					skipComments: true,
				},
			],
			"max-depth": ["error", 3],
			complexity: ["error", 10],
			"no-else-return": ["error", { allowElseIf: false }],
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
			"@typescript-eslint/no-explicit-any": "warn",
			"import/no-cycle": ["error", { maxDepth: Infinity }],
			"no-restricted-syntax": [
				"error",
				{
					selector: "ImportDeclaration[source.value=/\\.js$/]",
					message: "Do not include .js extension in TypeScript imports.",
				},
				{
					selector: "ImportDeclaration[source.value=/\\.ts$/]",
					message: "Do not include .ts extension in TypeScript imports.",
				},
			],
		},
	},
	{
		files: ["src/**/schema.ts"],
		rules: {
			"max-lines": [
				"error",
				{
					max: 400,
					skipBlankLines: true,
					skipComments: true,
				},
			],
			"max-lines-per-function": "off",
		},
	},
	{
		files: ["tests/**/*.ts"],
		rules: {
			"max-lines": "off",
			"max-lines-per-function": "off",
			"max-depth": "off",
			complexity: "off",
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
	{
		files: ["scripts/**/*.ts"],
		rules: {
			"max-lines": "off",
			"max-lines-per-function": "off",
			"max-depth": "off",
			complexity: "off",
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
	{
		// Pre-existing legacy adapters pending dedicated remediation PRs
		files: [
			"src/adapters/inbound/cli/InteractiveJsonEditor.ts",
			"src/adapters/inbound/cli/MediaPreviewer.ts",
			"src/adapters/inbound/cli/TriageCliController.ts",
			"src/adapters/outbound/mess/extraction/DeepseekTextExtractor.ts",
			"src/adapters/outbound/mess/extraction/DeepseekVisionExtractor.ts",
			"src/adapters/outbound/mess/extraction/ExtractorUtils.ts",
			"src/adapters/outbound/mess/extraction/PdfRasterizer.ts",
			"src/adapters/outbound/mess/formatting/MessCardRenderer.ts",
			"src/adapters/outbound/whatsapp/BaileysConnectionManager.ts",
			"src/adapters/outbound/whatsapp/PostgresBaileysSessionManager.ts",
		],
		rules: {
			"max-lines": "off",
			"max-lines-per-function": "off",
			"max-depth": "off",
			complexity: "off",
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
);
