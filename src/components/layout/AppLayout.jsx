import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import Toasts from '../ui/Toasts'
import BrandIntro from '../brand/BrandIntro'
import { useApp } from '../../app/store/AppContext'
import { resolveBrand } from '../../data/brand'

/**
 * 商家工作台外壳。
 *
 * 多站点规则：顶部不再放「预览网站 / 发布网站」这类站点级按钮 ——
 * 它们属于具体网站（SiteLayout 内），概览层只保留链路与账户状态。
 */
export default function AppLayout() {
  const { company } = useApp()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // 平台后台使用平台品牌；若企业已配置自身品牌则跟随
  const brand = resolveBrand(company, 'platform')

  return (
    <>
      <BrandIntro brand={brand} variant="platform" />

      <div className="app-shell">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="main-area">
          <Topbar onMenu={() => setSidebarOpen((v) => !v)} />
          <Outlet />
        </main>
      </div>

      <Toasts />
    </>
  )
}
