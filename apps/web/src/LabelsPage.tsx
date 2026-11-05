import { LabelManager } from "./LabelManager";
import { PageHeader } from "./PageHeader";
import { useLabels } from "./useLabels";

export default function LabelsPage() {
  const catalog = useLabels();
  return (
    <>
      <PageHeader>
        <span className="settings-breadcrumb">Settings</span>
        <span>/</span>
        <span>Labels</span>
      </PageHeader>
      <div className="settings-labels-intro">
        <h1>Labels</h1>
      </div>
      <LabelManager catalog={catalog} onMerged={() => {}} />
    </>
  );
}
