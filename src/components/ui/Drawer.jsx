export default function Drawer({ open, onClose, title, subtitle, url }) {
  return (
    <div className={`drawer${open ? ' open' : ''}`}>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel">
        <div className="drawer-head">
          <div>
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </div>
          <button onClick={onClose}>×</button>
        </div>
        <iframe src={url} title={title} />
      </div>
    </div>
  )
}
