import { Plugin } from '../core/ports/PluginRegistryPort';

export class CalculatorPlugin implements Plugin {
  readonly name = 'calculate';
  readonly description = 'Evaluates a basic mathematical expression (e.g. "2 + 2", "15 * 3 - 4")';
  readonly schema = {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'The math expression to calculate',
      },
    },
    required: ['expression'],
  };

  async execute(args: any): Promise<string> {
    const expr = args?.expression;
    if (typeof expr !== 'string' || expr.trim() === '') {
      return 'Error: Missing expression argument.';
    }

    const trimmed = expr.trim();
    if (!/^[0-9+\-*/().\s]+$/.test(trimmed)) {
      return 'Error: Expression contains invalid characters.';
    }

    try {
      const result = this.evaluateArithmetic(trimmed);
      if (!Number.isFinite(result)) {
        return 'Error: Division by zero.';
      }
      return String(result);
    } catch {
      return 'Error: Invalid mathematical expression.';
    }
  }

  private evaluateArithmetic(expression: string): number {
    const tokens = this.tokenize(expression);
    let index = 0;

    const parsePrimary = (): number => {
      const token = tokens[index++];
      if (token === '(') {
        const val = parseAddSub();
        if (tokens[index++] !== ')') {
          throw new Error('Mismatched parentheses');
        }
        return val;
      }
      if (token === '-') {
        return -parsePrimary();
      }
      const num = Number(token);
      if (Number.isNaN(num)) {
        throw new Error(`Unexpected token: ${token}`);
      }
      return num;
    };

    const parseMulDiv = (): number => {
      let left = parsePrimary();
      while (index < tokens.length && (tokens[index] === '*' || tokens[index] === '/')) {
        const op = tokens[index++];
        const right = parsePrimary();
        if (op === '*') {
          left *= right;
        } else {
          if (right === 0) {
            return Infinity;
          }
          left /= right;
        }
      }
      return left;
    };

    const parseAddSub = (): number => {
      let left = parseMulDiv();
      while (index < tokens.length && (tokens[index] === '+' || tokens[index] === '-')) {
        const op = tokens[index++];
        const right = parseMulDiv();
        if (op === '+') {
          left += right;
        } else {
          left -= right;
        }
      }
      return left;
    };

    const result = parseAddSub();
    if (index < tokens.length) {
      throw new Error(`Unexpected extra token: ${tokens[index]}`);
    }
    return result;
  }

  private tokenize(expr: string): string[] {
    const tokens: string[] = [];
    const re = /\s*([0-9]+(?:\.[0-9]+)?|[+\-*/()])\s*/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = re.exec(expr)) !== null) {
      if (expr.slice(lastIndex, match.index).trim() !== '') {
        throw new Error('Failed to tokenize entire expression');
      }
      tokens.push(match[1]);
      lastIndex = re.lastIndex;
    }

    if (lastIndex !== expr.length && expr.slice(lastIndex).trim() !== '') {
      throw new Error('Failed to tokenize entire expression');
    }

    return tokens;
  }
}
