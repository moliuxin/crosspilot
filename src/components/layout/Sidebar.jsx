import { NavLink } from 'react-router-dom'
import { useApp } from '../../app/store/AppContext'
import { useEntitlement } from '../../app/store/useEntitlement'

/**
 * 最终一级菜单（每项只对应一个目的与一个主路由）：
 *   概览 / 我的网站 / 询盘 / 客户 / SEO & GEO / AI增长 / 数据分析 / 模板商城 / 设置
 *
 * 规则（AGENTS.md / P0-NAV-TEMPLATE-PUBLIC）：
 * - 不允许任何两个一级菜单跳到同一路由；
 * - 页面编辑与产品管理都在具体网站内部（产品按键挂在「我的网站 → 某网站」下）；
 * - Buyer Persona / Buyer Conversion 只在 AI 增长；隐私条款只在设置；
 * - 工作区卡片显示的是企业（租户）身份，不是某个网站的名称。
 */
const primary = [
  { to: '/', end: true, icon: '◎', label: '概览' },
  { to: '/sites', icon: '◫', label: '我的网站' },
  { to: '/inquiries', icon: '✉', label: '询盘' },
  { to: '/customers', icon: '☺', label: '客户' },
  { to: '/seo', icon: '⚝', label: 'SEO & GEO' },
  { to: '/growth', icon: '✦', label: 'AI 增长', tag: 'PRO' },
  { to: '/analytics', icon: '↗', label: '数据分析' },
  { to: '/templates', icon: '▩', label: '模板商城', tag: 'NEW' },
  { to: '/settings', icon: '⚙', label: '设置' },
]

export default function Sidebar({ open, onClose }) {
  const { remainingGenerations, usage, tenant, user, logout, toast, openPaywall, entitlements } = useApp()
  const { isFree } = useEntitlement()
  // 工作区展示企业（租户）身份；具体网站从「我的网站」进入，不在侧栏出现
  const tenantName = tenant?.name || user?.displayName || 'Enterprise Account'
  const planName = entitlements?.planName || '免费版'

  async function handleLogout() {
    await logout()
    toast('已退出登录')
  }

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="brand-row">
        <div className="brand-mark">W</div>
        <div>
          <div className="brand-name">CrossPilot</div>
          <div className="brand-sub">AI 出海建站 · SITEPILOT</div>
        </div>
      </div>

      <div className="workspace-card">
        <div className="workspace-meta">
          <strong>{tenantName}</strong>
          <span>{tenant?.industry || user?.email || '企业账户'}</span>
        </div>
      </div>

      <nav className="nav-list nav-primary" aria-label="主导航">
        {primary.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            onClick={onClose}
          >
            <span className="nav-ico">{item.icon}</span>
            {item.label}
            {item.tag ? <i>{item.tag}</i> : null}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="plan-card">
          <div>
            <span className="plan-dot" />
            {planName}
          </div>
          <strong>账号级免费生成 {remainingGenerations}/{usage.freeGenerationLimit} 次</strong>
          <div className="mini-progress">
            <span style={{ width: `${(remainingGenerations / Math.max(1, usage.freeGenerationLimit)) * 72}%` }} />
          </div>
          <button
            onClick={() =>
              openPaywall(
                '升级套餐',
                isFree
                  ? '免费版包含 1 次完整生成。专业版不限次生成，并解锁 GEO、Agent 自动化、多语言市场版本与版本回滚。'
                  : '当前已是付费套餐，可继续升级以解锁更高额度与专业人工服务。',
                'plan.upgrade'
              )
            }
          >
            升级套餐
          </button>
        </div>
        <div className="user-row">
          <div className="avatar">{tenantName[0]}</div>
          <div>
            <strong>{tenantName}</strong>
            <span>{user?.role === 'operator' ? '平台运营' : '企业账户'}</span>
          </div>
          <button className="icon-btn" title="退出登录" onClick={handleLogout}>
            ⎋
          </button>
        </div>
      </div>
    </aside>
  )
}
