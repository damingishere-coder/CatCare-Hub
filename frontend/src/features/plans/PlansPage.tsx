import { useCallback, useState } from "react";

import { useUnsavedChanges } from "../../components/ui/useUnsavedChanges";
import { PageHeader } from "../../components/ui/PageHeader";
import { DailyPlansPage } from "./DailyPlansPage";

export function PlansPage() {
  const [scheduleDirty, setScheduleDirty] = useState(false);
  useUnsavedChanges(scheduleDirty);

  const handleDirtyChange = useCallback((dirty: boolean) => setScheduleDirty(dirty), []);

  return (
    <section className="cc-page cc-page--wide" aria-labelledby="plans-page-title">
      <PageHeader
        eyebrow="智能排程"
        title="路线图"
        headingId="plans-page-title"
        description="安排今天的上门顺序，查看家到客户再返回的路线。"
      />
      {scheduleDirty ? <p className="mt-3 text-right text-xs text-amber-700">当前排程尚未保存。</p> : null}
      <div className="mt-6">
        <DailyPlansPage onDirtyChange={handleDirtyChange} />
      </div>
    </section>
  );
}
