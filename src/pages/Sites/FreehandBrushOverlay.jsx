import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Freehand AI Brush 圈选层(全国赛 BATCH1-②)。
 *
 * - Freehand(默认)/Rectangle 两种圈选模式
 * - pointerdown/move/up 记录路径点 → 轻度降采样 + 自动闭合 → Polygon + BBox
 * - 蓝青色发光边线 + 12% 半透明选区;圈选外区域整体暗化(SVG evenodd 挖洞)
 * - 工具条:确认 / 重画 / 撤销 / 清空 / 退出;支持 ESC 退出、Ctrl+Z 撤销
 * - 确认时按选区 BBox 与 [data-brush-target] 区块矩形的最大重叠判定 section_hint
 *
 * selection 数据结构(spec 5.3):
 * { selection_mode, polygon_points, bounding_box, section_hint, strokes }
 */

/** 距离阈值降采样:相邻点 < 4px 丢弃,再 Chaikin 平滑一轮 */
function smoothPath(points) {
  if (points.length < 3) return points
  const ds = [points[0]]
  for (const p of points) {
    const q = ds[ds.length - 1]
    if (Math.hypot(p.x - q.x, p.y - q.y) >= 4) ds.push(p)
  }
  if (ds.length < 3) return ds
  const out = [ds[0]]
  for (let i = 0; i < ds.length - 1; i++) {
    const a = ds[i], b = ds[i + 1]
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
    out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
  }
  out.push(ds[ds.length - 1])
  return out
}

function bboxOf(points) {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function pathD(points) {
  if (!points.length) return ''
  const head = `M ${points[0].x} ${points[0].y}`
  return head + points.slice(1).map((p) => ` L ${p.x} ${p.y}`).join('') + ' Z'
}

export default function FreehandBrushOverlay({ onConfirm, onExit }) {
  const [mode, setMode] = useState('freehand')           // freehand | rectangle
  const [strokes, setStrokes] = useState([])             // 历史笔画(每笔为平滑后的点列)
  const [drawing, setDrawing] = useState([])             // 进行中的笔画
  const overlayRef = useRef(null)
  const activeRef = useRef(false)

  const commitStroke = useCallback((pts) => {
    const p = mode === 'rectangle'
      ? [{ x: pts[0].x, y: pts[0].y }, { x: pts[pts.length - 1].x, y: pts[0].y },
         { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y }, { x: pts[0].x, y: pts[pts.length - 1].y }]
      : smoothPath(pts)
    if (p.length >= 3) setStrokes((s) => [...s, p])
  }, [mode])

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    activeRef.current = true
    setDrawing([{ x: e.clientX, y: e.clientY }])
  }
  const onPointerMove = (e) => {
    if (!activeRef.current) return
    setDrawing((d) => [...d, { x: e.clientX, y: e.clientY }])
  }
  const onPointerUp = () => {
    if (!activeRef.current) return
    activeRef.current = false
    setDrawing((d) => { if (d.length > 2) commitStroke(d); return [] })
  }

  const undo = useCallback(() => setStrokes((s) => s.slice(0, -1)), [])
  const clear = useCallback(() => setStrokes([]), [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onExit() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit, undo])

  const allPts = [...strokes.flat(), ...drawing]
  const bbox = allPts.length >= 3 ? bboxOf(allPts) : null

  /** 确认:与 [data-brush-target] 区块求最大重叠 → section_hint */
  const confirm = () => {
    if (!bbox) return
    let best = null, bestArea = 0
    document.querySelectorAll('[data-brush-target]').forEach((el) => {
      const r = el.getBoundingClientRect()
      const ox = Math.max(0, Math.min(bbox.x + bbox.w, r.right) - Math.max(bbox.x, r.left))
      const oy = Math.max(0, Math.min(bbox.y + bbox.h, r.bottom) - Math.max(bbox.y, r.top))
      const area = ox * oy
      if (area > bestArea) { bestArea = area; best = el }
    })
    if (!best || bestArea <= 0) return
    const [market, sectionId] = best.getAttribute('data-brush-target').split('|')
    onConfirm({
      selection_mode: mode,
      polygon_points: strokes.flat().map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      bounding_box: { x: Math.round(bbox.x), y: Math.round(bbox.y), w: Math.round(bbox.w), h: Math.round(bbox.h) },
      section_hint: sectionId,
      market,
      strokes: strokes.length,
    })
  }

  const toPoly = (pts) => pathD(pts.length > 2 ? pts : [])
  const vw = window.innerWidth, vh = window.innerHeight
  const maskId = 'brush-hole-mask'

  return (
    <div className="fb-overlay" ref={overlayRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {/* 圈选外区域暗化:全屏矩形 + 选区挖洞(evenodd) */}
      <svg className="fb-mask" width={vw} height={vh}>
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width={vw} height={vh} fill="white" />
            {strokes.map((pts, i) => <path key={i} d={toPoly(pts)} fill="black" />)}
            {drawing.length > 2 && <path d={toPoly(drawing)} fill="black" />}
          </mask>
        </defs>
        <rect x="0" y="0" width={vw} height={vh} fill="rgba(15,23,42,0.45)" mask={`url(#${maskId})`} />
        {strokes.map((pts, i) => (
          <path key={i} d={toPoly(pts)} className="fb-poly" />
        ))}
        {drawing.length > 2 && <path d={toPoly(drawing)} className="fb-poly fb-poly-active" />}
      </svg>

      <div className="fb-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <span className="fb-title">🖌 自由圈选</span>
        <div className="fb-modes">
          <button className={mode === 'freehand' ? 'on' : ''} onClick={() => setMode('freehand')}>✏️ 手绘</button>
          <button className={mode === 'rectangle' ? 'on' : ''} onClick={() => setMode('rectangle')}>▭ 矩形</button>
        </div>
        <button onClick={confirm} disabled={!bbox}>✓ 确认</button>
        <button onClick={() => { setDrawing([]); setStrokes([]) }} title="重画">↺ 重画</button>
        <button onClick={undo} disabled={!strokes.length} title="撤销上一笔 (Ctrl+Z)">⌫ 撤销</button>
        <button onClick={clear} disabled={!strokes.length && !drawing.length}>✕ 清空</button>
        <button onClick={onExit} title="退出 (ESC)">⎋ 退出</button>
      </div>
    </div>
  )
}
