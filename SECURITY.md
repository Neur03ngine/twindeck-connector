# Security policy

Use the latest published version. To report a vulnerability, use this repository's
GitHub **Security → Report a vulnerability** private reporting flow. Do not post
credentials or household data in a public issue. If private reporting is unavailable,
contact the repository owner privately before sharing technical details.

The connector's Supervisor token has administrator access to Home Assistant and
remains local. Supported entity states, selected attributes, room/device names,
registry IDs, and requested history leave the home for the configured HTTPS origin.
Only pair with a TwinDeck deployment you trust. Pairing and connection secrets are
stored under `/data` and in Home Assistant app configuration/backups; protect backups.

No inbound ports, host networking, host filesystem mappings, Docker socket access,
or privileged capabilities are requested. Cloud operations are validated locally.
Disconnect the connector in TwinDeck to revoke its credential before uninstalling
or transferring a device. Restore backups only to trusted installations.

Release workflows use restricted job permissions, pinned actions, native architecture
tests and Cosign signatures. Version tags are never deliberately overwritten.
