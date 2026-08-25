import { CheckCircle2, LoaderCircle, MapPinned, Sparkles, SquareActivity } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ConnectionErrorAlert } from "../../components/ui/ConnectionErrorAlert";
import { PageHeader } from "../../components/ui/PageHeader";
import { hasAmapBrowserKey, hasAmapBrowserSecurityCode } from "../../features/plans/mapProvider";
import { getIntegrationSettings, testIntegration, type IntegrationSettings } from "../../features/settings/api";

function StatusPill({ configured }: { configured: boolean | undefined }) {
  const label = configured === undefined ? "状态未知" : configured ? "已配置（未测试）" : "未配置";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${configured ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{label}</span>;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [testing, setTesting] = useState<"amap" | "openai" | null>(null);
  const [results, setResults] = useState<Partial<Record<"amap" | "openai", string>>>({});
  const [error, setError] = useState<string | null>(null);
  const browserConfigured = hasAmapBrowserKey() && hasAmapBrowserSecurityCode();

  const loadSettings = useCallback(async () => {
    setError(null);
    try {
      setSettings(await getIntegrationSettings());
    } catch (cause) {
      setSettings(null);
      setError(cause instanceof Error ? cause.message : "配置状态加载失败，请重试。");
    }
  }, []);

  useEffect(() => {
    let active = true;
    getIntegrationSettings()
      .then((response) => {
        if (active) setSettings(response);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "配置状态加载失败，请重试。");
      });
    return () => {
      active = false;
    };
  }, []);

  async function runTest(target: "amap" | "openai") {
    setTesting(target);
    setError(null);
    try {
      const result = await testIntegration(target);
      setResults((current) => ({ ...current, [target]: result.message }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接测试失败");
    } finally {
      setTesting(null);
    }
  }

  return <section className="cc-page" aria-labelledby="settings-title">
    <PageHeader eyebrow="本地集成" title="设置" headingId="settings-title" description="只显示配置状态和测试结果；网页不会保存或回显任何 Key。" />
    {error ? <ConnectionErrorAlert className="mt-5" message={error} onRetry={() => void loadSettings()} /> : null}
    <div className="mt-6 grid gap-4 lg:grid-cols-3">
      <article className="cc-surface p-5"><div className="flex items-start justify-between gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-orange-50 text-orange-700"><MapPinned size={20} /></span><StatusPill configured={settings?.amap_backend.configured} /></div><h2 className="mt-4 font-semibold">高德后端路线服务</h2><p className="mt-2 text-sm leading-6 text-slate-600">负责地址解析、真实道路、距离、时间和路线折线。配置存在不代表已连接。</p>{settings?.amap_backend.message ? <p className="mt-3 text-xs text-amber-700">{settings.amap_backend.message}</p> : null}<button type="button" className="cc-button cc-button--secondary mt-4" disabled={!settings?.amap_backend.configured || testing !== null} onClick={() => void runTest("amap")}>{testing === "amap" ? <LoaderCircle className="animate-spin" size={15} /> : <SquareActivity size={15} />}测试连接</button>{results.amap ? <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 size={14} />{results.amap}</p> : null}</article>
      <article className="cc-surface p-5"><div className="flex items-start justify-between gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-orange-50 text-orange-700"><MapPinned size={20} /></span><StatusPill configured={browserConfigured} /></div><h2 className="mt-4 font-semibold">浏览器街道底图</h2><p className="mt-2 text-sm leading-6 text-slate-600">需要 VITE_AMAP_JS_API_KEY 和安全密钥。缺少任一项时会显示坐标网格。</p><p className="mt-3 text-xs font-medium text-amber-700">修改 Vite 环境变量后必须重启前端，当前页面不会保存 Key。</p></article>
      <article className="cc-surface p-5"><div className="flex items-start justify-between gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-orange-50 text-orange-700"><Sparkles size={20} /></span><StatusPill configured={settings?.gpt_recommendation.configured} /></div><h2 className="mt-4 font-semibold">GPT 路线建议</h2><p className="mt-2 text-sm leading-6 text-slate-600">当前电动车路线使用本地快速推荐；此独立 OpenAI 配置仅为将来支持真实批量路线矩阵的模式保留。</p><p className="mt-3 text-xs text-slate-500">Codex 登录不能替代独立 OPENAI_API_KEY。</p><button type="button" className="cc-button cc-button--secondary mt-4" disabled={!settings?.gpt_recommendation.configured || testing !== null} onClick={() => void runTest("openai")}>{testing === "openai" ? <LoaderCircle className="animate-spin" size={15} /> : <SquareActivity size={15} />}测试连接</button>{results.openai ? <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 size={14} />{results.openai}</p> : null}</article>
    </div>
  </section>;
}
