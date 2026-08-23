import { useState, type FormEvent } from "react";

import { FormDialog } from "../../components/ui/FormDialog";
import type { CatDetail, CatInput, CustomerDetail, CustomerInput } from "./types";
import {
  accessMethodOptions,
  customerAddress,
  keyStatusOptions,
  optionsWithLegacy,
} from "../../lib/customerDisplay";

const inputClass =
  "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-950 placeholder:text-slate-400";
const labelClass = "block text-sm font-medium text-slate-700";

function optionalValue(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
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
      setError("请填写客户名称。");
      return;
    }

    const payload: CustomerInput = {
      name,
      address: optionalValue(formData, "address"),
      access_method: optionalValue(formData, "access_method"),
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
      description="只保留上门服务真正需要的客户资料。"
      saving={saving}
      error={error}
      onCancel={onCancel}
      onSubmit={handleSubmit}
    >
      <section aria-labelledby="customer-basic-fields">
        <h3 id="customer-basic-fields" className="text-sm font-semibold text-slate-950">
          基本信息
        </h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className={labelClass}>
            名称 <span className="text-red-600">*</span>
            <input className={inputClass} name="name" defaultValue={initial?.name ?? ""} required maxLength={100} />
          </label>
          <label className="flex min-h-11 items-center gap-2 self-end rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-700">
            <input name="is_repeat_customer" type="checkbox" defaultChecked={initial?.is_repeat_customer ?? false} />
            标记为老客户
          </label>
        </div>
      </section>

      <section aria-labelledby="customer-address-fields">
        <h3 id="customer-address-fields" className="text-sm font-semibold text-slate-950">
          地址
        </h3>
        <label className={`${labelClass} mt-3`}>
          地址
          <textarea className={inputClass} name="address" defaultValue={initial ? customerAddress(initial) : ""} rows={2} maxLength={1000} placeholder="填写完整上门地址" />
        </label>
      </section>

      <section aria-labelledby="customer-access-fields">
        <h3 id="customer-access-fields" className="text-sm font-semibold text-slate-950">
          门禁与钥匙
        </h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            门禁方式
            <select className={inputClass} name="access_method" defaultValue={initial?.access_method ?? ""}>
              <option value="">未选择</option>
              {optionsWithLegacy(accessMethodOptions, initial?.access_method).map((option) => (
                <option key={option} value={option}>{accessMethodOptions.includes(option as typeof accessMethodOptions[number]) ? option : `历史值：${option}`}</option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            钥匙状态
            <select className={inputClass} name="key_status" defaultValue={initial?.key_status ?? ""}>
              <option value="">未选择</option>
              {optionsWithLegacy(keyStatusOptions, initial?.key_status).map((option) => (
                <option key={option} value={option}>{keyStatusOptions.includes(option as typeof keyStatusOptions[number]) ? option : `历史值：${option}`}</option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            钥匙编号
            <input className={inputClass} name="key_code" defaultValue={initial?.key_code ?? ""} maxLength={100} />
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
