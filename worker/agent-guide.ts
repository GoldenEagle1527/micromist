/**
 * Serves docs/agent-ws-explosive-chess.md at /agent-guide/explosive-chess.
 * The markdown file is the only protocol body; the live host is prepended per request.
 */
import protocol from "../docs/agent-ws-explosive-chess.md?raw";
import { agentGuideHttpResponse } from "../shared/explosive-chess/agent-guide";

export function handleAgentGuide(request: Request): Response | null {
  return agentGuideHttpResponse(request, protocol);
}
