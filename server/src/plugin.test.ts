import { load, unmarshalPluginRequest, sort } from './plugin';

describe('unmarshal', () => {
  it('should correctly create request using includes', () => {
    expect(unmarshalPluginRequest('one,two')).toEqual({
      exclude: false,
      plugins: ['one', 'two']
    });
  });

  it('should correctly create request using excludes', () => {
    expect(unmarshalPluginRequest('!one,two')).toEqual({
      exclude: true,
      plugins: ['one', 'two']
    });
  });

  it('should correctly handle the default case', () => {
    expect(unmarshalPluginRequest('')).toEqual({});
  });

  it('should correctly handle malformed', () => {
    expect(unmarshalPluginRequest('!')).toEqual({});
  });
});

describe('load', () => {
  it('should correctly load plugins', () => {
    expect(
      load(
        {},
        {
          'sb-one-0.0.1': 'foo'
        }
      )
    ).toEqual([{ name: 'one', version: '0.0.1' }]);
  });

  it('should accept multiple plugin versions', () => {
    expect(
      load(
        {},
        {
          'sb-one-v1': 'foo',
          'sb-one-v5': 'foo',
          'sb-two-v1': 'foo',
          'sb-two-v3': 'foo'
        }
      ).sort(sort)
    ).toEqual(
      [
        { name: 'one', version: 'v1' },
        { name: 'one', version: 'v5' },
        { name: 'two', version: 'v1' },
        { name: 'two', version: 'v3' }
      ].sort(sort)
    );
  });

  it('should accept plugins with dashes in them', () => {
    expect(
      load(
        {},
        {
          'sb-ping-pong-v1': 'foo'
        }
      ).sort(sort)
    ).toEqual([{ name: 'ping-pong', version: 'v1' }]);
  });

  it('should correctly handle a custom exclude request', () => {
    expect(
      load(
        {
          exclude: true,
          plugins: ['three', 'four']
        },
        {
          'sb-one-v1': 'foo',
          'sb-two-v5': 'foo',
          'sb-three-v1': 'foo',
          'sb-four-v3': 'foo'
        }
      )
    ).toEqual([
      { name: 'one', version: 'v1' },
      { name: 'two', version: 'v5' }
    ]);
  });

  it('should correctly handle a custom include request', () => {
    expect(
      load(
        {
          exclude: false,
          plugins: ['one', 'two']
        },
        {
          'sb-one-v1': 'foo',
          'sb-two-v5': 'foo',
          'sb-three-v1': 'foo',
          'sb-four-v3': 'foo'
        }
      )
    ).toEqual([
      { name: 'one', version: 'v1' },
      { name: 'two', version: 'v5' }
    ]);
  });

  it('should correctly handle no deps', () => {
    expect(load({}, {})).toEqual([]);
  });

  it('should correctly handle no plugins', () => {
    expect(
      load(
        {},
        {
          foo: 'bar'
        }
      )
    ).toEqual([]);
  });

  it('should correctly handle incorrect plugins', () => {
    expect(
      load(
        {},
        {
          foo: 'bar',
          'sb-one': 'bar',
          'sb-one-two-three': 'bar'
        }
      )
    ).toEqual([{ name: 'one-two', version: 'three' }]);
  });
});
