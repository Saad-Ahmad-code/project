"use client";

/**
 * ErrorBoundary — catches JavaScript errors anywhere in the child component tree,
 * logs them to the /api/log endpoint, and displays a fallback UI.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <YourApp />
 *   </ErrorBoundary>
 *
 * The fallback UI shows a brief error message and a "Try Again" button that
 * resets the error state (hard navigation to force a fresh page load).
 */
import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log the error to our diagnostics backend
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: "error",
        message: `ErrorBoundary caught: ${error.message}`,
        source: "ErrorBoundary",
        context: { stack: error.stack, componentStack: errorInfo.componentStack },
      }),
    }).catch(() => {
      // Silently fail — can't log if logging fails
    });
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return <>{this.props.fallback}</>;
      }

      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Something went wrong
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <Button onClick={() => window.location.reload()} size="sm">
              Reload page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
