"""Real CLI + real latest Herdr; no host credentials, services, or installs.

The Go suites cover injected download/transaction/upgrade failures. This script
covers a clean actual install and live server reuse with an isolated HOME.
"""
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading

HOME_DIR = Path('/tmp/pairfob-docker-home')
HOME_DIR.mkdir(mode=0o700)
env = {k: v for k, v in os.environ.items() if not k.startswith(('PAIRFOB_', 'HERDR_', 'XDG_'))}
env.update(HOME=str(HOME_DIR), SHELL='/bin/bash', PATH='/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin')
binary = '/tmp/pairfob-candidate'


def run(args, expected=0, environment=None):
    result = subprocess.run(args, env=environment or env, cwd=HOME_DIR, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=240)
    print('$', ' '.join(args), '\n', result.stdout, flush=True)
    assert result.returncode == expected, (args, result.returncode, expected)
    return result.stdout


run([binary, 'setup', '--no-install-herdr'], expected=1)
assert not (HOME_DIR / '.local/bin/herdr').exists()
run([binary, 'setup', '--restart-herdr', '--non-interactive'], expected=1)
run([binary, 'setup', '--non-interactive'])
herdr = HOME_DIR / '.local/bin/herdr'
receipt = json.loads((HOME_DIR / '.config/pairfob/herdr-install.json').read_text())
assert receipt['source'] == 'pairfob'
assert hashlib.sha256(herdr.read_bytes()).hexdigest() == receipt['release']['sha256']
run([str(herdr), '--version'])

# Repeated setup must keep the running server and existing binary.
marker = HOME_DIR / '.config/herdr/.pairfob-server.json'
identity = json.loads(marker.read_text())
run([binary, 'setup', '--no-install-herdr', '--non-interactive'])
assert json.loads(marker.read_text()) == identity
run([binary, 'setup', '--update-herdr', '--non-interactive'])
assert json.loads(marker.read_text()) == identity

# Exercise the actual shell installer using a local Pairfob release server.
release = Path('/tmp/pairfob-docker-release')
release.mkdir()
arch = {'aarch64': 'arm64', 'x86_64': 'amd64'}[os.uname().machine]
artifact = 'pairfob-linux-' + arch
shutil.copy(binary, release / artifact)
(release / 'SHA256SUMS').write_text(hashlib.sha256(Path(binary).read_bytes()).hexdigest() + '  ' + artifact + '\n')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(release), **kwargs)


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
install_env = dict(env, PAIRFOB_DOWNLOAD_BASE=f'http://127.0.0.1:{server.server_port}')
prefix = HOME_DIR / "工具 bin'quoted"
output = run(['sh', '/src/scripts/install.sh', '--prefix', str(prefix), '--no-service', '--no-enroll'], environment=install_env)
assert (prefix / 'pairfob').exists()
assert 'session setup is not verified' in output
assert json.loads(marker.read_text()) == identity

# Incorrect explicit overrides fail without replacing existing files.
bad_env = dict(env, HERDR_BIN=str(HOME_DIR / 'missing-explicit'))
run([binary, 'setup'], expected=1, environment=bad_env)
assert hashlib.sha256(herdr.read_bytes()).hexdigest() == receipt['release']['sha256']

# Losing provenance must never silently adopt an existing installation.
receipt_file = HOME_DIR / '.config/pairfob/herdr-install.json'
saved = receipt_file.read_bytes()
receipt_file.unlink()
run([binary, 'setup', '--update-herdr'], expected=1)
receipt_file.write_bytes(saved)
receipt_file.chmod(0o600)

# Fresh server from a minimal login-like environment, then creation of a pane.
run([str(herdr), 'server', 'stop'])
run([binary, 'setup', '--no-install-herdr'])
run([str(herdr), 'workspace', 'create', '--cwd', str(HOME_DIR), '--label', 'docker-first-session'])
run([str(herdr), 'workspace', 'list'])
run([str(herdr), 'server', 'stop'])
from upgrade import verify_upgrade
verify_upgrade(run, env, binary, herdr, receipt_file, marker)
server.shutdown()
print('PASS: real install, checksums, reuse, explicit overrides, provenance, shell installer, minimal environment and first workspace', flush=True)
