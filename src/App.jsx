import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { AppProvider, useApp } from './app/store/AppContext'
import AppLayout from './components/layout/AppLayout'
import PaywallModal from './components/ui/PaywallModal'

import OverviewPage from './pages/Overview/OverviewPage'
import SitesPage from './pages/Sites/SitesPage'
import SiteNew from './pages/Sites/SiteNew'
import SiteLayout from './pages/Sites/SiteLayout'
import SiteOverview from './pages/Sites/SiteOverview'
import SiteProducts from './pages/Sites/SiteProducts'
import Products from './pages/Products/Products'
import PageEditor from './pages/PageEditor/PageEditor'
import Inquiries from './pages/Inquiries/Inquiries'
import CustomersPage from './pages/Customers/CustomersPage'
import AIGrowth from './pages/AIGrowth/AIGrowth'
import SkillCenter from './pages/SkillCenter/SkillCenter'
import Localization from './pages/Localization/Localization'
import SEOCompare from './pages/SEOCompare/SEOCompare'
import AgentPage from './pages/Agent/AgentPage'
import VersionsPage from './pages/Versions/VersionsPage'
import TemplatesPage from './pages/Templates/TemplatesPage'
import TemplatePreview from './pages/Templates/TemplatePreview'
import HelpPage from './pages/Help/HelpPage'
import Geo from './pages/Geo/Geo'
import GrowthFeature from './pages/AIGrowth/GrowthFeature'
import AnalyticsPage from './pages/Analytics/AnalyticsPage'
import SettingsPage from './pages/Settings/SettingsPage'
import Onboarding from './pages/Onboarding/Onboarding'
import Login from './pages/Login/Login'
import GlobeIntro from './components/globe/GlobeIntro'
import { api } from './services/api'

/** 旧路由 /editor 的兼容跳转：进入第一个站点的编辑器。 */
function EditorRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    api
      .getSites()
      .then((sites) => {
        if (sites.length) navigate(`/sites/${sites[0].id}/editor`, { replace: true })
        else navigate('/sites', { replace: true })
      })
      .catch(() => navigate('/sites', { replace: true }))
  }, [navigate])
  return <div className="boot-splash"><div className="boot-spinner" /><span>正在进入站点编辑器…</span></div>
}

function Routed() {
  const { authState, dataMode } = useApp()

  // 凭证校验中：避免闪现登录页或工作台
  if (authState === 'checking') {
    return (
      <div className="boot-splash">
        <div className="boot-spinner" />
        <span>正在校验登录状态…</span>
      </div>
    )
  }

  // 未登录：3D 地球入场页 / 登录 / 模板商城（含预览）为公开路由。
  // 地球页是访客第一屏（拖动交互），从那里进入模板商城或登录。
  if (authState === 'anon') {
    return (
      <Routes>
        <Route path="/intro" element={<GlobeIntro />} />
        <Route path="/login" element={<Login />} />
        <Route path="/templates" element={<PublicShell><TemplatesPage /></PublicShell>} />
        <Route path="/templates/:slug" element={<PublicShell><TemplatePreview /></PublicShell>} />
        <Route path="*" element={<Navigate to="/intro" replace />} />
      </Routes>
    )
  }

  // 登录后进入通用商家工作台（不自动选中某个网站；具体网站从「我的网站」进入）
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      {/* 地球首页：登录后仍可访问（Topbar「回到首页」指向这里） */}
      <Route path="/intro" element={<GlobeIntro />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/templates/:slug" element={<TemplatePreview />} />
      <Route path="/" element={<AppLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="sites" element={<SitesPage />} />
        <Route path="sites/new" element={<SiteNew />} />
        <Route path="sites/:siteId" element={<SiteLayout />}>
          <Route index element={<SiteOverview />} />
          <Route path="products" element={<SiteProducts />} />
          <Route path="editor" element={<PageEditor />} />
          <Route path="markets" element={<Localization />} />
          <Route path="versions" element={<VersionsPage />} />
        </Route>
        <Route path="products" element={<Products />} />
        <Route path="inquiries" element={<Inquiries />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="growth" element={<AIGrowth />} />
        <Route path="growth/geo" element={<Geo />} />
        <Route path="growth/:feature" element={<GrowthFeature />} />
        <Route path="skills" element={<SkillCenter />} />
        <Route path="localization" element={<Localization />} />
        <Route path="seo" element={<SEOCompare />} />
        <Route path="seo/geo" element={<Geo />} />
        <Route path="agent" element={<AgentPage />} />
        <Route path="versions" element={<VersionsPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="help" element={<HelpPage />} />
        {/* 旧路由兼容：页面编辑不再是一级入口，跳到第一个站点 */}
        <Route path="editor" element={<EditorRedirect />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

/** 匿名公开外壳：给模板商城一个独立页头（不含商家侧栏），作为平台公开主页。 */
function PublicShell({ children }) {
  const navigate = useNavigate()
  return (
    <div className="tpl-public-page">
      <header className="tpl-public-head">
        <div className="tpl-public-brand">
          <span className="mark">C</span>
          <div>
            <strong>CrossPilot</strong>
            <span>面向 B2B 出海的 AI 建站与获客平台 · 中 / 英 / 俄</span>
          </div>
        </div>
        <div className="tpl-public-actions">
          <button className="ghost-btn" onClick={() => navigate('/templates')}>模板商城</button>
          <button className="primary-btn" onClick={() => navigate('/login')}>登录 / 注册</button>
        </div>
      </header>
      <section className="tpl-public-hero">
        <div>
          <h1>客户买的不是网站，是海外询盘与可信的生意机会</h1>
          <p>
            理解你的产品类别 → 生成结构 / 文案 / 视觉 → 中英俄三个市场独立表达（不是翻译）→
            SEO &amp; GEO 让你被找到、被信任、被询价。下面是可直接预览的行业模板。
          </p>
        </div>
      </section>
      <div className="tpl-public-body">{children}</div>
      <footer className="tpl-public-foot">
        浏览与预览无需登录 · 使用模板时再登录 · Demo 数据均已标注（Demo / Test）
      </footer>
    </div>
  )
}

// 已完成后台时，让 /onboarding 也能作为独立预览路由访问
export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Routed />
        {/* 全局付费门槛弹窗（免费额度外的动作统一触发） */}
        <PaywallModal />
      </HashRouter>
    </AppProvider>
  )
}
