import { useEffect, useState } from 'react'
import '../Sites/market-variants.css'

/**
 * PHASE 8 产品图库(JHWorld ProductGallery 体验的 React 重写,不复制 Django)。
 * images: [{url, source_type, caption, is_primary}...] — REAL 优先排序由后端管线保证。
 * 支持:封面主图 / 缩略图切换 / 左右切换 / 点击放大。
 */
export default function ProductGallery({ images = [], name = 'Product' }) {
  const list = images.filter((i) => i && i.url)
  const [idx, setIdx] = useState(0)
  const [zoom, setZoom] = useState(false)

  useEffect(() => { setIdx(0) }, [images])

  if (!list.length) {
    return <div className="pg-wrap"><div className="pg-main" style={{ height: 180, display: 'grid', placeItems: 'center', color: '#94a3b8', fontSize: 13 }}>暂无图片 — 上传真实产品图后优先展示(REAL)</div></div>
  }
  const cur = list[Math.min(idx, list.length - 1)]
  const go = (d) => setIdx((i) => (i + d + list.length) % list.length)

  return (
    <div className="pg-wrap">
      <div className="pg-main">
        <img src={cur.url} alt={cur.caption || name} onClick={() => setZoom(true)} />
        {list.length > 1 && (
          <>
            <button className="pg-nav pg-prev" onClick={() => go(-1)} aria-label="上一张">‹</button>
            <button className="pg-nav pg-next" onClick={() => go(1)} aria-label="下一张">›</button>
          </>
        )}
        <div className="pg-caption">
          <span>{cur.caption || name} · {idx + 1}/{list.length}</span>
          <span className={`pg-badge ${cur.source_type || 'FALLBACK'}`}>{cur.source_type || 'FALLBACK'}</span>
        </div>
      </div>
      {list.length > 1 && (
        <div className="pg-side">
          <div className="pg-thumbs">
            {list.map((im, i) => (
              <button key={i} className={`pg-thumb${i === idx ? ' on' : ''}`} onClick={() => setIdx(i)} aria-label={`第 ${i + 1} 张`}>
                <img src={im.url} alt="" />
              </button>
            ))}
          </div>
        </div>
      )}
      {zoom && (
        <div className="pg-lightbox" onClick={() => setZoom(false)}>
          <img src={cur.url} alt={cur.caption || name} />
        </div>
      )}
    </div>
  )
}
