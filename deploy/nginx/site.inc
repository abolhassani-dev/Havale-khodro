# The site, once — included by both the HTTP server (app.conf) and the HTTPS
# server (ssl.conf, written by enable-ssl.sh).
#
# Every location, header, limit and trap lives here so that the two servers
# cannot drift. They did: the HTTPS block used to be a second, shorter copy
# written by the script, and it had quietly lost the dotfile deny, the error
# page, the scanner trap and — because its cache locations set a header of
# their own — every security header on the JavaScript and CSS. One body, two
# `listen` lines.
#
# Not named *.conf on purpose: everything matching that pattern in this
# directory is auto-included at the http level, and this belongs inside a
# server block.

    root /usr/share/nginx/html;
    index index.html;

    client_max_body_size 2m;
    server_tokens off;

    # No directory listings, anywhere.
    #
    # `off` is nginx's own default, so this changes nothing today — it is here
    # because the day somebody adds a `location` for a new folder, the default
    # is the thing they will not think about, and a listing of /assets/ or of
    # an uploads directory is a map of the server drawn for whoever asked.
    autoindex off;

    # And when something is missing or closed, the visitor gets the site's own
    # page with a way back, not nginx's grey «404 Not Found» — which looks like
    # a broken server rather than a wrong address. Only for errors nginx itself
    # produces: an /api/ response is passed through untouched (there is no
    # proxy_intercept_errors below), because the caller there is a program and
    # an HTML apology is an unparseable answer.
    error_page 403 404 /error.html;
    location = /error.html {
        internal;
    }

    gzip on;
    gzip_types application/json text/plain text/css application/javascript image/svg+xml;
    gzip_min_length 1024;
    # Compression is nginx's alone now — the API stopped doing it, because zlib
    # on the event loop was the most expensive thing that process did.
    #
    # `gzip_proxied any` matters more here than it looks: nginx decides a
    # request is «proxied» by the presence of a Via header, and the default is
    # to send those responses uncompressed. Plenty of people reach this site
    # through a company proxy or a filtering middlebox that adds one — and
    # those are exactly the connections that can least afford an uncompressed
    # payload.
    gzip_proxied any;
    gzip_vary on;

    # Where certbot proves the domain is yours. Must stay above the catch-all
    # location, or the SPA fallback would swallow the challenge and no
    # certificate would ever issue.
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Dotfiles are never part of the interface.
    #
    # Nothing sensitive lives in the document root, so this changes no outcome
    # today: /.env already resolves to nothing and falls through to the SPA
    # rule. What it changes is the answer — 404 instead of 200-with-the-app —
    # and that matters more than it sounds. A scanner, an auditor, or our own
    # preflight asking "is /.env served?" gets a 200 either way, and has to
    # inspect the body to tell a safe server from a compromised one. Saying no
    # plainly removes the ambiguity, and holds if the document root ever moves.
    #
    # Below the ACME block on purpose: `^~` outranks a regex location, so the
    # challenge path is matched before this rule is ever considered. The other
    # order would make certificate renewal fail, silently, ninety days later.
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }

    # ---- what the web root must never hand out ----
    #
    # The whole frontend/ directory is the document root, and the repository
    # keeps more in it than the site: the smoke tests, the dev server, the
    # image-cropping scripts, package.json. None of it is secret, all of it is
    # a map — and a map of the admin selectors and endpoints is a gift to
    # whoever is walking this server. Answered 404, same as a wrong address.
    location ~ ^/(tests|scripts|node_modules)(/|$) {
        return 404;
    }
    location ~ ^/(package(-lock)?\.json|README\.md|[^/]*\.mjs)$ {
        return 404;
    }

    # ---- security headers ----
    #
    # In their own file, and repeated in every location that sets a header of
    # its own: nginx inherits `add_header` only into blocks that declare none,
    # so the two locations below that set Cache-Control were dropping all of
    # these from exactly the responses that carry the JavaScript and the CSS.
    include /etc/nginx/conf.d/security-headers.inc;

    # ---- the scanner trap ----
    #
    # Without this, an automated scan is invisible. `/wp-login.php` matches no
    # file, falls through to the SPA rule below, and is answered with the
    # application's index.html — a 200, from nginx, that the API never hears
    # about. So the whole class of «somebody is walking a wordlist against us»
    # does not appear in any log the owner can read.
    #
    # These patterns belong to other people's software and appear in no link,
    # no bookmark and no page of this product, so nothing legitimate is routed
    # here. Matching requests go to the API, which records where they came from
    # and answers 404 — the same answer as before, now with a record.
    #
    # A regex location, so it is evaluated after the `^~` blocks above and the
    # ACME challenge can never be caught by it.
    location ~* (?:/wp-(?:login|admin|content|includes)|/xmlrpc\.php|/phpmyadmin|/pma/|/adminer|/cgi-bin/|/vendor/phpunit|/actuator/|/solr/|/jenkins/|\.(?:php|asp|aspx|jsp|cgi|env|sql|bak)$) {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Connection        "";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # A scanner sends thousands of these. Nothing here needs a large body,
        # a long wait, or a line in the access log.
        client_max_body_size 1k;
        proxy_read_timeout 5s;
        access_log off;
    }

    location /api/ {
        if ($go_https) { return 301 https://$host$request_uri; }
        # Never in a search result. Nothing under here is a page, and an API
        # address indexed under the site's name is an invitation to walk it.
        add_header X-Robots-Tag "noindex, nofollow" always;
        include /etc/nginx/conf.d/security-headers.inc;
        proxy_pass http://api;
        proxy_http_version 1.1;
        # Without this, the `keepalive 32` in the upstream block above does
        # nothing: nginx passes the client's own Connection header through, so
        # every API call opened a fresh TCP connection to Node and paid for the
        # handshake. Emptying it is what actually reuses the pool.
        proxy_set_header Connection        "";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        # Ticket attachments: three files at five megabytes each, plus the
        # multipart overhead. The server's 2m ceiling would refuse them here —
        # as a bare nginx 413, before the API could say anything useful.
        client_max_body_size 20m;
    }

    # Deliberately without the HTTPS redirect the other locations carry: the
    # container healthcheck and update.sh both curl this over plain HTTP on
    # localhost, and a 301 would make a healthy system report itself down.
    # An exact-match location wins over the prefix one above, so this stays
    # reachable no matter what mode the site is in.
    location = /api/v1/health {
        proxy_pass http://api/api/v1/health;
        access_log off;
    }

    # Assets never change under the same name, so they can be held for a year.
    # The font alone is 110 KB that should be fetched once per browser.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        include /etc/nginx/conf.d/security-headers.inc;
    }

    # Application code changes on every deploy. Caching it would mean an agency
    # running last week's interface against this week's API.
    location /src/ {
        expires -1;
        add_header Cache-Control "no-cache";
        include /etc/nginx/conf.d/security-headers.inc;
    }

    location / {
        # $go_https is 1 only for plain-HTTP requests once enable-ssl.sh has
        # flipped 00-mode.conf (see 01-redirect.conf). Deliberately inside the
        # locations rather than at server level: a server-level redirect would
        # catch the ACME challenge above too, and certbot could never renew.
        if ($go_https) { return 301 https://$host$request_uri; }
        try_files $uri $uri/ /index.html;
    }
