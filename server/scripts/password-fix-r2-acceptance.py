"""Live evidence. Request credentials use stdin, never argv or evidence output."""
import datetime, hashlib, http.cookies, re, json, os, pathlib, secrets, shlex, subprocess, sys, time, urllib.error, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
SSH = ['ssh', '-i', os.path.expanduser('~/.ssh/jeayon_deploy_ed25519'), '-o', 'BatchMode=yes', 'ubuntu@43.136.106.96']
ORIGIN = 'https://jeayon.com'
UID = '649dce00-3867-4d28-a30d-c05001ad65eb'
def remote(command, data=None):
    return subprocess.run(SSH+[command], input=data, text=True, capture_output=True, check=True, timeout=90).stdout.strip()
def db(query):
    return remote('docker exec jeayon-work-staging-postgres-1 psql -U dwa_bootstrap -d dwa -v ON_ERROR_STOP=1 -Atc '+shlex.quote(query))
def emit(event, **fields):
    print(json.dumps(dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(), event=event, **fields), ensure_ascii=False), flush=True)
def client(): return {}
def curl_option(name, value):
    escaped=value.replace('\\','\\\\').replace('"','\\"').replace('\n','\\n').replace('\r','\\r').replace('\t','\\t').replace('\v','\\v')
    return name+' = "'+escaped+'"\n'
def request(opener, path, body=None, csrf=True, marker=None, xff=None):
    command=['curl','-sS','--max-time','25','-i','--config','-']
    config=curl_option('url',ORIGIN+path)+curl_option('header','Origin: '+ORIGIN)+curl_option('header','User-Agent: '+(marker or 'password-fix-r2'))
    if opener: config += curl_option('header','Cookie: '+'; '.join(k+'='+v for k,v in opener.items()))
    if body is not None: config += curl_option('header','Content-Type: application/json')+curl_option('data-binary',json.dumps(body))
    if csrf: config += curl_option('header','x-dwa-csrf: 1')
    if xff: config += curl_option('header','X-Forwarded-For: '+xff)
    result=subprocess.run(SSH+[shlex.join(command)],input=config,text=True,capture_output=True,timeout=30)
    if result.returncode: raise RuntimeError('HTTPS request transport failed (credentials suppressed)')
    raw=result.stdout.replace('\r\n','\n')
    response='HTTP/'+re.split(r'(?m)^HTTP/',raw)[-1]
    head,payload=response.split('\n\n',1); headers={}
    for line in head.splitlines()[1:]:
        k,_,v=line.partition(':');headers[k.lower()]=v.strip()
        if k.lower()=='set-cookie':
            cookie=http.cookies.SimpleCookie();cookie.load(v.strip())
            for name,value in cookie.items(): opener[name]=value.value
    return int(head.splitlines()[0].split()[1]),json.loads(payload),headers
def expect(r, status, code=None):
    assert r[0]==status, {'expected':status,'status':r[0],'code':r[1].get('code')}
    if code: assert r[1]['code']==code
    return r

def network():
    result=json.loads(remote("docker inspect jeayon-work-staging-api-1 jeayon-work-staging-caddy-1"))
    return [{ 'container':r['Name'], 'networks':{n: v['IPAddress'] for n,v in r['NetworkSettings']['Networks'].items()}, 'ports':r['HostConfig']['PortBindings'], 'trust_proxy':next((v.split('=',1)[1] for v in r['Config']['Env'] if v.startswith('TRUST_PROXY_CIDR=')),None)} for r in result]
def ip_evidence(stage):
    nets=network(); marker='password-fix-r2-'+stage+'-'+secrets.token_hex(6)
    expect(request(client(), '/api/auth/password/login', {'channel':'email','target':marker+'@example.test','password':'invalid'}, marker=marker, xff='198.51.100.199'),401,'invalid_credentials')
    logs=remote('docker logs --since 2m jeayon-work-staging-caddy-1 2>&1')
    entries=[]
    for line in logs.splitlines():
        try: row=json.loads(line)
        except ValueError: continue
        if marker in json.dumps(row.get('request',{}).get('headers',{})): entries.append(row)
    assert entries, 'Caddy request receipt missing'
    actual=entries[-1]['request']['remote_ip']
    caddy=next(iter(nets[1]['networks'].values()))
    candidates=[actual,caddy,'198.51.100.199']
    script="""import {createDb} from './dist/db/index.js';
import {keyedHash,ipKey} from './dist/auth/crypto.js';
import {sql} from 'kysely';
const db=createDb(process.env.DATABASE_URL);
const values=JSON.parse(process.argv[2]);
const out=[];
for (const ip of values) {const key=keyedHash(process.env.RATE_LIMIT_HMAC_SECRET,ipKey(ip));
const r=await sql`select count from auth_rate_limits where scope='password_login_ip' and key_hash=${key} and window_seconds=60 and expires_at>now() order by window_start desc limit 1`.execute(db);out.push(r.rows[0]?.count??0);}
console.log(JSON.stringify(out));await db.destroy();"""
    counts=json.loads(remote('docker exec -i -w /srv/api jeayon-work-staging-api-1 node --input-type=module - '+shlex.quote(json.dumps(candidates)),script))
    expected=1 if stage=='before' else 0
    assert counts[expected]>0 and counts[2]==0, counts
    emit('proxy_ip_'+stage, networks=nets, client_ip=actual.rsplit('.',1)[0]+'.*', client_fingerprint=hashlib.sha256(actual.encode()).hexdigest()[:12], caddy_ip=caddy, recorded_req_ip='caddy' if stage=='before' else 'real_client', evidence_method='persisted password_login_ip HMAC compared with Caddy remote_ip', candidate_bucket_counts=counts, forged_xff_effective=False)


def reset():
    db("begin; update users set password_hash=null,password_updated_at=null where id='"+UID+"'; update sessions set revoked_at=now() where user_id='"+UID+"' and revoked_at is null; commit;")
    proof=db("select (password_hash is null)::int,(password_updated_at is null)::int,(select count(*) from sessions where user_id=users.id and revoked_at is null) from users where id='"+UID+"'")
    assert proof=='1|1|0', 'Credential cleanup not confirmed'
    emit('credential_reset', user_id=UID, password_hash_null=True, password_updated_at_null=True, active_sessions=0)
def phone():
    value=db("select identifier_normalized from identities where kind='phone' and user_id='"+UID+"'")
    assert re.fullmatch(r'\+861\d{10}',value)
    return value
def otp(c, target):
    challenge=expect(request(c,'/api/auth/otp/request',{'channel':'phone','target':target,'purpose':'login'}),202)[1]['data']['challenge_id']
    receipt=remote('docker logs --since 2m jeayon-work-staging-api-1 2>&1')
    match=re.search(r'challenge='+re.escape(challenge)+r' code=(\d{6})',receipt)
    assert match, 'Console OTP receipt absent'
    return expect(request(c,'/api/auth/otp/verify',{'challenge_id':challenge,'code':match[1]}),200)
def wait_window():
    remaining=61-time.time()%60
    emit('waiting_real_minute_window',seconds=round(remaining,2))
    time.sleep(remaining)
def password(c, target, candidate):
    return request(c,'/api/auth/password/login',{'channel':'phone','target':target,'password':candidate})
def cleanup():
    private=ROOT/'server/acceptance-private'; known=[]
    state=private/'.env'
    if state.exists():
        values=json.loads(state.read_text())
        known=[values[k].encode() for k in ['password','new_password'] if values.get(k)]
    target=phone(); reset()
    try:
        for candidate in (known[:1] or [secrets.token_urlsafe(24).encode()]):
            expect(password(client(),target,candidate.decode()),401,'invalid_credentials')
        emit('unset_password_rejected',status=401,code='invalid_credentials',previous_known_password_tested=bool(known))
        c=client(); result=otp(c,target)
        assert result[1]['data']['user']['id']==UID and not result[1]['data']['user']['has_password']
        emit('otp_after_reset',status=200,has_password=False,provider='existing staging console OTP')
    finally: reset()
    deleted=[]
    if private.exists():
        for path in private.rglob('*'):
            if path.is_file():
                assert path.name=='.env', 'Unexpected private file; inspect before deleting'
                path.unlink();deleted.append(str(path.relative_to(ROOT)))
    matches=[]
    if known:
        for path in ROOT.rglob('*'):
            if path.is_file() and not path.is_symlink():
                try: data=path.read_bytes()
                except OSError: continue
                if any(value in data for value in known): matches.append(str(path.relative_to(ROOT)))
    assert not matches, {'credential_file_paths':matches}
    emit('plaintext_cleanup',deleted_files=deleted,known_password_byte_matches=matches,remaining_private_files=sum(p.is_file() for p in private.rglob('*')))

def acceptance():
    target=phone(); first=secrets.token_urlsafe(32); second=secrets.token_urlsafe(32)
    reset()
    try:
        c=client(); logged=otp(c,target)
        assert logged[1]['data']['user']['id']==UID
        emit('otp_login',status=200,has_password=False)
        absent='+8613900009999'
        assert db("select count(*) from identities where kind='phone' and identifier_normalized='"+absent+"'")=='0'
        unset=expect(password(client(),target,first),401,'invalid_credentials')
        missing=expect(password(client(),absent,first),401,'invalid_credentials')
        assert unset[1]==missing[1]
        emit('generic_absent_unset',absent_status=401,unset_status=401,equal_envelope=True,code='invalid_credentials')
        expect(request(client(),'/api/auth/password/set',{'password':first}),401,'unauthenticated')
        emit('unauthenticated_set_rejected',status=401,code='unauthenticated')
        expect(request(c,'/api/auth/password/set',{'password':first},csrf=False),403,'csrf_rejected')
        expect(request(client(),'/api/auth/password/login',{'channel':'phone','target':target,'password':first},csrf=False),403,'csrf_rejected')
        emit('missing_csrf_rejected',set_status=403,login_status=403,code='csrf_rejected')
        saved=expect(request(c,'/api/auth/password/set',{'password':first}),200)
        other=client(); pw=expect(password(other,target,first),200)
        assert pw[1]['data']['user']==saved[1]['data']['user']
        emit('otp_password_equivalence',user_id=UID,status=200,equal_user=True)
        expect(request(c,'/api/auth/password/set',{'password':second,'current_password':'incorrect'}),401,'invalid_credentials')
        expect(request(other,'/api/auth/me'),200)
        emit('wrong_current_password_rejected',status=401,code='invalid_credentials',other_session_status=200)
        expect(request(c,'/api/auth/password/set',{'password':second,'current_password':first}),200)
        expect(request(c,'/api/auth/me'),200)
        expect(request(other,'/api/auth/me'),401,'unauthenticated')
        expect(request(other,'/api/auth/refresh',{}),401,'unauthenticated')
        emit('change_revokes_other_sessions',caller=200,other_access=401,other_refresh=401)
        wrong=expect(password(client(),target,first),401,'invalid_credentials')
        assert wrong[1]==missing[1]
        expect(password(client(),target,second),200)
        emit('changed_password_login',status=200)
        wait_window()
        batch = r"""import json,subprocess,sys,time
value=json.load(sys.stdin); statuses=[]; start=int(time.time()//60); retry=None
for i in range(6):
    body={'channel':'phone','target':value['target'],'password':value['password'] if i==5 else 'incorrect'}
    r=subprocess.run(['curl','-sS','--max-time','10','-i','https://jeayon.com/api/auth/password/login','-H','Origin: https://jeayon.com','-H','Content-Type: application/json','-H','x-dwa-csrf: 1','--data-binary','@-'],input=json.dumps(body),text=True,capture_output=True)
    if r.returncode: raise RuntimeError('HTTPS transport failed')
    raw=r.stdout.replace('\r\n','\n');head,payload=raw.split('\n\n',1);status=int(head.splitlines()[0].split()[1]); result=json.loads(payload)
    assert status==(429 if i==5 else 401)
    assert result['code']==('rate-limited' if i==5 else 'invalid_credentials')
    statuses.append(status)
    if i==5:
        retry=int(next(line.split(':',1)[1] for line in head.splitlines() if line.lower().startswith('retry-after:')))
assert int(time.time()//60)==start
print(json.dumps({'statuses':statuses,'retry_after':retry}))
"""
        lock=json.loads(remote('python3 -c '+shlex.quote(batch),json.dumps({'target':target,'password':second})))
        emit('account_bucket_lock',correct_password_status=429,attempt_statuses=lock['statuses'],retry_after=lock['retry_after'],wrong_absent_unset_equal=True)
    finally:
        reset()
    wait_window()
    expect(password(client(),target,second),401,'invalid_credentials')
    emit('temporary_password_removed',status=401,code='invalid_credentials')
    try:
        c=client(); verified=otp(c,target)
        assert verified[1]['data']['user']['has_password'] is False
        emit('final_otp_login',status=200,has_password=False)
    finally: reset()
    emit('acceptance_PASS',user_id=UID,temporary_password_persisted=False)


def limits():
    wait_window()
    marker='password-fix-r2-limits-'+secrets.token_hex(4)
    # Batch requests on the actual host so SSH latency cannot straddle a quota minute.
    script=r"""import json,subprocess,time
origin='https://jeayon.com'; marker=MARKER
start=int(time.time()//60)
def send(source,target,expected):
    cmd=['curl','-sS','--max-time','10','-w','\\n%{http_code}',origin+'/api/auth/password/login','-H','Origin: '+origin,'-H','Content-Type: application/json','-H','x-dwa-csrf: 1','-H','User-Agent: '+marker+'-'+source,'-H','X-Forwarded-For: 198.51.100.199','--data-binary','@-']
    if source=='loopback': cmd+=['--resolve','jeayon.com:443:127.0.0.1']
    r=subprocess.run(cmd,input=json.dumps({'channel':'email','target':target,'password':'invalid'}),text=True,capture_output=True,check=True)
    payload,status=r.stdout.rsplit('\n',1);status=int(status)
    assert status==expected,dict(source=source,status=status,expected=expected)
    return status
account=marker+'@example.test'
for i in range(5): send('public',account,401)
send('public',account,429)
send('loopback',account,429)
send('loopback',marker+'-independent@example.test',401)
for i in range(15): send('public',marker+'-'+str(i)+'@example.test',401)
send('public',marker+'-ip-locked@example.test',429)
send('loopback',marker+'-after-lock@example.test',401)
for i in range(18): send('loopback',marker+'-loop-'+str(i)+'@example.test',401)
send('loopback',marker+'-loop-locked@example.test',429)
assert int(time.time()//60)==start, 'Requests crossed a fixed minute; wait and rerun'
print(json.dumps(dict(target_lock_across_sources=True,ip_limit_20_then_429=True,second_source_independent=True,both_sources_20_then_429=True,spoofed_xff='ignored',same_minute=True)))
""".replace('MARKER',repr(marker))
    results=json.loads(remote('python3 -',script))
    receipts=remote('docker logs --since 2m jeayon-work-staging-caddy-1 2>&1')
    sources={}
    for line in receipts.splitlines():
        try: row=json.loads(line)
        except ValueError: continue
        req=row.get('request',{});headers=json.dumps(req.get('headers',{}))
        for source in ['public','loopback']:
            if marker+'-'+source in headers: sources[source]=req['remote_ip']
    assert len(sources)==2 and sources['public']!=sources['loopback'], 'Two distinct real peer addresses required'
    proof=r"""import {createDb} from './dist/db/index.js';import {keyedHash,ipKey} from './dist/auth/crypto.js';import {sql} from 'kysely';
const db=createDb(process.env.DATABASE_URL), ips=JSON.parse(process.argv[2]), out=[];
for (const ip of ips) {const r=await sql`select count from auth_rate_limits where scope='password_login_ip' and key_hash=${keyedHash(process.env.RATE_LIMIT_HMAC_SECRET,ipKey(ip))} and window_seconds=60 and expires_at>now() order by window_start desc limit 1`.execute(db);out.push(r.rows[0]?.count??0);}
console.log(JSON.stringify(out));await db.destroy();"""
    counts=json.loads(remote('docker exec -i -w /srv/api jeayon-work-staging-api-1 node --input-type=module - '+shlex.quote(json.dumps([sources['public'],sources['loopback'],'198.51.100.199'])),proof))
    assert counts==[20,20,0], counts
    emit('independent_live_quota_locks',**results,source_paths={key:{'ip':value.rsplit('.',1)[0]+'.*','fingerprint':hashlib.sha256(value.encode()).hexdigest()[:12]} for key,value in sources.items()},persisted_ip_counts=counts,source_limitation='two real host network paths: public hairpin and loopback; not two independent Internet clients')
    # A direct API request from loopback is an untrusted peer, outside the fixed Caddy /32.
    direct=r"""import {createDb} from './dist/db/index.js';import {keyedHash} from './dist/auth/crypto.js';import {sql} from 'kysely';
const marker=process.argv[2],db=createDb(process.env.DATABASE_URL),statuses=[];
for(let i=1;i<=2;i++){const r=await fetch('http://127.0.0.1:8787/api/auth/password/login',{method:'POST',headers:{origin:'https://jeayon.com','content-type':'application/json','x-dwa-csrf':'1','x-forwarded-for':`203.0.113.${240+i}`},body:JSON.stringify({channel:'email',target:`${marker}-${i}@example.test`,password:'invalid'})});statuses.push(r.status);}
const counts=[];for(const ip of ['127.0.0.1','203.0.113.241','203.0.113.242']){const r=await sql`select count from auth_rate_limits where scope='password_login_ip' and key_hash=${keyedHash(process.env.RATE_LIMIT_HMAC_SECRET,ip)} and window_seconds=60 and expires_at>now() order by window_start desc limit 1`.execute(db);counts.push(r.rows[0]?.count??0);}
console.log(JSON.stringify({statuses,counts}));await db.destroy();"""
    result=json.loads(remote('docker exec -i -w /srv/api jeayon-work-staging-api-1 node --input-type=module - '+shlex.quote(marker),direct))
    assert result=={'statuses':[401,401],'counts':[2,0,0]},result
    emit('untrusted_direct_xff_ignored',statuses=result['statuses'],actual_peer='127.0.0.1',actual_peer_count=2,forged_ip_counts=[0,0],trust_proxy='172.30.240.2/32')

if __name__=='__main__':
    mode=sys.argv[1]
    if mode in ['before','after-ip']: ip_evidence('before' if mode=='before' else 'after')
    elif mode=='cleanup': cleanup()
    elif mode=='acceptance': acceptance()
    elif mode=='limits': limits()
    else: raise SystemExit('use before, after-ip, cleanup, acceptance or limits')
