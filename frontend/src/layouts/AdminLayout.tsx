import {
  CalendarRange,
  CircleGauge,
  ClipboardList,
  CreditCard,
  PawPrint,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

interface NavigationItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
}

const navigation: readonly NavigationItem[] = [
  { label: "工作台", to: "/admin", icon: CircleGauge, end: true },
  { label: "订单管理", to: "/admin/orders", icon: ClipboardList },
  { label: "路线图", to: "/admin/routes", icon: CalendarRange },
  { label: "收款记录", to: "/admin/payments", icon: CreditCard },
  { label: "客户档案", to: "/admin/customers", icon: PawPrint },
  { label: "设置", to: "/admin/settings", icon: Settings },
] as const;

export function AdminLayout() {
  return (
    <div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="border-b border-black/6 bg-white/72 text-[#1D1D1F] backdrop-blur-2xl lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
        <div className="flex h-[72px] items-center gap-3 border-b border-black/6 px-5">
          <div
            className="flex size-10 items-center justify-center rounded-[13px] bg-[#FF9500] text-[#1D1D1F] shadow-[0_8px_24px_rgba(255,149,0,0.24)]"
            aria-hidden="true"
          >
            <PawPrint size={19} />
          </div>
          <div>
            <p className="font-semibold tracking-[-0.02em]">CatCare-Hub</p>
            <p className="text-[11px] text-slate-500">喂猫业务管理</p>
          </div>
        </div>

        <nav
          className="cc-scrollbar flex gap-1.5 overflow-x-auto p-3 lg:block lg:space-y-1.5 lg:p-4"
          aria-label="后台主导航"
        >
          {navigation.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  "group flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-orange-50 text-orange-800 shadow-[inset_0_0_0_1px_rgba(255,149,0,0.12)] [&_svg]:text-orange-600"
                    : "text-slate-600 hover:bg-black/4 hover:text-slate-950",
                ].join(" ")
              }
            >
              <Icon className="transition-transform group-hover:scale-105" size={17} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 bg-[#F5F5F7]">
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-black/6 bg-white/72 px-5 backdrop-blur-2xl lg:px-8">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            本地安全工作区
          </div>
          <span className="text-xs text-slate-400">仅限本机访问</span>
        </header>
        <div className="p-5 sm:p-6 lg:p-8 xl:p-9">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
