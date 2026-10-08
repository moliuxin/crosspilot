import { Link, useLocation } from 'react-router-dom'
import { useApp } from '../../app/store/AppContext'

const labels = {
  '/': '概览',
  '/sites': '我的网站',
  '/sites/new': '创建网站',
  '/products': '产品',
  '/inquiries': '询盘',
  '/customers': '客户',
  '/seo': 'SEO & GEO',
  '/seo/geo': 'GEO（AI 搜索）',
  '/growth': 'AI 增长',
  '/growth/geo': 'GEO（AI 搜索）',
  '/growth/audit': '网站诊断',
  '/growth/copy': 'AI 文案',
  '/growth/image': 'AI 图片',
  '/growth/competitor': '竞品分析',
  '/skills': 'Skill Center',
  '/localization': '多语言市场',
  '/agent': 'AI Agent · MCP',
  '/versions': '版本历史',
  '/templates': '模板商城',
  '/analytics': '数据分析',
  '/settings': '设置',
  '/help': '使用说明',
}

function breadcrumbText(pathname) {
  if (labels[pathname]) return labels[pathname]
  // /sites/:siteId/... → 站点管理（站点名由站点页自己展示）
  const siteMatch = pathname.match(/^\/sites\/[^/]+(\/.*)?$/)
  if (siteMatch) {
    const sub = siteMatch[1]
    if (!sub) return '站点概览'
    if (sub.startsWith('/products')) return '站点 · 产品'
    if (sub.startsWith('/editor')) return '站点 · 页面编辑'
    if (sub.startsWith('/markets')) return '站点 · 市场版本'
    if (sub.startsWith('/versions')) return '站点 · 版本历史'
    return '站点管理'
  }
  const tplMatch = pathname.match(/^\/templates\/[^/]+$/)
  if (tplMatch) return '模板预览'
  return '概览'
}

export default function Topbar({ onMenu }) {
  const { pathname } = useLocation()
  const { dataMode, aiStatus } = useApp()
  const modeMeta =
    dataMode === 'backend'
      ? { cls: 'on', dot: '●', label: '已连接后端' }
      : dataMode === 'local'
        ? { cls: 'off', dot: '○', label: '本地模式' }
        : { cls: 'wait', dot: '◌', label: '正在连接…' }
  // AI Provider 徽章：真实模型 / 调用失败已降级 / 内置模板
  const aiMeta = !aiStatus
    ? null
    : aiStatus.enabled && !aiStatus.degraded
      ? { cls: 'on', dot: '●', label: `AI: real · ${aiStatus.model || aiStatus.provider}` }
      : aiStatus.enabled && aiStatus.degraded
        ? { cls: 'warn', dot: '▲', label: 'AI: degraded（降级模板）' }
        : { cls: 'off', dot: '○', label: 'AI: 内置模板' }
  return (
    <header className="topbar">
      <button className="mobile-menu" onClick={onMenu}>☰</button>
      <div className="breadcrumb">
        <span>工作台</span>
        <b>/</b>
        <strong>{breadcrumbText(pathname)}</strong>
      </div>
      <div className="top-actions">
        <span className={`data-mode ${modeMeta.cls}`} title={dataMode === 'backend' ? '数据来自 FastAPI 后端（/api）' : '后端未启动，数据保存在本地 localStorage'}>
          {modeMeta.dot} {modeMeta.label}
        </span>
        {aiMeta && (
          <span
            className={`data-mode ${aiMeta.cls}`}
            title={
              aiStatus.enabled
                ? `LLM provider：${aiStatus.provider}（${aiStatus.model || '-'}）${aiStatus.degraded ? `\n最近一次调用失败：${aiStatus.last_error || '未知错误'}` : ''}`
                : '未配置真实模型，AI 能力使用内置模板生成'
            }
          >
            {aiMeta.dot} {aiMeta.label}
          </span>
        )}
        <Link className="ghost-btn" to="/help">帮助</Link>
      </div>
    </header>
  )
}
