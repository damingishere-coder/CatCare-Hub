import { LoaderCircle, X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import type { CatDetail, CatInput, CustomerDetail, CustomerInput } from "./types";

const inputClass =
  "mt-1.5 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400";
const labelClass = "block text-sm font-medium text-slate-700";

function optionalValue(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

interface FormDialogProps {
  title: string;
  description: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}

function FormDialog({
  title,
  description,
  saving,
  error,
  onCancel,
  onSubmit,
  children,
}: FormDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-[2px] sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-form-title"
    >
      <form
        className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-2xl"
        onSubmit={onSubmit}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <h2 id="record-form-title" className="text-lg font-semibold text-slate-950">
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <button
            type="button"
            className="cc-icon-button"
            onClick={onCancel}
            aria-label="关闭表单"
            disabled={saving}
          >
            <X size={18} />
          </button>
        </div>

        <div className="cc-scrollbar max-h-[calc(100vh-13rem)] space-y-7 overflow-y-auto px-5 py-5 sm:px-6">
          {error ? (
            <p className="cc-alert cc-alert--danger" role="alert">
              {error}
            </p>
          ) : null}
          {children}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4 sm:px-6">
          <button
            type="button"
            className="cc-button cc-button--secondary"
            onClick={onCancel}
            disabled={saving}
          >
            取消
          </button>
          <button
            type="submit"
            className="cc-button cc-button--primary"
            disabled={saving}
          >
            {saving ? <LoaderCircle className="animate-spin" size={16} /> : null}
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

interface CustomerFormDialogProps {
  initial?: CustomerDetail;
  onCancel: () => void;
  onSave: (payload: CustomerInput) => Promise<void>;
}

export function CustomerFormDialog({ initial, onCancel, onSave }: CustomerFormDialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = optionalValue(formData, "name");
    if (!name) {
      setError("请填写客户姓名。");
      return;
    }

    const payload: CustomerInput = {
      name,
      wechat_name: optionalValue(formData, "wechat_name"),
      phone: optionalValue(formData, "phone"),
      community: optionalValue(formData, "community"),
      address: optionalValue(formData, "address"),
      building: optionalValue(formData, "building"),
      unit: optionalValue(formData, "unit"),
      room: optionalValue(formData, "room"),
      access_method: optionalValue(formData, "access_method"),
      access_info: optionalValue(formData, "access_info"),
      key_status: optionalValue(formData, "key_status"),
      key_code: optionalValue(formData, "key_code"),
      notes: optionalValue(formData, "notes"),
      is_repeat_customer: formData.get("is_repeat_customer") === "on",
    };

    setSaving(true);
    setError(null);
    try {
      await onSave(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "客户保存失败，请重试。");
      setSaving(false);
    }
  }

  return (
    <FormDialog
      title={initial ? "编辑客户" : "新增客户"}
      description="门禁、钥匙和地址信息仅保存在本地业务数据库中。"
      saving={saving}
      error={error}
      onCancel={onCancel}
      onSubmit={handleSubmit}
    >
      <section aria-labelledby="customer-basic-fields">
        <h3 id="customer-basic-fields" className="text-sm font-semibold text-slate-950">
          基本信息
        </h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            姓名 <span className="text-red-600">*</span>
            <input className={inputClass} name="name" defaultValue={initial?.name ?? ""} required maxLength={100} />
          </label>
          <label className={labelClass}>
            微信昵称
            <input className={inputClass} name="wechat_name" defaultValue={initial?.wechat_name ?? ""} maxLength={100} />
          </label>
          <label className={labelClass}>
            手机号
            <input className={inputClass} name="phone" type="tel" defaultValue={initial?.phone ?? ""} maxLength={32} />
          </label>
          <label className="flex items-center gap-2 self-end rounded-md border border-slate-200 px-3 py-2.5 text-sm text-slate-700">
            <input name="is_repeat_customer" type="checkbox" defaultChecked={initial?.is_repeat_customer ?? false} />
            标记为老客户
          </label>
        </div>
      </section>

      <section aria-labelledby="customer-address-fields">
        <h3 id="customer-address-fields" className="text-sm font-semibold text-slate-950">
          地址
        </h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            小区
            <input className={inputClass} name="community" defaultValue={initial?.community ?? ""} maxLength={200} />
          </label>
          <label className={labelClass}>
            详细地址
            <input className={inputClass} name="address" defaultValue={initial?.address ?? ""} maxLength={1000} />
          </label>
          <label className={labelClass}>
            楼栋
            <input className={inputClass} name="building" defaultValue={initial?.building ?? ""} maxLength={50} />
          </label>
          <label className={labelClass}>
            单元
            <input className={inputClass} name="unit" defaultValue={initial?.unit ?? ""} maxLength={50} />
          </label>
          <label className={labelClass}>
            房号
            <input className={inputClass} name="room" defaultValue={initial?.room ?? ""} maxLength={50} />
          </label>
        </div>
      </section>

      <section aria-labelledby="customer-access-fields">
        <h3 id="customer-access-fields" className="text-sm font-semibold text-slate-950">
          门禁与钥匙
        </h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            门禁方式
            <input className={inputClass} name="access_method" defaultValue={initial?.access_method ?? ""} maxLength={100} />
          </label>
          <label className={labelClass}>
            钥匙状态
            <input className={inputClass} name="key_status" defaultValue={initial?.key_status ?? ""} maxLength={50} placeholder="待取 / 已取 / 已归还 / 无需钥匙" />
          </label>
          <label className={labelClass}>
            钥匙编号
            <input className={inputClass} name="key_code" defaultValue={initial?.key_code ?? ""} maxLength={100} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            入户信息
            <textarea className={inputClass} name="access_info" defaultValue={initial?.access_info ?? ""} rows={3} maxLength={4000} />
          </label>
        </div>
      </section>

      <section aria-labelledby="customer-notes-field">
        <h3 id="customer-notes-field" className="text-sm font-semibold text-slate-950">
          客户备注
        </h3>
        <label className={`${labelClass} mt-3`}>
          注意事项
          <textarea className={inputClass} name="notes" defaultValue={initial?.notes ?? ""} rows={4} maxLength={4000} />
        </label>
      </section>
    </FormDialog>
  );
}

interface CatFormDialogProps {
  initial?: CatDetail;
  onCancel: () => void;
  onSave: (payload: CatInput) => Promise<void>;
}

export function CatFormDialog({ initial, onCancel, onSave }: CatFormDialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = optionalValue(formData, "name");
    if (!name) {
      setError("请填写猫咪名字。");
      return;
    }
    const ageValue = optionalValue(formData, "age");
    const age = ageValue === null ? null : Number(ageValue);
    if (age !== null && (!Number.isFinite(age) || age < 0 || age > 999)) {
      setError("猫咪年龄必须是 0 到 999 之间的数字。");
      return;
    }

    const payload: CatInput = {
      name,
      photo_url: optionalValue(formData, "photo_url"),
      gender: optionalValue(formData, "gender"),
      age,
      breed: optionalValue(formData, "breed"),
      personality: optionalValue(formData, "personality"),
      food: optionalValue(formData, "food"),
      food_preference: optionalValue(formData, "food_preference"),
      litter_type: optionalValue(formData, "litter_type"),
      medication_required: formData.get("medication_required") === "on",
      medication_notes: optionalValue(formData, "medication_notes"),
      special_notes: optionalValue(formData, "special_notes"),
      service_notes: optionalValue(formData, "service_notes"),
    };

    setSaving(true);
    setError(null);
    try {
      await onSave(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "猫咪保存失败，请重试。");
      setSaving(false);
    }
  }

  return (
    <FormDialog
      title={initial ? "编辑猫咪" : "添加猫咪"}
      description="记录日常喂养、用药和上门服务时需要注意的信息。"
      saving={saving}
      error={error}
      onCancel={onCancel}
      onSubmit={handleSubmit}
    >
      <section aria-labelledby="cat-basic-fields">
        <h3 id="cat-basic-fields" className="text-sm font-semibold text-slate-950">
          基本信息
        </h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            名字 <span className="text-red-600">*</span>
            <input className={inputClass} name="name" defaultValue={initial?.name ?? ""} required maxLength={100} />
          </label>
          <label className={labelClass}>
            性别
            <select className={inputClass} name="gender" defaultValue={initial?.gender ?? ""}>
              <option value="">未填写</option>
              <option value="female">母猫</option>
              <option value="male">公猫</option>
              <option value="unknown">未知</option>
            </select>
          </label>
          <label className={labelClass}>
            年龄
            <input className={inputClass} name="age" type="number" min="0" max="999" step="0.1" defaultValue={initial?.age ?? ""} />
          </label>
          <label className={labelClass}>
            品种
            <input className={inputClass} name="breed" defaultValue={initial?.breed ?? ""} maxLength={100} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            图片路径或 URL
            <input className={inputClass} name="photo_url" defaultValue={initial?.photo_url ?? ""} maxLength={500} placeholder="本轮不上传文件，可暂时留空" />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            性格
            <textarea className={inputClass} name="personality" defaultValue={initial?.personality ?? ""} rows={2} maxLength={4000} />
          </label>
        </div>
      </section>

      <section aria-labelledby="cat-feeding-fields">
        <h3 id="cat-feeding-fields" className="text-sm font-semibold text-slate-950">
          饮食与猫砂
        </h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            主食
            <textarea className={inputClass} name="food" defaultValue={initial?.food ?? ""} rows={2} maxLength={4000} />
          </label>
          <label className={labelClass}>
            饮食偏好
            <textarea className={inputClass} name="food_preference" defaultValue={initial?.food_preference ?? ""} rows={2} maxLength={4000} />
          </label>
          <label className={labelClass}>
            猫砂类型
            <input className={inputClass} name="litter_type" defaultValue={initial?.litter_type ?? ""} maxLength={100} />
          </label>
        </div>
      </section>

      <section aria-labelledby="cat-medication-fields">
        <h3 id="cat-medication-fields" className="text-sm font-semibold text-slate-950">
          用药与特殊情况
        </h3>
        <div className="mt-3 space-y-4">
          <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2.5 text-sm text-slate-700">
            <input name="medication_required" type="checkbox" defaultChecked={initial?.medication_required ?? false} />
            需要喂药
          </label>
          <label className={labelClass}>
            喂药说明
            <textarea className={inputClass} name="medication_notes" defaultValue={initial?.medication_notes ?? ""} rows={3} maxLength={4000} />
          </label>
          <label className={labelClass}>
            特殊情况
            <textarea className={inputClass} name="special_notes" defaultValue={initial?.special_notes ?? ""} rows={3} maxLength={4000} />
          </label>
          <label className={labelClass}>
            服务注意事项
            <textarea className={inputClass} name="service_notes" defaultValue={initial?.service_notes ?? ""} rows={3} maxLength={4000} placeholder="例如：添粮、换水、清理猫砂、陪玩、拍照" />
          </label>
        </div>
      </section>
    </FormDialog>
  );
}
