/**
 * Serves the explosive-chess Agent Guide at /agent-guide/explosive-chess.
 * English and Chinese protocol bodies stay in docs/; the live host is prepended per request.
 */
import protocolEn from "../docs/agent-ws-explosive-chess.md?raw";
import protocolZh from "../docs/agent-ws-explosive-chess.zh.md?raw";
import { agentGuideHttpResponse } from "../shared/explosive-chess/agent-guide";

export function handleAgentGuide(request: Request): Response | null {
  return agentGuideHttpResponse(request, { en: protocolEn, zh: protocolZh });
}
