# The security headers, in one file because nginx does not inherit them.
#
# `add_header` is inherited from the enclosing block only while the inner block
# declares none of its own. `location /assets/` and `location /src/` each set a
# Cache-Control header — and in doing so silently dropped every header below
# from the responses that carry this product's JavaScript and CSS. The ones
# that matter there most: `nosniff`, so a file served with the wrong type is
# not executed as another, and the policy itself.
#
# Not named *.conf on purpose: everything matching that pattern in this
# directory is auto-included at the http level by nginx's own configuration,
# and these directives belong inside a server or a location.
#
# The policy is the second line of defence behind the escaping in ui/html.js:
# even if a script tag were injected, the browser would refuse to run it.
# `unsafe-inline` is absent from script-src on purpose — nothing in this
# frontend uses an inline script or an onclick attribute, so allowing them
# would weaken this for no gain.
#
# style-src keeps 'unsafe-inline' because the markup uses a few inline style
# attributes, and so does the standalone error page. Those cannot execute code.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "same-origin" always;
# No third-party embedding. Clickjacking a "suspend account" button is easy
# money, and this panel has no business inside anyone else's page.
add_header X-Frame-Options "DENY" always;
