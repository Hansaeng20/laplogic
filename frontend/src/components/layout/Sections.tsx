import { Activity, BarChart3, Flag, Gauge, Sparkles } from 'lucide-react'
import { Panel, SectionHeading } from '../ui/Panel'

const HIGHLIGHTS = [
  {
    icon: <Flag size={21} />,
    title: 'MULTI-SIMULATOR',
    description: 'F1, ACC, Assetto Corsa, iRacing, LMU and custom CSVs',
  },
  {
    icon: <BarChart3 size={21} />,
    title: 'DATA-DRIVEN',
    description: 'Clean-lap pace, tyre wear and pit-loss measurement',
  },
  {
    icon: <Sparkles size={21} />,
    title: 'STRATEGY ADVISOR',
    description: 'Finds a faster plan and tells you how sure it is',
  },
]

const FEATURES = [
  {
    icon: <Activity size={24} />,
    title: 'Lap Performance',
    description: 'Understand lap-time trends, consistency and outlier laps.',
  },
  {
    icon: <Gauge size={24} />,
    title: 'Race Strategy',
    description: 'Search every pit window and tyre combination your data supports.',
  },
  {
    icon: <Sparkles size={24} />,
    title: 'AI Race Engineer',
    description: 'Personalized AI racing insights coming later.',
  },
]

export function FeatureHighlights() {
  return (
    <section className="mb-12 grid gap-4 sm:grid-cols-3">
      {HIGHLIGHTS.map((item) => (
        <Panel key={item.title}>
          <div className="mb-4 text-red-400" aria-hidden="true">{item.icon}</div>
          <h3 className="text-sm font-bold tracking-wider">{item.title}</h3>
          <p className="mt-2 text-sm text-slate-400">{item.description}</p>
        </Panel>
      ))}
    </section>
  )
}

export function PlatformFeatures() {
  return (
    <section id="features" className="scroll-mt-28 pt-20">
      <SectionHeading eyebrow="The Platform" title="Built for Every Racer" />

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {FEATURES.map((feature) => (
          <Panel key={feature.title}>
            <div className="mb-5 text-red-400" aria-hidden="true">{feature.icon}</div>
            <h3 className="font-bold">{feature.title}</h3>
            <p className="mt-3 text-sm leading-7 text-slate-400">{feature.description}</p>
          </Panel>
        ))}
      </div>
    </section>
  )
}

export function SiteFooter() {
  return (
    <footer className="mt-20 flex flex-wrap justify-between gap-4 border-t border-white/10 pt-8 text-xs text-slate-500">
      <span>© {new Date().getFullYear()} Laplogic</span>
      <span>Race Smarter. Lap Faster.</span>
    </footer>
  )
}
