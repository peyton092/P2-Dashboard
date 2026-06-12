import { Component } from 'react'

const O = '#F47920'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null, copied: false }
    this.reset = this.reset.bind(this)
    this.reload = this.reload.bind(this)
    this.copy = this.copy.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('[ErrorBoundary]', error, info)
  }

  reset() {
    this.setState({ hasError: false, error: null, info: null, copied: false })
  }

  reload() {
    window.location.reload()
  }

  async copy() {
    const err = this.state.error
    const text = [
      err?.message || 'Unknown error',
      err?.stack || '',
      this.state.info?.componentStack || '',
    ].filter(Boolean).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    } catch { /* clipboard unavailable */ }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const err = this.state.error
    const msg = err?.message || 'An unexpected error occurred.'

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.025] p-6 text-center">
          <div
            className="mx-auto mb-4 flex items-center justify-center rounded-2xl"
            style={{ width: 48, height: 48, backgroundColor: O + '22' }}
          >
            <svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true">
              <rect x="2" y="2" width="44" height="44" rx="11" fill={O} />
              <path d="M27 11 L17 27 L23.5 27 L21 37 L32 21 L25.5 21 Z" fill="#fff" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-white">This page hit a snag</h2>
          <p className="text-xs text-zinc-400 mt-1.5 break-words">{msg}</p>

          <div className="flex flex-col sm:flex-row gap-2 mt-5">
            <button
              type="button"
              onClick={this.reset}
              className="flex-1 text-xs font-bold px-3 py-2 rounded-lg text-white transition-colors"
              style={{ backgroundColor: O }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.reload}
              className="flex-1 text-xs font-semibold px-3 py-2 rounded-lg border border-white/15 text-zinc-200 hover:text-white hover:border-white/30 transition-colors"
            >
              Reload page
            </button>
          </div>

          <button
            type="button"
            onClick={this.copy}
            className="mt-3 text-[11px] text-zinc-400 hover:text-zinc-300 underline-offset-2 hover:underline"
          >
            {this.state.copied ? 'Copied error details' : 'Copy error details'}
          </button>
        </div>
      </div>
    )
  }
}
