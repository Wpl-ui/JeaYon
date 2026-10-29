"""Run on the authorized staging host. HTTPS via --resolve; secrets stay in process memory."""
import datetime, http.cookies, json, re, secrets, subprocess, time
HOST='https://jeayon.com'
CONTAINER='jeayon-work-staging-api-1'
def record(event,**data):
 print(json.dumps(dict(time=datetime.datetime.now(datetime.timezone.utc).isoformat(),event=event,**data)),flush=True)
class Client:
 def __init__(self):self.cookies={}
 def send(self,path,body=None):
  config=['url = '+json.dumps(HOST+path),'request = '+json.dumps('GET' if body is None else 'POST')]
  if body is not None:
   config += ['header = '+json.dumps('Origin: '+HOST),'header = "x-dwa-csrf: 1"','header = "Content-Type: application/json"','data = '+json.dumps(json.dumps(body))]
  if self.cookies:config+=['header = '+json.dumps('Cookie: '+'; '.join(k+'='+v for k,v in self.cookies.items()))]
  r=subprocess.run(['curl','--silent','--show-error','--max-time','15','--http1.1','--resolve','jeayon.com:443:127.0.0.1','--dump-header','-','--config','-'],input='\n'.join(config)+'\n',capture_output=True,text=True)
  if r.returncode:raise RuntimeError('HTTPS transport failed; details withheld')
  headers,raw=r.stdout.split('\n\n',1)
  status=int(headers.splitlines()[0].split()[1])
  sets=[]
  for line in headers.splitlines()[1:]:
   if line.lower().startswith('set-cookie:'):
    sets.append(line.partition(':')[2].strip())
    parsed=http.cookies.SimpleCookie();parsed.load(sets[-1])
    for key,item in parsed.items():self.cookies[key]=item.value
  return status,json.loads(raw),sets
 def expect(self,label,path,body,status,code=None):
  actual,data,sets=self.send(path,body)
  passed=actual==status and (code is None or data.get('code')==code)
  record(label,status=actual,expected_status=status,passed=passed)
  if not passed:raise RuntimeError('Acceptance assertion failed: '+label)
  return data.get('data'),sets

def code_for(challenge):
 # The existing DEV ONLY console log is read in memory and is never copied into evidence.
 r=subprocess.run(['docker','logs','--since','10m',CONTAINER],capture_output=True,text=True,check=True)
 matches=re.findall(r'challenge='+re.escape(challenge)+r' code=(\d{6})',r.stdout+'\n'+r.stderr)
 if not matches:raise RuntimeError('Staging console delivery unavailable')
 return matches[-1]
def request(client,target,purpose):
 data,_=client.expect('otp_request_'+purpose,'/api/auth/otp/request',{'channel':'email','target':target,'purpose':purpose},202)
 return {'challenge_id':data['challenge_id'],'code':code_for(data['challenge_id'])}
def query(sql):
 r=subprocess.run(['docker','exec','-i','jeayon-work-staging-postgres-1','sh','-c','psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1'],input=sql,capture_output=True,text=True,check=True)
 return r.stdout.strip()

record('staging_acceptance_start',resolve='jeayon.com:443:127.0.0.1',tls_verified=True,production_cutover=False)
client=Client()
client.expect('readiness','/api/health/ready',None,200)
identity='reauth-'+secrets.token_hex(10)+'@example.test'
password=secrets.token_urlsafe(32)
changed=secrets.token_urlsafe(32)
login_otp=request(client,identity,'login')
client.expect('pure_otp_no_account','/api/auth/otp/verify',login_otp,409,'registration_required')
assert query("select count(*) from identities where identifier_normalized='"+identity+"';")=='0'
record('bare_account_absent',passed=True)
registration=request(client,identity,'register')
registered_at=time.monotonic()
client.expect('signup_missing_password','/api/auth/register',registration,400,'invalid')
client.expect('signup_policy_rejected','/api/auth/register',{**registration,'password':'short'},400,'invalid')
account,cookies=client.expect('signup_password_atomic','/api/auth/register',{**registration,'password':password},200)
assert account['user']['has_password'] is True
assert len(cookies)==2 and all('HttpOnly' in c and 'Secure' in c and 'SameSite=Lax' in c for c in cookies)
record('signup_has_password_and_secure_session',passed=True)
client.expect('old_set_shortcut_denied','/api/auth/password/set',{'password':changed},400,'invalid')
other=Client()
other.expect('password_login_regression','/api/auth/password/login',{'channel':'email','target':identity,'password':password},200)
client.expect('change_missing_reauth','/api/auth/password/change',{'password':changed,'current_password':password},400,'invalid')
client.expect('change_invalid_reauth','/api/auth/password/change',{'password':changed,'current_password':password,'reauth_token':'invalid'},403,'reauth_required')
reauth_request,_=client.expect('reauth_request_bound_email','/api/auth/reauth/request',{},202)
body={'challenge_id':reauth_request['challenge_id'],'code':code_for(reauth_request['challenge_id'])}
other.expect('reauth_challenge_other_session_denied','/api/auth/reauth/verify',body,400,'invalid_code')
reauth,_=client.expect('reauth_verify','/api/auth/reauth/verify',body,200)
assert reauth['expires_in']==300
client.expect('reauth_otp_replay_denied','/api/auth/reauth/verify',body,400,'invalid_code')
change={'password':changed,'current_password':password,'reauth_token':reauth['reauth_token']}
other.expect('reauth_token_other_session_denied','/api/auth/password/change',change,403,'reauth_required')
client.expect('change_missing_current','/api/auth/password/change',{'password':changed,'reauth_token':reauth['reauth_token']},400,'invalid')
client.expect('change_wrong_current','/api/auth/password/change',{**change,'current_password':'wrong'},401,'invalid_credentials')
client.expect('change_success','/api/auth/password/change',change,200)
client.expect('reauth_replay_denied','/api/auth/password/change',{**change,'current_password':changed},403,'reauth_required')
other.expect('other_access_revoked','/api/auth/me',None,401,'unauthenticated')
other.expect('other_refresh_revoked','/api/auth/refresh',{},401,'unauthenticated')
client.expect('caller_access_preserved','/api/auth/me',None,200)
client.expect('caller_refresh_preserved','/api/auth/refresh',{},200)
new=Client()
new.expect('old_password_rejected','/api/auth/password/login',{'channel':'email','target':identity,'password':password},401,'invalid_credentials')
new.expect('new_password_login','/api/auth/password/login',{'channel':'email','target':identity,'password':changed},200)
assert query("select count(*) from password_reauth r join identities i on i.user_id=r.user_id where i.identifier_normalized='"+identity+"' and octet_length(r.token_hash)=32 and r.consumed_at is not null;")=='1'
record('reauth_hash_only_and_consumed',passed=True)
remaining=max(0,61-(time.monotonic()-registered_at))
record('await_existing_signup_cooldown',seconds=round(remaining,1))
# Only this disposable test identity waits for its ordinary send quota; no live quotas are edited.
while remaining>0:
 time.sleep(min(remaining,30))
 remaining=max(0,61-(time.monotonic()-registered_at))
backup_otp=request(new,identity,'login')
new.expect('password_account_backup_otp_login','/api/auth/otp/verify',backup_otp,200)
existing=request(new,identity,'register')
new.expect('existing_password_not_overwritten','/api/auth/register',{**existing,'password':password},409,'password_exists')
new.expect('existing_password_still_current','/api/auth/password/login',{'channel':'email','target':identity,'password':changed},200)
for c in [client,other,new]:c.expect('test_session_logout','/api/auth/logout',{},200)
query("update sessions set revoked_at=coalesce(revoked_at,now()),revoke_reason='acceptance_cleanup' where user_id in (select user_id from identities where identifier_normalized='"+identity+"') and revoked_at is null;")
assert query("select count(*) from sessions where user_id in (select user_id from identities where identifier_normalized='"+identity+"') and revoked_at is null;")=='0'
assert query('select name from kysely_migration order by name desc limit 1;')=='007_password_signup_reauth'
record('staging_acceptance_complete',result='PASS',new_test_accounts=1,test_sessions_logged_out=True,all_test_sessions_revoked=True,test_accounts_retained=True,expired_token_coverage='real PostgreSQL integration suite',phone_priority_coverage='real PostgreSQL integration suite; DOM suite uses a phone identity',migration='007_password_signup_reauth')
