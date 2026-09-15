import { describe, it, expect } from 'vitest';
import { CalculatorPlugin } from '../../src/plugins/CalculatorPlugin';

describe('CalculatorPlugin', () => {
  const plugin = new CalculatorPlugin();

  it('should have correct metadata and schema', () => {
    expect(plugin.name).toBe('calculate');
    expect(plugin.description).toContain('mathematical expression');
    expect(plugin.schema).toEqual({
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The math expression to calculate',
        },
      },
      required: ['expression'],
    });
  });

  it('should correctly evaluate basic arithmetic operations', async () => {
    expect(await plugin.execute({ expression: '2 + 2' })).toBe('4');
    expect(await plugin.execute({ expression: '10 - 3' })).toBe('7');
    expect(await plugin.execute({ expression: '4 * 5' })).toBe('20');
    expect(await plugin.execute({ expression: '15 / 3' })).toBe('5');
  });

  it('should respect operator precedence and parentheses', async () => {
    expect(await plugin.execute({ expression: '2 + 3 * 4' })).toBe('14');
    expect(await plugin.execute({ expression: '(2 + 3) * 4' })).toBe('20');
    expect(await plugin.execute({ expression: '10 - 2 * (3 + 1)' })).toBe('2');
  });

  it('should handle floating point numbers', async () => {
    expect(await plugin.execute({ expression: '2.5 * 2' })).toBe('5');
    expect(await plugin.execute({ expression: '7 / 2' })).toBe('3.5');
  });

  it('should reject invalid or malicious characters', async () => {
    expect(await plugin.execute({ expression: 'process.exit(1)' })).toBe(
      'Error: Expression contains invalid characters.'
    );
    expect(await plugin.execute({ expression: '2 + abc' })).toBe(
      'Error: Expression contains invalid characters.'
    );
  });

  it('should handle division by zero gracefully, including compound expressions', async () => {
    expect(await plugin.execute({ expression: '5 / 0' })).toBe(
      'Error: Division by zero.'
    );
    expect(await plugin.execute({ expression: '5 / 0 * 2' })).toBe(
      'Error: Division by zero.'
    );
    expect(await plugin.execute({ expression: '10 / 0 / 2' })).toBe(
      'Error: Division by zero.'
    );
    expect(await plugin.execute({ expression: '4 + 5 / (2 - 2) * 3' })).toBe(
      'Error: Division by zero.'
    );
    expect(await plugin.execute({ expression: '1 / (5 / 0)' })).toBe(
      'Error: Division by zero.'
    );
    expect(await plugin.execute({ expression: '2 / (1 / (5 - 5))' })).toBe(
      'Error: Division by zero.'
    );
  });

  it('should handle unary plus', async () => {
    expect(await plugin.execute({ expression: '+5' })).toBe('5');
    expect(await plugin.execute({ expression: '3 * +4' })).toBe('12');
  });

  it('should handle leading decimal numbers', async () => {
    expect(await plugin.execute({ expression: '.5 * 2' })).toBe('1');
  });

  it('should handle unary minus and negative numbers', async () => {
    expect(await plugin.execute({ expression: '-5 + 2' })).toBe('-3');
    expect(await plugin.execute({ expression: '3 * -4' })).toBe('-12');
    expect(await plugin.execute({ expression: '10 - -2' })).toBe('12');
    expect(await plugin.execute({ expression: '-(2 + 3) * 4' })).toBe('-20');
  });

  it('should handle missing or empty expression arguments gracefully', async () => {
    expect(await plugin.execute({})).toBe('Error: Missing expression argument.');
    expect(await plugin.execute({ expression: '' })).toBe('Error: Missing expression argument.');
    expect(await plugin.execute({ expression: '   ' })).toBe('Error: Missing expression argument.');
  });

  it('should handle malformed expressions gracefully', async () => {
    expect(await plugin.execute({ expression: '2 +* 3' })).toBe(
      'Error: Invalid mathematical expression.'
    );
    expect(await plugin.execute({ expression: '(2 + 3' })).toBe(
      'Error: Invalid mathematical expression.'
    );
    expect(await plugin.execute({ expression: '2 + (3 *' })).toBe(
      'Error: Invalid mathematical expression.'
    );
  });
});
