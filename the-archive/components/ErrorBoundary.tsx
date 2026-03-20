'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-8">
          <div className="border border-red-500/30 p-8 max-w-md w-full">
            <div className="font-mono text-[9px] text-red-400 uppercase tracking-widest mb-4">
              SYSTEM ERROR
            </div>
            <h2 className="font-anton text-2xl text-white uppercase mb-3">
              Something went wrong
            </h2>
            <p className="font-mono text-[10px] text-white/40 uppercase tracking-wider mb-6">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="font-mono text-[10px] uppercase tracking-widest border border-white/20 hover:border-acid/60 text-white/50 hover:text-acid px-6 py-2 transition-all"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
