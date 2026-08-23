import { useCallback, useState } from "react";

import { PageHeader } from "../../components/ui/PageHeader";
import { DailyPlansPage } from "./DailyPlansPage";

export function PlansPage() {
  const [scheduleDirty, setScheduleDirty] = useState(false);

  const handleDirtyChange = useCallback((dirty: boolean) => setScheduleDirty(dirty), []);

  return (
    <section className="cc-page cc-page--wide" aria-labelledby="plans-page-title">
      <PageHeader
        eyebrow="智能排程"
        title="路线图"
        headingId="plans-page-title"
        description="按日期安排任务，由 GPT 结合高德真实行车矩阵给出顺序建议，并由高德绘制路线。"
      />
      {scheduleDirty ? <p className="mt-3 text-right text-xs text-amber-700">当前排程尚未保存。</p> : null}
      <div className="mt-6">
        <DailyPlansPage onDirtyChange={handleDirtyChange} />
      </div>
    </section>
  );
}
