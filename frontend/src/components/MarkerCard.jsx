import { useEffect } from 'react'

/**
 * MarkerCard.jsx
 * Full-screen printable AR card page + download button
 */
export default function MarkerCard({ onBack }) {
  // Inject print CSS via DOM (avoids JSX template literal parsing issues)
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'marker-print-css'
    style.textContent = '@media print { .no-print { display: none !important; } .print-card { box-shadow: none !important; border: none !important; } body { background: white !important; } }'
    document.head.appendChild(style)
    return () => { const el = document.getElementById('marker-print-css'); if (el) el.remove() }
  }, [])

  const handlePrint = () => window.print()

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = 'assets/bheem_marker.jpg'
    a.download = 'bheem_marker_card.jpg'
    a.click()
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center p-4 gap-5">
      {/* Header */}
      <div className="no-print flex items-center justify-between w-full max-w-lg">
        <button
          onClick={onBack}
          className="bg-slate-800 text-slate-300 border border-slate-700 px-4 py-2 rounded-2xl text-sm font-bold flex items-center gap-2"
        >
          ← Back
        </button>
        <h2 className="text-amber-300 font-black text-lg">Print Your AR Card</h2>
        <div className="w-16" />
      </div>

      {/* Card Preview */}
      <div className="print-card w-full max-w-lg rounded-3xl overflow-hidden shadow-[0_0_60px_rgba(245,158,11,0.3)] border-4 border-amber-400/50">
        <img
          src="assets/bheem_marker.jpg"
          alt="Chhota Bheem AR Marker Card"
          className="w-full h-auto block"
          draggable={false}
        />
      </div>

      {/* Instructions */}
      <div className="no-print bg-slate-900/80 border border-slate-700/50 rounded-2xl p-4 max-w-lg w-full">
        <p className="text-amber-300 font-black text-sm mb-2">📋 Instructions</p>
        <ol className="text-slate-300 text-xs space-y-1.5 list-decimal list-inside">
          <li>Print this card at A4 or A5 size (landscape) on plain paper</li>
          <li>Or display it full-screen on another device / monitor</li>
          <li>Open the <strong className="text-amber-300">Marker AR</strong> mode in the app</li>
          <li>Point your camera at this card — the elephant appears!</li>
          <li>Walk around the card to see it from all angles 🐘</li>
        </ol>
      </div>

      {/* Action Buttons */}
      <div className="no-print flex gap-3 w-full max-w-lg">
        <button
          onClick={handleDownload}
          className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all"
        >
          ⬇ Download JPG
        </button>
        <button
          onClick={handlePrint}
          className="flex-1 bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/30 transition-all hover:scale-105"
        >
          🖨 Print Card
        </button>
      </div>
    </div>
  )
}
