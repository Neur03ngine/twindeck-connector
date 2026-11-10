# Hello World

Install **Hello World** from this repository in the Home Assistant app store.
Set `message` in Configuration to a greeting of 1–200 characters, save, and select
**Start**. The greeting appears in the app's Log tab. The app then exits successfully;
the stopped state is expected because `startup: once` makes this a one-shot example.
Select Start again to print another greeting.

```yaml
message: Hello from TwinDeck!
```

Supports amd64 and aarch64 (ARM64). It uses the official Home Assistant Alpine
base image, Bashio logging, and `/data/options.json`. It requests no Home Assistant
API, host mounts, ports, hardware, or elevated privileges. It does not pair a home
or connect to TwinDeck; install **TwinDeck Connector** for that functionality.

For local Docker testing, mount a directory containing the JSON equivalent of the
configuration as `/data`. A missing or invalid message exits with a nonzero code.
