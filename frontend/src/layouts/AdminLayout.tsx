import {
  CalendarRange,
  CircleGauge,
  ClipboardList,
  CreditCard,
  PawPrint,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

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
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-[var(--cc-app)] text-[var(--cc-text)] lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="border-b border-black/6 bg-white text-[var(--cc-text)] lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
        <div className="flex h-[72px] items-center gap-3 border-b border-black/6 px-5">
          <div
            className="flex size-10 items-center justify-center rounded-xl bg-brand-700 text-white"
            aria-hidden="true"
          >
            <PawPrint size={19} />
          </div>
          <div>
            <p className="font-semibold tracking-[-0.02em]">CatCare-Hub</p>
            <p className="text-xs text-slate-500">喂猫业务管理</p>
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
                  isActive || (to === "/admin/orders" && pathname === "/admin/intake")
                    ? "bg-brand-100 text-brand-800 [&_svg]:text-brand-700"
                    : "text-slate-600 hover:bg-black/4 hover:text-slate-950",
                ].join(" ")
              }
            >
              <Icon className="transition-transform group-hover:scale-105" size={17} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="hidden px-7 py-4 text-xs leading-6 text-slate-500 lg:block">用心照顾每一只猫<br />从今天的安排开始。</p>
        <p className="px-5 pb-3 text-xs text-slate-500 lg:absolute lg:bottom-3">本地工作区 · 仅供受信任设备使用</p>
      </aside>

      <main className="min-w-0 bg-[var(--cc-app)]">
        <div className="p-5 sm:p-6 lg:p-8 xl:p-9">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
