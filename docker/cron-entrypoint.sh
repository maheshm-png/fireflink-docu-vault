#!/bin/sh
set -e

# cron strips its own environment before running jobs (it rebuilds a bare
# one from /etc/passwd), so the DATABASE_URL/SUPABASE_*/etc. vars this
# container was started with would otherwise never reach the job scripts.
# Dump them once here, at container startup, and have run-cron-job.sh
# source the file before each job.
printenv | grep -v -E '^(HOME|PWD|SHLVL|_|OLDPWD)=' > /etc/environment

exec cron -f
