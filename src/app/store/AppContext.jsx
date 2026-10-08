import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useState } from 'react'
import { mockCompany } from '../../data/mockCompany'
import { api, detectBackend, onModeChange, onUnauthorized } from '../../services/api'
import { loadDb } from '../../services/db'

const AppContext = createContext(null)

const LS_KEY = 'sitepilot.onboarding.step'

// 平台默认直接进入商家工作台；首次建站引导作为独立入口（/#/onboarding）
const persistedStep = (() => {
  try {
    return localStorage.getItem(LS_KEY) || 'done'
  } catch {
    return 'done'
  }
})()

// 业务数据唯一真源在 localStorage（services/db.js），此处仅做视图态镜像
const db = loadDb()

const initialState = {
  company: mockCompany,
  markets: ['en-US', 'ru-RU', 'zh-CN'],
  currentMarket: 'en-US',
  // 站点状态（持久化 SiteState：companyName/industry/targetMarkets/plan/publishStatus…）
  site: db.site,
  // 免费完整生成次数（持久化）
  usage: db.usage,
  // 首次建站流程状态
  onboarding: {
    step: persistedStep, // form | hero | verify | generating | done
    industry: '',
    companyName: '',
    products: '',
    markets: [],
  },
  // 本次会话是否已走完首次完整生成（Demo 中允许体验 1 次）
  sessionGenerated: false,
  // Draft → Diff → 人工确认 → Publish（持久化）
  drafts: db.drafts,
  // 全局付费弹窗 { open, feature, reason, featureKey }
  paywall: { open: false, feature: '', reason: '', featureKey: '' },
  toasts: [],
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_MARKET':
      return { ...state, currentMarket: action.market }
    case 'SET_SITE':
      return { ...state, site: { ...state.site, ...action.patch } }
    case 'SET_ONBOARDING': {
      const next = { ...state.onboarding, ...action.patch }
      try {
        if (next.step) localStorage.setItem(LS_KEY, next.step)
      } catch {
        /* ignore */
      }
      return { ...state, onboarding: next }
    }
    case 'CONSUME_GENERATION': {
      const usage = { ...state.usage, freeGenerationUsed: state.usage.freeGenerationUsed + 1 }
      try {
        localStorage.setItem('sitepilot.db.v1', JSON.stringify({ ...loadDb(), usage }))
      } catch {
        /* ignore */
      }
      return { ...state, usage, sessionGenerated: true }
    }
    case 'SET_PLAN':
      return { ...state, site: { ...state.site, plan: action.plan } }
    case 'ADD_DRAFT': {
      // 同一个草稿可能被重复添加：Agent 页每次挂载会全量拉取后端草稿，
      // 若用户重复执行同一条指令（或刷新后重跑），会拿到同一个 draft.id。
      // 不去重会导致 (a) React key 冲突告警，(b) 侧栏出现多条重复待确认草稿。
      // 语义：以最新一次为准，把它提到最前，而不是追加副本。
      const rest = state.drafts.filter((d) => d.id !== action.draft.id)
      return { ...state, drafts: [action.draft, ...rest] }
    }
    case 'SET_DRAFTS': {
      // 后端列表理论上不会重复，但本地降级数据可能残留副本；
      // 统一按 id 去重，保证渲染 key 唯一。
      const seen = new Set()
      const unique = (action.drafts || []).filter((d) => {
        if (!d?.id || seen.has(d.id)) return false
        seen.add(d.id)
        return true
      })
      return { ...state, drafts: unique }
    }
    case 'CONFIRM_DRAFT':
      return { ...state, drafts: state.drafts.map((d) => (d.id === action.id ? { ...d, confirmed: true, status: 'published' } : d)) }
    case 'DISCARD_DRAFT':
      return { ...state, drafts: state.drafts.filter((d) => d.id !== action.id) }
    case 'PAYWALL_OPEN':
      return {
        ...state,
        paywall: {
          open: true,
          feature: action.feature || '',
          reason: action.reason || '',
          featureKey: action.featureKey || '',
        },
      }
    case 'PAYWALL_CLOSE':
      return { ...state, paywall: { open: false, feature: '', reason: '', featureKey: '' } }
    case 'TOAST_ADD':
      return { ...state, toasts: [...state.toasts, action.toast] }
    case 'TOAST_REMOVE':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) }
    default:
      return state
  }
}

let toastSeq = 0

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  // 数据链路：'unknown' 探测中 | 'backend' 已连 FastAPI | 'local' 本地降级
  const [mode, setMode] = useState(api.mode)
  // AI provider 状态（来自 /api/health 的 ai 字段）：null 未知 | {provider, enabled, degraded, runtime, model}
  const [aiStatus, setAiStatus] = useState(null)
  // 账户状态：'checking' 校验凭证中 | 'authed' 已登录 | 'anon' 未登录
  const [authState, setAuthState] = useState('checking')
  const [user, setUser] = useState(null)
  // 统一付费权限（真源来自后端 GET /api/entitlements，全前端共享一份）
  const [entitlements, setEntitlements] = useState(null)

  const refreshEntitlements = useCallback(async () => {
    try {
      const data = await api.getEntitlements()
      setEntitlements(data)
      return data
    } catch {
      setEntitlements(null)
      return null
    }
  }, [])

  // 登录态建立后立即拉取权限；登出清空
  useEffect(() => {
    if (authState === 'authed') refreshEntitlements()
    else setEntitlements(null)
  }, [authState, refreshEntitlements])

  // 凭证失效（401）时立即踢回登录页
  useEffect(() => onUnauthorized(() => {
    setUser(null)
    setAuthState('anon')
    setAiStatus(null)
  }), [])

  // 启动时探测后端可用性，并订阅后续链路切换（网络中断会自动降级）
  useEffect(() => {
    const off = onModeChange((next) => {
      setMode(next)
      if (next !== 'backend') setAiStatus(null) // 后端失联时清空 AI 状态，不冒充可用
    })
    detectBackend().then(async (up) => {
      if (!up) {
        // 纯本地模式（无后端）：不强制登录，保持离线演示可用
        setAuthState('anon')
        return
      }
      const h = await api.health()
      setAiStatus(h?.ai || null)
      if (!api.hasToken) {
        setAuthState('anon')
        return
      }
      // 有凭证：向后端确认其仍然有效（过期/被撤销则退回登录页）
      const me = await api.me()
      if (me) {
        setUser(me)
        setAuthState('authed')
      } else {
        setAuthState('anon')
      }
    })
    return off
  }, [])

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password)
    setUser(data.user)
    setAuthState('authed')
    return data.user
  }, [])

  const register = useCallback(async (payload) => {
    const data = await api.register(payload)
    setUser(data.user)
    setAuthState('authed')
    return data.user
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    setUser(null)
    setAuthState('anon')
  }, [])

  const toast = useCallback((message, tone = 'default') => {
    const id = ++toastSeq
    dispatch({ type: 'TOAST_ADD', toast: { id, message, tone } })
    setTimeout(() => dispatch({ type: 'TOAST_REMOVE', id }), 2400)
  }, [])

  const openPaywall = useCallback((feature, reason, featureKey) => {
    dispatch({ type: 'PAYWALL_OPEN', feature, reason, featureKey })
  }, [])

  const value = useMemo(
    () => ({
      ...state,
      dispatch,
      toast,
      openPaywall,
      // 当前数据链路（顶栏展示"已连接后端 / 本地模式"）
      dataMode: mode,
      isBackend: mode === 'backend',
      // AI 能力状态（顶栏展示 AI Provider 徽章：real / degraded / 模板）
      aiStatus,
      // 账户与租户：登录页/路由守卫/顶栏公司名都从这里取
      authState,
      user,
      tenant: user?.tenant || null,
      login,
      register,
      logout,
      // 统一付费权限：真源来自后端，页面一律通过 useEntitlement 消费
      entitlements,
      refreshEntitlements,
      // 免费完整生成剩余次数（持久化，初始 1/1）
      remainingGenerations: Math.max(0, state.usage.freeGenerationLimit - state.usage.freeGenerationUsed),
      isFree: entitlements ? entitlements.plan === 'free' : state.site.plan === 'free',
      publishStatus: state.site.publishStatus,
      setMarket: (market) => dispatch({ type: 'SET_MARKET', market }),
      setOnboarding: (patch) => dispatch({ type: 'SET_ONBOARDING', patch }),
      // 站点状态更新：写库 + 更新视图
      setSite: (patch) => {
        api.updateSiteState(patch)
        dispatch({ type: 'SET_SITE', patch })
      },
      addDraft: (draft) => dispatch({ type: 'ADD_DRAFT', draft }),
      // 从数据层覆盖式同步草稿（Agent 页挂载时拉取后端/持久层）
      setDrafts: (drafts) => dispatch({ type: 'SET_DRAFTS', drafts }),
      confirmDraft: (id) => dispatch({ type: 'CONFIRM_DRAFT', id }),
      discardDraft: (id) => {
        api && saveDraftRemoval(id)
        dispatch({ type: 'DISCARD_DRAFT', id })
      },
    }),
    [state, toast, openPaywall, mode, aiStatus, authState, user, login, register, logout, entitlements, refreshEntitlements]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// 草稿丢弃也同步到持久层
function saveDraftRemoval(id) {
  try {
    const db2 = loadDb()
    localStorage.setItem('sitepilot.db.v1', JSON.stringify({ ...db2, drafts: db2.drafts.filter((d) => d.id !== id) }))
  } catch {
    /* ignore */
  }
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
