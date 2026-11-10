# Development and releases

Use Node.js 24 LTS (22.13+ supported), npm, Git and Docker Buildx.

```sh
npm ci --ignore-scripts
npm run check
docker buildx build --load --build-arg BUILD_ARCH=amd64 --build-arg BUILD_VERSION=0.1.0 -t local/twindeck-connector ./twindeck_connector
node scripts/container-smoke.mjs twindeck_connector local/twindeck-connector
```

For Hello World use `hello_world`, version `1.0.0`, and a separate local image tag.
Use `--platform linux/arm64` and `BUILD_ARCH=aarch64` on ARM64; cross builds on x86
need QEMU. CI uses native GitHub-hosted AMD64 and ARM64 runners.

## Release process

Work on `main` (feature branches can use `codex/`). Bump the changed app's `version`
in `config.yaml`, update `CHANGELOG.md`, and open a pull request to `main`.
The version is the exact immutable GHCR tag; `image` has no tag or `{arch}` placeholder.
The npm package version is tooling metadata, independent of app image versions.

Pull requests validate and build all apps without publishing. A push to `main`
automatically validates configuration, lints shells, runs unit tests, builds native
candidates, and exercises their entry points. Only tested candidates are published
and signed with the official Home Assistant builder actions. The workflow combines
per-architecture images into one signed manifest, verifies AMD64 and ARM64 entries,
then advances `stable`. Set `stable` as the GitHub default branch so Home Assistant
only sees versions whose images already exist. Never push directly to `stable`.

Retries skip existing version tags. CI rejects image source changes without a
version increment compared with `origin/stable`. If a release partly failed after
uploading an image, do not change its code under that version: retry the identical
commit, or bump the version before making corrections. No mutable `latest` tag is
used by Home Assistant.

## Initial GitHub setup

The configured repository is `Neur03ngine/twindeck-connector`. Forks must replace
the repository URL, app URLs, README installation link, Docker OCI source labels,
image namespace and matching validation assertions. GHCR names must be lowercase.

1. Push this repository to `main` in the public GitHub repository.
2. Enable Actions and allow the release jobs' declared `contents: write`,
   `packages: write`, and `id-token: write` permissions. `GITHUB_TOKEN` handles
   authentication; no PAT secret is needed.
3. Wait for the architecture and manifest build jobs to finish.
4. In GitHub Packages, make **all six container packages public** (two manifest
   packages and four architecture packages). New GHCR packages may start private.
   A public source repository does not automatically make packages public.
5. Re-run the workflow after changing visibility. Its promotion job verifies
   anonymous pulls and Supervisor labels before creating `stable`. Set `stable`
   as the repository default branch. The main images are
   `ghcr.io/neur03ngine/twindeck-connector:0.1.0` and
   `ghcr.io/neur03ngine/twindeck-hello-world:1.0.0` on both platforms.
6. Add the repository to Home Assistant OS and run the acceptance test below.

GHCR visibility may require a package administrator; `GITHUB_TOKEN` cannot always
change it. Branch policies must allow the workflow's fast-forward push to `stable`.
If publishing or promotion fails, `stable` remains at its last good version.

## Home Assistant acceptance test

Add the repository through Settings → Apps → Repositories. Install each app on AMD64
and ARM64. Confirm Hello World logs its configured message and stops successfully.
Pair the connector with a test home, verify room/entity discovery, state changes,
one supported command and history. Restart the app to check persisted pairing.
Disconnect the internet, restore it and confirm recovery. Revoke the connector in
TwinDeck and check that it stops rather than retrying a revoked credential. Confirm
logs and outbound payloads contain no Supervisor token. Record device and HA versions
in release notes; mocked and plain-Docker tests do not replace this acceptance test.

Official specifications: [repository](https://contributors.home-assistant.io/apps/guides/repository/),
[configuration](https://contributors.home-assistant.io/apps/reference/configuration/),
[publishing](https://contributors.home-assistant.io/apps/guides/publishing/),
[testing](https://contributors.home-assistant.io/apps/guides/testing/).
