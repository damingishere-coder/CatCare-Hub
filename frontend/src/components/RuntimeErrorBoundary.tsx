import { Component, type ErrorInfo, type ReactNode } from "react";

interface RuntimeErrorBoundaryProps {
  children: ReactNode;
}

interface RuntimeErrorBoundaryState {
  failed: boolean;
}

const adminLinks = [
  ["工作台", "/admin"],
  ["订单", "/admin/orders"],
  ["路线", "/admin/routes"],
  ["收款", "/admin/payments"],
  ["客户", "/admin/customers"],
  ["设置", "/admin/settings"],
] as const;

export class RuntimeErrorBoundary extends Component<
  RuntimeErrorBoundaryProps,
  RuntimeErrorBoundaryState
> {
  state: RuntimeErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RuntimeErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("CatCare 页面渲染失败", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white px-6 py-4">
          <a className="text-lg font-bold" href="http://127.0.0.1:5180/admin">CatCare Hub</a>
          <nav className="mt-3 flex flex-wrap gap-3" aria-label="故障恢复导航">
            {adminLinks.map(([label, path]) => (
              <a key={path} className="text-sm text-slate-600 underline" href={`http://127.0.0.1:5180${path}`}>
                {label}
              </a>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-2xl px-6 py-16">
          <h1 className="text-2xl font-bold">页面遇到异常，但导航仍可使用</h1>
          <p className="mt-3 text-slate-600">请重新加载当前页面；如果问题持续，请返回工作台重试。</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="cc-button cc-button--primary" onClick={() => window.location.reload()}>
              重新加载
            </button>
            <a className="cc-button cc-button--secondary" href="http://127.0.0.1:5180/admin">
              返回工作台
            </a>
          </div>
        </main>
      </div>
    );
  }
}
