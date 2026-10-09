export default function Modal({ open, onClose, children }) {
  if (!open) return null
  return (
    <div className="modal open">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-card">
        <button className="modal-close" onClick={onClose}>×</button>
        {children}
      </div>
    </div>
  )
}
