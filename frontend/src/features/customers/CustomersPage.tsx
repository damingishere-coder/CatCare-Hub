import {
  Archive,
  Cat,
  ClipboardPenLine,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { ConnectionErrorAlert } from "../../components/ui/ConnectionErrorAlert";
import { PageHeader } from "../../components/ui/PageHeader";
import { customerAddress } from "../../lib/customerDisplay";
import {
  archiveCustomer,
  createCat,
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  updateCat,
  updateCustomer,
} from "./api";
import { CatFormDialog, CustomerFormDialog } from "./CustomerForms";
import type { CatDetail, CatInput, CustomerDetail, CustomerInput, CustomerSummary } from "./types";

function textOrPlaceholder(value: string | null | undefined): string {
  return value || "未填写";
}

function genderLabel(value: string | null): string {
  if (value === "female") return "母猫";
  if (value === "male") return "公猫";
  if (value === "unknown") return "未知";
  return "未填写";
}

function DetailItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className={`mt-1 text-sm leading-6 ${value ? "text-slate-900" : "text-slate-400"}`}>
        {textOrPlaceholder(value)}
      </dd>
    </div>
  );
}

interface CatCardProps {
  cat: CatDetail;
  changingStatus: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
}

function CatCard({ cat, changingStatus, onEdit, onToggleStatus }: CatCardProps) {
  return (
    <article className={`rounded-lg border p-4 ${cat.is_active ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-75"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-700">
            <Cat size={20} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-slate-950">{cat.name}</h4>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cat.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                {cat.is_active ? "在档" : "已停用"}
              </span>
              {cat.medication_required ? (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">需要喂药</span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {[genderLabel(cat.gender), cat.age ? `${cat.age} 岁` : null, cat.breed]
                .filter(Boolean)
                .join(" · ") || "基础资料未填写"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="cc-button cc-button--secondary min-h-9 px-3 text-xs"
            onClick={onEdit}
            aria-label={`编辑猫咪 ${cat.name}`}
          >
            <Pencil size={13} />
            编辑
          </button>
          <button
            type="button"
            className="cc-button cc-button--secondary min-h-9 px-3 text-xs"
            onClick={onToggleStatus}
            disabled={changingStatus}
          >
            {changingStatus ? <LoaderCircle className="animate-spin" size={13} /> : <RefreshCw size={13} />}
            {cat.is_active ? "停用" : "恢复"}
          </button>
        </div>
      </div>

      <dl className="mt-4 grid gap-x-5 gap-y-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
        <DetailItem label="主食" value={cat.food} />
        <DetailItem label="饮食偏好" value={cat.food_preference} />
        <DetailItem label="猫砂类型" value={cat.litter_type} />
        <DetailItem label="性格" value={cat.personality} />
        <DetailItem label="喂药说明" value={cat.medication_notes} />
        <DetailItem label="特殊情况" value={cat.special_notes} />
        <div className="sm:col-span-2">
          <DetailItem label="服务注意事项" value={cat.service_notes} />
        </div>
        {cat.photo_url ? (
          <div className="sm:col-span-2">
            <DetailItem label="图片记录路径" value={cat.photo_url} />
          </div>
        ) : null}
      </dl>
    </article>
  );
}

interface CustomersPageProps {
  initialCreate?: boolean;
}

export function CustomersPage({ initialCreate = false }: CustomersPageProps) {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [customerFormMode, setCustomerFormMode] = useState<"create" | "edit" | null>(
    initialCreate ? "create" : null,
  );
  const [catFormValue, setCatFormValue] = useState<CatDetail | "create" | null>(null);
  const [changingCatId, setChangingCatId] = useState<number | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [customerAction, setCustomerAction] = useState<"archive" | "delete" | null>(null);
  const listRequestId = useRef(0);

  const applyCustomerList = useCallback((items: CustomerSummary[], preferredId?: number) => {
    setCustomers(items);
    setSelectedCustomerId((current) => {
      if (preferredId && items.some((item) => item.id === preferredId)) {
        return preferredId;
      }
      if (current && items.some((item) => item.id === current)) {
        return current;
      }
      return items[0]?.id ?? null;
    });
  }, []);

  const refreshList = useCallback(async (query: string, preferredId?: number) => {
    const requestId = ++listRequestId.current;
    setListLoading(true);
    setPageError(null);
    try {
      const response = await listCustomers(query, includeArchived);
      if (requestId !== listRequestId.current) return;
      applyCustomerList(response.items, preferredId);
    } catch (cause) {
      if (requestId !== listRequestId.current) return;
      setCustomers([]);
      setSelectedCustomerId(null);
      setCustomerDetail(null);
      setPageError(cause instanceof Error ? cause.message : "客户列表加载失败，请重试。");
    } finally {
      if (requestId === listRequestId.current) setListLoading(false);
    }
  }, [applyCustomerList, includeArchived]);

  const refreshDetail = useCallback(async (customerId: number) => {
    const detail = await getCustomer(customerId);
    setCustomerDetail(detail);
    return detail;
  }, []);

  useEffect(() => {
    let active = true;
    const requestId = ++listRequestId.current;
    listCustomers("", includeArchived)
      .then((response) => {
        if (active && requestId === listRequestId.current) {
          applyCustomerList(response.items);
        }
      })
      .catch((cause: unknown) => {
        if (active && requestId === listRequestId.current) {
          setCustomers([]);
          setSelectedCustomerId(null);
          setCustomerDetail(null);
          setPageError(cause instanceof Error ? cause.message : "客户列表加载失败，请重试。");
        }
      })
      .finally(() => {
        if (active && requestId === listRequestId.current) setListLoading(false);
      });

    return () => {
      active = false;
    };
  }, [applyCustomerList, includeArchived]);

  useEffect(() => {
    if (selectedCustomerId === null) {
      return;
    }

    let active = true;
    getCustomer(selectedCustomerId)
      .then((detail) => {
        if (active) setCustomerDetail(detail);
      })
      .catch((cause: unknown) => {
        if (active) {
          setCustomerDetail(null);
          setPageError(cause instanceof Error ? cause.message : "客户详情加载失败，请重试。");
        }
      })
    return () => {
      active = false;
    };
  }, [selectedCustomerId]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchInput.trim();
    setSearchQuery(query);
    void refreshList(query);
  }

  async function handleCustomerSave(payload: CustomerInput) {
    if (customerFormMode === "edit" && customerDetail) {
      const updated = await updateCustomer(customerDetail.id, payload);
      setCustomerDetail(updated);
      setCustomerFormMode(null);
      await refreshList(searchQuery, updated.id);
      return;
    }

    const created = await createCustomer(payload);
    setSearchInput("");
    setSearchQuery("");
    setSelectedCustomerId(created.id);
    setCustomerDetail(created);
    setCustomerFormMode(null);
    await refreshList("", created.id);
  }

  async function handleCatSave(payload: CatInput) {
    if (!customerDetail) return;

    if (catFormValue !== "create" && catFormValue !== null) {
      await updateCat(customerDetail.id, catFormValue.id, payload);
    } else {
      await createCat(customerDetail.id, payload);
    }
    await refreshDetail(customerDetail.id);
    setCatFormValue(null);
    await refreshList(searchQuery, customerDetail.id);
  }

  async function handleCatStatus(cat: CatDetail) {
    if (!customerDetail) return;
    const action = cat.is_active ? "停用" : "恢复";
    if (!window.confirm(`确认${action}猫咪“${cat.name}”吗？`)) return;

    setChangingCatId(cat.id);
    setPageError(null);
    try {
      await updateCat(customerDetail.id, cat.id, { is_active: !cat.is_active });
      await refreshDetail(customerDetail.id);
      await refreshList(searchQuery, customerDetail.id);
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : `${action}猫咪失败，请重试。`);
    } finally {
      setChangingCatId(null);
    }
  }

  async function handleArchive() {
    if (!customerDetail) return;
    const archived = customerDetail.archived_at === null;
    if (!window.confirm(`确认${archived ? "归档" : "恢复"}客户“${customerDetail.name}”吗？`)) return;
    setCustomerAction("archive");
    setPageError(null);
    try {
      const updated = await archiveCustomer(customerDetail.id, archived);
      setCustomerDetail(updated);
      await refreshList(searchQuery, includeArchived ? updated.id : undefined);
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : "客户归档状态更新失败。");
    } finally {
      setCustomerAction(null);
    }
  }

  async function handleDeleteCustomer() {
    if (!customerDetail) return;
    if (!window.confirm(`仅无业务历史的纯档案可以删除。确认永久删除“${customerDetail.name}”吗？`)) return;
    setCustomerAction("delete");
    setPageError(null);
    try {
      await deleteCustomer(customerDetail.id);
      setCustomerDetail(null);
      setSelectedCustomerId(null);
      await refreshList(searchQuery);
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : "客户删除失败，请改用归档。");
    } finally {
      setCustomerAction(null);
    }
  }

  return (
    <section className="cc-page" aria-labelledby="page-title">
      <PageHeader
        eyebrow="客户与猫咪"
        title="客户档案"
        headingId="page-title"
        description="用最少字段维护客户、上门地址和猫咪照护资料。"
        actions={<>
          <a href="/admin/intake" className="cc-button cc-button--secondary"><ClipboardPenLine size={17} />客户填写</a>
          <button
            type="button"
            className="cc-button cc-button--primary"
            onClick={() => setCustomerFormMode("create")}
          >
            <Plus size={17} />
            新增客户
          </button>
        </>}
      />

      {pageError ? (
        <ConnectionErrorAlert className="mt-5" message={pageError} onRetry={() => void refreshList(searchQuery)} />
      ) : null}

      <div className="cc-surface mt-6 grid min-h-[640px] overflow-hidden p-0 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 lg:border-r lg:border-b-0" aria-label="客户列表">
          <form className="border-b border-slate-200 p-4" onSubmit={handleSearch} role="search">
            <label className="sr-only" htmlFor="customer-search">搜索客户</label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
                <input
                  id="customer-search"
                  type="search"
                  className="min-h-10 w-full rounded-lg border border-slate-300 py-2 pr-3 pl-9 text-sm"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="客户名称或猫咪"
                  maxLength={100}
                />
              </div>
              <button type="submit" className="cc-button cc-button--secondary min-h-10 px-3">
                搜索
              </button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />查看已归档档案</label>
            {searchQuery ? (
              <button
                type="button"
                className="mt-2 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900"
                onClick={() => {
                  setSearchInput("");
                  setSearchQuery("");
                  void refreshList("");
                }}
              >
                清除搜索“{searchQuery}”
              </button>
            ) : null}
          </form>

          <div className="cc-scrollbar max-h-[720px] overflow-y-auto p-2">
            {listLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
                <LoaderCircle className="animate-spin" size={17} />
                正在加载客户…
              </div>
            ) : customers.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <UserRound className="mx-auto text-slate-300" size={32} />
                <p className="mt-3 text-sm font-medium text-slate-700">{searchQuery ? "没有找到客户" : "还没有客户档案"}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{searchQuery ? "请换一个关键词，或清除搜索条件。" : "点击右上角“新增客户”开始录入。"}</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {customers.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      className={`w-full rounded-xl px-3 py-3 text-left transition-colors ${selectedCustomerId === customer.id ? "bg-[#FF9500] text-[#1D1D1F] shadow-sm" : "hover:bg-slate-100"}`}
                      onClick={() => setSelectedCustomerId(customer.id)}
                      aria-pressed={selectedCustomerId === customer.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="truncate text-sm font-semibold">{customer.name}</span>
                        {customer.is_repeat_customer ? (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${selectedCustomerId === customer.id ? "bg-white/15 text-white" : "bg-amber-50 text-amber-700"}`}>老客户</span>
                        ) : null}
                        {customer.archived_at ? <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">已归档</span> : null}
                      </div>
                      <p className={`mt-2 text-xs ${selectedCustomerId === customer.id ? "text-slate-300" : "text-slate-500"}`}>
                        在档猫咪 {customer.active_cat_count} 只
                        {customer.inactive_cat_count ? ` · 已停用 ${customer.inactive_cat_count} 只` : ""}
                        {customer.pending_cat_profile_count ? ` · 待补 ${customer.pending_cat_profile_count} 只` : ""}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <div className="min-w-0 bg-slate-50/60">
          {selectedCustomerId !== null && customerDetail?.id !== selectedCustomerId ? (
            <div className="flex h-full min-h-96 items-center justify-center gap-2 text-sm text-slate-500">
              <LoaderCircle className="animate-spin" size={18} />
              正在加载客户详情…
            </div>
          ) : selectedCustomerId === null || !customerDetail ? (
            <div className="flex h-full min-h-96 flex-col items-center justify-center px-6 text-center">
              <UserRound className="text-slate-300" size={38} />
              <p className="mt-4 text-sm font-medium text-slate-700">选择一位客户查看完整档案</p>
              <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">选择客户后可查看地址、门禁与猫咪资料。</p>
            </div>
          ) : (
            <div className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-slate-950">{customerDetail.name}</h2>
                    {customerDetail.is_repeat_customer ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">老客户</span> : null}
                    {customerDetail.archived_at ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">已归档</span> : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">档案编号 #{customerDetail.id}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="cc-button cc-button--secondary min-h-10 px-3" onClick={() => void handleArchive()} disabled={customerAction !== null}>{customerAction === "archive" ? <LoaderCircle className="animate-spin" size={15} /> : <Archive size={15} />}{customerDetail.archived_at ? "恢复档案" : "归档档案"}</button>
                  <button type="button" className="cc-button cc-button--secondary min-h-10 px-3 text-red-700" onClick={() => void handleDeleteCustomer()} disabled={customerAction !== null}>{customerAction === "delete" ? <LoaderCircle className="animate-spin" size={15} /> : <Trash2 size={15} />}删除档案</button>
                  <button
                    type="button"
                    className="cc-button cc-button--secondary min-h-10 px-3"
                    onClick={() => setCustomerFormMode("edit")}
                  >
                    <Pencil size={15} />
                    编辑客户
                  </button>
                  <button
                    type="button"
                    className="cc-button cc-button--primary min-h-10 px-3"
                    onClick={() => setCatFormValue("create")}
                  >
                    <Plus size={15} />
                    添加猫咪
                  </button>
                </div>
              </div>

              <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="customer-basic-title">
                <h3 id="customer-basic-title" className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <UserRound size={16} />
                  地址
                </h3>
                <dl className="mt-4">
                  <DetailItem label="完整地址" value={customerAddress(customerDetail)} />
                </dl>
              </section>

              <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="customer-access-title">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="customer-access-title" className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <LockKeyhole size={16} />
                    门禁与钥匙
                  </h3>
                </div>
                <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  <DetailItem label="小区门禁" value={customerDetail.community_access_method} />
                  <DetailItem label="楼下门禁" value={customerDetail.building_access_method} />
                  {customerDetail.access_method ? <DetailItem label="历史门禁方式（待分类）" value={customerDetail.access_method} /> : null}
                  <div className="flex gap-3">
                    <KeyRound className="mt-0.5 shrink-0 text-slate-500" size={16} />
                    <DetailItem label="钥匙状态 / 编号" value={[customerDetail.key_status, customerDetail.key_code].filter(Boolean).join(" · ") || null} />
                  </div>
                </dl>
              </section>

              <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="customer-notes-title">
                <h3 id="customer-notes-title" className="text-sm font-semibold text-slate-950">客户备注</h3>
                <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${customerDetail.notes ? "text-slate-700" : "text-slate-400"}`}>
                  {textOrPlaceholder(customerDetail.notes)}
                </p>
              </section>

              <section className="mt-6" aria-labelledby="customer-cats-title">
                {customerDetail.pending_cat_profile_count > 0 ? <p className="cc-alert cc-alert--warning mb-3">仍有 {customerDetail.pending_cat_profile_count} 只猫咪资料待补。订单只保留数量，不会自动生成占位猫咪。</p> : null}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 id="customer-cats-title" className="text-base font-semibold text-slate-950">猫咪档案</h3>
                    <p className="mt-1 text-xs text-slate-500">共 {customerDetail.cats.length} 只，停用记录仍保留并可恢复。</p>
                  </div>
                </div>
                <div className="mt-3 space-y-3">
                  {customerDetail.cats.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
                      <Cat className="mx-auto text-slate-300" size={32} />
                      <p className="mt-3 text-sm font-medium text-slate-700">尚未添加猫咪</p>
                      <button type="button" className="mt-3 text-sm font-medium text-slate-900 underline underline-offset-4" onClick={() => setCatFormValue("create")}>
                        添加第一只猫咪
                      </button>
                    </div>
                  ) : (
                    customerDetail.cats.map((cat) => (
                      <CatCard
                        key={cat.id}
                        cat={cat}
                        changingStatus={changingCatId === cat.id}
                        onEdit={() => setCatFormValue(cat)}
                        onToggleStatus={() => void handleCatStatus(cat)}
                      />
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {customerFormMode ? (
        <CustomerFormDialog
          key={`${customerFormMode}-${customerDetail?.id ?? "new"}`}
          initial={customerFormMode === "edit" ? customerDetail ?? undefined : undefined}
          onCancel={() => setCustomerFormMode(null)}
          onSave={handleCustomerSave}
        />
      ) : null}

      {catFormValue ? (
        <CatFormDialog
          key={catFormValue === "create" ? "new-cat" : `cat-${catFormValue.id}`}
          initial={catFormValue === "create" ? undefined : catFormValue}
          onCancel={() => setCatFormValue(null)}
          onSave={handleCatSave}
        />
      ) : null}
    </section>
  );
}
