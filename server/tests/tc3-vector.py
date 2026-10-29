"""Independent vector generator; no network or credentials.
Canonical request structure: https://cloud.tencent.com/document/api/213/30654
Run: python3 tests/tc3-vector.py
"""
import hashlib
import hmac

body = '{"Limit": 1, "Filters": [{"Values": ["未命名"], "Name": "instance-name"}]}'
canonical = ('POST\n/\n\ncontent-type:application/json; charset=utf-8\n'
             'host:cvm.tencentcloudapi.com\nx-tc-action:describeinstances\n\n'
             'content-type;host;x-tc-action\n' + hashlib.sha256(body.encode()).hexdigest())
to_sign = ('TC3-HMAC-SHA256\n1551113065\n2019-02-25/cvm/tc3_request\n'
           + hashlib.sha256(canonical.encode()).hexdigest())
key = b'TC3public-unit-test-key-not-a-credential'
for part in ('2019-02-25', 'cvm', 'tc3_request'):
    key = hmac.new(key, part.encode(), hashlib.sha256).digest()
print(hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest())
