import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-12 gap-4 text-center">
          <p className="text-lg font-bold text-red-400">Something went wrong</p>
          <p className="text-sm text-muted-foreground max-w-sm">{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button
            className="text-xs underline text-muted-foreground"
            onClick={() => this.setState({ hasError: false, error: null })}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
