/**
 * Serves Agent Guides at /agent-guide/<slug>.
 * English and Chinese protocol bodies stay in docs/; the live host is prepended per request.
 */
import protocolEn from "../docs/agent-ws-explosive-chess.md?raw";
import protocolZh from "../docs/agent-ws-explosive-chess.zh.md?raw";
import chromaEn from "../docs/agent-ws-chroma-slide.md?raw";
import chromaZh from "../docs/agent-ws-chroma-slide.zh.md?raw";
import tideEn from "../docs/agent-ws-frontline-tide.md?raw";
import tideZh from "../docs/agent-ws-frontline-tide.zh.md?raw";
import { chromaAgentGuideHttpResponse } from "../shared/chroma-slide/agent-guide";
import { agentGuideHttpResponse } from "../shared/explosive-chess/agent-guide";
import { frontlineAgentGuideHttpResponse } from "../shared/frontline-tide/agent-guide";

export function handleAgentGuide(request: Request): Response | null {
  const tide = frontlineAgentGuideHttpResponse(request, { en: tideEn, zh: tideZh });
  if (tide) return tide;
  const chroma = chromaAgentGuideHttpResponse(request, { en: chromaEn, zh: chromaZh });
  if (chroma) return chroma;
  return agentGuideHttpResponse(request, { en: protocolEn, zh: protocolZh });
}
