"""Exercise the real request builder offline; never print synthetic credentials."""
import importlib.util
import json
import pathlib
import shlex
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('acceptance', pathlib.Path(__file__).with_name('password-fix-r2-acceptance.py'))
acceptance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acceptance)
cookie = 'offline-cookie-sentinel'
password = 'offline-password-sentinel'
escaped_password = 'offline-current-password-sentinel-"\\\nheader = "sentinel'
marker = 'offline-sensitive-header-sentinel'
calls = []

def capture(argv, **kwargs):
    local_argv = argv
    remote_argv = shlex.split(argv[-1])
    for value in (cookie, password, 'offline-current-password-sentinel', marker):
        assert all(value not in arg for arg in local_argv + remote_argv), 'Sensitive value in argv'
    assert all('Cookie:' not in arg for arg in local_argv), 'Cookie header in argv'
    assert shlex.split(argv[-1])[-2:] == ['--config', '-'], 'Expected stdin curl config'
    config = kwargs['input']
    assert cookie in config and marker in config, 'Headers missing from stdin'
    body_lines = [line for line in config.splitlines() if line.startswith('data-binary = ')]
    if body_lines:
        # For this input, curl quoted-string escapes match JSON string escapes.
        assert json.loads(json.loads(body_lines[0].split(' = ', 1)[1])) == {'password': password, 'current_password': escaped_password}
    calls.append(bool(body_lines))
    return SimpleNamespace(returncode=0, stdout='HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}')

with patch.object(acceptance.subprocess, 'run', side_effect=capture):
    acceptance.request({'session': cookie}, '/api/auth/password/login', {'password': password, 'current_password': escaped_password}, marker=marker)
    acceptance.request({'session': cookie}, '/api/auth/me', marker=marker)
assert calls == [True, False], 'Body and header-only cases required'
print(json.dumps({'event': 'offline_argv_check', 'offline': True, 'argv_credentials_absent': True, 'headers_and_body_in_stdin': True, 'cases': len(calls)}))
