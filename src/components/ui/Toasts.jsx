import { useApp } from '../../app/store/AppContext'

export default function Toasts() {
  const { toasts } = useApp()
  if (!toasts.length) return null
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className="toast show">{t.message}</div>
      ))}
    </div>
  )
}
