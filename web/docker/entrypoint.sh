#!/bin/sh
# Waits for the database, applies migrations and warms the cache, then starts the web server.
set -e

if [ "$1" = 'frankenphp' ]; then
	tries=30
	until php bin/console dbal:run-sql -q 'SELECT 1' >/dev/null 2>&1; do
		tries=$((tries - 1))
		if [ "$tries" -le 0 ]; then
			echo 'The database is still unreachable; giving up.' >&2
			exit 1
		fi
		echo 'Waiting for the database...'
		sleep 2
	done

	php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration
	php bin/console cache:warmup
fi

exec docker-php-entrypoint "$@"
