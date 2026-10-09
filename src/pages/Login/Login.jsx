import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/store/AppContext'
import PublicVisualShell from '../../components/brand/PublicVisualShell'
import './auth.css'

const DEMO = { email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }

/** 后端 422 校验错误的 detail 是数组，直接渲染会让 React 崩溃白屏 —— 统一转成文案 */
function errText(err) {
  if (typeof err?.detail === 'string') return err.detail
  if (Array.isArray(err?.detail)) {
    return err.detail.map((d) => d?.msg || '').filter(Boolean).join('；') || '输入信息有误，请检查后重试'
  }
  return err?.message || '操作失败，请重试'
}

/**
 * 登录 / 注册页(公共视觉系统:与 /intro 地球首页同一套深色科技视觉)。
 *
 * 逻辑层与旧版完全一致 —— 多租户登录、注册、intended_template 回跳、
 * 演示账号、offline 提示、422 错误归一化,全部保留;本轮只改视觉与布局。
 */
export default function Login() {
  const { mode, login, register, toast } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState('login')
  const [form, setForm] = useState({
    email: '',
    password: '',
    company_name: '',
    industry: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [backendDown, setBackendDown] = useState(false)

  // 独立后端探测:模式订阅链路异常时也能如实显示离线状态(不猜测、不冒充可登录)
  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000'}/api/health`, {
      signal: AbortSignal.timeout(3000),
    })
      .then((r) => { if (alive) setBackendDown(!(r.ok || r.status === 401)) })
      .catch(() => { if (alive) setBackendDown(true) })
    return () => { alive = false }
  }, [])

  const offline = mode === 'local' || backendDown
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (tab === 'login') {
        await login(form.email.trim(), form.password)
        toast('已登录', 'success')
      } else {
        await register({
          email: form.email.trim(),
          password: form.password,
          company_name: form.company_name.trim(),
          industry: form.industry.trim(),
        })
        toast('账户已创建，已为你初始化独立站点空间', 'success')
      }
      // 登录前有「使用模板」意图：回到模板继续创建网站
      const intended = sessionStorage.getItem('sitepilot.intended_template')
      if (intended) {
        sessionStorage.removeItem('sitepilot.intended_template')
        navigate(`/sites/new?template=${encodeURIComponent(intended)}`)
      }
      // 其余情况由路由自然落到通用概览（/）
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  function fillDemo() {
    setTab('login')
    setForm((f) => ({ ...f, ...DEMO }))
    setError('')
  }

  return (
    <PublicVisualShell
      topbar={
        <header className="cp-login-top">
          <div className="cp-brand">
            <span className="cp-mark">C</span>
            <div>
              <strong>CrossPilot</strong>
              <span>AI 出海建站与获客平台 · 中 / 英 / 俄</span>
            </div>
          </div>
          <nav className="cp-login-nav">
            <button className="cp-btn cp-btn-ghost" onClick={() => navigate('/intro')}>← 返回首页</button>
            <button className="cp-btn cp-btn-ghost" onClick={() => navigate('/templates')}>模板商城</button>
          </nav>
        </header>
      }
    >
      <main className="cp-login-main">
        {/* 左侧:品牌与全球增长视觉 */}
        <section className="cp-login-left">
          <p className="cp-login-eyebrow">// GLOBAL GROWTH ENGINE</p>
          <h1 className="cp-login-title">
            让中国 B2B 企业
            <br />
            更快走向全球
          </h1>
          <p className="cp-login-sub">AI 建站 · 市场本地化 · SEO/GEO · 买家转化</p>

          <ul className="cp-login-caps">
            <li>
              <b>被找到</b>
              <span>SEO / GEO</span>
            </li>
            <li>
              <b>被理解</b>
              <span>Market Localization</span>
            </li>
            <li>
              <b>被信任</b>
              <span>Trust &amp; Compliance</span>
            </li>
            <li>
              <b>被询价</b>
              <span>RFQ / Buyer Conversion</span>
            </li>
          </ul>

          <p className="cp-login-bottom">GLOBAL MARKETS · SMARTER EXPORTS · WITH AI</p>
        </section>

        {/* 右侧:玻璃拟态登录卡片 */}
        <section className="cp-auth-card">
          <div className="cp-auth-brand">
            <span className="cp-mark">C</span>
            <div>
              <strong>CrossPilot</strong>
              <span>AI 驱动的 B2B 海外获客增长平台</span>
            </div>
          </div>

          {offline && (
            <div className="cp-auth-offline">
              <i className="cp-dot cp-dot-orange" />
              当前为静态演示模式。登录 / 注册需要后端服务,可先
              <button type="button" onClick={() => navigate('/templates')}>浏览模板商城</button>
            </div>
          )}

          <div className="cp-auth-tabs">
            <button
              type="button"
              className={tab === 'login' ? 'on' : ''}
              onClick={() => { setTab('login'); setError('') }}
            >
              登录
            </button>
            <button
              type="button"
              className={tab === 'register' ? 'on' : ''}
              onClick={() => { setTab('register'); setError('') }}
            >
              注册新企业
            </button>
          </div>

          <form className="cp-auth-form" onSubmit={submit}>
            <label>
              <span>邮箱</span>
              <input
                type="email"
                required
                autoComplete="username"
                placeholder="you@company.com"
                value={form.email}
                onChange={set('email')}
              />
            </label>

            <label>
              <span>密码</span>
              <input
                type="password"
                required
                minLength={6}
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                placeholder="至少 6 位"
                value={form.password}
                onChange={set('password')}
              />
            </label>

            {tab === 'register' && (
              <>
                <label>
                  <span>企业名称</span>
                  <input
                    type="text"
                    required
                    placeholder="例如：宁波 XX 机械有限公司"
                    value={form.company_name}
                    onChange={set('company_name')}
                  />
                </label>
                <label>
                  <span>所属行业（可选）</span>
                  <input
                    type="text"
                    placeholder="例如：工业水处理设备"
                    value={form.industry}
                    onChange={set('industry')}
                  />
                </label>
              </>
            )}

            {error && <div className="cp-auth-error">{error}</div>}

            <button className="cp-btn cp-btn-primary cp-auth-submit" type="submit" disabled={busy || offline}>
              {busy ? <><i className="cp-spinner" />正在连接 CrossPilot…</> : tab === 'login' ? '登录 CrossPilot' : '创建企业账户'}
            </button>
          </form>

          <div className="cp-auth-foot">
            <span>新账户自动创建独立企业空间,数据与其他商家完全隔离</span>
            <button type="button" className="cp-auth-demo" onClick={fillDemo}>
              填入演示账号
            </button>
          </div>
        </section>
      </main>
    </PublicVisualShell>
  )
}
