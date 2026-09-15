import './ViewfinderFrame.css'

/**
 * Corner-bracket frame — the recurring signature motif of the app.
 * Used both on the idle/start screen and around the live camera view,
 * so the "viewfinder" language ties the whole experience together.
 */
export default function ViewfinderFrame({ children, active = false, className = '' }) {
  return (
    <div className={`viewfinder ${active ? 'viewfinder--active' : ''} ${className}`}>
      <span className="vf-corner vf-tl" />
      <span className="vf-corner vf-tr" />
      <span className="vf-corner vf-bl" />
      <span className="vf-corner vf-br" />
      {children}
    </div>
  )
}
