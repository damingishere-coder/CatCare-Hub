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
    <div className="min-h-screen bg-[#f3f5f8] text-[#182033] lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-[#171d2a] text-white lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
        <div className="flex h-[72px] items-center gap-3 border-b border-white/10 px-5">
          <div
            className="flex size-9 items-center justify-center rounded-lg bg-indigo-500 text-white shadow-[0_8px_20px_rgba(79,70,229,0.25)]"
            aria-hidden="true"
          >
            <PawPrint size={19} />
          </div>
          <div>
            <p className="font-semibold tracking-[-0.02em]">CatCare-Hub</p>
            <p className="text-[11px] text-slate-400">喂猫业务管理</p>
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
                  "group flex min-h-10 shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-white/12 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                    : "text-slate-400 hover:bg-white/7 hover:text-white",
                ].join(" ")
              }
            >
              <Icon className="transition-transform group-hover:scale-105" size={17} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 bg-[#f3f5f8]">
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-[#e4e8ef]/80 bg-white/88 px-5 backdrop-blur-xl lg:px-8">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            本地安全工作区
          </div>
          <SessionControls />
        </header>
        <div className="p-5 sm:p-6 lg:p-8 xl:p-9">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
