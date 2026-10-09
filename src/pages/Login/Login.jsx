import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/store/AppContext'
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
 * 登录 / 注册页。
 *
 * 多租户改造后，工作台数据全部按登录账户的租户隔离 ——
 * 没有凭证时业务端点一律 401，所以这里是进入工作台的唯一入口。
 * 未登录使用模板时会记录 intended_template，登录成功后回到创建流程。
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

  const offline = mode === 'local'
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
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-logo">CrossPilot</span>
          <span className="auth-tagline">AI 出海建站 · 中英俄多市场获客平台</span>
        </div>

        {offline && (
          <div className="auth-warn">
            后端未连接，当前为静态演示模式。登录/注册需要后端服务（本地启动 API 或访问自托管部署）；
            你也可以先<b>免登录浏览</b>
            <a href="#/templates" style={{ color: 'var(--blue)', fontWeight: 600 }}>模板商城</a>。
          </div>
        )}

        <div className="auth-tabs">
          <button
            type="button"
            className={tab === 'login' ? 'auth-tab on' : 'auth-tab'}
            onClick={() => {
              setTab('login')
              setError('')
            }}
          >
            登录
          </button>
          <button
            type="button"
            className={tab === 'register' ? 'auth-tab on' : 'auth-tab'}
            onClick={() => {
              setTab('register')
              setError('')
            }}
          >
            注册新企业
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label className="auth-field">
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

          <label className="auth-field">
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
              <label className="auth-field">
                <span>企业名称</span>
                <input
                  type="text"
                  required
                  placeholder="例如：宁波 XX 机械有限公司"
                  value={form.company_name}
                  onChange={set('company_name')}
                />
              </label>
              <label className="auth-field">
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

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-submit" type="submit" disabled={busy || offline}>
            {busy ? '处理中…' : tab === 'login' ? '登录工作台' : '创建账户并开始'}
          </button>
        </form>

        <div className="auth-foot">
          <span>新账户会自动创建独立的企业空间，数据与其他商家完全隔离。</span>
          <button type="button" className="auth-demo" onClick={fillDemo}>
            填入演示账号
          </button>
        </div>
      </div>

      <div className="auth-side">
        <h2>每个商家一套独立数据</h2>
        <ul>
          <li>产品、询盘、页面、草稿均按企业租户隔离，互不可见</li>
          <li>免费额度按企业独立计算，不被他人消耗影响</li>
          <li>发布必须人工确认，Agent 永不直接改线上内容</li>
        </ul>
      </div>
    </div>
  )
}
