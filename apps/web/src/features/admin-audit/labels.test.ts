import { describe, expect, it } from 'vitest';
import { AUDIT_ORIGIN_LABELS } from './labels';

describe('AUDIT_ORIGIN_LABELS (GES-116)', () => {
  it.each([
    ['web', 'Web'],
    ['app', 'App'],
    ['admin', 'Admin'],
    ['mcp', 'MCP'],
    ['job', 'Job'],
    ['system', 'Sistema'],
  ] as const)('labels origin %s as %s', (origin, label) => {
    expect(AUDIT_ORIGIN_LABELS[origin]).toBe(label);
  });

  it('has exactly the six origins of the spec, in order', () => {
    expect(Object.keys(AUDIT_ORIGIN_LABELS)).toEqual([
      'web',
      'app',
      'admin',
      'mcp',
      'job',
      'system',
    ]);
  });
});
