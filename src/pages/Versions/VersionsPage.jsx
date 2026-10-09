import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { useEntitlement } from '../../app/store/useEntitlement'

// 动作 → 中文标签 + 语义色。后端 Version.action 取值：
// publish | rollback | edit | brush | template | seo | geo
const ACTION_META = {
  publish: { label: '发布上线', tone: 'ok' },
  rollback: { label: '版本回滚', tone: 'warn' },
  edit: { label: '页面编辑', tone: 'info' },
  brush: { label: 'AI 画笔', tone: 'info' },
  template: { label: '切换模板', tone: 'info' },
  seo: { label: 'SEO 优化', tone: 'info' },
  geo: { label: 'GEO 优化', tone: 'info' },
}

const ENTITY_LABEL = { product: '产品', page: '页面', site: '站点' }

const actionMeta = (a) => ACTION_META[a] || { label: a || '变更', tone: 'info' }
const entityLabel = (t) => ENTITY_LABEL[t] || t || '实体'

const fmtTime = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const brief = (v) => {
  if (v === null || v === undefined) return '∅'
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > 120 ? `${s.slice(0, 120)}…` : s
}

// 把 before/after 两个快照拍平成 { field: {before, after, changed} } 列表
function diffSnapshots(before = {}, after = {}) {
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})])).sort()
  return keys.map((field) => {
    const b = before?.[field]
    const a = after?.[field]
    return { field, before: b, after: a, changed: JSON.stringify(b) !== JSON.stringify(a) }
  })
}

export default function VersionsPage() {
  const { toast } = useApp()
  const { can, requireFeature } = useEntitlement()
  // 站点作用域：挂在 /sites/:siteId/versions 下时只看该站点版本
  const { siteId } = useParams()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [entityFilter, setEntityFilter] = useState('all')

  const [detail, setDetail] = useState(null) // 详情（含 before/after 快照）
  const [detailLoading, setDetailLoading] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState(null) // 待确认回滚的版本
  const [restoring, setRestoring] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await api.listRecentVersions(100, siteId)
      setItems(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setError(e?.message || '版本记录加载失败')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    load()
  }, [load])

  const actions = useMemo(() => Array.from(new Set(items.map((v) => v.action).filter(Boolean))), [items])
  const entities = useMemo(
    () => Array.from(new Set(items.map((v) => v.entity_type).filter(Boolean))),
    [items]
  )

  const filtered = useMemo(
    () =>
      items.filter(
        (v) =>
          (actionFilter === 'all' || v.action === actionFilter) &&
          (entityFilter === 'all' || v.entity_type === entityFilter)
      ),
    [items, actionFilter, entityFilter]
  )

  async function openDetail(v) {
    setDetailLoading(true)
    setDetail({ ...v, before_snapshot: {}, after_snapshot: {} })
    try {
      const full = await api.getVersion(v.id)
      setDetail(full || v)
    } catch (e) {
      toast(e?.message || '版本详情加载失败')
    } finally {
      setDetailLoading(false)
    }
  }

  function askRestore(v) {
    if (!v.before_snapshot || Object.keys(v.before_snapshot).length === 0) {
      // 列表接口不含快照，需先拉详情再判断
      api
        .getVersion(v.id)
        .then((full) => {
          if (!full?.before_snapshot || Object.keys(full.before_snapshot).length === 0) {
            toast('该版本没有可恢复的快照')
            return
          }
          setRestoreTarget({ ...v, hasSnapshot: true })
        })
        .catch((e) => toast(e?.message || '版本详情加载失败'))
      return
    }
    setRestoreTarget({ ...v, hasSnapshot: true })
  }

  async function doRestore() {
    if (!restoreTarget) return
    // 回滚属于付费能力（统一走权限层，不在页面里散写收费判断）
    if (!can('version.restore')) {
      requireFeature('version.restore')
      return
    }
    setRestoring(true)
    try {
      const res = await api.rollbackVersion({
        entity_type: restoreTarget.entity_type,
        entity_id: restoreTarget.entity_id,
        version_id: restoreTarget.id,
      })
      if (res?.rolled_back) {
        toast(`已回滚到 v${restoreTarget.version_no} 之前的内容`)
        setRestoreTarget(null)
        setDetail(null)
        await load()
      } else {
        toast(res?.error || '回滚失败')
      }
    } catch (e) {
      toast(e?.message || '回滚失败')
    } finally {
      setRestoring(false)
    }
  }

  const detailDiff = detail ? diffSnapshots(detail.before_snapshot, detail.after_snapshot) : []
  const changedCount = detailDiff.filter((d) => d.changed).length

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">VERSION HISTORY</div>
          <h1>版本历史</h1>
          <p>
            每次 AI 生成、页面编辑、SEO/GEO 优化、模板切换与发布都会留痕。
            <b>可对比 before/after，并真实回滚到任意历史版本</b>（回滚会写回数据库，不是提示框）。
          </p>
        </div>
        <div className="head-actions">
          <button className="ghost-btn" onClick={load} disabled={loading}>
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>筛选</h3>
          <span className="usage-pill">{filtered.length} / {items.length}</span>
        </div>
        <div className="filter-row">
          <label>
            动作
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="all">全部</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {actionMeta(a).label}
                </option>
              ))}
            </select>
          </label>
          <label>
            对象
            <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
              <option value="all">全部</option>
              {entities.map((t) => (
                <option key={t} value={t}>
                  {entityLabel(t)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>变更记录</h3>
        </div>

        {error && <div className="inline-error">{error}</div>}

        {!error && !loading && filtered.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            暂无版本记录。发布站点、保存页面或执行 SEO/GEO 优化后，这里会出现可回滚的版本。
          </p>
        )}

        {filtered.length > 0 && (
          <table className="data-table version-table">
            <thead>
              <tr>
                <th style={{ width: 72 }}>版本</th>
                <th style={{ width: 168 }}>时间</th>
                <th style={{ width: 108 }}>动作</th>
                <th style={{ width: 108 }}>对象</th>
                <th>内容</th>
                <th style={{ width: 190 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const meta = actionMeta(v.action)
                return (
                  <tr key={v.id}>
                    <td>
                      <code>v{v.version_no}</code>
                    </td>
                    <td className="muted">{fmtTime(v.created_at)}</td>
                    <td>
                      <span className={`ver-tag ${meta.tone}`}>{meta.label}</span>
                    </td>
                    <td>
                      {entityLabel(v.entity_type)}
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {v.entity_id}
                      </div>
                    </td>
                    <td>{v.summary || v.note || '—'}</td>
                    <td>
                      <button className="link-btn" onClick={() => openDetail(v)}>
                        查看对比
                      </button>
                      <button className="link-btn" onClick={() => askRestore(v)}>
                        回滚到此版本
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 详情抽屉：before/after 对比 */}
      {detail && (
        <div className="vdrawer-mask" onClick={() => setDetail(null)}>
          <div className="vdrawer" onClick={(e) => e.stopPropagation()}>
            <div className="vdrawer-head">
              <div>
                <div className="eyebrow">VERSION v{detail.version_no}</div>
                <h3>{detail.summary || detail.note || `${entityLabel(detail.entity_type)}变更`}</h3>
                <div className="muted" style={{ fontSize: 12 }}>
                  {fmtTime(detail.created_at)} · {entityLabel(detail.entity_type)}:{detail.entity_id} ·{' '}
                  {actionMeta(detail.action).label}
                </div>
              </div>
              <button className="icon-btn" onClick={() => setDetail(null)}>
                ✕
              </button>
            </div>

            {detailLoading ? (
              <p className="muted">正在加载快照…</p>
            ) : (
              <>
                <div className="diff-summary">
                  共 <b>{detailDiff.length}</b> 个字段，其中 <b>{changedCount}</b> 个发生变化
                </div>
                <table className="data-table diff-table">
                  <thead>
                    <tr>
                      <th style={{ width: 160 }}>字段</th>
                      <th>变更前 (before)</th>
                      <th>变更后 (after)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailDiff.map((d) => (
                      <tr key={d.field} className={d.changed ? 'changed' : ''}>
                        <td>
                          <code>{d.field}</code>
                        </td>
                        <td className="diff-before">{brief(d.before)}</td>
                        <td className="diff-after">{brief(d.after)}</td>
                      </tr>
                    ))}
                    {detailDiff.length === 0 && (
                      <tr>
                        <td colSpan={3} className="muted">
                          该版本没有可展示的快照数据。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div className="vdrawer-actions">
                  <button className="primary-btn" onClick={() => askRestore(detail)}>
                    回滚到此版本
                  </button>
                  <button className="ghost-btn" onClick={() => setDetail(null)}>
                    关闭
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 二次确认：真回滚 */}
      {restoreTarget && (
        <div className="vdrawer-mask" onClick={() => !restoring && setRestoreTarget(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>确认回滚？</h3>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
              将把 <b>{entityLabel(restoreTarget.entity_type)}:{restoreTarget.entity_id}</b> 的内容恢复到{' '}
              <b>v{restoreTarget.version_no} 之前</b>的快照。此操作会真实写入数据库，并生成一条新的回滚版本记录
              （可再次回滚撤销）。
            </p>
            <div className="confirm-actions">
              <button className="primary-btn" disabled={restoring} onClick={doRestore}>
                {restoring ? '回滚中…' : '确认回滚'}
              </button>
              <button className="ghost-btn" disabled={restoring} onClick={() => setRestoreTarget(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
