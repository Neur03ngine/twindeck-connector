# Install TwinDeck Connector

## Requirements

- Home Assistant OS with Supervisor and support for apps/add-ons.
- An amd64 or aarch64 device and an internet connection.
- An owner/admin account for the TwinDeck home you want to pair.
- TwinDeck server support for `/api/devices/connector/claim` and `/api/devices/connector/exchange` deployed on the same HTTPS website you use to sign in.

The connector uses the Supervisor's internal Home Assistant API. No Home Assistant long-lived token needs to be copied into TwinDeck. Home Assistant Container users do not have the Supervisor app store; this package targets Home Assistant OS.

## Install from the app repository

[Add this repository to Home Assistant](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FNeur03ngine%2Ftwindeck-connector),
or open **Settings → Apps → Repositories** and add
`https://github.com/Neur03ngine/twindeck-connector`. Refresh the store and install
**TwinDeck Connector**. Home Assistant downloads the published image for your platform.

## Install locally from source

1. Download and extract this repository on your computer.
2. Use the Home Assistant Samba share or Terminal & SSH app to access its local apps folder. Current Home Assistant releases call it `local_apps` (`/local_apps` in Terminal); older releases use the `addons` share (`/addons`). This is the Supervisor's local-apps directory, not `/config`.
3. Copy the complete `twindeck_connector` folder into that directory. It must contain `config.yaml`, `Dockerfile`, `run.sh`, and the three `.mjs` files directly inside it.
4. To build your local source, remove the `image` key from the copied `config.yaml`. Otherwise Home Assistant pulls the published image and ignores local source changes.
5. Open **Settings → Apps → Install app** (older releases: **Settings → Add-ons → Add-on store**). From the top-right menu choose **Check for updates**, then refresh.
6. Find **TwinDeck Connector** under **Local apps / Local add-ons**, select it, and install. The image builds on your device; the first install needs internet access to fetch the base image and Node.js.

## Pair with your TwinDeck home

1. In TwinDeck, select your home, then **Settings → Home Assistant**.
2. Choose **Local Home Assistant · TwinDeck Connector** and select **Create pairing code**.
3. In the add-on's **Configuration**, enter:

   ```yaml
   twindeck_url: "https://your-twindeck.example"
   pairing_code: "PASTE-THE-CODE-FROM-TWINDECK"
   ```

   Use the exact HTTPS origin of your TwinDeck website, without `/settings` or any other path. The pairing code expires after ten minutes and works once. Treat it as a secret until used.
4. Save, enable **Start on boot**, and start the add-on. Open its **Log** tab: successful setup prints `Paired with your TwinDeck home.`
5. Leave TwinDeck settings open. The status refreshes every five seconds and should change to **Online** after Home Assistant discovery completes.
6. Open the model mapping workspace to match Home Assistant rooms and devices to the IFC model.

Leave the used pairing code in Configuration, or clear it after pairing. A persistent credential in the add-on's `/data/connection.json` lets the add-on reconnect after restarts. To replace a revoked connection, create a fresh code, replace `pairing_code`, save, and restart. Pairing the replacement revokes the previous connector for that home.

### Private Sites hosting

If the TwinDeck website is protected by the Sites **Sign in with ChatGPT** gate, machine requests also need the site's existing service-access credential. Have the site owner obtain it through the Sites connection, then enter it in the add-on's optional **sites_service_token** password field. The connector sends it only to the configured TwinDeck origin in `OAI-Sites-Authorization`; it still uses its separate home-scoped bearer credential for relay authorization. Keep the site's existing audience unchanged. This field stays empty on hosting without that platform gate. Never put this credential in the source repository, pairing code, browser page, or logs.

## How it works and what leaves the home

The connector opens outbound HTTPS requests to your TwinDeck origin on port 443. Nothing listens on a public port. Locally, it connects to the Supervisor REST/WebSocket proxy using `SUPERVISOR_TOKEN`, which never leaves the add-on.

It uploads device entity IDs and states, an allowlist of attributes used by TwinDeck (including temperatures, lighting values and friendly names), room/device/entity registries, temperature units, and timezone. Device history is requested only when TwinDeck asks for it. TwinDeck stores the latest snapshot and short-lived command jobs in its database; it does not receive general access to your LAN. Room and device names are household data visible to authorized members of that TwinDeck home.

The Supervisor credential has Home Assistant administrator authority. The connector independently restricts cloud requests to supported device reads, lighting/climate and existing compatibility controls, and TwinDeck light timers. Arbitrary URLs, Home Assistant user/configuration APIs, shell commands, and arbitrary automation actions are rejected. Keep your TwinDeck origin and pairing code under your control.

## Expected behavior

- States and registries come from Home Assistant's WebSocket API.
- Cloud synchronization polls every three seconds; TwinDeck checks snapshots every two seconds. Expect a few seconds of latency. This first version uses polling rather than a persistent cloud socket to work with TwinDeck's existing hosting bindings.
- Commands expire after twenty seconds. A dispatched command is not automatically replayed. If a request times out, inspect the device state before retrying: the device may already have acted.
- During an internet outage, local Home Assistant continues normally. TwinDeck shows the connector offline after about thirty seconds. The add-on reconnects with backoff.
- Repeated Home Assistant failures also mark the connection offline. The add-on reconnects automatically.
- Disconnect in TwinDeck to revoke the connector and erase its snapshot and queued jobs. Removing only the add-on does not revoke its cloud credential.

## Troubleshooting

- **Pairing failed / HTTP 401:** the code may be expired or already consumed. Generate a new one, update Configuration, and restart. Also use a new code if the add-on's data was lost.
- **HTTP 404 or HTML response:** the TwinDeck relay routes have not been deployed at that address, or the website is behind an interactive sign-in gate that blocks machine API traffic.
- **HTTP 403 / interactive sign-in response:** check host-level access restrictions. For a private Sites website, configure `sites_service_token` as described above. The relay also authenticates the connector independently of browser cookies.
- **Paired but offline:** check that Home Assistant is running, the app has `homeassistant_api` enabled, and the Home Assistant registry APIs are accessible.
- **Connection unavailable:** check outbound HTTPS/DNS and the TwinDeck website. No inbound firewall or router port change is needed.
- **App not listed:** confirm the folder location and inspect Supervisor logs for configuration errors. Preserve Unix (LF) line endings in `run.sh`.
- **Large installations:** snapshots are limited to 1.5 MB and 10,000 entities; individual history responses are limited to 490 KB. A larger request fails rather than silently truncating data.

## Validation status

The standalone suite covers persisted pairing, duplicate/expired/rejected jobs,
acknowledgement retry, privacy filtering, WebSocket discovery, state updates and
shutdown against simulated services. CI additionally lints the app configuration,
builds both native architectures and runs container entry-point/runtime checks.
Full Home Assistant OS pairing and device acceptance tests require a real deployment;
see [CONTRIBUTING.md](../CONTRIBUTING.md). Do not interpret CI success as a physical-device
acceptance test.

Official references: [internal API communication](https://contributors.home-assistant.io/apps/guides/communication/), [local app installation](https://contributors.home-assistant.io/apps/first-app/), and [app configuration](https://contributors.home-assistant.io/apps/reference/configuration/).
