"""Keep a fresh Docker daemon available for the shipped browser protocol client.

Requires a local Wrangler Worker on PAIRFOB_TEST_ORIGIN. The host test reads
/tmp/pairfob-live-offer.json using docker exec; nothing reaches production.
"""
import json
import os
from pathlib import Path
import subprocess
import time

home = Path('/tmp/pairfob-live-home')
home.mkdir(mode=0o700)
env = {k: v for k, v in os.environ.items() if not k.startswith(('PAIRFOB_', 'HERDR_', 'XDG_'))}
env.update(HOME=str(home), SHELL='/bin/bash', PAIRFOB_ALLOWED_ROOTS=str(home))
binary = '/tmp/pairfob-candidate'
subprocess.run(['go', 'build', '-o', binary, './cmd/pairfob'], check=True)
subprocess.run([binary, 'setup', '--non-interactive'], env=env, check=True)
subprocess.run([binary, 'enroll', '--origin', os.environ['PAIRFOB_TEST_ORIGIN']], env=env, check=True)
log = open('/tmp/pairfob-live-daemon.log', 'w')
daemon = subprocess.Popen([binary, 'run'], env=env, stdout=log, stderr=log)
offer = None
try:
    for _ in range(100):
        if (home / '.config/pairfob/pairfob.sock').exists():
            break
        assert daemon.poll() is None, Path(log.name).read_text()
        time.sleep(.1)
    time.sleep(1)
    offer = subprocess.Popen([binary, 'pair', 'offer'], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    event = json.loads(offer.stdout.readline())
    assert event['event'] == 'offer', event
    Path('/tmp/pairfob-live-offer.json').write_text(json.dumps(event))
    print('LIVE_READY', flush=True)
    for line in offer.stdout:
        event = json.loads(line)
        print(event['event'], flush=True)
    assert offer.wait(timeout=15) == 0
    deadline = time.monotonic() + 180
    while not Path('/tmp/pairfob-live-done').exists():
        assert time.monotonic() < deadline, 'live client did not finish'
        assert daemon.poll() is None
        time.sleep(.25)
finally:
    if offer and offer.poll() is None:
        offer.terminate()
        offer.wait(timeout=10)
    daemon.terminate()
    daemon.wait(timeout=20)
    subprocess.run([str(home / '.local/bin/herdr'), 'server', 'stop'], env=env, check=True)
