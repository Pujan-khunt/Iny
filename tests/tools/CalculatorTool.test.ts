import { describe, it, expect } from 'vitest';
import { CalculatorTool } from '../../src/tools/CalculatorTool';

describe('CalculatorTool', () => {
  const tool = new CalculatorTool();

  it('should have correct metadata and definition with valid JSON schema', () => {
    expect(tool.name).toBe('calculate');
    expect(tool.description).toContain('mathematical expression');

    const def = tool.definition;
    expect(def.name).toBe('calculate');
    expect(def.description).toBe(tool.description);
    expect(def.schema).toBeDefined();

    const schema = def.schema as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
    const props = schema.properties as Record<string, unknown>;
    expect(props.expression).toBeDefined();
    expect(schema.required).toContain('expression');
  });

  it('should correctly evaluate basic arithmetic operations', async () => {
    expect(await tool.execute({ expression: '2 + 2' })).toBe('4');
    expect(await tool.execute({ expression: '10 - 3' })).toBe('7');
    expect(await tool.execute({ expression: '4 * 5' })).toBe('20');
    expect(await tool.execute({ expression: '15 / 3' })).toBe('5');
  });

  it('should respect operator precedence and parentheses', async () => {
    expect(await tool.execute({ expression: '2 + 3 * 4' })).toBe('14');
    expect(await tool.execute({ expression: '(3 + 5) * 2' })).toBe('16');
    expect(await tool.execute({ expression: '(2 + 3) * 4' })).toBe('20');
    expect(await tool.execute({ expression: '10 - 2 * (3 + 1)' })).toBe('2');
  });

  it('should handle floating point numbers', async () => {
    expect(await tool.execute({ expression: '2.5 * 2' })).toBe('5');
    expect(await tool.execute({ expression: '7 / 2' })).toBe('3.5');
  });

  it('should handle unary operators and negatives', async () => {
    expect(await tool.execute({ expression: '+5' })).toBe('5');
    expect(await tool.execute({ expression: '3 * +4' })).toBe('12');
    expect(await tool.execute({ expression: '-5 + 2' })).toBe('-3');
    expect(await tool.execute({ expression: '3 * -4' })).toBe('-12');
    expect(await tool.execute({ expression: '10 - -2' })).toBe('12');
    expect(await tool.execute({ expression: '-(2 + 3) * 4' })).toBe('-20');
    expect(await tool.execute({ expression: '.5 * 2' })).toBe('1');
  });

  it('should handle division by zero gracefully, including compound expressions', async () => {
    expect(await tool.execute({ expression: '5 / 0' })).toBe('Error: Division by zero.');
    expect(await tool.execute({ expression: '5 / 0 * 2' })).toBe('Error: Division by zero.');
    expect(await tool.execute({ expression: '10 / 0 / 2' })).toBe('Error: Division by zero.');
    expect(await tool.execute({ expression: '4 + 5 / (2 - 2) * 3' })).toBe('Error: Division by zero.');
    expect(await tool.execute({ expression: '1 / (5 / 0)' })).toBe('Error: Division by zero.');
    expect(await tool.execute({ expression: '2 / (1 / (5 - 5))' })).toBe('Error: Division by zero.');
  });

  it('should return validation error for missing or empty arguments', async () => {
    const missingRes = await tool.execute({});
    expect(missingRes).toContain('Error: Invalid tool arguments');

    const emptyRes = await tool.execute({ expression: '' });
    expect(emptyRes).toContain('Error: Invalid tool arguments');

    const whitespaceRes = await tool.execute({ expression: '   ' });
    expect(whitespaceRes).toContain('Error: Invalid tool arguments');

    const invalidTypeRes = await tool.execute({ expression: 123 as unknown as string });
    expect(invalidTypeRes).toContain('Error: Invalid tool arguments');
  });

  it('should reject invalid or malicious characters', async () => {
    expect(await tool.execute({ expression: 'process.exit(1)' })).toBe(
      'Error: Expression contains invalid characters.'
    );
    expect(await tool.execute({ expression: '2 + abc' })).toBe(
      'Error: Expression contains invalid characters.'
    );
  });

  it('should handle malformed expressions gracefully', async () => {
    expect(await tool.execute({ expression: '2 +* 3' })).toBe(
      'Error: Invalid mathematical expression.'
    );
    expect(await tool.execute({ expression: '(2 + 3' })).toBe(
      'Error: Invalid mathematical expression.'
    );
    expect(await tool.execute({ expression: '2 + (3 *' })).toBe(
      'Error: Invalid mathematical expression.'
    );
  });
});
