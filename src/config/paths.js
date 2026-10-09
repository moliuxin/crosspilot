// 部署路径配置 —— 全站唯一真源（禁止在组件里硬编码 /api 或域名）。
//
// 两个部署变量（对应 docker/.env 的 APP_BASE_PATH / API_BASE_PATH）：
//   APP_BASE_PATH  应用部署子路径，默认 "/"，支持 "/crosspilot/" 等
//   API_BASE_PATH  浏览器调用后端 API 的路径前缀，默认从 APP_BASE_PATH 派生：${APP_BASE_PATH}api
//
// 解析优先级（apiBasePath）：
//   1) 构建时注入 VITE_API_BASE（完整 URL，跨域/开发直连后端用）
//   2) 构建时注入 VITE_API_BASE_PATH（同源路径前缀）
//   3) 开发模式（vite dev）：默认 http://127.0.0.1:8000（dev server 不代理 /api）
//   4) 生产构建默认：运行时从页面地址推导 —— 页面目录 + "api"。
//      配合「外部 Nginx 不剥离子路径前缀」的转发约定，改 APP_BASE_PATH
//      只需改环境变量并重启，前端无需重新构建（详见 DEPLOYMENT-DOCKER.md）。
//
// WebSocket：项目当前无 WS 端点；wsBaseUrl() 预留派生规则
// （默认 ${APP_BASE_PATH}ws，协议随页面 http/https 自动选择）。

function env(name) {
  try {
    return (import.meta.env && import.meta.env[name]) || ''
  } catch {
    return '' /* 非 Vite 环境（node 单测） */
  }
}

/** 规范化路径：过滤空段、确保前导 "/"、去尾斜杠（根路径除外）。
 * normalizeBase('') → '/'；normalizeBase('crosspilot') → '/crosspilot'；
 * normalizeBase('/crosspilot//') → '/crosspilot'；normalizeBase('///a//b///') → '/a/b' */
export function normalizeBase(p) {
  const segs = String(p ?? '').split('/').filter(Boolean)
  return segs.length ? '/' + segs.join('/') : '/'
}

/** 目录形式（带尾斜杠）：'/crosspilot' → '/crosspilot/'，'/' 保持不变。 */
export function withTrailingSlash(p) {
  const s = normalizeBase(p)
  return s === '/' ? s : s + '/'
}

/** 安全拼接：空段过滤 + 去重复斜杠，返回以 "/" 开头的完整路径。
 * joinPath('/crosspilot/', '/api/', '/health') → '/crosspilot/api/health' */
export function joinPath(...parts) {
  const segs = parts.flatMap((p) => String(p ?? '').split('/')).filter(Boolean)
  return segs.length ? '/' + segs.join('/') : '/'
}

/** 应用根（目录形式，带尾斜杠）。
 * 显式配置优先；否则运行时从页面地址推导（HashRouter 的 hash 不参与请求路径，
 * 页面所在目录即应用根：/crosspilot/#/sites → /crosspilot/）。 */
export function appBasePath() {
  const cfg = env('VITE_APP_BASE_PATH')
  if (cfg) return withTrailingSlash(cfg)
  if (typeof window === 'undefined') return '/'
  const dir = window.location.pathname.replace(/[^/]*$/, '')
  return dir.endsWith('/') ? dir : dir + '/'
}

/** API 前缀（无尾斜杠），如 '/crosspilot/api' 或 'http://127.0.0.1:8000'。 */
export function apiBasePath() {
  const urlCfg = env('VITE_API_BASE')
  if (urlCfg) return String(urlCfg).replace(/\/+$/, '')
  const pathCfg = env('VITE_API_BASE_PATH')
  if (pathCfg) return normalizeBase(pathCfg)
  let isDev = false
  try {
    isDev = !!(import.meta.env && import.meta.env.DEV)
  } catch {
    /* node 环境 */
  }
  if (isDev) return 'http://127.0.0.1:8000'
  return joinPath(appBasePath(), 'api')
}

/** 统一 API 请求地址：apiUrl('/auth/login') → '/crosspilot/api/auth/login'。 */
export function apiUrl(path) {
  return joinPath(apiBasePath(), path)
}

/** WebSocket 基址（预留）。协议随页面 http/https 自动选择（http→ws / https→wss）。 */
export function wsBaseUrl(subPath = 'ws') {
  if (typeof window === 'undefined') return ''
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}${joinPath(appBasePath(), subPath)}`
}
