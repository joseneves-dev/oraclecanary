# Production image of the OracleCanary API: FrankenPHP (Caddy + PHP 8.4) serving Symfony.
FROM dunglas/frankenphp:1-php8.4

RUN install-php-extensions pdo_pgsql intl opcache apcu zip \
	&& mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

ENV APP_ENV=prod \
	APP_DEBUG=0 \
	COMPOSER_ALLOW_SUPERUSER=1

WORKDIR /app

# Dependencies first so they are cached between code changes.
COPY composer.json composer.lock symfony.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-progress

COPY . .
RUN composer dump-autoload --classmap-authoritative --no-dev \
	&& composer run-script --no-dev post-install-cmd \
	&& php bin/console asset-map:compile \
	&& chmod +x docker/entrypoint.sh

COPY docker/Caddyfile /etc/frankenphp/Caddyfile

ENTRYPOINT ["docker/entrypoint.sh"]
CMD ["frankenphp", "run", "--config", "/etc/frankenphp/Caddyfile", "--adapter", "caddyfile"]
