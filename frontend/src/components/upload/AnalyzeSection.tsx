import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  UploadCloud,
  X,
} from 'lucide-react'
import { CATEGORIES, MAX_FILE_LABEL, SIMULATORS } from '../../constants'
import type { UploadMode } from '../../types'
import { formatSize } from '../../utils/format'
import { Panel, PanelTitle } from '../ui/Panel'

const SELECT_CLASS =
  'w-full appearance-none rounded-lg border border-white/15 bg-[#0c1320] px-4 py-3.5 pr-10 text-sm outline-none focus:border-red-500'

function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  id: string
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-sm text-slate-300">
        {label}
      </label>
      <div className="relative">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
          {options.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <ChevronDown size={18} aria-hidden="true" className="pointer-events-none absolute right-4 top-4 text-slate-400" />
      </div>
    </div>
  )
}

export default function AnalyzeSection({
  category,
  simulator,
  circuit,
  uploadMode,
  selectedFile,
  fileError,
  busy,
  onCategoryChange,
  onSimulatorChange,
  onModeChange,
  onChooseFile,
  onRemoveFile,
  onAnalyze,
}: {
  category: string
  simulator: string
  circuit: string | null
  uploadMode: UploadMode
  selectedFile: File | null
  fileError: string
  busy: boolean
  onCategoryChange: (value: string) => void
  onSimulatorChange: (value: string) => void
  onModeChange: (mode: UploadMode) => void
  onChooseFile: (file: File) => void
  onRemoveFile: () => void
  onAnalyze: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function resetInput() {
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) onChooseFile(file)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* CONFIGURATION */}
      <Panel>
        <PanelTitle step="01" title="Session Configuration" hint="Pick the category and game" />

        <SelectField
          id="category"
          label="Racing Category"
          value={category}
          options={CATEGORIES}
          onChange={onCategoryChange}
          className="mb-6"
        />

        <SelectField
          id="simulator"
          label="Simulator / Game"
          value={simulator}
          options={SIMULATORS}
          onChange={onSimulatorChange}
        />
        <p className="mt-2 text-xs text-slate-500">
          Sets the strategy rules, e.g. the F1 two-compound rule and typical pit loss.
        </p>

        <div className="mt-7 rounded-lg border border-white/10 bg-[#0c1320] p-4 text-sm">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Current Session</p>
          <dl className="space-y-3">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-400">Category</dt>
              <dd className="text-right font-semibold">{category}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-400">Simulator</dt>
              <dd className="text-right font-semibold">{simulator}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-400">Circuit</dt>
              <dd className="text-right font-semibold text-sky-400">{circuit ?? 'Read from CSV'}</dd>
            </div>
          </dl>
        </div>
      </Panel>

      {/* FILE UPLOAD */}
      <Panel>
        <PanelTitle step="02" title="Upload Race Data" hint="Add your session file" />
        <div className="mb-5 grid grid-cols-2 gap-3">
          {([
            { mode: 'csv', label: 'CSV Data', icon: <FileSpreadsheet size={18} aria-hidden="true" /> },
            { mode: 'pdf', label: 'PDF Report', icon: <FileText size={18} aria-hidden="true" /> },
          ] as const).map((item) => (
            <button
              key={item.mode}
              type="button"
              aria-pressed={uploadMode === item.mode}
              onClick={() => {
                resetInput()
                onModeChange(item.mode)
              }}
              className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-semibold transition ${uploadMode === item.mode
                ? 'border-[#E10600] bg-red-500/10'
                : 'border-white/10 bg-[#0c1320] text-slate-400 hover:border-white/30'
                }`}
            >
              {item.icon}{item.label}
            </button>
          ))}
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label={`Choose a ${uploadMode.toUpperCase()} file, or drag and drop it here`}
          aria-describedby="upload-help"
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileRef.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files[0]
            if (file) onChooseFile(file)
          }}
          className={`flex min-h-60 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center ${dragging
            ? 'border-red-500 bg-red-500/10'
            : 'border-white/20 bg-[#0c1320] hover:border-white/40'
            }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept={uploadMode === 'csv' ? '.csv,text/csv' : '.pdf'}
            onChange={handleInput}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />
          <UploadCloud size={36} className="mb-4 text-red-400" aria-hidden="true" />
          <p className="font-semibold">Drag & drop your {uploadMode.toUpperCase()} file</p>
          <p className="mt-2 text-sm text-slate-500">or click to browse</p>
          <p id="upload-help" className="mt-4 text-xs text-slate-500">
            Maximum size: {MAX_FILE_LABEL}
            {uploadMode === 'csv' && ' · needs a lap-time column; lap, tyre and pit columns improve the analysis'}
          </p>
        </div>

        {selectedFile && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex min-w-0 items-center gap-2">
              <CheckCircle2 size={19} className="shrink-0 text-emerald-400" aria-hidden="true" />
              <span className="min-w-0 truncate text-sm">
                {selectedFile.name}
                <span className="ml-2 text-slate-500">({formatSize(selectedFile.size)})</span>
              </span>
            </div>
            <button
              type="button"
              aria-label="Remove file"
              onClick={() => {
                resetInput()
                onRemoveFile()
              }}
            >
              <X size={18} />
            </button>
          </div>
        )}

        {fileError && <p role="alert" className="mt-4 text-sm text-red-400">{fileError}</p>}

        <button
          type="button"
          disabled={!selectedFile || uploadMode !== 'csv' || busy}
          onClick={onAnalyze}
          className="ignition group mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-[#E10600] px-6 py-4 font-bold transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
            : <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />}
          {busy ? 'Analyzing...' : 'Analyze Race'}
        </button>
        {uploadMode === 'pdf' && (
          <p className="mt-3 text-center text-xs text-amber-400">PDF analysis will be added later.</p>
        )}
      </Panel>
    </div>
  )
}
