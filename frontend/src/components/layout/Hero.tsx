import { useState } from 'react'
import { Activity, ArrowRight } from 'lucide-react'
import { prefersReducedMotion } from '../../utils/motion'

// Drop your video (or gif / image) into frontend/public and
// point this at it. Videos should be muted, no audio needed.
const HERO_MEDIA_SRC = '/hero.mp4'
const HERO_POSTER_SRC = '' // optional still frame, e.g. '/hero-poster.jpg'

const HERO_IS_IMAGE = /\.(gif|webp|png|jpe?g|avif|svg)$/i.test(HERO_MEDIA_SRC)

function HeroPlaceholder() {
  // Shown only while no hero media file exists yet.
  return (
    <div className="absolute inset-0">
      <div className="hero-glow absolute -right-24 top-1/2 h-[30rem] w-[30rem] -translate-y-1/2 rounded-full bg-[#E10600]/30 blur-3xl" />
      <div className="hero-stripes absolute inset-0" />
    </div>
  )
}

function HeroMedia() {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reduceMotion] = useState(prefersReducedMotion)

  const mediaClass = `absolute inset-0 h-full w-full object-cover transition-opacity duration-[2500ms] ease-out ${ready ? 'opacity-100' : 'opacity-0'
    }`

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 lg:left-auto lg:w-[68%]"
    >
      {failed ? (
        <HeroPlaceholder />
      ) : HERO_IS_IMAGE ? (
        <img
          src={HERO_MEDIA_SRC}
          alt=""
          className={mediaClass}
          onLoad={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <video
          src={HERO_MEDIA_SRC}
          poster={HERO_POSTER_SRC || undefined}
          className={mediaClass}
          autoPlay={!reduceMotion}
          loop={!reduceMotion}
          muted
          playsInline
          // Reduced motion users see a still frame, so fetch less up front.
          preload={reduceMotion ? 'metadata' : 'auto'}
          disablePictureInPicture
          onLoadedData={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      )}

      {/* Phones: dim the whole clip so the text stays readable */}
      <div className="absolute inset-0 bg-[#080c14]/70 lg:hidden" />

      {/* Left edge: the slow fade from page background into the clip */}
      <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-[#080c14] via-[#080c14]/60 to-transparent lg:w-3/5" />

      {/* Bottom and top edges melt into the page */}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#080c14] to-transparent" />
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#080c14] to-transparent" />
    </div>
  )
}

export default function Hero() {
  return (
    <section id="dashboard" className="relative isolate overflow-hidden">
      <HeroMedia />

      <div className="relative z-10 mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
        <div className="max-w-3xl">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-red-400">
            <Activity size={14} aria-hidden="true" />
            Universal Sim Racing Intelligence
          </p>

          <h2 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
            EVERY LAP
            <span className="block text-[#E10600]">TELLS A STORY.</span>
          </h2>

          <p className="mt-6 max-w-2xl leading-8 text-slate-400">
            Analyze your race data, measure tyre wear and pit-stop losses,
            and let the Strategy Advisor find a faster race plan from
            your own recorded pace.
          </p>

          <a
            href="#analyze"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[#E10600] px-6 py-4 text-sm font-bold hover:bg-red-700"
          >
            Analyze Your Race
            <ArrowRight size={18} aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  )
}
