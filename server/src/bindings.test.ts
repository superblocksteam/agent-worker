import { ExecutionContext } from '@superblocksteam/shared';
import { buildContextFromBindings, resolveAllBindings } from '@superblocksteam/shared-backend';

describe('Building frontend context', () => {
  it('should build frontend context', () => {
    expect(
      buildContextFromBindings({
        'a.b.c': 'super',
        'b.a': 'blocks'
      })
    ).toEqual([
      ['a', { b: { c: 'super' } }],
      ['b', { a: 'blocks' }]
    ]);
  });

  it('should handle arrays correctly', () => {
    expect(
      buildContextFromBindings({
        'a.b[2]': 'super',
        'b.a': 'blocks'
      })
      // eslint-disable-next-line no-sparse-arrays
    ).toEqual([
      ['a', { b: [undefined, undefined, 'super'] }],
      ['b', { a: 'blocks' }]
    ]);
  });

  it('should handle string literal property access correctly', () => {
    expect(
      buildContextFromBindings({
        'a["b"]': 'super',
        'b["a"]': 'blocks'
      })
    ).toEqual([
      ['a', { b: 'super' }],
      ['b', { a: 'blocks' }]
    ]);
  });
});

describe('binding resolution', () => {
  it('resolve a simple binding', async () => {
    const context = new ExecutionContext();
    context.addGlobalVariable('a', 'hello');
    context.addGlobalVariable('b', ' world');
    await expect(resolveAllBindings('SELECT * FROM {{a + b}}', context, {}, false)).resolves.toEqual({
      'a + b': 'hello world'
    });
  });

  it('resolves object bindings', async () => {
    const context = new ExecutionContext();
    context.addGlobalVariable('Dropdown1', { value: 40 });
    context.addGlobalVariable('Widget1', { value: 5 });
    await expect(
      resolveAllBindings('SELECT * FROM table WHERE value < {{65 - Widget1.value + Dropdown1.value}}', context, {}, false)
    ).resolves.toEqual({ '65 - Widget1.value + Dropdown1.value': 100 });
  });

  it('resolves multiple bindings', async () => {
    const context = new ExecutionContext();
    context.addGlobalVariable('Dropdown1', { value: 40 });
    context.addGlobalVariable('Widget1', { value: 5 });
    await expect(resolveAllBindings('{{65 - Widget1.value}} {{Dropdown1.value}}', context, {}, false)).resolves.toEqual({
      '65 - Widget1.value': 60,
      'Dropdown1.value': 40
    });
  });
});
