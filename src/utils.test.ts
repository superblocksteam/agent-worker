import { unmarshalLabels } from './utils';

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
