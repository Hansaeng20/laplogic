import { useState } from 'react'
import { Gauge, Menu, ShieldCheck, X } from 'lucide-react'

const LINKS = ['dashboard', 'analyze', 'strategy', 'features']

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0d1320]/95 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 lg:px-8">
        <a href="#dashboard" className="flex items-center gap-3">
          <div className="rounded-xl bg-[#E10600] p-3">
            <Gauge size={24} aria-hidden="true" />
          </div>

          <div>
            <h1 className="text-xl font-black tracking-widest">
              LAP<span className="text-[#E10600]">LOGIC</span>
            </h1>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
              Race Smarter. Lap Faster.
            </p>
          </div>
        </a>

        <nav aria-label="Main" className="hidden gap-8 text-sm text-slate-400 md:flex">
          {LINKS.map((name, index) => (
            <a
              key={name}
              href={`#${name}`}
              className={`capitalize ${index === 0 ? 'text-white' : 'hover:text-white'}`}
            >
              {name}
            </a>
          ))}
        </nav>

        <span className="hidden items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-400 md:flex">
          <ShieldCheck size={15} className="mr-2" aria-hidden="true" />
          Free to Use
        </span>

        <button
          type="button"
          className="md:hidden"
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {menuOpen && (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="flex flex-col gap-4 border-t border-white/10 p-5 text-sm md:hidden"
        >
          {LINKS.map((name) => (
            <a
              key={name}
              href={`#${name}`}
              className="capitalize"
              onClick={() => setMenuOpen(false)}
            >
              {name}
            </a>
          ))}
        </nav>
      )}
    </header>
  )
}
