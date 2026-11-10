#!/command/with-contenv bashio
# shellcheck shell=bash
set -euo pipefail

# Read the mounted options directly so this example also runs without Supervisor.
message="$(jq -er '.message | select(type == "string" and length > 0 and length <= 200)' /data/options.json)"
bashio::log.info "${message}"
