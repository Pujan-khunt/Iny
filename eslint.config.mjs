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
		files: ["src/**/schema.ts", "tests/**/*.ts"],
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
		files: ["scripts/**/*.ts"],
		rules: {
			"max-lines": "off",
		},
	},
);
