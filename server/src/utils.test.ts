import { unmarshalLabels, delta } from './utils';

// Need to mock the env store since it tries
// to read environment variables upon module load
jest.mock('./env');

describe('unmarshalLabels', () => {
  it('should correctly unmarshal no labels', () => {
    expect(unmarshalLabels('')).toEqual({});
  });
  it('should correctly unmarshal labels', () => {
    expect(unmarshalLabels('one=two,three=four')).toEqual({
      one: 'two',
      three: 'four'
    });
  });
  it('should correctly handle duplicate labels', () => {
    expect(unmarshalLabels('one=two,three=four,one=five')).toEqual({
      one: 'five',
      three: 'four'
    });
  });
  it('should correctly handle maformed labels', () => {
    expect(unmarshalLabels('one=two,three=,one=five')).toEqual({
      one: 'five'
    });
    expect(unmarshalLabels('one=two,=,one=five')).toEqual({
      one: 'five'
    });
    expect(unmarshalLabels('one=,=,=five')).toEqual({});
  });
});

describe('delta', () => {
  it('should correctly return controllers to add and remove', () => {
    expect(delta({}, [])).toEqual({
      add: [],
      remove: []
    });

    expect(
      delta(
        {
          'https://localhost:5001': null,
          'https://localhost:5002': null
        },
        [{ url: 'https://localhost:5001' }, { url: 'https://localhost:5002' }]
      )
    ).toEqual({
      add: [],
      remove: []
    });

    expect(
      delta(
        {
          'https://localhost:5001': null,
          'https://localhost:5002': null,
          'https://localhost:5003': null
        },
        [{ url: 'https://localhost:5001' }, { url: 'https://localhost:5002' }]
      )
    ).toEqual({
      add: [],
      remove: ['https://localhost:5003']
    });

    expect(
      delta(
        {
          'https://localhost:5001': null,
          'https://localhost:5002': null
        },
        [{ url: 'https://localhost:5001' }, { url: 'https://localhost:5002' }, { url: 'https://localhost:5003' }]
      )
    ).toEqual({
      add: [{ url: 'https://localhost:5003' }],
      remove: []
    });

    expect(
      delta(
        {
          'https://localhost:5001': null,
          'https://localhost:5002': null,
          'https://localhost:5004': null
        },
        [{ url: 'https://localhost:5001' }, { url: 'https://localhost:5002' }, { url: 'https://localhost:5003' }]
      )
    ).toEqual({
      add: [{ url: 'https://localhost:5003' }],
      remove: ['https://localhost:5004']
    });

    expect(
      delta(
        {
          'https://localhost:5004': null,
          'https://localhost:5001': null,
          'https://localhost:5002': null
        },
        [{ url: 'https://localhost:5003' }, { url: 'https://localhost:5001' }, { url: 'https://localhost:5002' }]
      )
    ).toEqual({
      add: [{ url: 'https://localhost:5003' }],
      remove: ['https://localhost:5004']
    });

    expect(
      delta(
        {
          'https://localhost:5004': null,
          'https://localhost:5001': null,
          'https://localhost:5002': null,
          'https://localhost:5022': null
        },
        [
          { url: 'https://localhost:5003' },
          { url: 'https://localhost:5001' },
          { url: 'https://localhost:5002' },
          { url: 'https://localhost:5032' }
        ]
      )
    ).toEqual({
      add: [{ url: 'https://localhost:5003' }, { url: 'https://localhost:5032' }],
      remove: ['https://localhost:5004', 'https://localhost:5022']
    });
  });
});
