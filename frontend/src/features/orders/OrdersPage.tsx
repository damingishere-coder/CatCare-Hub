import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  LoaderCircle,
  Pencil,
  Plus,
  ReceiptText,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createOrder,
  getOrder,
  getOrderFormOptions,
  listOrders,
  updateOrder,
  updateOrderStatus,
} from "./api";
import { serviceItemOptions } from "./constants";
import { OrderForm } from "./OrderForm";
import type {
  OrderDetail,
  OrderFormOptions,
  OrderInput,
  OrderPaymentStatus,
  OrderStatus,
  OrderSummary,
  ServiceItem,
  TaskStatus,
} from "./types";

const orderStatusLabels: Record<OrderStatus, string> = {
  pending_confirmation: "待确认",
  confirmed: "已确认",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};

const paymentStatusLabels: Record<OrderPaymentStatus, string> = {
  unpaid: "未收款",
  partial: "部分收款",
  paid: "已收款",
  refunded: "已退款",
};

const taskStatusLabels: Record<TaskStatus, string> = {
  pending: "待确认",
  confirmed: "已确认",
  ready: "待执行",
  in_progress: "执行中",
  completed: "已完成",
  exception: "有异常",
  cancelled: "已取消",
};

const serviceLabels = Object.fromEntries(
  serviceItemOptions.map((item) => [item.value, item.label]),
) as Record<ServiceItem, string>;

function currency(value: string): string {
  return `¥${Number(value).toFixed(2)}`;
}

function shortDate(value: string): string {
  return value.replaceAll("-", "/");
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const style = {
    pending_confirmation: "bg-amber-50 text-amber-700",
    confirmed: "bg-blue-50 text-blue-700",
    in_progress: "bg-violet-50 text-violet-700",
    completed: "bg-emerald-50 text-emerald-700",
    cancelled: "bg-slate-200 text-slate-600",
  }[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{orderStatusLabels[status]}</span>;
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm leading-6 text-slate-900">{value}</dd>
    </div>
  );
}

export function OrdersPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [formOptions, setFormOptions] = useState<OrderFormOptions | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const listRequestId = useRef(0);

  const applyOrders = useCallback((items: OrderSummary[], preferredId?: number) => {
    setOrders(items);
    setSelectedOrderId((current) => {
      if (preferredId && items.some((item) => item.id === preferredId)) return preferredId;
      if (current && items.some((item) => item.id === current)) return current;
      return items[0]?.id ?? null;
    });
  }, []);

  const refreshOrders = useCallback(async (preferredId?: number) => {
    const requestId = ++listRequestId.current;
    setListLoading(true);
    setPageError(null);
    try {
      const response = await listOrders();
      if (requestId === listRequestId.current) applyOrders(response.items, preferredId);
    } catch (cause) {
      if (requestId === listRequestId.current) {
        setOrders([]);
        setSelectedOrderId(null);
        setOrderDetail(null);
        setPageError(cause instanceof Error ? cause.message : "订单列表加载失败，请重试。");
      }
    } finally {
      if (requestId === listRequestId.current) setListLoading(false);
    }
  }, [applyOrders]);

  useEffect(() => {
    let active = true;
    const requestId = ++listRequestId.current;
    Promise.all([listOrders(), getOrderFormOptions()])
      .then(([orderResponse, options]) => {
        if (!active) return;
        setFormOptions(options);
        if (requestId === listRequestId.current) applyOrders(orderResponse.items);
      })
      .catch((cause: unknown) => {
        if (active) {
          setPageError(cause instanceof Error ? cause.message : "订单页面加载失败，请重试。");
        }
      })
      .finally(() => {
        if (active && requestId === listRequestId.current) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyOrders]);

  useEffect(() => {
    if (selectedOrderId === null) return;
    let active = true;
    getOrder(selectedOrderId)
      .then((detail) => {
        if (active) setOrderDetail(detail);
      })
      .catch((cause: unknown) => {
        if (active) {
          setOrderDetail(null);
          setPageError(cause instanceof Error ? cause.message : "订单详情加载失败，请重试。");
        }
      });
    return () => {
      active = false;
    };
  }, [selectedOrderId]);

  async function handleSave(payload: OrderInput) {
    const saved =
      formMode === "edit" && orderDetail
        ? await updateOrder(orderDetail.id, payload)
        : await createOrder(payload);
    setOrderDetail(saved);
    setSelectedOrderId(saved.id);
    setFormMode(null);
    await refreshOrders(saved.id);
  }

  async function handleStatusChange(status: OrderStatus) {
    if (!orderDetail || status === orderDetail.order_status) return;
    if (status === "cancelled" && !window.confirm("确认取消这个订单及尚未执行的任务吗？")) return;

    setStatusSaving(true);
    setPageError(null);
    try {
      const updated = await updateOrderStatus(orderDetail.id, status);
      setOrderDetail(updated);
      await refreshOrders(updated.id);
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : "订单状态更新失败，请重试。");
    } finally {
      setStatusSaving(false);
    }
  }

  const tasksByDate = orderDetail?.tasks.reduce<Record<string, OrderDetail["tasks"]>>(
    (groups, task) => {
      (groups[task.service_date] ??= []).push(task);
      return groups;
    },
    {},
  );

  return (
    <section className="mx-auto max-w-7xl" aria-labelledby="page-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wider text-slate-500 uppercase">P3 · 订单与任务生成</p>
          <h2 id="page-title" className="text-xl font-semibold tracking-tight">订单管理</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">录入服务订单，自动计算次数和费用，并生成每日任务。</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => setFormMode("create")}
          disabled={!formOptions || formOptions.customers.length === 0}
        >
          <Plus size={17} />
          新建订单
        </button>
      </div>

      {pageError ? (
        <div className="mt-5 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <AlertCircle className="mt-0.5 shrink-0" size={17} />
          <span>{pageError}</span>
        </div>
      ) : null}

      {!listLoading && formOptions?.customers.length === 0 ? (
        <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">请先在“客户档案”中新增客户和猫咪，再创建订单。</p>
      ) : null}

      <div className="mt-6 grid min-h-[680px] overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-[350px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 lg:border-r lg:border-b-0" aria-label="订单列表">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">全部订单</p>
            <span className="text-xs text-slate-500">{orders.length} 单</span>
          </div>
          <div className="max-h-[760px] overflow-y-auto p-2">
            {listLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={17} />正在加载订单…</div>
            ) : orders.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <ReceiptText className="mx-auto text-slate-300" size={34} />
                <p className="mt-3 text-sm font-medium text-slate-700">还没有订单</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">准备好客户和猫咪档案后即可创建。</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {orders.map((order) => (
                  <li key={order.id}>
                    <button
                      type="button"
                      className={`w-full rounded-lg px-3 py-3 text-left transition-colors ${selectedOrderId === order.id ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
                      onClick={() => setSelectedOrderId(order.id)}
                      aria-pressed={selectedOrderId === order.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="truncate text-sm font-semibold">{order.customer.name}</span>
                        <StatusBadge status={order.order_status} />
                      </div>
                      <p className={`mt-1 text-xs ${selectedOrderId === order.id ? "text-slate-300" : "text-slate-500"}`}>
                        {shortDate(order.start_date)} – {shortDate(order.end_date)} · {order.total_visits} 次
                      </p>
                      <div className={`mt-2 flex items-center justify-between text-xs ${selectedOrderId === order.id ? "text-slate-300" : "text-slate-500"}`}>
                        <span>{order.cats.map((cat) => cat.name).join("、")}</span>
                        <span className="font-medium">{currency(order.total_amount)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <div className="min-w-0 bg-slate-50/60">
          {selectedOrderId !== null && orderDetail?.id !== selectedOrderId ? (
            <div className="flex h-full min-h-96 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} />正在加载订单详情…</div>
          ) : selectedOrderId === null || !orderDetail ? (
            <div className="flex h-full min-h-96 flex-col items-center justify-center px-6 text-center">
              <ClipboardList className="text-slate-300" size={40} />
              <p className="mt-4 text-sm font-medium text-slate-700">选择一笔订单查看详情</p>
              <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">选择订单后可查看费用、服务范围和自动生成的任务。</p>
            </div>
          ) : (
            <div className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-slate-950">订单 #{orderDetail.id}</h2>
                    <StatusBadge status={orderDetail.order_status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{orderDetail.customer.name}{orderDetail.customer.community ? ` · ${orderDetail.customer.community}` : ""}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                    value={orderDetail.order_status}
                    onChange={(event) => void handleStatusChange(event.target.value as OrderStatus)}
                    disabled={statusSaving}
                    aria-label="更新订单状态"
                  >
                    {Object.entries(orderStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => setFormMode("edit")}>
                    <Pencil size={15} />编辑订单
                  </button>
                </div>
              </div>

              <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="order-overview-title">
                <h3 id="order-overview-title" className="flex items-center gap-2 text-sm font-semibold text-slate-950"><CalendarDays size={16} />服务概览</h3>
                <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                  <DetailItem label="日期范围" value={`${orderDetail.start_date} 至 ${orderDetail.end_date}`} />
                  <DetailItem label="服务次数" value={`${orderDetail.service_days} 天 × ${orderDetail.visits_per_day} 次/天 = ${orderDetail.total_visits} 次`} />
                  <DetailItem label="客户" value={orderDetail.customer.name} />
                  <DetailItem label="猫咪" value={orderDetail.cats.map((cat) => `${cat.name}${cat.is_active ? "" : "（已停用）"}`).join("、")} />
                  <div className="sm:col-span-2 xl:col-span-4"><DetailItem label="服务内容" value={orderDetail.service_items.map((item) => serviceLabels[item]).join("、")} /></div>
                </dl>
              </section>

              <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="order-price-title">
                <h3 id="order-price-title" className="flex items-center gap-2 text-sm font-semibold text-slate-950"><CircleDollarSign size={16} />费用与收款</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-md bg-slate-50 p-3"><p className="text-xs text-slate-500">每次费用</p><p className="mt-1 font-semibold">{currency(String(Number(orderDetail.base_price) + Number(orderDetail.extra_cat_fee) + Number(orderDetail.stairs_fee)))}</p><p className="mt-1 text-xs text-slate-500">基础 {currency(orderDetail.base_price)} + 猫咪 {currency(orderDetail.extra_cat_fee)} + 爬楼 {currency(orderDetail.stairs_fee)}</p></div>
                  <div className="rounded-md bg-slate-50 p-3"><p className="text-xs text-slate-500">其他费用</p><p className="mt-1 font-semibold">{currency(orderDetail.other_fee)}</p></div>
                  <div className="rounded-md bg-slate-900 p-3 text-white"><p className="text-xs text-slate-300">应收</p><p className="mt-1 text-lg font-semibold">{currency(orderDetail.total_amount)}</p></div>
                  <div className="rounded-md bg-amber-50 p-3"><p className="text-xs text-amber-700">待收 · {paymentStatusLabels[orderDetail.payment_status]}</p><p className="mt-1 text-lg font-semibold text-amber-900">{currency(orderDetail.due_amount)}</p></div>
                </div>
              </section>

              <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="order-notes-title">
                <h3 id="order-notes-title" className="text-sm font-semibold text-slate-950">订单备注</h3>
                <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${orderDetail.notes ? "text-slate-700" : "text-slate-400"}`}>{orderDetail.notes || "未填写"}</p>
              </section>

              <section className="mt-6" aria-labelledby="generated-tasks-title">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 id="generated-tasks-title" className="text-base font-semibold text-slate-950">已生成任务</h3>
                    <p className="mt-1 text-xs text-slate-500">共 {orderDetail.task_count} 个任务；具体时间与排序请在“按天计划”中设置。</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"><CheckCircle2 size={13} />自动生成完成</span>
                </div>
                <div className="mt-3 space-y-2">
                  {Object.entries(tasksByDate ?? {}).map(([date, tasks]) => (
                    <article key={date} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{date}</p>
                        <span className="text-xs text-slate-500">{tasks.length} 次服务</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {tasks.map((task) => (
                          <span key={task.id} className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
                            第 {task.sort_order + 1} 次 · {taskStatusLabels[task.status]}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {formMode && formOptions ? (
        <OrderForm
          key={`${formMode}-${orderDetail?.id ?? "new"}`}
          options={formOptions}
          initial={formMode === "edit" ? orderDetail ?? undefined : undefined}
          onCancel={() => setFormMode(null)}
          onSave={handleSave}
        />
      ) : null}
    </section>
  );
}
