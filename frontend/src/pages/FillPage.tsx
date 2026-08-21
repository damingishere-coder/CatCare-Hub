import { ClipboardPenLine } from "lucide-react";
import { useParams } from "react-router-dom";

export function FillPage() {
  const { token } = useParams<{ token: string }>();

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-950">
      <section className="mx-auto max-w-xl" aria-labelledby="fill-title">
        <ClipboardPenLine className="text-slate-700" aria-hidden="true" />
        <p className="mt-5 text-xs font-semibold tracking-wider text-slate-500 uppercase">
          P10 预留入口
        </p>
        <h1 id="fill-title" className="mt-1 text-2xl font-semibold">
          客户信息填写
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {token
            ? "填写链接格式已识别。客户资料表单与安全校验将在后续轮次启用。"
            : "当前链接缺少专属 Token。请使用后台生成的完整填写链接。"}
        </p>
      </section>
    </main>
  );
}
