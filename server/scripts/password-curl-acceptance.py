"""Real HTTPS curl differential checks; never print credentials/cookies/OTP/hash."""
raise SystemExit('Historical runner disabled: use password-fix-r2-acceptance.py; temporary credentials must be cleared in finally.')

import datetime, http.cookies, json, os, pathlib, re, secrets, subprocess, sys, time
ROOT = pathlib.Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'server/acceptance-private'
PRIVATE.mkdir(mode=0o700, parents=True, exist_ok=True)
STATE = PRIVATE / '.env'
HOST = 'ubuntu@43.136.106.96'
SSH = ['ssh', '-i', os.path.expanduser('~/.ssh/jeayon_deploy_ed25519'), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', HOST]
ORIGIN = 'https://jeayon.com'

def remote(command):
    return subprocess.run(SSH + [command], capture_output=True, text=True, check=True, timeout=45).stdout

def db(query):
    # Queries in this script contain no passwords/tokens; credentials stay in container config.
    import shlex
    return remote('docker exec jeayon-work-staging-postgres-1 psql -U dwa_bootstrap -d dwa -Atc ' + shlex.quote(query)).strip()

def jar(name):
    d = PRIVATE / name
    d.mkdir(mode=0o700, exist_ok=True)
    p = d / '.env'
    if not p.exists():
        p.touch(mode=0o600)
    return p

def request(name, path, body=None, csrf=True):
    command = ['curl', '--connect-to', 'jeayon.com:443:127.0.0.1:18443', '-sS', '--max-time', '20', '-i', '--cookie', str(jar(name)), '--cookie-jar', str(jar(name)), ORIGIN + path]
    if body is not None:
        command += ['-H', 'Origin: ' + ORIGIN, '-H', 'Content-Type: application/json', '--data-binary', '@-']
        if csrf:
            command += ['-H', 'x-dwa-csrf: 1']
    raw = subprocess.run(command, input=json.dumps(body) if body is not None else None,
                         capture_output=True, text=True, check=True, timeout=45).stdout
    raw = raw.replace('\r\n', '\n')
    # curl may include a CONNECT preamble; use the last HTTP response block.
    blocks = re.split(r'(?m)^HTTP/', raw)
    response = 'HTTP/' + blocks[-1]
    head, payload = response.split('\n\n', 1)
    status = int(head.splitlines()[0].split()[1])
    headers = {}
    attrs = []
    for line in head.splitlines()[1:]:
        k, _, v = line.partition(':')
        headers[k.lower()] = v.strip()
        if k.lower() == 'set-cookie':
            parsed = http.cookies.SimpleCookie(); parsed.load(v.strip())
            for key, value in parsed.items():
                attrs.append({'name': key, 'path': value['path'], 'secure': bool(value['secure']),
                              'httpOnly': bool(value['httponly']), 'sameSite': value['samesite'],
                              'domain': value['domain'], 'maxAge': int(value['max-age'])})
    return {'status': status, 'body': json.loads(payload), 'headers': headers, 'cookies': attrs}

def expect(response, status, code=None):
    assert response['status'] == status, {'status': response['status'], 'code': response['body'].get('code')}
    if code: assert response['body']['code'] == code
    return response

def otp(name, phone):
    challenge = expect(request(name, '/api/auth/otp/request', {'channel': 'phone', 'target': phone, 'purpose': 'login'}), 202)['body']['data']['challenge_id']
    logs = remote('docker logs --since 2m jeayon-work-staging-api-1 2>&1')
    match = re.search(r'challenge=' + re.escape(challenge) + r' code=(\d{6})', logs)
    assert match, 'Console OTP delivery receipt not found'
    return expect(request(name, '/api/auth/otp/verify', {'challenge_id': challenge, 'code': match[1]}), 200)

def save(state):
    fd = os.open(STATE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f: json.dump(state, f)

def emit(event, **fields):
    print(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'event': event, **fields}, ensure_ascii=False), flush=True)

mode = sys.argv[1]
if mode == 'baseline':
    # Oldest existing phone account is an existing acceptance account with no team membership.
    row = db("select i.identifier_normalized,u.id from identities i join users u on u.id=i.user_id where i.kind='phone' and u.status='active' and not exists(select 1 from team_members m where m.user_id=u.id) order by i.created_at limit 1")
    phone, uid = row.split('|')
    verified = otp('otp', phone)
    me = expect(request('otp', '/api/auth/me'), 200)
    assert me['body']['data']['user']['id'] == uid
    save({'phone': phone, 'uid': uid, 'baseline_user': me['body']['data']['user'], 'baseline_cookies': verified['cookies']})
    emit('baseline_otp', account=phone[:5]+'****'+phone[-4:], user_id=uid, me_status=200, cookies=verified['cookies'], provider='existing console OTP, unchanged')
elif mode == 'after':
    state = json.loads(STATE.read_text()); phone = state['phone']; uid = state['uid']
    password = secrets.token_urlsafe(24); new_password = secrets.token_urlsafe(24)
    state['password'] = password; state['new_password'] = new_password; save(state)
    def pw(name, candidate, target=phone):
        return request(name, '/api/auth/password/login', {'channel': 'phone', 'target': target, 'password': candidate})
    expect(request('none', '/api/auth/password/set', {'password': password}), 401, 'unauthenticated')
    expect(pw('none', password), 401, 'invalid_credentials')
    missing = '+8613900009999'
    assert db("select count(*) from identities where kind='phone' and identifier_normalized='"+missing+"'") == '0'
    absent = expect(pw('none', password, missing), 401, 'invalid_credentials')
    unset = expect(pw('none', password), 401, 'invalid_credentials')
    assert absent['body'] == unset['body']
    before_me = request('otp', '/api/auth/me')
    if before_me['status'] == 401:
        expect(request('otp', '/api/auth/refresh', {}), 200)
    expect(request('otp', '/api/auth/password/set', {'password': password}, csrf=False), 403, 'csrf_rejected')
    saved = expect(request('otp', '/api/auth/password/set', {'password': password}), 200)
    assert saved['body']['data']['user']['has_password']
    # Two target attempts above intentionally count toward the same five/minute quota.
    login = expect(pw('password', password), 200)
    otp_me = expect(request('otp', '/api/auth/me'), 200)['body']['data']
    password_me = expect(request('password', '/api/auth/me'), 200)['body']['data']
    assert otp_me['user'] == password_me['user']
    assert otp_me['user']['id'] == uid
    safe_before = dict(state['baseline_user']); safe_after = dict(otp_me['user']); safe_after.pop('has_password')
    assert safe_before == safe_after
    attrs = lambda cs: [{k:v for k,v in c.items() if k != 'maxAge'} for c in cs]
    assert attrs(login['cookies']) == attrs(state['baseline_cookies'])
    emit('password_otp_equivalence', user_id=uid, equal_user=True, otp_me=200, password_me=200, user_keys=sorted(otp_me['user']), cookies=login['cookies'])
    expect(request('password', '/api/auth/refresh', {}), 200)
    expect(request('otp', '/api/auth/password/set', {'password': new_password, 'current_password': 'intentionally-wrong'}), 401, 'invalid_credentials')
    expect(request('password', '/api/auth/me'), 200)
    expect(request('otp', '/api/auth/password/set', {'password': new_password, 'current_password': password}), 200)
    expect(request('otp', '/api/auth/me'), 200)
    expect(request('password', '/api/auth/me'), 401, 'unauthenticated')
    expect(request('password', '/api/auth/refresh', {}), 401, 'unauthenticated')
    wrong = expect(pw('none', password), 401, 'invalid_credentials')
    assert wrong['body'] == absent['body']
    expect(pw('none', 'another-intentionally-wrong'), 401, 'invalid_credentials')
    locked = expect(pw('none', new_password), 429, 'rate-limited')
    retry = int(locked['headers']['retry-after']); assert 1 <= retry <= 60
    emit('change_and_lock', caller_me=200, other_me=401, other_refresh=401, generic_errors_equal=True, locked_correct_password=429, retry_after=retry)
    state['password'] = new_password; save(state)
    # Wait for the real bucket to expire; do not alter production rate-limit state.
    time.sleep(retry + 1)
    recovered = expect(pw('password', new_password), 200)
    emit('lock_recovery', password_status=recovered['status'])
    post_otp = otp('post_otp', phone)
    post_me = expect(request('post_otp', '/api/auth/me'), 200)
    assert post_me['body']['data']['user'] == recovered['body']['data']['user']
    expect(request('post_otp', '/api/auth/otp/verify', {'challenge_id':'00000000-0000-4000-8000-000000000000','code':'000000'}), 400, 'invalid_code')
    expect(request('password', '/api/auth/logout', {}), 200)
    expect(request('password', '/api/auth/me'), 401, 'unauthenticated')
    expect(request('password', '/api/auth/refresh', {}), 401, 'unauthenticated')
    proof = db("select count(*) filter(where password_hash is not null),count(*) filter(where password_hash is not null and password_hash !~ '^\\$argon2id\\$v=19\\$m=19456,t=2,p=1\\$[A-Za-z0-9+/]{22}\\$[A-Za-z0-9+/]{43}$') from users")
    assert proof.split('|')[1] == '0'
    emit('otp_regression_and_db', otp_verify=post_otp['status'], otp_me=post_me['status'], same_user=True, invalid_otp=400, logout_me=401, logout_refresh=401, non_null_hashes=int(proof.split('|')[0]), invalid_hashes=0)
    expect(request('otp', '/api/auth/logout', {}), 200)
    expect(request('post_otp', '/api/auth/logout', {}), 200)
    emit('PASS', account=phone[:5]+'****'+phone[-4:], user_id=uid)
elif mode == 'smoke':
    import hashlib
    state = json.loads(STATE.read_text())
    response = expect(request('smoke', '/api/auth/password/login', {'channel': 'phone', 'target': state['phone'], 'password': state['password']}), 200)
    me = expect(request('smoke', '/api/auth/me'), 200)
    assert me['body']['data']['user']['id'] == state['uid']
    expect(request('smoke', '/api/auth/refresh', {}), 200)
    expect(request('smoke', '/api/auth/logout', {}), 200)
    expect(request('smoke', '/api/auth/me'), 401)
    def asset(path):
        return subprocess.run(['curl','--connect-to','jeayon.com:443:127.0.0.1:18443','-fsS','--max-time','20',ORIGIN+path], capture_output=True, check=True, timeout=25).stdout
    index = asset('/')
    assert index == (ROOT/'app/dist/index.html').read_bytes()
    match = re.search(rb'var js = "([^"]+\.js)"', index)
    assert match, 'Built frontend loader asset not found'
    js = '/' + match[1].decode().removeprefix('./')
    served = asset(js)
    local = (ROOT/'app/dist'/js.lstrip('/')).read_bytes()
    assert served == local
    emit('final_smoke_PASS', password_login=200, me=200, refresh=200, logout_me=401, user_id=state['uid'], frontend_asset=js, sha256=hashlib.sha256(served).hexdigest(), served_matches_build=True)
else:
    raise SystemExit('use baseline, after or smoke')
