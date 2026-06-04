#!/bin/sh
set -e

# Restore the latest DB from GCS if a replica exists (first boot = no-op).
litestream restore -if-replica-exists -config /etc/litestream.yml /data/waitlist.db || true

# Run the app under Litestream so every write is replicated to GCS.
exec litestream replicate -config /etc/litestream.yml -exec "node server.js"
