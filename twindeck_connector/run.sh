#!/command/with-contenv bash
# shellcheck shell=bash
set -euo pipefail
umask 077
exec node /app/connector.mjs
