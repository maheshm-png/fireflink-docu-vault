#!/bin/sh
set -e

set -a
. /etc/environment
set +a

cd /app
exec npm run "$1"
