import { useMemo, useRef, useState } from 'react'
import { api, parseBulkText, bulkSampleText } from '../../services/api'

const STEPS = { INPUT: 'input', RUNNING: 'running', DONE: 'done' }
const MAX_FILE = 2 * 1024 * 1024

/** 读取文件为 base64（去掉 data: 前缀）。 */
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

export default function BulkImportModal({ open, onClose, onImported, toast }) {
  const [text, setText] = useState('')
  const [step, setStep] = useState(STEPS.INPUT)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null)
  const [parseError, setParseError] = useState(null)
  const [xlsxInfo, setXlsxInfo] = useState(null)
  const [fileItems, setFileItems] = useState(null)
  const fileRef = useRef(null)

  const parsed = useMemo(() => {
    if (fileItems) return { items: fileItems, errors: [], skippedHeader: false }
    if (!text.trim()) return null
    return parseBulkText(text)
  }, [text, fileItems])

  const reset = () => {
    setText('')
    setStep(STEPS.INPUT)
    setProgress({ done: 0, total: 0 })
    setResult(null)
    setParseError(null)
    setXlsxInfo(null)
    setFileItems(null)
  }

  const close = () => {
    if (step === STEPS.RUNNING) return
    reset()
    onClose()
  }

  // 读取本地文件：.xlsx 走后端 openpyxl 解析，其余按文本读取
  const readFile = async (file) => {
    if (!file) return
    setParseError(null)
    const isXlsx = /\.xlsx$/i.test(file.name)

    if (file.size > MAX_FILE) {
      setParseError(`文件超过 ${MAX_FILE / 1024 / 1024}MB，请拆分后再导入`)
      return
    }

    if (isXlsx) {
      try {
        const contentBase64 = await readAsBase64(file)
        const res = await api.parseXlsx({ filename: file.name, contentBase64, commit: false })
        setFileItems(res.items || [])
        setXlsxInfo({ filename: file.name, sheet: res.sheet, errors: res.errors || [], skippedHeader: res.skippedHeader })
        setText('')
        if (!res.items?.length) setParseError('Excel 中没有解析出有效产品行')
      } catch (e) {
        setFileItems(null)
        setXlsxInfo(null)
        setParseError(e.message || 'Excel 解析失败')
      }
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setFileItems(null)
      setXlsxInfo(null)
      setText(String(reader.result || ''))
      setParseError(null)
    }
    reader.onerror = () => setParseError('文件读取失败，请改用粘贴方式')
    reader.readAsText(file, 'utf-8')
  }

  const run = async () => {
    if (!parsed || !parsed.items.length) return
    setStep(STEPS.RUNNING)
    setParseError(null)
    setProgress({ done: 0, total: parsed.items.length })
    setResult(null)

    // 逐条提交，实时反馈进度；后端同样逐行容错，单行失败不影响整批
    const created = []
    const failed = []
    for (let i = 0; i < parsed.items.length; i++) {
      const item = parsed.items[i]
      try {
        const res = await api.bulkImportProducts([item])
        const c = res?.created || []
        const f = res?.failed || []
        if (c.length) created.push({ ...c[0], index: i + 1 })
        if (f.length) failed.push({ ...f[0], index: i + 1 })
        if (!c.length && !f.length) failed.push({ index: i + 1, name: item.name, error: '未返回结果' })
      } catch (e) {
        failed.push({ index: i + 1, name: item.name, error: e.message || '请求失败' })
      }
      setProgress({ done: i + 1, total: parsed.items.length })
    }

    setResult({ created, failed })
    setStep(STEPS.DONE)
    if (created.length) onImported?.()
  }

  const retryFailed = () => {
    const names = new Set(result.failed.map((f) => f.name))
    const lines = parsed.items.filter((it) => names.has(it.name))
    setResult(null)
    setStep(STEPS.INPUT)
    setFileItems(null)
    setXlsxInfo(null)
    setText(
      ['名称,型号,分类,参数,应用场景']
        .concat(
          lines.map((it) =>
            [it.name, it.model, it.category, it.specs.join('; '), it.applications.join('; ')].join(',')
          )
        )
        .join('\n')
    )
  }

  if (!open) return null

  const canRun = !!parsed && parsed.items.length > 0 && step === STEPS.INPUT
  const allWarnings = [...(xlsxInfo?.errors || []), ...(parsed?.errors || [])]

  return (
    <div className="modal open">
      <div className="modal-backdrop" onClick={close} />
      <div className="modal-card bulk-modal">
        <button className="modal-close" onClick={close} disabled={step === STEPS.RUNNING}>
          ×
        </button>

        <div className="eyebrow">BULK IMPORT</div>
        <h2>批量导入产品</h2>

        {step === STEPS.INPUT && (
          <>
            <p>
              粘贴 Excel 中复制的清单，或上传 <b>.xlsx</b> / CSV 文件。每行一个产品，列顺序：
              <b>名称, 型号, 分类, 参数, 应用场景</b>。AI 会为每条自动生成三语言标题、卖点与搜索内容。
            </p>

            <div className="bulk-drop" onClick={() => fileRef.current?.click()}>
              <span className="bulk-drop-ico">⇪</span>
              <div>
                <b>选择 Excel(.xlsx) / CSV / TXT 文件</b>
                <small>或直接把内容粘贴到下方输入框（最大 2MB）</small>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv,.txt,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
                style={{ display: 'none' }}
                onChange={(e) => {
                  readFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>

            {xlsxInfo && (
              <div className="bulk-xlsx">
                <span className="bulk-xlsx-ico">📄</span>
                <div>
                  <b>{xlsxInfo.filename}</b>
                  <small>
                    工作表「{xlsxInfo.sheet || 'Sheet1'}」
                    {xlsxInfo.skippedHeader ? ' · 已跳过表头' : ''}
                  </small>
                </div>
                <button
                  className="row-btn"
                  onClick={() => {
                    setFileItems(null)
                    setXlsxInfo(null)
                  }}
                >
                  移除
                </button>
              </div>
            )}

            <textarea
              className="bulk-textarea"
              rows={xlsxInfo ? 4 : 9}
              placeholder={'名称,型号,分类,参数,应用场景\n便携式储能电源,AF-PS600,储能,容量: 600Wh; 输出: 600W,露营; 应急备电'}
              value={text}
              disabled={!!xlsxInfo}
              onChange={(e) => {
                setText(e.target.value)
                setParseError(null)
              }}
            />

            <div className="bulk-toolbar">
              <button
                className="row-btn"
                onClick={() => {
                  setFileItems(null)
                  setXlsxInfo(null)
                  setText(bulkSampleText())
                }}
              >
                填入示例
              </button>
              <button
                className="row-btn"
                onClick={() => {
                  setText('')
                  setFileItems(null)
                  setXlsxInfo(null)
                }}
                disabled={!text && !xlsxInfo}
              >
                清空
              </button>
              <span className="bulk-hint">
                支持逗号 / 制表符 / 中文逗号分隔；含分隔符的字段可用双引号包裹；首行表头会自动跳过。
              </span>
            </div>

            {parsed && (
              <div className="bulk-preview">
                <div className="bulk-preview-head">
                  <b>解析结果</b>
                  <span>
                    共 <b className="ok-text">{parsed.items.length}</b> 条有效产品
                    {parsed.skippedHeader && <em className="muted">（已跳过表头）</em>}
                  </span>
                </div>
                {allWarnings.length > 0 && (
                  <ul className="bulk-warn">
                    {allWarnings.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
                <div className="bulk-preview-list">
                  {parsed.items.slice(0, 6).map((it, i) => (
                    <div className="bulk-chip" key={i}>
                      <b>{it.name}</b>
                      <small>
                        {it.model || '无型号'} · {it.category || '未分类'} · {it.specs.length} 项参数
                      </small>
                    </div>
                  ))}
                  {parsed.items.length > 6 && (
                    <div className="bulk-chip more">…另有 {parsed.items.length - 6} 条</div>
                  )}
                </div>
              </div>
            )}

            {parseError && <div className="bulk-error">{parseError}</div>}

            <div className="onboard-actions">
              <button className="ghost-btn" onClick={close}>
                取消
              </button>
              <button className="primary-btn" onClick={run} disabled={!canRun}>
                {canRun ? `开始导入 ${parsed.items.length} 个产品` : '开始导入'}
              </button>
            </div>
          </>
        )}

        {step === STEPS.RUNNING && (
          <>
            <p>正在为每个产品生成多语言内容并写入数据库，请勿关闭窗口。</p>
            <div className="bulk-progress">
              <div className="bulk-progress-bar">
                <i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              <div className="bulk-progress-text">
                {progress.done} / {progress.total}
                <span> · {Math.round(progress.total ? (progress.done / progress.total) * 100 : 0)}%</span>
              </div>
            </div>
          </>
        )}

        {step === STEPS.DONE && result && (
          <>
            <div className="bulk-summary">
              <div className="bulk-stat ok">
                <b>{result.created.length}</b>
                <span>导入成功</span>
              </div>
              <div className={`bulk-stat ${result.failed.length ? 'bad' : ''}`}>
                <b>{result.failed.length}</b>
                <span>导入失败</span>
              </div>
            </div>

            {result.failed.length > 0 && (
              <div className="bulk-failed">
                <b>失败明细</b>
                <ul>
                  {result.failed.map((f, i) => (
                    <li key={i}>
                      第 {f.index} 行 <b>{f.name}</b>：{f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.created.length > 0 && (
              <div className="bulk-created">
                <b>已导入</b>
                <div className="bulk-preview-list">
                  {result.created.slice(0, 8).map((c, i) => (
                    <div className="bulk-chip" key={i}>
                      <b>{c.name}</b>
                      <small>{c.id}</small>
                    </div>
                  ))}
                  {result.created.length > 8 && (
                    <div className="bulk-chip more">…另有 {result.created.length - 8} 条</div>
                  )}
                </div>
              </div>
            )}

            <div className="onboard-actions">
              {result.failed.length > 0 && (
                <button className="ghost-btn" onClick={retryFailed}>
                  只重试失败项
                </button>
              )}
              <button className="ghost-btn" onClick={() => { reset() }}>
                再导入一批
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  if (result.created.length) toast?.(`已导入 ${result.created.length} 个产品`)
                  close()
                }}
              >
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
