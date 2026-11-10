# TwinDeck Home Assistant Apps

[![Build and publish](https://github.com/Neur03ngine/twindeck-connector/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/Neur03ngine/twindeck-connector/actions/workflows/ci.yaml)

Connect Home Assistant to your TwinDeck home through an outbound HTTPS connection.
No router port forwarding, public Home Assistant URL or copied long-lived Home
Assistant token is needed.

| App | Purpose | Platforms |
| --- | --- | --- |
| [TwinDeck Connector](twindeck_connector/DOCS.md) | Pair a home, discover rooms/devices, sync state and relay supported commands | AMD64, ARM64 (`aarch64`) |
| [Hello World](hello_world/DOCS.md) | A complete one-shot example with a configurable log message | AMD64, ARM64 (`aarch64`) |

## Install in Home Assistant

Requires **Home Assistant OS with Supervisor**, internet access and an AMD64 or ARM64
device. Home Assistant Container does not include the app store. The connector also
requires a TwinDeck home with the connector claim/exchange API deployed.

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FNeur03ngine%2Ftwindeck-connector)

Or add it manually:

1. Open **Settings → Apps → Repositories** (on versions with an app-store screen:
   **Settings → Apps → Install app → ⋮ → Repositories**).
2. Add `https://github.com/Neur03ngine/twindeck-connector`.
3. Refresh the store, select **TwinDeck Connector**, and choose **Install**.
4. Create a pairing code in your TwinDeck home's **Settings → Home Assistant**.
5. Save your TwinDeck HTTPS origin and pairing code in the app's **Configuration**,
   enable **Start on boot**, and select **Start**.
6. Check the app log for successful pairing and TwinDeck for **Online**.

```yaml
twindeck_url: "https://your-twindeck.example"
pairing_code: "PASTE-YOUR-ONE-USE-CODE"
sites_service_token: ""
```

Use your actual website origin without a path. The optional Sites service token is
only needed for private Sites hosting. See the [complete guide](twindeck_connector/DOCS.md)
for pairing, credential recovery, data sharing and troubleshooting. Older Home
Assistant releases use the labels **Add-ons** and **Add-on store**.

## Images and releases

| App | Multi-architecture image | Version |
| --- | --- | --- |
| TwinDeck Connector | `ghcr.io/neur03ngine/twindeck-connector` | `0.1.0` |
| Hello World | `ghcr.io/neur03ngine/twindeck-hello-world` | `1.0.0` |

`config.yaml` supplies the image tag through `version`; Docker selects the platform
from the multi-architecture manifest. Both Dockerfiles use the official Home
Assistant `ghcr.io/home-assistant/base:3.24` image and s6-overlay (`init: false`).
The connector installs Alpine's supported Node.js package and verifies native
WebSocket support during the build. The base minor version is pinned; rebuilding
may pick up Alpine security updates, so release a new app version for rebuilt images.

Development happens on `main`. CI validates, tests, builds and signs images, verifies
their platforms, then promotes the commit to the default **`stable`** branch. This
keeps the version Home Assistant sees behind successful publication. Existing version
tags are preserved. See [CONTRIBUTING.md](CONTRIBUTING.md) for release and GHCR visibility
setup, local container testing and the Home Assistant acceptance checklist.

## Privacy and support

The Supervisor credential remains inside the app. Selected entity states and
attributes, household room/device registry information and requested history go to
the configured TwinDeck origin. The connector validates supported operations locally
and requests no inbound ports, host mounts, or elevated capabilities. Protect pairing
codes and backups, and pair only with a TwinDeck deployment you trust.

Use [GitHub Issues](https://github.com/Neur03ngine/twindeck-connector/issues) for bugs,
including app/HA versions, architecture and sanitized logs. See [SECURITY.md](SECURITY.md)
for private vulnerability reporting. Licensed under [MIT](LICENSE).

Built against the current official Home Assistant
[app configuration](https://contributors.home-assistant.io/apps/reference/configuration/),
[repository](https://contributors.home-assistant.io/apps/guides/repository/) and
[publishing](https://contributors.home-assistant.io/apps/guides/publishing/) specifications.
