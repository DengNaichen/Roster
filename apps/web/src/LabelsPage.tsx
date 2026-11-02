import { LabelManager } from "./LabelManager";
import { PageHeader } from "./PageHeader";
import { useLabels } from "./useLabels";

export default function LabelsPage() {
  const catalog = useLabels();
  return (
    <>
      <PageHeader>
        <span>Labels</span>
      </PageHeader>
      <LabelManager catalog={catalog} onMerged={() => {}} />
    </>
  );
}
