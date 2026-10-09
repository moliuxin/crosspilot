import './public-theme.css'

/**
 * CrossPilot 公共视觉外壳(公开页面共享)。
 *
 * 提供:/intro 与 /login 一致的深色科技背景 ——
 * 星点层、网格层、极光、地球剪影、轻扫描线,全部纯 CSS,
 * 不渲染第二个 canvas/WebGL 地球(性能约束)。
 *
 * 用法:
 *   <PublicVisualShell topbar={...}>
 *     页面内容
 *   </PublicVisualShell>
 */
export default function PublicVisualShell({ topbar, globe = true, children }) {
  return (
    <div className="cp-shell">
      {globe && (
        <div
          className="cp-globe-silhouette"
          aria-hidden="true"
          style={{ width: '46vmin', height: '46vmin', right: '6vw', bottom: '4vh', opacity: 0.5 }}
        />
      )}
      {topbar}
      {children}
      <div className="cp-scan" aria-hidden="true" />
    </div>
  )
}
