import { useEffect, useState } from 'react'

const EMPTY = {
  name: '',
  model: '',
  category: '',
  specsText: 'Capacity: 100 m³/h\nPressure: 1.0 MPa',
  benefitsText: 'Stable operation\nEasy maintenance',
  applicationsText: 'Water treatment\nIndustrial circulation',
}

export default function ProductForm({ product, submitting, onSubmit, onCancel }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name || '',
        model: product.model || '',
        category: product.category || '',
        specsText: (product.specs || []).map((s) => `${s.key}: ${s.value}`).join('\n'),
        benefitsText: (product.benefits || []).join('\n'),
        applicationsText: (product.applications || []).join('\n'),
      })
    } else {
      setForm(EMPTY)
    }
  }, [product])

  const parsePairs = (text) =>
    text
      .split('\n')
      .map((l) => l.split(':'))
      .filter((arr) => arr[0] && arr[0].trim())
      .map((arr) => ({ key: arr[0].trim(), value: (arr[1] || '').trim() }))

  const parseLines = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean)

  const submit = (e) => {
    e.preventDefault()
    // 表单校验：名称必填，型号建议填写
    if (!form.name.trim()) {
      setError('请填写产品名称（必填）')
      return
    }
    if (!form.model.trim()) {
      setError('请填写型号，采购商搜索时依赖型号识别产品')
      return
    }
    setError('')
    onSubmit({
      name: form.name.trim(),
      model: form.model.trim(),
      category: form.category.trim() || 'General',
      specs: parsePairs(form.specsText),
      benefits: parseLines(form.benefitsText),
      applications: parseLines(form.applicationsText),
      images: [],
    })
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 16 }}>
      {error && (
        <div style={{ background: '#fef2f2', color: '#b42318', border: '1px solid #fecdca', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 12 }}>
          ⚠ {error}
        </div>
      )}
      <div className="form-grid">
        <div className="form-field">
          <label>产品名称</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Industrial RO System" />
        </div>
        <div className="form-field">
          <label>型号</label>
          <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="AF-RO-1200" />
        </div>
        <div className="form-field full">
          <label>分类</label>
          <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Water Treatment" />
        </div>
        <div className="form-field full">
          <label>参数（每行一个，格式 Key: Value）</label>
          <textarea rows="3" value={form.specsText} onChange={(e) => setForm({ ...form, specsText: e.target.value })} />
        </div>
        <div className="form-field full">
          <label>卖点（每行一个）</label>
          <textarea rows="2" value={form.benefitsText} onChange={(e) => setForm({ ...form, benefitsText: e.target.value })} />
        </div>
        <div className="form-field full">
          <label>应用场景（每行一个）</label>
          <textarea rows="2" value={form.applicationsText} onChange={(e) => setForm({ ...form, applicationsText: e.target.value })} />
        </div>
      </div>
      <div className="onboard-actions">
        <button type="submit" className="primary-btn" disabled={submitting}>
          {submitting ? 'AI 生成中…' : '✦ AI 生成内容并保存'}
        </button>
        <button type="button" className="ghost-btn" onClick={onCancel}>取消</button>
      </div>
    </form>
  )
}
