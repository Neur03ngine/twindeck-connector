# Changelog

## 0.1.3

- Add optional document OCR through the paired home connection, with separate local OCR processing.

## 0.1.2

- Validate command deadlines using the authenticated TwinDeck response time instead of the Home Assistant host clock. Fix state reads and temperature commands being rejected when the host clock differs from the cloud.
- Account conservatively for response rounding and network delay, and use monotonic elapsed time so clock corrections do not extend command validity.

## 0.1.1

- Publish bounded TwinDeck sensor/schedule automations with light and thermostat power actions. Rebuild definitions locally and return only configuration fingerprints for conflict detection.

- Include Home Assistant floor names, area floor assignments, labels and device/entity label assignments for automatic TwinDeck setup suggestions; refresh them on registry changes.

- Relay appliance select/input-select options and button/input-button press actions with bounded payload validation.
- Preserve select options in device snapshots so TwinDeck can show the settings supported by each appliance.

## 0.1.0

- Initial Home Assistant app repository release for amd64 and aarch64.
- Versioned, signed multi-architecture GHCR images, native container checks, and gated stable-branch promotion.
- One-use home-scoped pairing, persistent revocable connector credentials, and outbound HTTPS synchronization.
- Home Assistant WebSocket discovery/state updates and restricted REST command/history relay.
- Automatic reconnection, command expiry, response bounds, and local automation reconstruction.
- Abort in-flight cloud requests on shutdown and prevent startup after a stop during pairing.
