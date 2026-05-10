import { useEffect, useState } from "react";
import { api, subscribeStream, type Kpi, type Vm } from "./api";
import { KpiCard } from "./components/KpiCard";
import { VmCard } from "./components/VmCard";
import { AgentChat } from "./components/AgentChat";
import { SpawnVmDialog } from "./components/SpawnVmDialog";
import { Settings } from "./components/Settings";
import { AddKpiDialog } from "./components/AddKpiDialog";

export default function App() {
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [vms, setVms] = useState<Vm[]>([]);
  const [tab, setTab] = useState<"dashboard" | "chat" | "settings">("dashboard");
  const [spawnFor, setSpawnFor] = useState<Kpi | null>(null);
  const [addKpiOpen, setAddKpiOpen] = useState(false);

  useEffect(() => {
    api.listKpis().then(setKpis).catch(() => {});
    api.listVms().then(setVms).catch(() => {});
    const unsub = subscribeStream((e) => {
      if (e.type === "kpi.update" || e.type === "kpi.create") {
        api.listKpis().then(setKpis).catch(() => {});
      }
      if (e.type.startsWith("vm.")) {
        api.listVms().then(setVms).catch(() => {});
      }
    });
    return unsub;
  }, []);

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-line px-4 py-3 flex items-center gap-4 sticky top-0 bg-bg/90 backdrop-blur z-10">
        <div className="font-mono text-accent">▌VibeM</div>
        <div className="text-muted text-sm hidden sm:block">
          define KPIs · spawn VM agents · eval on cron
        </div>
        <div className="ml-auto flex gap-1">
          <TabButton active={tab === "dashboard"} onClick={() => setTab("dashboard")}>
            Dashboard
          </TabButton>
          <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
            Agent
          </TabButton>
          <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
            Settings
          </TabButton>
        </div>
      </header>

      {tab === "dashboard" ? (
        <main className="flex-1 p-4 grid gap-6 grid-cols-1 lg:grid-cols-[2fr_1fr]">
          <section>
            <div className="flex items-center mb-2">
              <SectionHeader>KPIs ({kpis.length})</SectionHeader>
              <button
                onClick={() => setAddKpiOpen(true)}
                className="ml-auto px-2.5 py-1 rounded border border-accent text-accent text-xs font-mono hover:bg-accent hover:text-bg transition-colors"
              >
                + add kpi
              </button>
            </div>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              {kpis.length === 0 && <Empty>No KPIs yet — ask the agent to create one.</Empty>}
              {kpis.map((k) => (
                <KpiCard
                  key={k.id}
                  kpi={k}
                  vms={vms.filter((v) => v.kpiId === k.id)}
                  onSpawn={setSpawnFor}
                />
              ))}
            </div>
          </section>
          <section>
            <SectionHeader>Running VMs ({vms.filter((v) => v.status === "running").length})</SectionHeader>
            <div className="grid gap-3">
              {vms.length === 0 && <Empty>No VMs running.</Empty>}
              {vms.map((v) => (
                <VmCard
                  key={v.id}
                  vm={v}
                  kpi={kpis.find((k) => k.id === v.kpiId)}
                  onPause={() => api.pauseVm(v.id)}
                  onResume={() => api.resumeVm(v.id)}
                  onKill={() => api.killVm(v.id)}
                />
              ))}
            </div>
          </section>
        </main>
      ) : tab === "chat" ? (
        <main className="flex-1 p-4">
          <AgentChat />
        </main>
      ) : (
        <main className="flex-1 p-4 overflow-y-auto">
          <Settings />
        </main>
      )}

      {spawnFor && <SpawnVmDialog kpi={spawnFor} onClose={() => setSpawnFor(null)} />}
      {addKpiOpen && (
        <AddKpiDialog
          onClose={() => setAddKpiOpen(false)}
          onCreated={() => api.listKpis().then(setKpis).catch(() => {})}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-1.5 rounded text-sm font-mono " +
        (active ? "bg-panel text-accent" : "text-muted hover:text-ink")
      }
    >
      {children}
    </button>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm uppercase tracking-wider text-muted mb-2">{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-line rounded p-6 text-muted text-sm text-center">
      {children}
    </div>
  );
}
