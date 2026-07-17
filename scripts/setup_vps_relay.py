#!/usr/bin/env python3
"""Install nginx OpenAI relay on VPS. Pass host + password as argv."""
import sys
import paramiko

HOST = sys.argv[1] if len(sys.argv) > 1 else ""
PASSWORD = sys.argv[2] if len(sys.argv) > 2 else ""
USER = "root"
PORT = 22

NGINX_CONF = """
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 32m;

    location = /health {
        default_type application/json;
        return 200 '{"ok":true,"service":"daidai-openai-relay","upstream":"api.openai.com"}';
    }

    location / {
        proxy_http_version 1.1;
        proxy_pass https://api.openai.com;
        proxy_ssl_server_name on;
        proxy_ssl_protocols TLSv1.2 TLSv1.3;
        proxy_set_header Host api.openai.com;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Content-Type $http_content_type;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
"""


def main():
    if not HOST or not PASSWORD:
        print("usage: setup_vps_relay.py <host> <password>")
        sys.exit(2)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"connecting {HOST} ...")
    client.connect(
        HOST,
        port=PORT,
        username=USER,
        password=PASSWORD,
        timeout=40,
        allow_agent=False,
        look_for_keys=False,
    )

    def run(cmd, timeout=900):
        print(">>>", cmd[:140].replace("\n", " "))
        _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        if out:
            print(out)
        if err:
            print(err)
        print("exit", code)
        return code, out, err

    code, out, _ = run(
        "uname -a; . /etc/os-release 2>/dev/null; echo ID=$ID VERSION=$VERSION_ID; free -h | head -2"
    )
    if code != 0:
        client.close()
        sys.exit(code)

    # Prefer apt (Ubuntu/Debian). Fallback: binary Caddy if no package manager nginx.
    setup = r"""
set -e
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y nginx curl ca-certificates
  rm -f /etc/nginx/sites-enabled/default
  cat > /etc/nginx/conf.d/openai-relay.conf <<'EOF'
""" + NGINX_CONF + r"""
EOF
  nginx -t
  systemctl enable nginx
  systemctl restart nginx
elif command -v yum >/dev/null 2>&1; then
  # CentOS vault + epel for nginx
  sed -i 's/mirrorlist/#mirrorlist/g' /etc/yum.repos.d/CentOS-*.repo 2>/dev/null || true
  sed -i 's|#baseurl=http://mirror.centos.org|baseurl=http://vault.centos.org|g' /etc/yum.repos.d/CentOS-*.repo 2>/dev/null || true
  yum install -y epel-release || true
  yum install -y nginx curl ca-certificates
  cat > /etc/nginx/conf.d/openai-relay.conf <<'EOF'
""" + NGINX_CONF + r"""
EOF
  nginx -t
  systemctl enable nginx
  systemctl restart nginx
else
  echo "no apt/yum"; exit 1
fi

sleep 1
echo '--- health ---'
curl -sS http://127.0.0.1/health; echo
echo '--- upstream openai ---'
curl -sS -o /tmp/oai.txt -w "upstream_http=%{http_code}\n" https://api.openai.com/v1/models -H 'Authorization: Bearer sk-test' || true
head -c 180 /tmp/oai.txt; echo
echo '--- via relay ---'
curl -sS -o /tmp/relay.txt -w "relay_http=%{http_code}\n" http://127.0.0.1/v1/models -H 'Authorization: Bearer sk-test' || true
head -c 180 /tmp/relay.txt; echo
ss -lntp | grep ':80' || true
"""
    code, _, _ = run(setup, timeout=900)
    client.close()
    if code != 0:
        sys.exit(code)
    print("\nDONE")
    print(f"DAIDAI_IMAGE_BASE_URL=http://{HOST}")
    print("Remove DAIDAI_IMAGE_PROXY_ASYNC")
    print("Change root password ASAP (password was in chat).")


if __name__ == "__main__":
    main()
