import { useCallback, useRef, useState } from 'react'
import RaceAnalysis from './components/analysis/RaceAnalysis'
import PitStopIntro from './components/intro/PitStopIntro'
import RaceCarDivider from './components/intro/RaceCarDivider'
import Hero from './components/layout/Hero'
import { FeatureHighlights, PlatformFeatures, SiteFooter } from './components/layout/Sections'
import SiteHeader from './components/layout/SiteHeader'
import StrategyAdvisor from './components/strategy/StrategyAdvisor'
import StrategyPlanner from './components/strategy/StrategyPlanner'
import { ErrorBanner } from './components/ui/Panel'
import AnalyzeSection from './components/upload/AnalyzeSection'
import { MAX_FILE_LABEL, MAX_FILE_SIZE } from './constants'
import { analyzeCsv } from './services/api'
import type { Analysis, UploadMode } from './types'
import { prefersReducedMotion } from './utils/motion'

function scrollToRef(ref: { current: HTMLElement | null }) {
  requestAnimationFrame(() => {
    ref.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    })
  })
}

function App() {
  const resultsRef = useRef<HTMLElement>(null)
  const introRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<AbortController | null>(null)

  // The analyze form fades in after the race car intro
  const [analyzeRevealed, setAnalyzeRevealed] = useState(prefersReducedMotion)

  // Session configuration
  const [category, setCategory] = useState('Formula Racing')
  const [simulator, setSimulator] = useState('F1 Series')

  // Upload
  const [uploadMode, setUploadMode] = useState<UploadMode>('csv')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')

  // Race analysis
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analysisId, setAnalysisId] = useState(0)
  const [analysisError, setAnalysisError] = useState('')
  const [loading, setLoading] = useState(false)

  // Pit stop intro that takes over the results area
  const [intro, setIntro] = useState(false)
  const finishIntro = useCallback(() => setIntro(false), [])

  function clearResults() {
    requestRef.current?.abort()
    setLoading(false)
    setIntro(false)
    setAnalysis(null)
    setAnalysisError('')
  }

  function chooseFile(file: File) {
    clearResults()

    if (!file.name.toLowerCase().endsWith(`.${uploadMode}`)) {
      setSelectedFile(null)
      setFileError(`Please select a ${uploadMode.toUpperCase()} file.`)
      return
    }
    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      setSelectedFile(null)
      setFileError(`File must be larger than 0 bytes and at most ${MAX_FILE_LABEL}.`)
      return
    }

    setSelectedFile(file)
    setFileError('')
  }

  function changeMode(mode: UploadMode) {
    setUploadMode(mode)
    setSelectedFile(null)
    setFileError('')
    clearResults()
  }

  function removeFile() {
    setSelectedFile(null)
    setFileError('')
    clearResults()
  }

  async function analyzeRace() {
    if (!selectedFile || uploadMode !== 'csv' || loading || intro) return

    const controller = new AbortController()
    requestRef.current = controller
    const playIntro = !prefersReducedMotion()

    setLoading(true)
    setAnalysisError('')
    setAnalysis(null)
    setIntro(playIntro)
    if (playIntro) scrollToRef(introRef)

    try {
      const result = await analyzeCsv(selectedFile, controller.signal)
      if (controller.signal.aborted) return
      setAnalysis(result)
      setAnalysisId((id) => id + 1)
      if (!playIntro) scrollToRef(resultsRef)
    } catch (error) {
      if (controller.signal.aborted) return
      setIntro(false)
      setAnalysisError(
        error instanceof Error ? error.message : 'Unable to connect to Laplogic.'
      )
    } finally {
      if (requestRef.current === controller) setLoading(false)
    }
  }

  const showResults = analysis !== null && !intro && selectedFile !== null

  return (
    <div className="app-bg min-h-screen text-white">
      <a
        href="#analyze"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[#E10600] focus:px-4 focus:py-2"
      >
        Skip to race analysis
      </a>

      <SiteHeader />
      <Hero />

      <main className="mx-auto max-w-7xl px-5 pb-20 lg:px-8">
        <FeatureHighlights />

        {/* RACE DATA UPLOAD */}
        <section id="analyze" className="scroll-mt-28">
          <RaceCarDivider onReveal={setAnalyzeRevealed} />

          <div className={`analyze-reveal ${analyzeRevealed ? 'is-revealed' : ''}`}>
            <p className="text-xs font-bold uppercase tracking-widest text-red-400">Start Here</p>
            <h2 className="mt-2 text-3xl font-bold">New Race Analysis</h2>
            <p className="mt-2 text-sm text-slate-400">
              Select your racing category and upload your session data.
            </p>
            <div className="section-rule mb-7" />

            <AnalyzeSection
              category={category}
              simulator={simulator}
              circuit={analysis?.circuit ?? null}
              uploadMode={uploadMode}
              selectedFile={selectedFile}
              fileError={fileError}
              busy={loading || intro}
              onCategoryChange={(value) => {
                setCategory(value)
                clearResults()
              }}
              onSimulatorChange={(value) => {
                setSimulator(value)
                clearResults()
              }}
              onModeChange={changeMode}
              onChooseFile={chooseFile}
              onRemoveFile={removeFile}
              onAnalyze={analyzeRace}
            />
          </div>
        </section>

        {analysisError && <ErrorBanner message={analysisError} className="mt-8" />}

        {intro && (
          <div ref={introRef} className="mt-16 scroll-mt-28">
            <PitStopIntro ready={analysis !== null} onDone={finishIntro} />
          </div>
        )}

        {showResults && (
          <>
            <RaceAnalysis
              analysis={analysis}
              category={category}
              simulator={simulator}
              sectionRef={resultsRef}
            />

            {uploadMode === 'csv' && (
              <StrategyAdvisor
                key={`advisor-${analysisId}`}
                file={selectedFile}
                simulator={simulator}
              />
            )}

            <StrategyPlanner
              key={`planner-${analysisId}`}
              analysis={analysis}
              file={selectedFile}
              simulator={simulator}
            />
          </>
        )}

        <PlatformFeatures />
        <SiteFooter />
      </main>
    </div>
  )
}

export default App
