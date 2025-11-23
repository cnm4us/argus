 # argus.bawebtech.com
# Final HTTPS config after Certbot issuance.
# - HTTP (80): redirects to HTTPS and serves ACME challenges.
# - HTTPS (443): terminates SSL and proxies to Node backend on 127.0.0.1:4000.

map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

# HTTP → HTTPS + ACME
server {
  listen 80;
  server_name argus.bawebtech.com;

  # Allow HTTP-01 challenges for Certbot
  location ^~ /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  # Redirect everything else to HTTPS
  location / {
    return 301 https://$host$request_uri;
  }
}

# HTTPS
server {
  listen 443 ssl http2;
  server_name argus.bawebtech.com;

  # PDFs can be large; allow larger uploads.
  client_max_body_size 50m;

  # Certbot-managed SSL files
  ssl_certificate /etc/letsencrypt/live/argus.bawebtech.com/fullchain.pem; # managed by Certbot
  ssl_certificate_key /etc/letsencrypt/live/argus.bawebtech.com/privkey.pem; # managed by Certbot
  include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

  # Allow ACME on HTTPS too (harmless)
  location ^~ /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  # Proxy all traffic to the Node backend on port 4000.
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_read_timeout 300;
    proxy_send_timeout 300;
  }
}

