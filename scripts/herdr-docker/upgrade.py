"""Exercise a genuine 0.9.3 -> latest upgrade and terminal confirmation in Docker."""
import hashlib
import json
import os
from pathlib import Path
import pty
import select
import time
import urllib.request


def verify_upgrade(run, env, binary, herdr, receipt_file, marker):
    # Seed a recorded older installation, never reuse or modify a host install.
    release = json.load(urllib.request.urlopen('https://api.github.com/repos/herdrdev/herdr/releases/tags/v0.9.3', timeout=30))
    platform = 'linux-' + {'aarch64': 'aarch64', 'x86_64': 'x86_64'}[os.uname().machine]
    asset = next(a for a in release['assets'] if a['name'] == 'herdr-' + platform)
    payload = urllib.request.urlopen(asset['browser_download_url'], timeout=120).read()
    digest = hashlib.sha256(payload).hexdigest()
    assert asset['digest'] == 'sha256:' + digest
    receipt = json.loads(receipt_file.read_text())
    assert receipt['release']['version'] != '0.9.3', 'upgrade fixture must precede latest'
    latest = receipt['release']['version']
    receipt['release'] = dict(version='0.9.3', url=asset['browser_download_url'], sha256=digest, platform=platform)
    temporary = herdr.with_suffix('.older')
    temporary.write_bytes(payload)
    temporary.chmod(0o755)
    temporary.replace(herdr)
    receipt_file.write_text(json.dumps(receipt))
    run([binary, 'setup', '--no-install-herdr'])
    identity = marker.read_bytes()
    run([binary, 'setup', '--update-herdr', '--non-interactive'], expected=2)
    assert marker.read_bytes() == identity
    assert hashlib.sha256(herdr.read_bytes()).hexdigest() == digest
    run([binary, 'setup', '--update-herdr', '--restart-herdr'], expected=2)
    assert marker.read_bytes() == identity

    def confirm(answer, expected):
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(env['HOME'])
            os.execve(binary, [binary, 'setup', '--update-herdr', '--restart-herdr'], env)
        data, answered, status = b'', False, None
        deadline = time.monotonic() + 240
        try:
            while time.monotonic() < deadline:
                if select.select([fd], [], [], .1)[0]:
                    try:
                        chunk = os.read(fd, 65536)
                    except OSError:
                        chunk = b''
                    data += chunk
                    if b'[y/N]' in data and not answered:
                        os.write(fd, (answer + '\n').encode())
                        answered = True
                done, status = os.waitpid(pid, os.WNOHANG)
                if done:
                    break
            else:
                os.kill(pid, 9)
                os.waitpid(pid, 0)
                raise AssertionError('TTY update timed out')
        finally:
            os.close(fd)
        print(data.decode(errors='replace'), flush=True)
        assert answered, 'restart did not ask on controlling terminal'
        assert os.waitstatus_to_exitcode(status) == expected

    confirm('n', 2)
    assert marker.read_bytes() == identity
    confirm('y', 0)
    assert marker.read_bytes() != identity
    assert latest in run([str(herdr), '--version'])
    assert json.loads(receipt_file.read_text())['release']['version'] == latest
    assert not receipt_file.with_name('herdr-update.json').exists()
    run([binary, 'setup', '--no-install-herdr'])
    run([str(herdr), 'server', 'stop'])
    print('PASS: real old -> latest upgrade, staged exit 2, no-TTY refusal, TTY decline and confirmed restart', flush=True)
