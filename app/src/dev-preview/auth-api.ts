// Never send SMS, perform OAuth, or create a session from the screenshot preview.
export async function requestPhoneCode(_phone: string): Promise<never> { throw new Error('预览模式：不发送验证码。请在正常入口使用真实登录。') }
export async function requestEmailCode(_email: string): Promise<never> { throw new Error('预览模式：不发送验证码。请在正常入口使用真实登录。') }
export async function verifyPhoneCode(): Promise<never> { throw new Error('预览模式：不执行登录。') }
export async function verifyOtpCode(): Promise<never> { throw new Error('预览模式：不执行登录。') }
export async function startWechatLogin(): Promise<never> { throw new Error('预览模式：不执行登录。') }
export async function fetchMe(): Promise<never> { throw new Error('预览模式：无会话。') }
export async function updateAccountName(_name: string): Promise<never> { throw new Error('预览模式：不执行资料更新。') }
export async function refreshSession(): Promise<never> { throw new Error('预览模式：无会话。') }
export async function logoutSession(): Promise<void> {}

export async function passwordLogin(_channel: 'phone' | 'email', _target: string, _password: string): Promise<never> { throw new Error('预览模式：不执行登录。') }
export async function setAccountPassword(_password: string, _currentPassword?: string): Promise<never> { throw new Error('预览模式：不执行改密。') }

export async function registerAccount(): Promise<never> { throw new Error('预览模式：不执行注册。') }
export async function requestPasswordReauth(): Promise<never> { throw new Error('预览模式：不发送验证码。') }
export async function verifyPasswordReauth(): Promise<never> { throw new Error('预览模式：不执行验证。') }
