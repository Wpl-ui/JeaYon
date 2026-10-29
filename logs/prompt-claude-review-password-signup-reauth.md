审阅 Codex「注册设密 + 改密 OTP 升权」（/workspace/selfhost）。只审不改，不要 commit/push/delete。
必读：logs/prompt-password-signup-reauth.md、logs/proposal-password-at-signup-reauth.md、server/docs/password-signup-reauth.md、logs/codex-password-signup-reauth.log 末尾、证据、LoginPage、PasswordSettings、auth service。
核对：1) 新账号必须验证码+密码同事务，禁止无密码建号；2) 已有密码不可注册覆盖；3) 改密须 OTP→reauth→新密码+当前密码；4) 旧 password/set 首次捷径已收紧；5) 忘记密码未伪造成功；6) 品牌导航未回退；7) 测试部署证据齐全。
可跑 /opt/node24/bin/node 测试。最后一行「结论：可上线」或「结论：需修复」。
