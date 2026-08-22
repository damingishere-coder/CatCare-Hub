import {
  CalendarRange,
  CircleGauge,
  CreditCard,
  PawPrint,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { SessionControls } from "../features/auth/SessionControls";

interface NavigationItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
}

const navigation: readonly NavigationItem[] = [
  { label: "工作台", to: "/admin", icon: CircleGauge, end: true },
  { label: "订单计划", to: "/admin/plans", icon: CalendarRange },
  { label: "客户档案", to: "/admin/customers", icon: PawPrint },
  { label: "收款记录", to: "/admin/payments", icon: CreditCard },
  { label: "设置", to: "/admin/settings", icon: Settings },
] as const;

export function AdminLayout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-slate-200 bg-white lg:min-h-screen lg:border-r lg:border-b-0">
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
          <div
            className="flex size-9 items-center justify-center rounded-lg bg-slate-900 text-white"
            aria-hidden="true"
          >
            <PawPrint size={19} />
          </div>
          <div>
            <p className="font-semibold tracking-tight">CatCare-Hub</p>
            <p className="text-xs text-slate-500">喂猫业务管理</p>
          </div>
        </div>

        <nav
          className="flex gap-1 overflow-x-auto p-3 lg:block lg:space-y-1"
          aria-label="后台主导航"
        >
          {navigation.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  "flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                ].join(" ")
              }
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="min-w-0">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-8">
          <p className="text-sm text-slate-500">本地管理后台</p>
          <SessionControls />
        </header>
        <div className="p-5 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
