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
      <div className="settings-page">
        <header className="settings-heading">
          <h1>Labels</h1>
          <p>Labels tag issues across every team. A group allows one label per issue.</p>
        </header>
        <LabelManager catalog={catalog} onMerged={() => {}} />
      </div>
    </>
  );
}
