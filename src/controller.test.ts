import { ControllerFleet } from './controller';

// Need to mock the env store since it tries
// to read environment variables upon module load
jest.mock('./env');

describe('delta', () => {
  it('should correctly return controllers to add and remove', () => {
    expect(ControllerFleet.delta({}, [])).toEqual({
      add: [],
      remove: []
    });

    expect(
      ControllerFleet.delta(
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
      ControllerFleet.delta(
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
      ControllerFleet.delta(
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
      ControllerFleet.delta(
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
      ControllerFleet.delta(
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
      ControllerFleet.delta(
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
