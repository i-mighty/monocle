import type { NextPage } from "next";
import dynamic from "next/dynamic";

const AgentConversationLog = dynamic(
  () => import("../components/orchestration/AgentConversationLog"),
  { ssr: false }
);

const OrchestratePage: NextPage = () => {
  return (
    <div style={{
      display: "flex", height: "100vh",
      background: "#07070f", overflow: "hidden",
    }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <AgentConversationLog />
      </div>
    </div>
  );
};

export default OrchestratePage;
