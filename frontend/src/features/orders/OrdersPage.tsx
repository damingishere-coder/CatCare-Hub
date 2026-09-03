import {
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  LoaderCircle,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ConnectionErrorAlert } from "../../components/ui/ConnectionErrorAlert";
import { localDateValue } from "../../components/ui/calendarDates";
import { displayOrderNumber } from "../../lib/orderNumber";
import {
  createOrder,
  clearDemoData,
  deleteOrder,
  getOrder,
  getOrderFormOptions,
  listOrders,
  previewDemoData,
  retryOrderGeocode,
  updateOrder,
  updateOrderStatus,
} from "./api";
import { serviceItemOptions } from "./constants";
import { OrderForm } from "./OrderForm";
import { OrderDayVisits, OrderScheduleCalendar } from "./OrderScheduleCalendar";
import type {
  OrderDetail,
  OrderCreateInput,
  OrderFormOptions,
  OrderPatchInput,
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

interface OrdersPageProps {
  initialCreate?: boolean;
}

export function OrdersPage({ initialCreate = false }: OrdersPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedOrderId = Number(searchParams.get("order_id"));
  const selectedOrderId = Number.isInteger(requestedOrderId) && requestedOrderId > 0
    ? requestedOrderId
    : null;
  const requestedDate = searchParams.get("date") || localDateValue();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [formOptions, setFormOptions] = useState<OrderFormOptions | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(
    initialCreate ? "create" : null,
  );
  const [statusSaving, setStatusSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const listRequestId = useRef(0);
  const createIdempotencyKey = useRef(crypto.randomUUID());

  function beginCreate() {
    createIdempotencyKey.current = crypto.randomUUID();
    setFormMode("create");
  }

  const applyOrders = useCallback((items: OrderSummary[]) => {
    setOrders(items);
  }, []);

  const refreshOrders = useCallback(async () => {
    const requestId = ++listRequestId.current;
    setListLoading(true);
    setPageError(null);
    try {
      const response = await listOrders();
      if (requestId === listRequestId.current) applyOrders(response.items);
    } catch (cause) {
      if (requestId === listRequestId.current) {
        setOrders([]);
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

  async function handleSave(payload: OrderCreateInput | OrderPatchInput) {
    const saved =
      formMode === "edit" && orderDetail
        ? await updateOrder(
            orderDetail.id,
            payload as OrderPatchInput,
            orderDetail.write_revision,
          )
        : await createOrder(payload as OrderCreateInput, createIdempotencyKey.current);
    setOrderDetail(saved);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("order_id", String(saved.id));
      return next;
    });
    setFormMode(null);
    await refreshOrders();
    setScheduleRefreshKey((current) => current + 1);
    createIdempotencyKey.current = crypto.randomUUID();
  }

  function selectOrder(orderId: number) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("order_id", String(orderId));
      return next;
    });
  }

  function toggleListedOrder(orderId: number) {
    if (selectedOrderId === orderId) {
      closeOrderDetail();
      return;
    }
    selectOrder(orderId);
  }

  function closeOrderDetail() {
    setOrderDetail(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("order_id");
      return next;
    });
  }

  function selectScheduleDate(date: string) {
    setOrderDetail(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("date", date);
      next.delete("task_id");
      next.delete("order_id");
      return next;
    });
  }

  async function handleStatusChange(status: OrderStatus) {
    if (!orderDetail || status === orderDetail.order_status) return;
    if (status === "cancelled" && !window.confirm("确认取消这个订单及尚未执行的任务吗？")) return;

    setStatusSaving(true);
    setPageError(null);
    try {
      const updated = await updateOrderStatus(
        orderDetail.id,
        status,
        orderDetail.write_revision,
      );
      setOrderDetail(updated);
      await refreshOrders();
      setScheduleRefreshKey((current) => current + 1);
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : "订单状态更新失败，请重试。");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleDelete() {
    if (!orderDetail?.deletable) return;
    if (!window.confirm(`确认永久删除订单 #${displayOrderNumber(orderDetail)} 吗？此操作不能撤销。`)) return;
    setDeleting(true);
    setPageError(null);
    try {
      await deleteOrder(orderDetail.id, orderDetail.write_revision);
      closeOrderDetail();
      await refreshOrders();
      setScheduleRefreshKey((current) => current + 1);
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : "订单删除失败，请重试。");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDemoClear() {
    if (!orderDetail?.is_demo_data) return;
    setDeleting(true);
    setPageError(null);
    try {
      const preview = await previewDemoData();
      const counts = preview.counts;
      const confirmed = window.confirm(
        `将永久清除系统演示数据：${counts.customers} 位客户、${counts.cats} 只猫咪、${counts.orders} 笔订单、${counts.tasks} 个任务、${counts.payments} 条收款。确认继续吗？`,
      );
      if (!confirmed) return;
      await clearDemoData();
      closeOrderDetail();
      await refreshOrders();
      setScheduleRefreshKey((current) => current + 1);
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : "演示数据清理失败，请重试。");
    } finally {
      setDeleting(false);
    }
  }

  async function handleGeocodeRetry() {
    if (!orderDetail) return;
    setGeocoding(true);
    setPageError(null);
    try {
      const updated = await retryOrderGeocode(
        orderDetail.id,
        orderDetail.write_revision,
      );
      setOrderDetail(updated);
      await refreshOrders();
      setScheduleRefreshKey((current) => current + 1);
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : "地址定位重试失败。");
    } finally {
      setGeocoding(false);
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
    <section aria-labelledby="page-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="cc-eyebrow">订单与任务</p>
          <h2 id="page-title" className="mt-1 text-xl font-semibold tracking-tight text-slate-950">订单管理</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">录入服务订单，自动计算次数和费用，并生成每日任务。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="cc-button cc-button--secondary" onClick={() => setListCollapsed((current) => !current)} aria-expanded={!listCollapsed} aria-controls="orders-secondary-list">
            {listCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            {listCollapsed ? "展开订单列表" : "收起订单列表"}
          </button>
          <button
            type="button"
            className="cc-button cc-button--primary"
            onClick={beginCreate}
            disabled={!formOptions}
          >
            <Plus size={17} />
            新建订单
          </button>
        </div>
      </div>

      {pageError ? (
        <ConnectionErrorAlert className="mt-5" message={pageError} onRetry={() => void refreshOrders()} />
      ) : null}

      <div className={`cc-surface mt-6 grid min-h-[680px] overflow-hidden p-0 ${listCollapsed ? "lg:grid-cols-[minmax(0,1fr)]" : "lg:grid-cols-[320px_minmax(0,1fr)]"}`}>
        <aside id="orders-secondary-list" className={`${listCollapsed ? "hidden" : "block"} border-b border-slate-200 lg:border-r lg:border-b-0`} aria-label="订单列表">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">全部订单</p>
            <span className="text-xs text-slate-500">{orders.length} 单</span>
          </div>
          <div className="cc-scrollbar max-h-[760px] overflow-y-auto p-2">
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
                      className={`w-full rounded-xl px-3 py-3 text-left transition-colors ${selectedOrderId === order.id ? "bg-orange-50 text-slate-950 shadow-sm ring-1 ring-orange-200" : "hover:bg-slate-100"}`}
                      onClick={() => toggleListedOrder(order.id)}
                      aria-pressed={selectedOrderId === order.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="truncate text-sm font-semibold">#{displayOrderNumber(order)} · {order.customer.name}</span>
                        <StatusBadge status={order.order_status} />
                      </div>
                      <p className={`mt-1 text-xs ${selectedOrderId === order.id ? "text-orange-800" : "text-slate-500"}`}>
                        {shortDate(order.start_date)} – {shortDate(order.end_date)} · {order.total_visits} 次
                      </p>
                      <div className={`mt-2 flex items-center justify-between text-xs ${selectedOrderId === order.id ? "text-orange-800" : "text-slate-500"}`}>
                        <span>{order.cats.length ? order.cats.map((cat) => cat.name).join("、") : `${order.cat_count} 只猫`}</span>
                        <span className="font-medium">{currency(order.total_amount)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <main className="min-w-0 bg-slate-50/60 p-4 sm:p-5" aria-label="订单月历与详情">
          <div className="space-y-5">
        {selectedOrderId === null ? (
          <OrderScheduleCalendar
            selectedDate={requestedDate}
            onSelectDate={selectScheduleDate}
            onSelectOrder={selectOrder}
            refreshKey={scheduleRefreshKey}
          />
        ) : <section className="cc-scrollbar h-[min(620px,72vh)] min-h-[480px] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 shadow-sm" aria-label="订单详情区域">
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
                    <h2 className="text-xl font-semibold text-slate-950">订单 #{displayOrderNumber(orderDetail)}</h2>
                    <StatusBadge status={orderDetail.order_status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{orderDetail.customer.name}{orderDetail.customer.address ? ` · ${orderDetail.customer.address}` : ""}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="cc-button cc-button--secondary min-h-10 px-3" onClick={closeOrderDetail} aria-label="关闭订单详情"><X size={15} />关闭</button>
                  {(["pending_confirmation", "confirmed"] as OrderStatus[]).includes(orderDetail.order_status) ? <button type="button" className="cc-button cc-button--secondary min-h-10 px-3 text-red-700" onClick={() => void handleStatusChange("cancelled")} disabled={statusSaving}>{statusSaving ? <LoaderCircle className="animate-spin" size={15} /> : null}取消订单</button> : null}
                  {orderDetail.is_demo_data ? <button type="button" className="cc-button cc-button--secondary min-h-10 px-3 text-red-700" onClick={() => void handleDemoClear()} disabled={deleting}>{deleting ? <LoaderCircle className="animate-spin" size={15} /> : <Trash2 size={15} />}清除整套演示数据</button> : <button type="button" className="cc-button cc-button--secondary min-h-10 px-3 text-red-700 disabled:cursor-not-allowed disabled:opacity-45" onClick={() => void handleDelete()} disabled={!orderDetail.deletable || deleting} title={orderDetail.delete_block_reason ?? "永久删除订单"}>{deleting ? <LoaderCircle className="animate-spin" size={15} /> : <Trash2 size={15} />}删除订单</button>}
                  <button type="button" className="cc-button cc-button--secondary min-h-10 px-3" onClick={() => setFormMode("edit")}>
                    <Pencil size={15} />编辑订单
                  </button>
                </div>
              </div>

              {orderDetail.customer_resolution ? <p className="cc-alert cc-alert--success mt-4">客户档案已同步：{orderDetail.customer_resolution === "created" ? "已新建档案" : orderDetail.customer_resolution === "selected" ? "已关联所选档案" : "已匹配现有档案"}。</p> : null}
              {orderDetail.pending_cat_profile_count > 0 ? <p className="cc-alert cc-alert--warning mt-3">客户档案仍有 {orderDetail.pending_cat_profile_count} 只猫咪资料待补；订单未创建占位猫咪。</p> : null}

              <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="order-overview-title">
                <h3 id="order-overview-title" className="flex items-center gap-2 text-sm font-semibold text-slate-950"><CalendarDays size={16} />服务概览</h3>
                <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                  <DetailItem label="服务日期" value={orderDetail.service_schedule.map((entry) => `${entry.service_date}${entry.visit_count > 1 ? `（${entry.visit_count} 次）` : ""}`).join("、")} />
                  <DetailItem label="服务次数" value={`${orderDetail.service_days} 个日期 · ${orderDetail.total_visits} 次`} />
                  <DetailItem label="客户" value={orderDetail.customer.name} />
                  <DetailItem label="猫咪" value={orderDetail.cats.length ? `${orderDetail.cat_count} 只（${orderDetail.cats.map((cat) => `${cat.name}${cat.is_active ? "" : "（已停用）"}`).join("、")}）` : `${orderDetail.cat_count} 只`} />
                  <div className="sm:col-span-2 xl:col-span-4"><DetailItem label="服务内容" value={orderDetail.service_items.map((item) => serviceLabels[item]).join("、")} /></div>
                </dl>
              </section>

              <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="order-contact-title">
                <h3 id="order-contact-title" className="text-sm font-semibold text-slate-950">订单联系人与入户快照</h3>
                <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                  <DetailItem label="联系人" value={orderDetail.service_contact.name} />
                  <DetailItem label="电话 / 微信" value={[orderDetail.service_contact.phone, orderDetail.service_contact.wechat_name].filter(Boolean).join(" / ") || "未填写"} />
                  <DetailItem label="上门地址" value={orderDetail.customer.address || "未填写（无法自动规划路线）"} />
                  <DetailItem label="小区门禁" value={orderDetail.service_contact.community_access_method || "未填写"} />
                  <DetailItem label="楼下门禁" value={orderDetail.service_contact.building_access_method || "未填写"} />
                  {orderDetail.service_contact.access_method ? <DetailItem label="历史门禁方式（待分类）" value={orderDetail.service_contact.access_method} /> : null}
                  <div className="sm:col-span-2 xl:col-span-4"><DetailItem label="门禁 / 钥匙 / 客户备注" value={[orderDetail.service_contact.access_info, orderDetail.service_contact.key_status, orderDetail.service_contact.key_code, orderDetail.service_contact.notes].filter(Boolean).join("；") || "未填写"} /></div>
                </dl>
                {!orderDetail.deletable && orderDetail.delete_block_reason ? <p className="mt-4 text-xs text-slate-500">删除限制：{orderDetail.delete_block_reason}</p> : null}
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2.5 py-1 font-medium ${orderDetail.route_geocode_status === "resolved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{orderDetail.route_geocode_status === "resolved" ? "地址已定位" : orderDetail.route_geocode_status === "missing" ? "缺少地址" : orderDetail.route_geocode_status === "failed" ? "定位失败" : "地址待定位"}</span>{orderDetail.route_geocode_status !== "resolved" && orderDetail.route_geocode_status !== "missing" ? <button type="button" className="cc-button cc-button--secondary min-h-8 px-2.5 text-xs" onClick={() => void handleGeocodeRetry()} disabled={geocoding}>{geocoding ? <LoaderCircle className="animate-spin" size={13} /> : <MapPin size={13} />}重试定位</button> : null}</div>
              </section>

              <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="order-price-title">
                <h3 id="order-price-title" className="flex items-center gap-2 text-sm font-semibold text-slate-950"><CircleDollarSign size={16} />费用与收款</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">每次价格</p><p className="mt-1 font-semibold">{currency(orderDetail.unit_price)}</p><p className="mt-1 text-xs text-slate-500">{orderDetail.pricing_mode === "per_visit" ? "最终单次价格" : "历史订单折算单价"}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">已收</p><p className="mt-1 font-semibold">{currency(orderDetail.paid_amount)}</p></div>
                  <div className="rounded-xl bg-[#FF9500] p-3 text-[#1D1D1F]"><p className="text-xs text-orange-950">应收</p><p className="mt-1 text-lg font-semibold">{currency(orderDetail.total_amount)}</p></div>
                  <div className="rounded-md bg-amber-50 p-3"><p className="text-xs text-amber-700">待收 · {paymentStatusLabels[orderDetail.payment_status]}</p><p className="mt-1 text-lg font-semibold text-amber-900">{currency(orderDetail.due_amount)}</p></div>
                </div>
                {Number(orderDetail.overpaid_amount) > 0 ? <div className="cc-alert cc-alert--warning mt-3">当前超收 {currency(orderDetail.overpaid_amount)}{Number(orderDetail.due_amount) > 0 ? `，同时仍有待收 ${currency(orderDetail.due_amount)}；按服务日期分别核对，不能跨日抵消。` : "，当前没有待收；请按实际情况线下退款或保留为客户余额。"}</div> : null}
                <p className="mt-3 text-xs text-slate-500">结算方式：{orderDetail.settlement_mode === "daily" ? "按服务日期日结" : "整单结算"}</p>
                {orderDetail.daily_receivables.length > 0 ? <div className="mt-4 overflow-x-auto"><table className="cc-table min-w-full text-left text-xs"><thead><tr><th className="px-3 py-2">服务日期</th><th className="px-3 py-2">应收</th><th className="px-3 py-2">已收</th><th className="px-3 py-2">待收</th><th className="px-3 py-2">超收</th></tr></thead><tbody>{orderDetail.daily_receivables.map((item) => <tr key={item.service_date}><td className="px-3 py-2">{item.service_date}</td><td className="px-3 py-2">{currency(item.expected_amount)}</td><td className="px-3 py-2 text-emerald-700">{currency(item.paid_amount)}</td><td className="px-3 py-2 font-medium text-amber-700">{currency(item.due_amount)}</td><td className="px-3 py-2 font-medium text-red-700">{currency(item.overpaid_amount)}</td></tr>)}</tbody></table></div> : null}
              </section>

              <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="order-notes-title">
                <h3 id="order-notes-title" className="text-sm font-semibold text-slate-950">服务备注</h3>
                <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${orderDetail.notes ? "text-slate-700" : "text-slate-400"}`}>{orderDetail.notes || "未填写"}</p>
              </section>

              <section className="mt-6" aria-labelledby="generated-tasks-title">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 id="generated-tasks-title" className="text-base font-semibold text-slate-950">已生成任务</h3>
                    <p className="mt-1 text-xs text-slate-500">共 {orderDetail.task_count} 个任务；具体时间与顺序由“路线图”维护。</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"><CheckCircle2 size={13} />自动生成完成</span>
                </div>
                <div className="mt-3 space-y-2">
                  {Object.entries(tasksByDate ?? {}).map(([date, tasks]) => (
                    <article key={date} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{date}</p>
                        <Link className="cc-button cc-button--secondary min-h-8 px-2.5 text-xs" to={`/admin/routes?date=${date}&task_id=${tasks[0].id}`}><MapPin size={13} />查看路线</Link>
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
        </section>}
            <OrderDayVisits selectedDate={requestedDate} onSelectOrder={selectOrder} refreshKey={scheduleRefreshKey} />
          </div>
        </main>
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
