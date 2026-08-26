#!/bin/sh
set -e

# Restore the latest DBs from GCS if a replica exists (first boot = no-op).
# Every database listed in litestream.yml needs a line here, otherwise it
# starts empty on each new revision with no error to warn you.
litestream restore -if-replica-exists -config /etc/litestream.yml /data/waitlist.db || true
litestream restore -if-replica-exists -config /etc/litestream.yml /data/careers.db || true

# Run the app under Litestream so every write is replicated to GCS.
exec litestream replicate -config /etc/litestream.yml -exec "node server.js"
