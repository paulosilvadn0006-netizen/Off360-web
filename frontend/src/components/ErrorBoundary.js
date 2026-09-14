import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    try { console.error("[OFF360 ErrorBoundary]", error, info); } catch (_) {}
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-off-bg p-6 text-center" data-testid="error-boundary">
          <div className="w-full max-w-sm off-card p-6">
            <p className="font-display text-lg font-bold text-white">Algo deu errado ao carregar a tela</p>
            <p className="mt-2 text-sm text-gray-400">Não se preocupe — nenhum dado foi perdido. Toque no botão abaixo para recarregar.</p>
            <button
              data-testid="error-reload-btn"
              onClick={this.handleReload}
              className="mt-5 h-12 w-full rounded-xl off-gradient font-bold text-white"
            >
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
