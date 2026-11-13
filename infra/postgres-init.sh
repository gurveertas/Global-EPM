#!/bin/sh
# Creates the eszy_app role the API uses. It has no BYPASSRLS, so row-level security always applies.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE eszy_app LOGIN PASSWORD '${ESZY_APP_PASSWORD}';
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO eszy_app;
SQL
