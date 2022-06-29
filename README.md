# agent-worker

This repository contains the source code of the worker component in the agent platform.
The worker is responsible for the following:

- Discovering the desired state of the controller fleet from Superblocks Cloud
- Registration against controllers
- Managing a fleet of controllers
- Reporting diagnostics and metrics to Superblocks Cloud
- Exposing metrics via Prometheus
- Executing API steps

Learn more about the On-Premise Agent [here](https://docs.superblocks.com/on-premise-agent/overview).

## Build locally

A Makefile has been included for convenience.

### Requirements

- Node v16
- Python v3.10

To transpile the source files:

```bash
make build
```

To build the docker image:

```bash
make docker
```

To build the docker image and launch it via docker-compose:

```bash
make docker-up
```

To run unit tests:

```bash
make test
```
