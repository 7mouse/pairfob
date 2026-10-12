import {
  parseAgentTraceDetail,
  parseAgentTracePage,
  parseAgentTraceSummaryPage,
  type AgentTraceDetail,
  type AgentTracePage,
} from "../operations";
import { ProtocolError } from "./errors";
import { noteDaemonClock } from "../agent-trace-clock";
import { parseTurnWrites } from "./agent-trace-writes";

type ReadRPC = (op: string, params: Record<string, unknown>) => Promise<unknown>;

/** Rolling compatibility: prefer body-free summaries, but keep old daemons readable. */
export class AgentTraceRPC {
  private summarySupport: "unknown" | "yes" | "no" = "unknown";

  /** markers / labels / times / writes reflect GetConfig.capabilities.trace_markers / trace_labels / trace_times / trace_writes. */
  constructor(private readonly rpc: ReadRPC, private readonly markers: () => boolean = () => false,
    private readonly labels: () => boolean = () => false, private readonly times: () => boolean = () => false,
    private readonly writes: () => boolean = () => false) {}

  /**
   * The files the agent's edit tools wrote since the reader last spoke to it:
   * the newest page of the summary, read with writes:true and nothing else, so
   * the conversation's own reads keep the vocabulary they asked for. Null when
   * the daemon cannot say (no trace_writes).
   */
  async turnWrites(paneId: string): Promise<string[] | null> {
    if (!this.writes()) return null;
    return parseTurnWrites(await this.rpc("AgentTraceSummary", { pane_id: paneId, cursor: null, limit: 200, writes: true }));
  }

  async read(paneId: string, cursor: string | null = null, limit = 50): Promise<AgentTracePage> {
    const params = { pane_id: paneId, cursor, limit, ...(this.markers() ? { markers: true } : {}) };
    if (this.summarySupport !== "no") {
      try {
        // labels and times exist only on the summary read.
        const summary = { ...params, ...(this.labels() ? { labels: true } : {}), ...(this.times() ? { times: true } : {}) };
        const page = parseAgentTraceSummaryPage(await this.rpc("AgentTraceSummary", summary));
        if (page.now !== undefined) noteDaemonClock(page.now);
        this.summarySupport = "yes";
        return page;
      } catch (error) {
        if (!(error instanceof ProtocolError) || error.code !== "unknown_op") throw error;
        this.summarySupport = "no";
      }
    }
    return parseAgentTracePage(await this.rpc("AgentTrace", params));
  }

  async detail(paneId: string, detailRef: string): Promise<AgentTraceDetail> {
    const result = await this.rpc("AgentTraceDetail", { pane_id: paneId, detail_ref: detailRef });
    return parseAgentTraceDetail(result, detailRef);
  }
}
